import PocketBase from 'pocketbase';
import { AuthUser, DashboardData, CloudBackupMetadata, MonthlyTrend, ParkInfo, ReceivablePermission, UserRole } from '../types';
import { applyDashboardDataScope } from './dataScopeFilter';
import {
    normalizeReceivablePermissions,
    receivableDefaultsForRole,
    resolveHideRentPricing,
} from './receivablePermissions';
import type { IntegrationFullSnapshotV1 } from './integrationSnapshot';
import { INTEGRATION_FULL_SNAPSHOT_KIND } from './integrationSnapshot';
import type { DirtyPayload } from './dirtyTracker';
import { clearCurrentCloudAuthToken, setCurrentCloudAuthToken } from './cloudAuthToken';

/**
 * RecordMeta —— 增量保存的「行级乐观锁基准表」
 *
 * 结构：{ [collection]: { [originalId]: pocketbaseUpdatedTimestamp } }
 *
 * - 在 fetchPocketBaseBackup 时随业务数据一同返回。
 * - 业务组件改某条记录时，把 recordMeta[collection][originalId] 作为 baseUpdated
 *   传给 dirtyTracker.markUpdate / markDelete。
 * - saveIncrementalToPocketBase 提交前，会和服务端最新 updated 比对；
 *   若不一致则记入 conflicts，不写入。
 *
 * 注意：对于无 `original_id` 字段的集合（pb_yearly_targets / pb_monthly_init_data），
 * 我们用合成 key：
 *   - pb_yearly_targets: `${year}`
 *   - pb_monthly_init_data: `${year}_${month}`
 */
export type RecordMeta = Record<string, Record<string, string>>;

/** PocketBase 记录通用字段 */
type PbRecord = { id: string; created?: string; updated?: string; [key: string]: unknown };

/** 从 unknown 错误对象安全提取消息（含 PocketBase 字段级校验） */
const errMsg = (e: unknown): string => {
    const err = e as {
        data?: { message?: string; data?: Record<string, unknown> };
        response?: { message?: string; data?: Record<string, unknown> };
        message?: string;
        status?: number;
    };
    const fieldBag = err?.response?.data ?? err?.data?.data ?? err?.data;
    if (fieldBag && typeof fieldBag === 'object' && !Array.isArray(fieldBag)) {
        const parts: string[] = [];
        for (const [field, val] of Object.entries(fieldBag)) {
            if (field === 'message' || field === 'data' || field === 'status') continue;
            if (val && typeof val === 'object' && 'message' in val) {
                const msg = String((val as { message?: string }).message || '').trim();
                if (msg) parts.push(`${field}: ${msg}`);
            } else if (typeof val === 'string' && val.trim()) {
                parts.push(`${field}: ${val.trim()}`);
            }
        }
        if (parts.length > 0) return parts.join('；');
    }
    const generic = String(err?.response?.message || err?.data?.message || err?.message || '').trim();
    const status = err?.status ?? (err?.response as { status?: number } | undefined)?.status;
    if (
        generic === 'Something went wrong while processing your request.' ||
        generic === 'Failed to create record.' ||
        generic === 'Failed to update record.'
    ) {
        return status
            ? `${generic.replace(/\.$/, '')}（HTTP ${status}）`
            : generic;
    }
    return generic;
};

/** 从 unknown 错误对象安全提取 HTTP 状态码 */
const errStatus = (e: unknown): number | undefined => {
    const err = e as { status?: number; response?: { status?: number } };
    return err?.status ?? err?.response?.status;
};

/** create 时 original_id 已存在（常见于基线未刷新后重复保存） */
const isDuplicateKeyError = (e: unknown): boolean => {
    const msg = errMsg(e).toLowerCase();
    return msg.includes('unique') || msg.includes('not_unique');
};

const deepEqualComparable = (a: unknown, b: unknown): boolean => {
    if (a === b) return true;
    if (a === null || b === null || a === undefined || b === undefined) return a === b;
    if (typeof a !== typeof b) return false;
    if (typeof a !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        for (let i = 0; i < a.length; i += 1) {
            if (!deepEqualComparable(a[i], b[i])) return false;
        }
        return true;
    }
    const ak = Object.keys(a as Record<string, unknown>).sort();
    const bk = Object.keys(b as Record<string, unknown>).sort();
    if (ak.length !== bk.length) return false;
    for (let i = 0; i < ak.length; i += 1) {
        if (ak[i] !== bk[i]) return false;
        if (!deepEqualComparable((a as any)[ak[i]], (b as any)[bk[i]])) return false;
    }
    return true;
};

const createDataMatchesExistingRecord = (
    existing: Record<string, any>,
    data: Record<string, any>
): boolean => {
    for (const [field, value] of Object.entries(data)) {
        if (field === 'id' || value === undefined) continue;
        if (!deepEqualComparable(existing[field], value)) return false;
    }
    return true;
};

const normalizeCreateDataForPocketBase = (
    collection: string,
    projectId: string,
    rawData: Record<string, any>
): Record<string, any> => {
    const data: Record<string, any> = { project_id: projectId, ...rawData };
    if (data.id !== undefined && data.original_id === undefined) {
        data.original_id = data.id;
    }
    delete data.id;
    if (collection === 'pb_yearly_targets' || collection === 'pb_monthly_init_data') {
        delete data.original_id;
    }
    return data;
};

const isGenericPbProcessingError = (e: unknown): boolean => {
    const msg = errMsg(e);
    return (
        msg.includes('Something went wrong while processing your request') ||
        msg.includes('Failed to update record') ||
        msg.includes('Failed to create record')
    );
};

/** 生产库未跑 migration 时，写入未知字段会触发 PB 泛化错误 */
const stripTenantFieldsPendingMigration = (
    fields: Record<string, unknown>,
): Record<string, unknown> => {
    if (!('source_agent_name' in fields)) return fields;
    const next = { ...fields };
    delete next.source_agent_name;
    return next;
};

const jsonSafeClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** PATCH 请求中携带服务端乐观锁基线（pb_hooks 的 CAS 据此比对，PB_CAS_ENABLED=1 时生效）。 */
const casHeaders = (expectedUpdated?: string): { headers: { [k: string]: string } } | undefined =>
    expectedUpdated ? { headers: { 'X-PB-Expected-Updated': expectedUpdated } } : undefined;

const applyPbRecordUpdate = async (
    client: PocketBase,
    collection: string,
    recordId: string,
    fields: Record<string, unknown>,
    expectedUpdated?: string,
): Promise<PbRecord> => {
    let payload = fields;
    const opts = casHeaders(expectedUpdated);
    if (collection === 'pb_tenants') {
        try {
            return (await client.collection(collection).update(recordId, payload, opts)) as PbRecord;
        } catch (e: unknown) {
            if (!isGenericPbProcessingError(e) || !('source_agent_name' in payload)) throw e;
            payload = stripTenantFieldsPendingMigration(payload);
            return (await client.collection(collection).update(recordId, payload, opts)) as PbRecord;
        }
    }
    if (collection === 'pb_budget_scenarios' && payload.base_data_snapshot !== undefined) {
        try {
            return (await client.collection(collection).update(recordId, payload, opts)) as PbRecord;
        } catch (e: unknown) {
            if (!isGenericPbProcessingError(e)) throw e;
            const slim = {
                ...payload,
                base_data_snapshot: jsonSafeClone(payload.base_data_snapshot),
            };
            return (await client.collection(collection).update(recordId, slim, opts)) as PbRecord;
        }
    }
    return (await client.collection(collection).update(recordId, payload, opts)) as PbRecord;
};

/** 是否为服务端乐观锁冲突（pb_hooks 抛 409 + OPTIMISTIC_LOCK_CONFLICT 标记）。 */
const isOptimisticLockConflict = (e: unknown): boolean => {
    const err = e as { status?: number; response?: { message?: string }; data?: { message?: string }; message?: string };
    if (err?.status === 409) return true;
    const msg = String(err?.response?.message || err?.data?.message || err?.message || '');
    return msg.indexOf('OPTIMISTIC_LOCK_CONFLICT') >= 0;
};

let pb: PocketBase | null = null;
// 会话级 batch 能力缓存（模块级，跨调用保持）：首次被 403/404 拒绝后本会话直接走串行，
// 并跳过 saveBatchToPocketBase 里的 Phase-1 OR 预查（预查只为 batch 服务）。
let _batchAvailable = true;
/** 复位 batch 能力探测（登录/切园区/重连时调用）。 */
export const resetBatchCapability = () => { _batchAvailable = true; };
// 单个 /api/batch（单事务）最多包含的操作数。必须 ≤ 服务端 Settings → Application 的 batch maxRequests
// （建议服务端设 200~500）。超过此数的保存整包走串行，不跨事务分片，以保持原子性。
const BATCH_MAX_REQUESTS = 200;

// 按年窗口加载（B3）：>0 时 fetchPocketBaseBackup 默认只拉「该年起」的 payments/invoices，
// 让首屏/切园区/基线回拉口径一致（同一个 fetch 驱动 data 与 baseline，不会错位）。
// 默认 null = 全量（保持历史行为）。窗口外历史欠款依赖 pb_sealed_months 封账，故须在封账回填后再开启。
let _loadSinceYear: number | null = null;
/** 设置按年窗口（传 null 关闭，恢复全量）。前端启动时按 VITE_YEAR_WINDOW_LOAD 决定。 */
export const setLoadWindowSinceYear = (sinceYear: number | null) => { _loadSinceYear = sinceYear; };
const isPocketBaseDebug = () => Boolean(import.meta.env?.DEV);

export const initPocketBase = (url: string) => {
    try {
        if (isPocketBaseDebug()) {
            console.log('=== Initializing PocketBase ===');
            console.log('URL:', url);
            console.log('Old pb instance:', pb ? 'exists' : 'null');
        }
        
        // 强制重新创建实例
        pb = new PocketBase(url);
        // 新连接：复位 batch 能力探测，下一次保存重新尝试 batch。
        _batchAvailable = true;
        
        if (isPocketBaseDebug()) {
            console.log('New pb instance created');
            console.log('pb.baseUrl:', pb.baseUrl);
            console.log('pb instance:', pb);
        }
        
        return true;
    } catch (e) {
        console.error("PocketBase init failed:", e);
        return false;
    }
};

// 调试用：获取当前 PocketBase 实例信息
export const getPocketBaseInfo = () => {
    return {
        initialized: pb !== null,
        baseUrl: pb?.baseUrl || 'not initialized',
        isValid: pb?.authStore?.isValid || false,
        model: pb?.authStore?.model || null
    };
};

const normalizeProjectIds = (value: unknown, fallback?: string): string[] => {
    const ids = Array.isArray(value)
        ? value
        : typeof value === 'string' && value.trim()
          ? [value.trim()]
          : [];
    const normalized = ids
        .map((id) => String(id || '').trim())
        .filter(Boolean);
    if (fallback && !normalized.includes(fallback)) normalized.unshift(fallback);
    return Array.from(new Set(normalized));
};

/** PocketBase auth 集合要求合法邮箱；申请集合为 text，需在提交与审批前校验。 */
const AUTH_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidAuthEmail = (email: string) => AUTH_EMAIL_REGEX.test(String(email || '').trim());
const PB_AUTH_PASSWORD_MIN_LEN = 8;

/** 将 PocketBase ClientResponseError 的字段级校验合并为可读文案 */
const formatPocketBaseClientError = (err: unknown): string => {
    const e = err as { data?: { message?: string; data?: Record<string, { message?: string }> }; response?: { message?: string; data?: Record<string, { message?: string }> }; message?: string };
    const payload = (e?.data ?? e?.response ?? {}) as { message?: string; data?: Record<string, { message?: string }> };
    const top = String(payload?.message || e?.message || '').trim();
    const fieldBag = payload?.data;
    if (fieldBag && typeof fieldBag === 'object' && !Array.isArray(fieldBag)) {
        const parts: string[] = [];
        for (const [key, val] of Object.entries(fieldBag)) {
            if (val && typeof val === 'object' && (val as { message?: string }).message) {
                parts.push(`${key}: ${String((val as { message?: string }).message)}`);
            }
        }
        if (parts.length) return [top, ...parts].filter(Boolean).join('；');
    }
    return top || '请求失败';
};

/** PocketBase filter：`email="..."`（转义引号与反斜杠） */
const emailEqFilter = (email: string): string => {
    const e = escFilter(String(email || '').trim());
    return `email="${e}"`;
};

const isElevatedAuthRole = (role: unknown): boolean => {
    const r = String(role || '').trim();
    return r === 'platform_admin' || r === 'group_admin';
};

/**
 * 注册审批时邮箱已占用：合并申请的园区到 `allowed_project_ids`、启用账号；
 * 对普通 `park_user` 尝试按申请重置密码（失败则跳过，避免 Rules 禁止改密时整单失败）。
 * @param existingRow 若已按邮箱查过 `users` 记录可传入，避免重复请求。
 */
const mergeSignupIntoExistingUser = async (
    request: SignupRequestRecord,
    existingRow?: Record<string, unknown>
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const email = String(request.email || '').trim();
    const primaryProjectId = request.requestedProjectIds[0];
    if (!email || !primaryProjectId) {
        return { success: false, message: '申请缺少邮箱或园区信息' };
    }
    try {
        const row =
            existingRow?.id != null
                ? existingRow
                : await pb.collection('users').getFirstListItem(emailEqFilter(email));
        const existingProjectId = String(row.project_id || '').trim();
        const baseProject = existingProjectId || primaryProjectId;
        const mergedAllowed = normalizeProjectIds(
            [...normalizeProjectIds(row.allowed_project_ids, baseProject), ...request.requestedProjectIds],
            baseProject
        );
        const patch: Record<string, unknown> = {
            allowed_project_ids: mergedAllowed,
            enabled: true,
        };
        if (!existingProjectId) {
            patch.project_id = primaryProjectId;
        }
        const applicantName = String(request.applicantName || '').trim();
        const currentName = String(row.name || row.username || '').trim();
        if (applicantName && !currentName) {
            patch.name = applicantName;
        }
        const pwd = String(request.password || '').trim();
        const canTryPassword = !isElevatedAuthRole(row.role) && pwd.length >= PB_AUTH_PASSWORD_MIN_LEN;
        if (canTryPassword) {
            patch.password = pwd;
            patch.passwordConfirm = pwd;
            patch.password_plain = pwd;
        }
        try {
            const updated = await pb.collection('users').update(String(row.id), patch);
            return {
                success: true,
                user: mapManagedUser(updated),
                message: canTryPassword
                    ? '该邮箱已有账号：已合并园区授权、启用，并已更新密码。'
                    : isElevatedAuthRole(row.role)
                      ? '该邮箱已有账号：已合并园区授权并启用（平台/集团管理员密码未通过注册单修改）。'
                      : '该邮箱已有账号：已合并园区授权并启用（申请密码过短或未提供，未改密）。',
            };
        } catch (first: unknown) {
            if (!canTryPassword) {
                return { success: false, message: formatPocketBaseClientError(first) || '合并已有账号失败' };
            }
            const { password: _p, passwordConfirm: _c, ...withoutPwd } = patch;
            try {
                const updated = await pb.collection('users').update(String(row.id), withoutPwd);
                return {
                    success: true,
                    user: mapManagedUser(updated),
                    message:
                        '该邮箱已有账号：已合并园区授权并启用；密码因权限策略未自动更新，请管理员在后台重置或通知用户使用原密码登录。',
                };
            } catch (second: unknown) {
                return { success: false, message: formatPocketBaseClientError(second) || '合并已有账号失败' };
            }
        }
    } catch (e: unknown) {
        const status = errStatus(e);
        if (status === 404) {
            return { success: false, message: '未找到同名邮箱账号' };
        }
        return { success: false, message: formatPocketBaseClientError(e) || '查询已有账号失败' };
    }
};

const mapAuthUser = (record: Record<string, unknown> | null | undefined): AuthUser | null => {
    if (!record?.id) return null;
    const projectId = String(record.project_id || '').trim();
    const allowedProjectIds = normalizeProjectIds(record.allowed_project_ids, projectId);
    return {
        id: String(record.id),
        email: String(record.email || ''),
        name: String(record.name || record.username || ''),
        projectId: projectId || allowedProjectIds[0] || '',
        role: (String(record.role || 'park_user')) as UserRole,
        allowedProjectIds,
        enabled: record.enabled !== false,
        receivablePermissions: normalizeReceivablePermissions(
            record.receivable_permissions,
            (String(record.role || 'park_user')) as UserRole,
        ),
        hideRentPricing: resolveHideRentPricing(String(record.role || 'park_user'), record.hide_rent_pricing),
    };
};

const mapParkBillingFeatures = (row: Record<string, unknown>) => {
    const meta = (row.metadata || row.billing_features) as Record<string, unknown> | undefined;
    if (!meta || typeof meta !== 'object') return undefined;
    return {
        managementFeeBilling: meta.managementFeeBilling === true || meta.management_fee_billing === true,
        receivableMonthOffset: meta.receivableMonthOffset === 0 || meta.receivable_month_offset === 0 ? 0 : -1,
        defaultManagementFeeUnitPriceMode:
            meta.defaultManagementFeeUnitPriceMode === 'monthly' || meta.default_management_fee_unit_price_mode === 'monthly'
                ? 'monthly'
                : 'daily',
    } as ParkInfo['billingFeatures'];
};

export const getCurrentAuthUser = (): AuthUser | null => {
    return mapAuthUser(pb?.authStore?.model as Record<string, unknown> | null);
};

export const getCurrentAuthToken = (): string => {
    const token = String(pb?.authStore?.token || '').trim();
    setCurrentCloudAuthToken(token);
    return token;
};

const readCookieValue = (name: string): string => {
    if (typeof document === 'undefined') return '';
    const prefix = `${name}=`;
    const item = document.cookie
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(prefix));
    if (!item) return '';
    try {
        return decodeURIComponent(item.slice(prefix.length));
    } catch {
        return item.slice(prefix.length);
    }
};

const expireCookie = (name: string): void => {
    if (typeof document === 'undefined') return;
    const attrs = 'Path=/; Max-Age=0; SameSite=Lax';
    document.cookie = `${name}=; ${attrs}`;
    const host = typeof window !== 'undefined' ? window.location.hostname : '';
    const parts = host.split('.').filter(Boolean);
    if (parts.length >= 2) {
        const rootDomain = `.${parts.slice(-2).join('.')}`;
        document.cookie = `${name}=; Domain=${rootDomain}; ${attrs}`;
    }
};

export const restorePocketBaseSessionFromCookie = async (): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const token = readCookieValue('kd_token');
    if (!token) return { success: false, message: '未检测到小程序 SSO cookie' };

    const previousToken = String(pb.authStore?.token || '').trim();
    const previousModel = pb.authStore?.model as Parameters<typeof pb.authStore.save>[1] | null;

    try {
        pb.authStore.save(token, null);
        setCurrentCloudAuthToken(token);
        const refreshed = await pb.collection('users').authRefresh();
        const user = mapAuthUser(refreshed.record);
        if (!user?.enabled) throw new Error('账号已停用，请联系管理员');
        if (!user.projectId && user.allowedProjectIds.length === 0) {
            throw new Error('账号未绑定园区，请联系管理员');
        }
        pb.authStore.save(String(pb.authStore.token || token), refreshed.record as Parameters<typeof pb.authStore.save>[1]);
        expireCookie('kd_token');
        setCurrentCloudAuthToken(pb.authStore.token);
        return { success: true, user, message: '小程序 SSO 登录成功' };
    } catch (e: unknown) {
        expireCookie('kd_token');
        if (previousToken) {
            pb.authStore.save(previousToken, previousModel ?? undefined);
            setCurrentCloudAuthToken(previousToken);
        } else {
            pb.authStore.clear();
            clearCurrentCloudAuthToken();
        }
        return { success: false, message: errMsg(e) || '小程序 SSO 登录失败' };
    }
};

export const isAuthenticated = (): boolean => {
    const user = getCurrentAuthUser();
    return !!pb?.authStore?.isValid && !!user?.enabled && !!user.projectId;
};

export const authenticatePocketBaseUser = async (
    email: string,
    password: string
): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const safeEmail = (email || '').trim();
    const safePassword = (password || '').trim();
    if (!safeEmail || !safePassword) return { success: false, message: '请输入邮箱和密码' };

    try {
        const authData = await pb.collection('users').authWithPassword(safeEmail, safePassword);
        const user = mapAuthUser(authData.record);
        if (!user?.enabled) {
            pb.authStore.clear();
            clearCurrentCloudAuthToken();
            return { success: false, message: '账号已停用，请联系管理员' };
        }
        if (!user.projectId) {
            pb.authStore.clear();
            clearCurrentCloudAuthToken();
            return { success: false, message: '账号未绑定园区，请联系管理员' };
        }
        setCurrentCloudAuthToken(pb.authStore.token);
        return { success: true, user, message: '登录成功' };
    } catch (e: unknown) {
        const status = errStatus(e);
        if (!status) {
            return {
                success: false,
                message: '无法连接后端，请确认 PocketBase 已启动（本地可运行 ./start-all.sh）',
            };
        }
        return { success: false, message: errMsg(e) || '登录失败，请检查账号密码' };
    }
};

export const logoutPocketBase = () => {
    pb?.authStore?.clear();
    clearCurrentCloudAuthToken();
};

/** MCP / 外部 Agent：用已登录用户的 token 恢复 pocketbaseService 单例会话（与前端同一 pb 客户端） */
export const restorePocketBaseUserSession = (
    url: string,
    token: string,
    model: Record<string, unknown> | null,
): void => {
    initPocketBase(url);
    if (!pb) throw new Error('PocketBase 未初始化');
    pb.authStore.save(token, (model as Parameters<typeof pb.authStore.save>[1]) ?? undefined);
    setCurrentCloudAuthToken(token);
};

export const fetchAuthorizedParks = async (): Promise<{ success: boolean; parks: ParkInfo[]; message: string }> => {
    if (!pb) return { success: false, parks: [], message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, parks: [], message: '尚未登录' };
    try {
        const rows = await pb.collection('pb_parks').getFullList({
            filter: 'enabled = true',
            sort: 'sort_order,name',
        });
        const parks = rows.map((row: any) => {
            const billingFeatures = mapParkBillingFeatures(row);
            return {
                id: row.id,
                projectId: row.project_id,
                name: row.name || row.project_id,
                city: row.city || '',
                enabled: row.enabled !== false,
                sortOrder: row.sort_order ?? 0,
                billingFeatures,
                metadata: billingFeatures,
            };
        });
        return { success: true, parks, message: '加载成功' };
    } catch (e: unknown) {
        return { success: false, parks: [], message: errMsg(e) || '加载园区失败' };
    }
};

export interface ManagedUserAccount {
    id: string;
    email: string;
    name: string;
    role: UserRole;
    projectId: string;
    allowedProjectIds: string[];
    enabled: boolean;
    /** 管理员可见的明文密码（users.password_plain；历史账号可能为空） */
    password?: string;
    wechatOpenid?: string;
    receivablePermissions?: ReceivablePermission[];
    hideRentPricing?: boolean;
    created?: string;
    updated?: string;
}

export interface CreateManagedUserInput {
    email: string;
    password: string;
    name?: string;
    role?: UserRole;
    projectId: string;
    allowedProjectIds?: string[];
    enabled?: boolean;
    receivablePermissions?: ReceivablePermission[];
    hideRentPricing?: boolean;
}

/** 更新已创建的 `users` 记录；`password` 留空或与 `oldPassword` 相同表示不改密 */
export interface UpdateManagedUserInput {
    userId: string;
    name?: string;
    role?: UserRole;
    projectId?: string;
    allowedProjectIds?: string[];
    enabled?: boolean;
    password?: string;
    /** 改密时必填，须与 PocketBase 当前登录密码一致 */
    oldPassword?: string;
    receivablePermissions?: ReceivablePermission[];
    hideRentPricing?: boolean;
}

export interface SignupRequestRecord {
    id: string;
    /** 申请人姓名（pb_user_signup_requests.applicant_name） */
    applicantName: string;
    email: string;
    password: string;
    requestedProjectIds: string[];
    status: 'pending' | 'approved' | 'rejected';
    reviewNote?: string;
    approvedUserId?: string;
    approvedAt?: string;
    created?: string;
    updated?: string;
}

const mapManagedUser = (row: Record<string, unknown>): ManagedUserAccount => {
    const projectId = String(row.project_id || '').trim();
    const wechatOpenid = String(row.wechat_openid || row.openid || '').trim();
    return {
        id: String(row.id || ''),
        email: String(row.email || ''),
        name: String(row.name || row.username || ''),
        role: (String(row.role || 'park_user')) as UserRole,
        projectId,
        allowedProjectIds: normalizeProjectIds(row.allowed_project_ids, projectId),
        enabled: row.enabled !== false,
        wechatOpenid: wechatOpenid || undefined,
        receivablePermissions: normalizeReceivablePermissions(
            row.receivable_permissions,
            (String(row.role || 'park_user')) as UserRole,
        ),
        hideRentPricing: resolveHideRentPricing(String(row.role || 'park_user'), row.hide_rent_pricing),
        password: String(row.password_plain || '').trim() || undefined,
        created: String(row.created || ''),
        updated: String(row.updated || ''),
    };
};

/** 从已审批注册申请中补全缺失的明文密码（兼容迁移前创建的账号） */
const enrichManagedUserPasswords = async (
    users: ManagedUserAccount[]
): Promise<ManagedUserAccount[]> => {
    if (!pb || users.every((u) => u.password)) return users;
    try {
        const requests = await pb.collection('pb_user_signup_requests').getFullList();
        const byEmail = new Map<string, string>();
        for (const row of requests) {
            const email = String(row.email || '').trim().toLowerCase();
            const pwd = String(row.password_plain || '').trim();
            if (email && pwd) byEmail.set(email, pwd);
        }
        return users.map((u) =>
            u.password
                ? u
                : { ...u, password: byEmail.get(u.email.trim().toLowerCase()) || u.password }
        );
    } catch {
        return users;
    }
};

const STALE_AUTH_RELOGIN_MESSAGE =
    '登录会话已过期（常见于后台修改 users 集合后）。请退出并重新登录后再查看账号列表。';

/** 刷新当前 users 登录态，使 API Rules 能读到最新的 role / enabled 等字段 */
export const refreshAuthRecord = async (): Promise<{
    success: boolean;
    user?: AuthUser | null;
    message: string;
    staleAuth?: boolean;
}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    try {
        const authData = await pb.collection('users').authRefresh();
        const user = mapAuthUser(authData.record);
        return { success: true, user, message: '刷新成功' };
    } catch (e: unknown) {
        return {
            success: false,
            message: errMsg(e) || STALE_AUTH_RELOGIN_MESSAGE,
            staleAuth: true,
        };
    }
};

export const fetchManagedUsers = async (): Promise<{ success: boolean; users: ManagedUserAccount[]; message: string }> => {
    if (!pb) return { success: false, users: [], message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, users: [], message: '尚未登录' };

    const currentUser = getCurrentAuthUser();
    if (currentUser?.role === 'platform_admin') {
        const refreshed = await refreshAuthRecord();
        if (!refreshed.success) {
            return { success: false, users: [], message: refreshed.message || STALE_AUTH_RELOGIN_MESSAGE };
        }
    }

    try {
        const rows = await pb.collection('users').getFullList({
            sort: '-created',
        });
        const users = await enrichManagedUserPasswords(rows.map(mapManagedUser));
        if (users.length === 0 && getCurrentAuthUser()?.role === 'platform_admin') {
            return { success: false, users: [], message: STALE_AUTH_RELOGIN_MESSAGE };
        }
        return { success: true, users, message: '加载成功' };
    } catch (e: unknown) {
        return { success: false, users: [], message: errMsg(e) || '加载登录人员失败' };
    }
};

const mapSignupRequest = (row: Record<string, unknown>): SignupRequestRecord => ({
    id: String(row.id || ''),
    applicantName: String(row.applicant_name || '').trim(),
    email: String(row.email || ''),
    password: String(row.password_plain || ''),
    requestedProjectIds: normalizeProjectIds(row.requested_project_ids),
    status: (String(row.status || 'pending')) as SignupRequestRecord['status'],
    reviewNote: String(row.review_note || ''),
    approvedUserId: String(row.approved_user_id || ''),
    approvedAt: String(row.approved_at || ''),
    created: String(row.created || ''),
    updated: String(row.updated || ''),
});

export const fetchPublicParks = async (): Promise<{ success: boolean; parks: ParkInfo[]; message: string }> => {
    if (!pb) return { success: false, parks: [], message: 'PocketBase 未初始化' };
    try {
        const rows = await pb.collection('pb_parks').getFullList({
            filter: 'enabled = true',
            sort: 'sort_order,name',
        });
        const parks = rows.map((row: any) => ({
            id: row.id,
            projectId: row.project_id,
            name: row.name || row.project_id,
            city: row.city || '',
            enabled: row.enabled !== false,
            sortOrder: row.sort_order ?? 0,
        }));
        return { success: true, parks, message: '加载成功' };
    } catch (e: unknown) {
        return { success: false, parks: [], message: errMsg(e) || '加载园区失败' };
    }
};

export const submitSignupRequest = async (
    email: string,
    password: string,
    requestedProjectIds: string[],
    applicantName: string
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const safeEmail = String(email || '').trim();
    const safePassword = String(password || '').trim();
    const safeName = String(applicantName || '').trim();
    const safeProjectIds = normalizeProjectIds(requestedProjectIds);
    if (!safeEmail || !safePassword || !safeName || safeProjectIds.length === 0) {
        return { success: false, message: '请填写姓名、账号、密码并至少选择一个园区' };
    }
    if (!isValidAuthEmail(safeEmail)) {
        return { success: false, message: '请填写有效的电子邮箱（将用于登录账号）' };
    }
    if (safePassword.length < PB_AUTH_PASSWORD_MIN_LEN) {
        return {
            success: false,
            message: `密码长度至少 ${PB_AUTH_PASSWORD_MIN_LEN} 位（与后台账号策略一致）`,
        };
    }
    try {
        await pb.collection('pb_user_signup_requests').create({
            email: safeEmail,
            applicant_name: safeName,
            password_plain: safePassword,
            requested_project_ids: safeProjectIds,
            status: 'pending',
        });
        return { success: true, message: '申请已提交，请等待管理员审批' };
    } catch (e: unknown) {
        return { success: false, message: errMsg(e) || '提交申请失败' };
    }
};

export const fetchSignupRequests = async (): Promise<{ success: boolean; requests: SignupRequestRecord[]; message: string }> => {
    if (!pb) return { success: false, requests: [], message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, requests: [], message: '尚未登录' };
    try {
        const rows = await pb.collection('pb_user_signup_requests').getFullList();
        return { success: true, requests: rows.map(mapSignupRequest), message: '加载成功' };
    } catch (e: unknown) {
        return { success: false, requests: [], message: errMsg(e) || '加载注册申请失败' };
    }
};

export const createManagedUser = async (
    input: CreateManagedUserInput
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const email = String(input.email || '').trim();
    const password = String(input.password || '').trim();
    const projectId = String(input.projectId || '').trim();
    if (!email || !password || !projectId) {
        return { success: false, message: '邮箱、密码、默认园区不能为空' };
    }
    const allowedProjectIds = normalizeProjectIds(input.allowedProjectIds, projectId);
    if (!isValidAuthEmail(email)) {
        return { success: false, message: '邮箱格式无效，无法创建 PocketBase 登录账号' };
    }
    if (password.length < PB_AUTH_PASSWORD_MIN_LEN) {
        return {
            success: false,
            message: `密码长度至少 ${PB_AUTH_PASSWORD_MIN_LEN} 位，请修改后重试`,
        };
    }
    const displayName = String(input.name || '').trim() || email.split('@')[0] || email;

    /**
     * PocketBase 的 `users` 集合中，`verified` / `emailVisibility` 属于受保护字段，
     * 只允许 superusers (admin token) 在创建时直接赋值；普通登录账号（即便 role=platform_admin）
     * 通过 collection API 提交会触发 `Values don't match`。所以此处不传，使用集合默认值。
     * 若后续需要邮箱验证，可在 PocketBase Admin UI 手动勾选或走 `requestVerification` 流程。
     */
    const role = (input.role || 'park_user') as UserRole;
    const roleDefaults = receivableDefaultsForRole(role);
    const payload: Record<string, unknown> = {
        email,
        password,
        passwordConfirm: password,
        name: displayName,
        role,
        project_id: projectId,
        allowed_project_ids: allowedProjectIds,
        enabled: input.enabled !== false,
    };
    const perms =
        input.receivablePermissions?.length && role !== 'property_staff'
            ? input.receivablePermissions
            : roleDefaults.receivablePermissions;
    payload.receivable_permissions = perms;
    payload.hide_rent_pricing =
        input.hideRentPricing === true || roleDefaults.hideRentPricing;
    payload.password_plain = password;

    try {
        const created = await pb.collection('users').create(payload);
        return { success: true, user: mapManagedUser(created), message: '创建成功' };
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '创建登录人员失败' };
    }
};

export const updateManagedUserEnabled = async (
    userId: string,
    enabled: boolean
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const id = String(userId || '').trim();
    if (!id) return { success: false, message: '缺少用户ID' };
    try {
        await pb.collection('users').update(id, { enabled });
        return { success: true, message: enabled ? '已审批通过并启用' : '已禁用账号' };
    } catch (e: unknown) {
        return { success: false, message: errMsg(e) || '更新账号状态失败' };
    }
};

export const updateManagedUser = async (
    input: UpdateManagedUserInput
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const userId = String(input.userId || '').trim();
    if (!userId) return { success: false, message: '缺少用户ID' };
    let current: any;
    try {
        current = await pb.collection('users').getOne(userId);
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '用户不存在' };
    }
    const patch: Record<string, unknown> = {};
    if (input.name !== undefined) {
        patch.name = String(input.name || '').trim() || String(current.name || current.username || '').trim() || '用户';
    }
    if (input.role !== undefined) {
        patch.role = input.role;
        const roleDefaults = receivableDefaultsForRole(input.role);
        patch.receivable_permissions = roleDefaults.receivablePermissions;
        patch.hide_rent_pricing = roleDefaults.hideRentPricing;
    }
    if (input.enabled !== undefined) patch.enabled = input.enabled;

    const effectiveProjectId =
        input.projectId !== undefined
            ? String(input.projectId || '').trim()
            : String(current.project_id || '').trim();
    if (input.projectId !== undefined) {
        patch.project_id = effectiveProjectId || current.project_id;
    }
    if (input.allowedProjectIds !== undefined) {
        const base = (effectiveProjectId || String(current.project_id || '').trim()) as string;
        patch.allowed_project_ids = normalizeProjectIds(input.allowedProjectIds, base);
    }

    const pwd = String(input.password || '').trim();
    const storedPlain = String(current.password_plain || '').trim();
    const oldPwdFromInput = input.oldPassword !== undefined ? String(input.oldPassword).trim() : undefined;
    // 管理员改密时以前端传入的旧密码为准；空字符串视为未提供，回退到 password_plain 备份
    const baselinePlain = oldPwdFromInput || storedPlain;
    if (pwd.length > 0 && pwd !== baselinePlain) {
        if (pwd.length < PB_AUTH_PASSWORD_MIN_LEN) {
            return {
                success: false,
                message: `新密码长度至少 ${PB_AUTH_PASSWORD_MIN_LEN} 位`,
            };
        }
        if (!baselinePlain && !storedPlain) {
            // 历史账号尚无明文备份：仅补录 password_plain，不触发认证改密
            patch.password_plain = pwd;
        } else {
            const oldPwd = baselinePlain;
            if (!oldPwd) {
                return {
                    success: false,
                    message: '修改密码需提供旧密码（请确认当前密码填写正确）',
                };
            }
            patch.password = pwd;
            patch.passwordConfirm = pwd;
            patch.oldPassword = oldPwd;
            patch.password_plain = pwd;
        }
    }
    if (input.receivablePermissions !== undefined && input.role === undefined) {
        patch.receivable_permissions = input.receivablePermissions;
    }
    if (input.hideRentPricing !== undefined && input.role === undefined) {
        patch.hide_rent_pricing = input.hideRentPricing;
    }

    if (Object.keys(patch).length === 0) {
        return { success: true, user: mapManagedUser(current), message: '没有变更' };
    }
    try {
        const updated = await pb.collection('users').update(userId, patch);
        return { success: true, user: mapManagedUser(updated), message: '已保存' };
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '更新账号失败' };
    }
};

/** 当前登录用户修改自己的密码 */
export const changeOwnPassword = async (
    oldPassword: string,
    newPassword: string
): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const userId = String(pb.authStore.model?.id || '').trim();
    const email = String(pb.authStore.model?.email || '').trim();
    if (!userId || !email) return { success: false, message: '无法识别当前用户' };

    const oldPwd = String(oldPassword || '').trim();
    const newPwd = String(newPassword || '').trim();
    if (!oldPwd || !newPwd) return { success: false, message: '请填写当前密码和新密码' };
    if (newPwd.length < PB_AUTH_PASSWORD_MIN_LEN) {
        return { success: false, message: `新密码长度至少 ${PB_AUTH_PASSWORD_MIN_LEN} 位` };
    }
    if (oldPwd === newPwd) return { success: false, message: '新密码不能与当前密码相同' };

    try {
        await pb.collection('users').update(userId, {
            oldPassword: oldPwd,
            password: newPwd,
            passwordConfirm: newPwd,
            password_plain: newPwd,
        });
        const authData = await pb.collection('users').authWithPassword(email, newPwd);
        const user = mapAuthUser(authData.record);
        if (!user?.enabled) {
            pb.authStore.clear();
            return { success: false, message: '账号已停用，请联系管理员' };
        }
        return { success: true, user, message: '密码已更新' };
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '改密失败' };
    }
};

/** 删除指定 `pb_user_signup_requests` 申请记录，找不到记录视为成功（已不存在）。 */
export const deleteSignupRequest = async (
    requestId: string
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const id = String(requestId || '').trim();
    if (!id) return { success: false, message: '缺少申请记录ID' };
    try {
        await pb.collection('pb_user_signup_requests').delete(id);
        return { success: true, message: '已清理审批记录' };
    } catch (e: unknown) {
        const status = errStatus(e);
        if (status === 404) {
            return { success: true, message: '审批记录已不存在' };
        }
        return { success: false, message: formatPocketBaseClientError(e) || '清理审批记录失败' };
    }
};

export const rejectSignupRequest = async (
    requestId: string,
    reviewerNote: string = ''
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const id = String(requestId || '').trim();
    if (!id) return { success: false, message: '缺少申请记录ID' };
    try {
        const row = await pb.collection('pb_user_signup_requests').getOne(id);
        const request = mapSignupRequest(row);
        if (request.status === 'approved') {
            return { success: false, message: '该申请已审批通过；如需撤销，请先删除或停用对应登录账号。' };
        }
        if (request.status === 'rejected') {
            return { success: true, message: '该申请已退回' };
        }
        await pb.collection('pb_user_signup_requests').update(id, {
            status: 'rejected',
            review_note: reviewerNote.trim() || '管理员退回注册申请',
        });
        return { success: true, message: '已退回注册申请' };
    } catch (e: unknown) {
        const status = errStatus(e);
        if (status === 404) {
            return { success: true, message: '审批记录已不存在' };
        }
        return { success: false, message: formatPocketBaseClientError(e) || '退回注册申请失败' };
    }
};

/**
 * 清理与某 `users` 记录关联的「已审批通过」注册申请：
 * - 通过 `approved_user_id` 反查；找不到时按邮箱兜底匹配；
 * - 仅清理 `status = "approved"` 的记录，不动 `pending` / `rejected`；
 * - 单条删失败不会让整体失败，最终返回累计成功数。
 */
export const cleanupSignupRequestsForUser = async (
    userId: string,
    fallbackEmail?: string
): Promise<{ success: boolean; cleaned: number; message: string }> => {
    if (!pb) return { success: false, cleaned: 0, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, cleaned: 0, message: '尚未登录' };
    const id = String(userId || '').trim();
    const email = String(fallbackEmail || '').trim();
    try {
        const all = await pb.collection('pb_user_signup_requests').getFullList();
        const matched = all.filter((row: any) => {
            if (String(row?.status || '').trim() !== 'approved') return false;
            const linked = String(row?.approved_user_id || '').trim();
            if (id && linked === id) return true;
            if (!linked && email) return String(row?.email || '').trim().toLowerCase() === email.toLowerCase();
            return false;
        });
        if (matched.length === 0) {
            return { success: true, cleaned: 0, message: '无需清理' };
        }
        let ok = 0;
        for (const row of matched) {
            try {
                await pb.collection('pb_user_signup_requests').delete(row.id);
                ok += 1;
            } catch (e) {
                console.warn('[PB] 清理单条审批记录失败:', e);
            }
        }
        return { success: true, cleaned: ok, message: ok > 0 ? `已清理 ${ok} 条审批记录` : '清理失败' };
    } catch (e: unknown) {
        return {
            success: false,
            cleaned: 0,
            message: formatPocketBaseClientError(e) || '查询审批记录失败',
        };
    }
};

export const deleteManagedUser = async (
    userId: string,
    currentAuthUserId?: string
): Promise<{ success: boolean; message: string; cleanedSignupCount?: number }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const id = String(userId || '').trim();
    if (!id) return { success: false, message: '缺少用户ID' };
    if (currentAuthUserId && id === String(currentAuthUserId).trim()) {
        return { success: false, message: '不能删除当前正在使用的登录账号' };
    }
    let userEmail = '';
    try {
        const row = await pb.collection('users').getOne(id);
        userEmail = String(row?.email || '').trim();
        if (String(row.role) === 'platform_admin') {
            const all = await pb.collection('users').getFullList();
            const platformAdmins = all.filter((r: any) => String(r.role) === 'platform_admin');
            if (platformAdmins.length <= 1) {
                return { success: false, message: '不能删除最后一个平台管理员账号' };
            }
        }
    } catch (e) {
        console.warn('[PB] 删除前用户预检失败，继续尝试删除:', e);
    }
    try {
        await pb.collection('users').delete(id);
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '删除账号失败' };
    }
    let cleanedSignupCount = 0;
    try {
        const cleanup = await cleanupSignupRequestsForUser(id, userEmail);
        if (cleanup.success) cleanedSignupCount = cleanup.cleaned;
    } catch (e) {
        console.warn('[PB] 清理关联审批记录失败（账号已删除）:', e);
    }
    const tail = cleanedSignupCount > 0 ? `，并清理 ${cleanedSignupCount} 条审批记录` : '';
    return { success: true, message: `已删除账号${tail}`, cleanedSignupCount };
};

export const approveSignupRequest = async (
    requestId: string,
    reviewerNote: string = ''
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    if (!pb.authStore?.isValid) return { success: false, message: '尚未登录' };
    const id = String(requestId || '').trim();
    if (!id) return { success: false, message: '缺少申请ID' };
    try {
        const req = await pb.collection('pb_user_signup_requests').getOne(id);
        const request = mapSignupRequest(req);
        if (request.status !== 'pending') {
            return { success: false, message: '该申请已处理，请刷新列表' };
        }
        const primaryProjectId = request.requestedProjectIds[0];
        if (!primaryProjectId) return { success: false, message: '申请缺少园区信息' };
        if (!String(request.password || '').trim()) {
            return {
                success: false,
                message:
                    '该申请未带回密码字段（可能被接口隐藏或数据异常）。请申请人重新注册，或由管理员使用「新增登录人员」手动创建账号。',
            };
        }
        if (!isValidAuthEmail(request.email)) {
            return {
                success: false,
                message: `该申请邮箱「${request.email}」不是有效电子邮箱，无法写入认证库。请驳回并让申请人使用真实邮箱重新申请。`,
            };
        }
        let existingUser: any = null;
        try {
            existingUser = await pb.collection('users').getFirstListItem(emailEqFilter(String(request.email || '').trim()));
        } catch {
            existingUser = null;
        }
        const createRes = existingUser
            ? await mergeSignupIntoExistingUser(request, existingUser)
            : await createManagedUser({
                  email: request.email,
                  password: request.password,
                  name: request.applicantName || undefined,
                  projectId: primaryProjectId,
                  allowedProjectIds: request.requestedProjectIds,
                  role: 'park_user',
                  enabled: true,
              });
        if (!createRes.success || !createRes.user) {
            const msg = createRes.message || '审批失败：创建账号失败';
            const dup =
                /email:\s*value must be unique/i.test(msg) ||
                (/unique/i.test(msg) && /email/i.test(msg));
            if (dup && !existingUser) {
                const merged = await mergeSignupIntoExistingUser(request);
                if (!merged.success || !merged.user) {
                    return {
                        success: false,
                        message:
                            merged.message ||
                            '该邮箱已被占用：若账号已存在请在 PocketBase 中检查 users 表，或让申请人更换邮箱后重新提交申请。',
                    };
                }
                await pb.collection('pb_user_signup_requests').update(id, {
                    status: 'approved',
                    review_note: reviewerNote || '管理员审批通过（合并已有账号）',
                    approved_user_id: merged.user.id,
                    approved_at: new Date().toISOString(),
                });
                return { success: true, message: merged.message || '审批完成，申请人账号已可登录' };
            }
            return { success: false, message: msg };
        }
        await pb.collection('pb_user_signup_requests').update(id, {
            status: 'approved',
            review_note: reviewerNote || (existingUser ? '管理员审批通过（合并已有账号）' : '管理员审批通过'),
            approved_user_id: createRes.user.id,
            approved_at: new Date().toISOString(),
        });
        return {
            success: true,
            message: existingUser ? createRes.message || '审批完成，申请人账号已可登录' : '审批完成，申请人账号已可登录',
        };
    } catch (e: unknown) {
        return { success: false, message: formatPocketBaseClientError(e) || '审批申请失败' };
    }
};

export const authenticatePocketBase = async (email: string, password: string) => {
    if (!pb) return false;
    const safeEmail = (email || '').trim();
    const safePassword = (password || '').trim();
    if (!safeEmail || !safePassword) {
        console.warn('PocketBase 登录已跳过：未填写账号或密码');
        return false;
    }

    const loginByAdminsEndpoint = async (): Promise<boolean> => {
        if (!pb) return false;
        const baseUrl = pb.baseUrl.replace(/\/+$/, '');
        const endpoint = `${baseUrl}/api/admins/auth-with-password`;

        const loginPayloads = [
            { email: safeEmail, password: safePassword },      // 旧版常见格式
            { identity: safeEmail, password: safePassword },   // 新版常见格式
        ];

        let lastError: any = null;
        for (const payload of loginPayloads) {
            const resp = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            if (resp.ok) {
                const data = await resp.json();
                if (data?.token) {
                    pb.authStore.save(data.token, data.admin || data.record || null);
                    return true;
                }
                throw new Error('admins 登录响应缺少 token');
            }

            const message = await resp.text();
            lastError = new Error(`admins 登录失败: ${resp.status} ${resp.statusText}`);
            (lastError as any).status = resp.status;
            (lastError as any).message = message || (lastError as any).message;
        }

        throw lastError || new Error('admins 登录失败');
    };

    try {
        if (isPocketBaseDebug()) console.log('PocketBase 尝试登录(_superusers):', safeEmail);
        const authData = await pb.collection('_superusers').authWithPassword(safeEmail, safePassword);
        if (isPocketBaseDebug()) {
            console.log('PocketBase 管理员登录成功:', authData.record?.email || safeEmail);
            console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
        }
        return true;
    } catch (e: unknown) {
        // 回退 1：兼容旧版本 PocketBase admins 认证端点
        try {
            if (isPocketBaseDebug()) console.log('PocketBase 回退登录(admins endpoint):', safeEmail);
            await loginByAdminsEndpoint();
            if (isPocketBaseDebug()) {
                console.log('PocketBase admins 登录成功:', safeEmail);
                console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
            }
            return true;
        } catch (adminErr: unknown) {
            // 回退 2：兼容使用 users 集合做登录的旧配置
            try {
                if (isPocketBaseDebug()) console.log('PocketBase 回退登录(users):', safeEmail);
                const authData = await pb.collection('users').authWithPassword(safeEmail, safePassword);
                if (isPocketBaseDebug()) {
                    console.log('PocketBase 用户登录成功:', authData.record?.email || safeEmail);
                    console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
                }
                return true;
            } catch (userErr: unknown) {
                // 认证失败不再打红色 error，避免控制台噪音；保存接口可按 API Rules 直接工作
                console.warn("PocketBase 认证失败（已跳过登录，继续匿名模式）", {
                    superuserStatus: errStatus(e),
                    superuserMessage: errMsg(e),
                    adminStatus: errStatus(adminErr),
                    adminMessage: errMsg(adminErr),
                    userStatus: errStatus(userErr),
                    userMessage: errMsg(userErr),
                });
                return false;
            }
        }
    }
};

export const checkPocketBaseConnection = async (url: string): Promise<boolean> => {
    try {
        const client = new PocketBase(url);
        await client.health.check();
        return true;
    } catch (e) {
        console.warn("PocketBase connection failed:", e);
        return false;
    }
};

/**
 * PocketBase filter 字符串安全转义（防止注入）。
 * 旧实现只转义 `\` 和 `"`，碰到 `'`、换行、回车、`\0` 时会破坏 filter 语法或被用于注入。
 * 这里补全 PocketBase filter DSL 关心的特殊字符。
 */
const escFilter = (value: string): string =>
    String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n')
        .replace(/\t/g, '\\t')
        // eslint-disable-next-line no-control-regex
        .replace(/\u0000/g, '');

/** 与 pb_billing_period_notes 中单条记录的 original_id 对应，存 notes_json.version */
const DASHBOARD_DATA_VERSION_OID = 'dashboard_data_version';

export const readCloudSaveVersion = async (projectId: string): Promise<number> => {
    if (!pb) return 0;
    const list = await pb.collection('pb_billing_period_notes').getList(1, 1, {
        filter: `project_id = "${escFilter(projectId)}" && original_id = "${escFilter(DASHBOARD_DATA_VERSION_OID)}"`,
        fields: 'notes_json',
    });
    const v = (list.items[0]?.notes_json as { version?: unknown } | undefined)?.version;
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
};

export type SaveToPocketBaseOptions = {
    /** 打开数据时从服务器读到的版本；与服务器当前版本不一致则拒绝保存 */
    expectedVersion?: number;
    /** 内部迁移等场景跳过校验（迁移完成后仍会写入新版本号） */
    skipVersionCheck?: boolean;
};

export type SaveToPocketBaseResult = {
    success: boolean;
    message: string;
    conflict?: boolean;
    newVersion?: number;
};

/**
 * @deprecated 旧的「整包覆写」保存。会先删除该 project_id 下所有行再批量重建，
 * 多人并发保存时后保存者会覆盖先保存者的改动。
 *
 * 新代码请使用 `saveIncrementalToPocketBase`（增量合并 + 行级乐观锁）。
 * 仅当用户在 UI 上显式选择「全量覆盖」、或处理完冲突后强制覆盖时再调用此函数。
 */
export const saveToPocketBase = async (
    data: DashboardData,
    projectId: string,
    note: string = '',
    options?: SaveToPocketBaseOptions
): Promise<SaveToPocketBaseResult> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化\n\n请点击"保存配置"按钮重新初始化' };

    const skipVersionCheck = options?.skipVersionCheck === true;
    const expectedVersion =
        typeof options?.expectedVersion === 'number' && Number.isFinite(options.expectedVersion)
            ? Math.max(0, Math.floor(options.expectedVersion))
            : typeof data.cloudSaveVersion === 'number' && Number.isFinite(data.cloudSaveVersion)
              ? Math.max(0, Math.floor(data.cloudSaveVersion))
              : 0;

    if (!skipVersionCheck) {
        const serverVersion = await readCloudSaveVersion(projectId);
        if (serverVersion !== expectedVersion) {
            return {
                success: false,
                conflict: true,
                message:
                    '云端数据已被他人更新（或您在其他窗口已保存）。请先加载最新数据后再编辑保存，以免覆盖他人修改。',
            };
        }
    }

    const ensureArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
    const byOriginalId = (id: string) => `project_id = "${escFilter(projectId)}" && original_id = "${escFilter(id)}"`;
    const upsertByOriginalId = async (collection: string, originalId: string, payload: Record<string, any>) => {
        const existing = await pb!.collection(collection).getList(1, 1, {
            filter: byOriginalId(originalId),
            fields: 'id',
        });
        if (existing.items.length > 0) {
            await pb!.collection(collection).update(existing.items[0].id, payload);
            return;
        }
        await pb!.collection(collection).create(payload);
    };
    /**
     * 全量覆盖一个集合（按 original_id 进行 upsert，最后再删除多余旧行）。
     *
     * 旧实现「先全部删除，再全部新建」——任何一条 create 失败都会让该集合的数据
     * 彻底丢失（先删后建的中间窗口为空）。改为：
     *   1) 读取旧行，按 original_id 建立映射
     *   2) 对每条新行：若 original_id 命中→update；否则→create；同时记录命中的 originalId
     *   3) 把未命中、即新列表里没有的旧行删除
     * 任意一步抛错都不会出现"空集合"，最坏情况是旧+新混存，便于补救。
     */
    const replaceCollection = async (collection: string, rows: Record<string, any>[]) => {
        const oldRows = await pb!.collection(collection).getFullList({
            filter: `project_id = "${escFilter(projectId)}"`,
            fields: 'id,original_id',
        });
        // 用 original_id 做 key；缺失 original_id 的行（如 yearly_targets / monthly_init_data
        // 这类无业务主键的集合）退化为按 PocketBase id 进行的 delete-then-create。
        const hasOriginalId = (r: Record<string, any>) => typeof r?.original_id === 'string' && r.original_id !== '';
        const oldByOid = new Map<string, string>();
        const oldWithoutOid: string[] = [];
        for (const r of oldRows) {
            if (hasOriginalId(r)) oldByOid.set(String(r.original_id), r.id);
            else oldWithoutOid.push(r.id);
        }

        const seenOids = new Set<string>();
        for (const row of rows) {
            if (hasOriginalId(row)) {
                const oid = String(row.original_id);
                seenOids.add(oid);
                const oldId = oldByOid.get(oid);
                if (oldId) {
                    await pb!.collection(collection).update(oldId, row);
                } else {
                    await pb!.collection(collection).create(row);
                }
            } else {
                // 无 original_id 的集合：直接 create；旧行在后面统一删除。
                await pb!.collection(collection).create(row);
            }
        }

        // 删除：1) 命名集合中 original_id 不在新列表的旧行；2) 整个无主键集合的旧行。
        for (const [oid, oldId] of oldByOid.entries()) {
            if (!seenOids.has(oid)) {
                await pb!.collection(collection).delete(oldId);
            }
        }
        for (const oldId of oldWithoutOid) {
            await pb!.collection(collection).delete(oldId);
        }
    };

    try {
        const buildings = ensureArray<any>(data.buildings).map((b) => ({
            original_id: b.id,
            name: b.name,
            type: b.type || 'Building',
            project_id: projectId,
        }));
        const units = ensureArray<any>(data.buildings).flatMap((b) =>
            ensureArray<any>(b.units).map((u) => ({
                original_id: u.id,
                building_id: b.id,
                name: u.name,
                area: u.area || 0,
                status: u.status || 'Vacant',
                floor: u.floor || 1,
                is_self_use: !!u.isSelfUse,
                project_id: projectId,
            }))
        );
        const tenants = ensureArray<any>(data.tenants).map((t) => ({
            original_id: t.id,
            root_id: t.rootId || '',
            name: t.name,
            source_agent_name: t.sourceAgentName || '',
            contact_info: t.contactInfo || '',
            industry: t.industry || '',
            founding_date: t.foundingDate || '',
            legal_rep_name: t.legalRepName || '',
            legal_rep_birthday: t.legalRepBirthday || '',
            contact_name: t.contactName || '',
            contact_birthday: t.contactBirthday || '',
            building_id: t.buildingId,
            unit_ids: t.unitIds || [],
            total_area: t.totalArea || 0,
            signing_date: t.signingDate || '',
            lease_start: t.leaseStart,
            lease_end: t.leaseEnd,
            move_in_date: t.moveInDate || '',
            unit_price: t.unitPrice || 0,
            unit_price_mode: t.unitPriceMode || 'daily',
            monthly_rent: t.monthlyRent || 0,
            rent_free_periods: t.rentFreePeriods || [],
            rent_reductions: t.rentReductions || [],
            payment_cycle: t.paymentCycle || 'Monthly',
            payment_terms: Array.isArray(t.unitTerms) ? t.unitTerms : (Array.isArray(t.paymentTerms) ? t.paymentTerms : []),
            payment_cycle_months: t.paymentCycleMonths ?? null,
            first_payment_date: t.firstPaymentDate || '',
            first_payment_months: t.firstPaymentMonths ?? null,
            first_receivable_amount: t.firstReceivableAmount ?? null,
            first_receivable_start_date: t.firstReceivableStartDate || '',
            first_receivable_end_date: t.firstReceivableEndDate || '',
            free_rent_handling: t.freeRentHandling || null,
            deposit_amount: t.depositAmount || 0,
            deposit_status: t.depositStatus || 'Unpaid',
            status: t.status || 'Active',
            termination_date: t.terminationDate || '',
            termination_type: t.terminationType || null,
            termination_reason: t.terminationReason || '',
            parent_contract_id: t.parentContractId || '',
            early_termination_fr_clawback_override: t.earlyTerminationFreeRentClawbackOverride ?? null,
            early_termination_deposit_deduction: t.earlyTerminationDepositDeduction ?? null,
            early_termination_other_adjustment: t.earlyTerminationOtherAdjustment ?? null,
            special_requirements: t.specialRequirements || '',
            is_risk: !!t.isRisk,
            is_special_business: !!t.isSpecialBusiness,
            contract_parking_spaces: t.contractParkingSpaces ?? t.parkingSpaces ?? 0,
            actual_parking_spaces: t.actualParkingSpaces ?? t.parkingSpaces ?? 0,
            parking_unit_price: t.parkingUnitPrice || 0,
            key_moments: t.keyMoments || [],
            name_history: t.nameHistory || [],
            payment_cycle_changes: t.paymentCycleChanges || [],
            payment_period_adjustments: t.paymentPeriodAdjustments || [],
            payment_period_shift_months: t.paymentPeriodShiftMonths ?? 0,
            management_fee_enabled: t.managementFeeEnabled ?? null,
            management_fee_exempt: t.managementFeeExempt ?? null,
            management_fee_free_periods: t.managementFeeFreePeriods || [],
            management_fee_unit_price: t.managementFeeUnitPrice ?? null,
            management_fee_unit_price_mode:
                t.managementFeeUnitPrice != null && t.managementFeeUnitPrice > 0
                    ? 'monthly'
                    : t.managementFeeUnitPriceMode || 'monthly',
            management_fee_monthly_amount: t.managementFeeMonthlyAmount ?? null,
            management_fee_first_payment_date: t.managementFeeFirstPaymentDate || '',
            management_fee_start_with_occupancy: t.managementFeeStartWithOccupancy ?? null,
            management_fee_start_date: t.managementFeeStartDate || '',
            project_id: projectId,
        }));
        const payments = ensureArray<any>(data.payments).map((p) => ({
            original_id: p.id,
            tenant_id: p.tenantId,
            tenant_name: p.tenantName || '',
            amount: p.amount || 0,
            type: p.type || 'Rent',
            date: p.date,
            status: p.status || 'Pending',
            invoice_status: p.invoiceStatus || null,
            period: p.period || '',
            remarks: p.remarks || '',
            project_id: projectId,
        }));
        const invoices = ensureArray<any>(data.invoices).map((inv) => ({
            original_id: inv.id,
            tenant_id: inv.tenantId,
            bill_date: inv.billDate,
            target_invoice_date: inv.targetInvoiceDate || '',
            amount: inv.amount || 0,
            status: inv.status || 'Pending',
            invoiced_at: inv.invoicedAt || '',
            defer_reason: inv.deferReason || '',
            project_id: projectId,
        }));
        const yearlyTargets = Object.entries(data.yearlyTargets || {}).map(([year, targets]) => ({
            year: Number(year),
            revenue: (targets as any)?.revenue || 0,
            occupancy: (targets as any)?.occupancy || 0,
            initial_budget: (targets as any)?.initialBudget ?? 0,
            project_id: projectId,
        }));
        const monthlyInitData = ensureArray<any>(data.initializationData).map((d) => ({
            year: d.year,
            month: d.month,
            revenue_target: d.revenueTarget || 0,
            revenue_collected: d.revenueCollected || 0,
            occupancy_rate: d.occupancyRate || 0,
            accumulated_arrears: d.accumulatedArrears || 0,
            initial_budget: d.initialBudget ?? 0,
            project_id: projectId,
        }));
        const budgetAssumptions = ensureArray<any>(data.budgetAssumptions).map((a) => ({
            original_id: a.id,
            target_type: a.targetType || null,
            target_id: a.targetId || '',
            target_name: a.targetName || '',
            strategy: a.strategy || null,
            projected_termination_date: a.projectedTerminationDate || '',
            vacancy_gap_months: a.vacancyGapMonths ?? null,
            projected_sign_date: a.projectedSignDate || '',
            projected_unit_price: a.projectedUnitPrice || 0,
            projected_rent_free_months: a.projectedRentFreeMonths || 0,
            billing_cycle_shift_months: a.billingCycleShiftMonths ?? null,
            price_adjustment: a.priceAdjustment || null,
            payment_shift: a.paymentShift || null,
            project_id: projectId,
        }));
        const budgetAdjustments = ensureArray<any>(data.budgetAdjustments).map((a) => {
            const isAmountDelta =
                a.adjustmentKind === 'amount_delta' ||
                (a.originalYear === -1 && a.originalMonth === -1);
            return {
                original_id: a.id,
                tenant_id: a.tenantId,
                tenant_name: a.tenantName || '',
                original_year: isAmountDelta ? null : a.originalYear,
                original_month: isAmountDelta ? null : a.originalMonth,
                adjusted_year: a.adjustedYear,
                adjusted_month: a.adjustedMonth,
                amount: a.amount || 0,
                reason: a.reason || '',
                adjustment_kind: isAmountDelta ? 'amount_delta' : a.adjustmentKind || 'period_shift',
                project_id: projectId,
            };
        });
        const budgetScenarios = ensureArray<any>(data.budgetScenarios).map((s) => ({
            original_id: s.id,
            name: s.name,
            budget_year: s.budgetYear ?? new Date().getFullYear(),
            description: s.description || '',
            scenario_created_at: s.createdAt || '',
            is_active: !!s.isActive,
            assumptions: s.assumptions || [],
            adjustments: s.adjustments || [],
            base_data_snapshot: s.baseDataSnapshot || null,
            project_id: projectId,
        }));

        await replaceCollection('pb_buildings', buildings);
        await replaceCollection('pb_units', units);
        await replaceCollection('pb_tenants', tenants);
        await replaceCollection('pb_payments', payments);
        await replaceCollection('pb_invoices', invoices);
        await replaceCollection('pb_yearly_targets', yearlyTargets);
        await replaceCollection('pb_monthly_init_data', monthlyInitData);
        await replaceCollection('pb_budget_assumptions', budgetAssumptions);
        await replaceCollection('pb_budget_adjustments', budgetAdjustments);
        await replaceCollection('pb_budget_scenarios', budgetScenarios);
        await upsertByOriginalId('pb_billing_period_notes', 'billing_period_notes', {
            original_id: 'billing_period_notes',
            notes_json: data.billingPeriodNotes || {},
            project_id: projectId,
        });

        if (note) {
            await upsertByOriginalId('pb_billing_period_notes', 'last_save_note', {
                original_id: 'last_save_note',
                notes_json: { note, saved_at: new Date().toISOString() },
                project_id: projectId,
            });
        }

        // 始终从服务端读取最新版本号，再 +1：
        // 旧实现在 skipVersionCheck=false 时使用内存中的 expectedVersion，
        // 两个并发保存（双方都在 894 处通过了版本校验）会写入相同的 newVersion，
        // 导致后续保存无法检测出实际的版本冲突。
        const versionBeforeWrite = await readCloudSaveVersion(projectId);
        const newVersion = versionBeforeWrite + 1;
        await upsertByOriginalId('pb_billing_period_notes', DASHBOARD_DATA_VERSION_OID, {
            original_id: DASHBOARD_DATA_VERSION_OID,
            notes_json: { version: newVersion },
            project_id: projectId,
        });

        return { success: true, message: 'PocketBase 结构化数据保存成功', newVersion };
    } catch (e: unknown) {
        const errorMsg = errMsg(e) || 'Unknown error';
        return { success: false, message: `PocketBase 保存失败: ${errorMsg}` };
    }
};

export const getPocketBaseHistory = async (
    projectId: string
): Promise<{success: boolean, data?: CloudBackupMetadata[], message: string}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    
    try {
        const noteRecord = await pb.collection('pb_billing_period_notes').getList(1, 1, {
            filter: `project_id = "${escFilter(projectId)}" && original_id = "last_save_note"`,
            fields: 'updated,notes_json',
        });
        const notePayload = noteRecord.items[0]?.notes_json || {};
        const createdAt = notePayload.saved_at || noteRecord.items[0]?.updated || new Date().toISOString();
        const note = notePayload.note || '结构化数据最新版本';
        return {
            success: true,
            data: [{ id: projectId, created_at: createdAt, note }],
            message: '加载成功',
        };
    } catch (e: unknown) {
        return { success: true, data: [{ id: projectId, created_at: new Date().toISOString(), note: '结构化数据' }], message: '加载成功' };
    }
};

export const fetchPocketBaseBackup = async (
    projectId: string,
    options?: { year?: number; sinceYear?: number }
): Promise<{success: boolean, data?: DashboardData, message: string, recordMeta?: RecordMeta}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const client = pb;

    // 禁用 SDK 对「同路径重复请求」的自动取消，避免保存后刷新、冲突处理等多处并发拉全量时较早请求被误判取消。
    // https://github.com/pocketbase/js-sdk#auto-cancellation
    const noAutoCancel = { requestKey: null };

    const metaFields = (...fields: string[]) => ['id', 'updated', ...fields].join(',');
    const backupFieldsByCollection: Record<string, string> = {
        pb_buildings: metaFields('original_id', 'name', 'type'),
        pb_units: metaFields('original_id', 'building_id', 'name', 'area', 'status', 'floor', 'is_self_use'),
        pb_tenants: metaFields(
            'original_id',
            'root_id',
            'name',
            'source_agent_name',
            'contact_info',
            'industry',
            'founding_date',
            'legal_rep_name',
            'legal_rep_birthday',
            'contact_name',
            'contact_birthday',
            'building_id',
            'unit_ids',
            'total_area',
            'signing_date',
            'lease_start',
            'lease_end',
            'move_in_date',
            'unit_price',
            'unit_price_mode',
            'project_id',
            'monthly_rent',
            'rent_free_periods',
            'rent_reductions',
            'payment_cycle',
            'payment_terms',
            'payment_cycle_months',
            'first_payment_date',
            'first_payment_months',
            'first_receivable_amount',
            'first_receivable_start_date',
            'first_receivable_end_date',
            'free_rent_handling',
            'deposit_amount',
            'deposit_status',
            'status',
            'termination_date',
            'termination_type',
            'termination_reason',
            'parent_contract_id',
            'early_termination_fr_clawback_override',
            'early_termination_deposit_deduction',
            'early_termination_other_adjustment',
            'special_requirements',
            'is_risk',
            'is_special_business',
            'contract_parking_spaces',
            'actual_parking_spaces',
            'parking_unit_price',
            'key_moments',
            'name_history',
            'payment_cycle_changes',
            'payment_period_adjustments',
            'payment_period_shift_months',
            'management_fee_enabled',
            'management_fee_exempt',
            'management_fee_free_periods',
            'management_fee_unit_price',
            'management_fee_unit_price_mode',
            'management_fee_monthly_amount',
            'management_fee_first_payment_date',
            'management_fee_start_with_occupancy',
            'management_fee_start_date',
        ),
        pb_payments: metaFields('original_id', 'tenant_id', 'tenant_name', 'amount', 'type', 'date', 'period', 'status', 'invoice_status', 'remarks'),
        pb_invoices: metaFields('original_id', 'tenant_id', 'bill_date', 'target_invoice_date', 'amount', 'status', 'invoiced_at', 'defer_reason'),
        pb_yearly_targets: metaFields('year', 'revenue', 'occupancy', 'initial_budget'),
        pb_monthly_init_data: metaFields('year', 'month', 'revenue_target', 'revenue_collected', 'occupancy_rate', 'accumulated_arrears', 'initial_budget'),
        pb_budget_assumptions: metaFields(
            'original_id',
            'target_type',
            'target_id',
            'target_name',
            'strategy',
            'projected_termination_date',
            'vacancy_gap_months',
            'projected_sign_date',
            'projected_unit_price',
            'projected_rent_free_months',
            'billing_cycle_shift_months',
            'price_adjustment',
            'payment_shift',
        ),
        pb_budget_adjustments: metaFields(
            'original_id',
            'tenant_id',
            'tenant_name',
            'original_year',
            'original_month',
            'adjusted_year',
            'adjusted_month',
            'amount',
            'reason',
            'adjustment_kind',
        ),
        pb_budget_scenarios: metaFields(
            'original_id',
            'name',
            'budget_year',
            'description',
            'scenario_created_at',
            'is_active',
            'assumptions',
            'adjustments',
            'base_data_snapshot',
        ),
    };

    const mapList = async (collection: string, extraFilter?: string, batchSize = 1000) => {
        const parts = [`project_id = "${escFilter(projectId)}"`];
        if (extraFilter) parts.push(extraFilter);
        const filter = parts.join(' && ');
        return client.collection(collection).getFullList({
            filter,
            fields: backupFieldsByCollection[collection],
            batch: batchSize,
            ...noAutoCancel,
        });
    };

    const inTextDateWindow = (row: Record<string, unknown>, field: string, range: { from: string; to?: string }): boolean => {
        const value = String(row?.[field] || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        if (value < range.from) return false;
        return range.to ? value <= range.to : true;
    };

    const mapWindowedList = async (
        collection: string,
        dateField: string,
        extraFilter: string | undefined,
        range: { from: string; to?: string } | undefined,
        batchSize = 1000,
    ) => {
        const rows = await mapList(collection, extraFilter, batchSize);
        if (!extraFilter || !range || rows.length > 0) return rows;

        // Production PB has occasionally returned an empty set for text date range filters
        // while project-only reads still contain matching rows. Fall back to JS filtering so
        // compute snapshots do not treat a whole year's payments/invoices as missing.
        const projectRows = await mapList(collection, undefined, batchSize);
        return projectRows.filter((row: Record<string, unknown>) => inTextDateWindow(row, dateField, range));
    };

    // year：精确单年（compute-engine 用）；sinceYear：按年窗口加载（前端用，含该年及以后）；
    // 都未显式给定时回退模块级窗口 _loadSinceYear。两者都无 = 全量。
    // 窗口外的历史欠款/趋势依赖 pb_sealed_months 封账快照。
    const sinceYear = options?.sinceYear ?? (options?.year ? undefined : _loadSinceYear ?? undefined);
    const paymentYearFilter = options?.year
        ? `date >= "${options.year}-01-01" && date <= "${options.year}-12-31"`
        : sinceYear
        ? `date >= "${sinceYear}-01-01"`
        : undefined;
    const paymentDateWindow = options?.year
        ? { from: `${options.year}-01-01`, to: `${options.year}-12-31` }
        : sinceYear
        ? { from: `${sinceYear}-01-01` }
        : undefined;
    const invoiceYearFilter = options?.year
        ? `bill_date >= "${options.year}-01-01" && bill_date <= "${options.year}-12-31"`
        : sinceYear
        ? `bill_date >= "${sinceYear}-01-01"`
        : undefined;
    const invoiceDateWindow = options?.year
        ? { from: `${options.year}-01-01`, to: `${options.year}-12-31` }
        : sinceYear
        ? { from: `${sinceYear}-01-01` }
        : undefined;

    try {
        const [
            buildingsRows,
            unitsRows,
            tenantsRows,
            paymentsRows,
            invoicesRows,
            yearlyRows,
            monthlyInitRows,
            assumptionRows,
            adjustmentRows,
            scenarioRows,
            notesRows,
            versionRows,
            sealedRows,
        ] = await Promise.all([
            mapList('pb_buildings'),
            mapList('pb_units'),
            mapList('pb_tenants'),
            mapWindowedList('pb_payments', 'date', paymentYearFilter, paymentDateWindow),
            mapWindowedList('pb_invoices', 'bill_date', invoiceYearFilter, invoiceDateWindow),
            mapList('pb_yearly_targets'),
            mapList('pb_monthly_init_data'),
            mapList('pb_budget_assumptions'),
            mapList('pb_budget_adjustments'),
            mapList('pb_budget_scenarios'),
            client.collection('pb_billing_period_notes').getList(1, 1, {
                filter: `project_id = "${escFilter(projectId)}" && original_id = "billing_period_notes"`,
                fields: 'notes_json,updated',
                ...noAutoCancel,
            }),
            client.collection('pb_billing_period_notes').getList(1, 1, {
                filter: `project_id = "${escFilter(projectId)}" && original_id = "${escFilter(DASHBOARD_DATA_VERSION_OID)}"`,
                fields: 'notes_json',
                ...noAutoCancel,
            }),
            // 已封账历史月（pb_sealed_months）。容错：集合不存在/未迁移时回退空数组，不影响整体加载。
            client.collection('pb_sealed_months').getFullList({
                filter: `project_id = "${escFilter(projectId)}"`,
                fields: 'sealed_year,sealed_month,arrears_increment,cumulative_arrears,details_json',
                ...noAutoCancel,
            }).catch(() => [] as any[]),
        ]);
        const cloudSaveVersionRaw = (versionRows.items[0]?.notes_json as { version?: unknown } | undefined)?.version;
        const cloudSaveVersion =
            typeof cloudSaveVersionRaw === 'number' && Number.isFinite(cloudSaveVersionRaw) && cloudSaveVersionRaw >= 0
                ? Math.floor(cloudSaveVersionRaw)
                : 0;

        const unitsByBuilding = new Map<string, any[]>();
        for (const row of unitsRows) {
            const arr = unitsByBuilding.get(row.building_id) || [];
            arr.push({
                id: row.original_id,
                name: row.name,
                area: row.area || 0,
                status: row.status || 'Vacant',
                floor: row.floor || 1,
                isSelfUse: !!row.is_self_use,
            });
            unitsByBuilding.set(row.building_id, arr);
        }

        const rebuilt: Partial<DashboardData> = {
            buildings: buildingsRows.map((b: any) => ({
                id: b.original_id,
                name: b.name,
                type: b.type || 'Building',
                units: unitsByBuilding.get(b.original_id) || [],
            })),
            tenants: tenantsRows.map((t: any) => ({
                id: t.original_id,
                rootId: t.root_id || '',
                name: t.name,
                sourceAgentName: t.source_agent_name || '',
                contactInfo: t.contact_info || '',
                industry: t.industry || '',
                foundingDate: t.founding_date || '',
                legalRepName: t.legal_rep_name || '',
                legalRepBirthday: t.legal_rep_birthday || '',
                contactName: t.contact_name || '',
                contactBirthday: t.contact_birthday || '',
                buildingId: t.building_id,
                unitIds: Array.isArray(t.unit_ids) ? t.unit_ids : [],
                totalArea: t.total_area || 0,
                signingDate: t.signing_date || '',
                leaseStart: t.lease_start,
                leaseEnd: t.lease_end,
                moveInDate: t.move_in_date || '',
                unitPrice: t.unit_price || 0,
                unitPriceMode: t.unit_price_mode || 'daily',
                projectId: t.project_id || '',
                monthlyRent: t.monthly_rent || 0,
                rentFreePeriods: Array.isArray(t.rent_free_periods) ? t.rent_free_periods : [],
                rentReductions: Array.isArray(t.rent_reductions) ? t.rent_reductions : [],
                paymentCycle: t.payment_cycle || 'Monthly',
                unitTerms: Array.isArray(t.payment_terms) ? t.payment_terms : [],
                paymentTerms: Array.isArray(t.payment_terms) ? t.payment_terms : [],
                paymentCycleMonths: t.payment_cycle_months ?? undefined,
                firstPaymentDate: t.first_payment_date || '',
                firstPaymentMonths: t.first_payment_months ?? undefined,
                firstReceivableAmount: t.first_receivable_amount != null ? Number(t.first_receivable_amount) : undefined,
                firstReceivableStartDate: t.first_receivable_start_date || undefined,
                firstReceivableEndDate: t.first_receivable_end_date || undefined,
                freeRentHandling: t.free_rent_handling || undefined,
                depositAmount: t.deposit_amount || 0,
                depositStatus: t.deposit_status || 'Unpaid',
                status: t.status || 'Active',
                terminationDate: t.termination_date || undefined,
                terminationType: t.termination_type || undefined,
                terminationReason: t.termination_reason || '',
                parentContractId: t.parent_contract_id || undefined,
                earlyTerminationFreeRentClawbackOverride:
                    t.early_termination_fr_clawback_override != null
                        ? Number(t.early_termination_fr_clawback_override)
                        : undefined,
                earlyTerminationDepositDeduction:
                    t.early_termination_deposit_deduction != null
                        ? Number(t.early_termination_deposit_deduction)
                        : undefined,
                earlyTerminationOtherAdjustment:
                    t.early_termination_other_adjustment != null
                        ? Number(t.early_termination_other_adjustment)
                        : undefined,
                specialRequirements: t.special_requirements || '',
                isRisk: !!t.is_risk,
                isSpecialBusiness: !!t.is_special_business,
                contractParkingSpaces: t.contract_parking_spaces ?? 0,
                actualParkingSpaces: t.actual_parking_spaces ?? 0,
                parkingUnitPrice: t.parking_unit_price || 0,
                keyMoments: Array.isArray(t.key_moments) ? t.key_moments : [],
                nameHistory: Array.isArray(t.name_history) ? t.name_history : [],
                paymentCycleChanges: Array.isArray(t.payment_cycle_changes) ? t.payment_cycle_changes : [],
                // 过滤掉非法形态的账期调整条目（例如 OpenClaw 误填的「租金阶梯」或「季度账期表」），
                // 防止编辑弹窗渲染时因缺失 amount/originalYear 等字段而崩溃。
                paymentPeriodAdjustments: Array.isArray(t.payment_period_adjustments)
                    ? t.payment_period_adjustments.filter(
                          (adj: any) =>
                              adj &&
                              typeof adj === 'object' &&
                              typeof adj.originalYear === 'number' &&
                              typeof adj.originalMonth === 'number' &&
                              typeof adj.adjustedYear === 'number' &&
                              typeof adj.adjustedMonth === 'number' &&
                              typeof adj.amount === 'number'
                      )
                    : [],
                paymentPeriodShiftMonths: typeof t.payment_period_shift_months === 'number' ? t.payment_period_shift_months : 0,
                managementFeeEnabled:
                    t.management_fee_enabled != null
                        ? !!t.management_fee_enabled
                        : (t.project_id || projectId) === 'shenzhen_park',
                managementFeeExempt: !!t.management_fee_exempt,
                managementFeeFreePeriods: Array.isArray(t.management_fee_free_periods)
                    ? t.management_fee_free_periods
                    : [],
                managementFeeUnitPrice:
                    t.management_fee_unit_price != null ? Number(t.management_fee_unit_price) : undefined,
                managementFeeUnitPriceMode:
                    t.management_fee_unit_price_mode === 'monthly' ? 'monthly' : 'daily',
                managementFeeMonthlyAmount:
                    t.management_fee_monthly_amount != null
                        ? Number(t.management_fee_monthly_amount)
                        : undefined,
                managementFeeFirstPaymentDate: t.management_fee_first_payment_date || undefined,
                managementFeeStartWithOccupancy:
                    t.management_fee_start_with_occupancy != null
                        ? !!t.management_fee_start_with_occupancy
                        : undefined,
                managementFeeStartDate: t.management_fee_start_date || undefined,
            })),
            payments: paymentsRows.map((p: any) => ({
                id: p.original_id,
                tenantId: p.tenant_id,
                tenantName: p.tenant_name || '',
                amount: p.amount || 0,
                type: p.type || 'Rent',
                date: p.date,
                period: p.period || '',
                status: p.status || 'Pending',
                invoiceStatus: p.invoice_status || undefined,
                remarks: p.remarks || '',
            })),
            invoices: invoicesRows.map((inv: any) => ({
                id: inv.original_id,
                tenantId: inv.tenant_id,
                billDate: inv.bill_date,
                targetInvoiceDate: inv.target_invoice_date || '',
                amount: inv.amount || 0,
                status: inv.status || 'Pending',
                invoicedAt: inv.invoiced_at || undefined,
                deferReason: inv.defer_reason || '',
            })),
            yearlyTargets: yearlyRows.reduce(
                (acc: Record<number, { revenue: number; occupancy: number; initialBudget?: number }>, row: any) => {
                    acc[Number(row.year)] = {
                        revenue: row.revenue || 0,
                        occupancy: row.occupancy || 0,
                        initialBudget: row.initial_budget ?? 0,
                    };
                    return acc;
                },
                {}
            ),
            initializationData: monthlyInitRows.map((row: any) => ({
                year: row.year,
                month: row.month,
                revenueTarget: row.revenue_target || 0,
                revenueCollected: row.revenue_collected || 0,
                occupancyRate: row.occupancy_rate || 0,
                accumulatedArrears: row.accumulated_arrears || 0,
                initialBudget: row.initial_budget ?? 0,
            })),
            budgetAssumptions: assumptionRows.map((a: any) => ({
                id: a.original_id,
                targetType: a.target_type,
                targetId: a.target_id || '',
                targetName: a.target_name || '',
                strategy: a.strategy || undefined,
                projectedTerminationDate: a.projected_termination_date || '',
                vacancyGapMonths: a.vacancy_gap_months ?? undefined,
                projectedSignDate: a.projected_sign_date || '',
                projectedUnitPrice: a.projected_unit_price || 0,
                projectedRentFreeMonths: a.projected_rent_free_months || 0,
                billingCycleShiftMonths: a.billing_cycle_shift_months ?? undefined,
                priceAdjustment: a.price_adjustment || undefined,
                paymentShift: a.payment_shift || undefined,
            })),
            budgetAdjustments: adjustmentRows.map((a: any) => {
                const isAmountDelta =
                    a.adjustment_kind === 'amount_delta' ||
                    (a.original_year == null && a.original_month == null);
                return {
                    id: a.original_id,
                    tenantId: a.tenant_id,
                    tenantName: a.tenant_name || '',
                    originalYear: isAmountDelta ? -1 : a.original_year,
                    originalMonth: isAmountDelta ? -1 : a.original_month,
                    adjustedYear: a.adjusted_year,
                    adjustedMonth: a.adjusted_month,
                    amount: a.amount || 0,
                    reason: a.reason || '',
                    adjustmentKind: a.adjustment_kind || undefined,
                };
            }),
            budgetScenarios: scenarioRows.map((s: any) => ({
                id: s.original_id,
                name: s.name,
                budgetYear: Number.isFinite(Number(s.budget_year)) ? Number(s.budget_year) : new Date().getFullYear(),
                description: s.description || '',
                createdAt: s.scenario_created_at || '',
                isActive: !!s.is_active,
                assumptions: Array.isArray(s.assumptions) ? s.assumptions : [],
                adjustments: Array.isArray(s.adjustments) ? s.adjustments : [],
                baseDataSnapshot: s.base_data_snapshot || undefined,
            })),
            billingPeriodNotes: (notesRows.items[0]?.notes_json || {}) as Record<string, string>,
            cloudSaveVersion,
            sealedMonths: (sealedRows as any[]).map((s: any) => ({
                year: Number(s.sealed_year),
                month: Number(s.sealed_month),
                arrearsIncrement: Number(s.arrears_increment) || 0,
                cumulativeArrears: Number(s.cumulative_arrears) || 0,
                billingDetails: Array.isArray(s.details_json) ? s.details_json : undefined,
            })),
        };

        // 构建 recordMeta：用于增量保存的行级乐观锁基准
        const recordMeta: RecordMeta = {};
        const fillMeta = (collection: string, rows: any[], keyOf: (row: any) => string) => {
            const bucket: Record<string, string> = {};
            for (const row of rows) {
                const key = keyOf(row);
                if (key && typeof row?.updated === 'string' && row.updated) {
                    bucket[key] = row.updated;
                }
            }
            if (Object.keys(bucket).length > 0) recordMeta[collection] = bucket;
        };
        fillMeta('pb_buildings', buildingsRows, (r) => r.original_id);
        fillMeta('pb_units', unitsRows, (r) => r.original_id);
        fillMeta('pb_tenants', tenantsRows, (r) => r.original_id);
        fillMeta('pb_payments', paymentsRows, (r) => r.original_id);
        fillMeta('pb_invoices', invoicesRows, (r) => r.original_id);
        fillMeta('pb_yearly_targets', yearlyRows, (r) => String(r.year));
        fillMeta('pb_monthly_init_data', monthlyInitRows, (r) => `${r.year}_${r.month}`);
        fillMeta('pb_budget_assumptions', assumptionRows, (r) => r.original_id);
        fillMeta('pb_budget_adjustments', adjustmentRows, (r) => r.original_id);
        fillMeta('pb_budget_scenarios', scenarioRows, (r) => r.original_id);
        // notes 集合本身是单条 upsert，meta 也保留以便冲突检测
        if (notesRows.items[0]?.updated) {
            recordMeta['pb_billing_period_notes'] = {
                billing_period_notes: notesRows.items[0].updated,
            };
        }

        const scoped = applyDashboardDataScope(rebuilt as DashboardData, getCurrentAuthUser());
        return { success: true, data: scoped, message: '获取成功', recordMeta };
    } catch (e: unknown) {
        return { success: false, message: 'PocketBase 数据获取失败: ' + errMsg(e) };
    }
};

// =====================================================================
// 增量保存（incremental save with row-level optimistic lock）
// =====================================================================

/**
 * 把 originalId（业务主键 / 合成 key）转换为 PocketBase 的过滤器表达式。
 * 不同集合的业务主键不同，集中在此处维护。
 */
const buildOriginalIdFilter = (
    collection: string,
    originalId: string,
    projectId: string
): string => {
    const pid = escFilter(projectId);
    if (collection === 'pb_yearly_targets') {
        const year = Number(originalId);
        return `project_id = "${pid}" && year = ${Number.isFinite(year) ? year : 0}`;
    }
    if (collection === 'pb_monthly_init_data') {
        const [yStr, mStr] = String(originalId).split('_');
        const year = Number(yStr);
        const month = Number(mStr);
        return `project_id = "${pid}" && year = ${Number.isFinite(year) ? year : 0} && month = ${Number.isFinite(month) ? month : 0}`;
    }
    const oid = escFilter(String(originalId));
    return `project_id = "${pid}" && original_id = "${oid}"`;
};

const isBillingPeriodNotesRow = (collection: string, originalId: string): boolean =>
    collection === 'pb_billing_period_notes' && originalId === 'billing_period_notes';

/** 把 notes_json 顶层 key 补丁合并进服务端 JSON（null 表示删除该 key） */
export const applyBillingPeriodNotesPatch = (
    serverNotes: Record<string, unknown> | null | undefined,
    patch: Record<string, unknown> | null | undefined
): Record<string, unknown> => {
    const merged =
        serverNotes && typeof serverNotes === 'object' && !Array.isArray(serverNotes)
            ? { ...serverNotes }
            : {};
    if (!patch || typeof patch !== 'object') return merged;
    for (const [key, value] of Object.entries(patch)) {
        if (value === null) delete merged[key];
        else merged[key] = value;
    }
    return merged;
};

const resolveBillingNotesUpdateFields = (
    serverRecord: Record<string, any>,
    changedFields: Record<string, any>
): Record<string, any> => {
    if (changedFields.notes_json_patch && typeof changedFields.notes_json_patch === 'object') {
        const { notes_json_patch, ...rest } = changedFields;
        return {
            ...rest,
            notes_json: applyBillingPeriodNotesPatch(
                serverRecord.notes_json as Record<string, unknown>,
                notes_json_patch as Record<string, unknown>
            ),
        };
    }
    return changedFields;
};

const COLLECTION_LABELS: Record<string, string> = {
    pb_payments: '收款流水',
    pb_tenants: '租户合同',
    pb_units: '房源单元',
    pb_buildings: '楼栋',
    pb_billing_period_notes: '账期备注',
    pb_yearly_targets: '年度目标',
    pb_monthly_init_data: '月度初始化',
};

const incrementalChangeLabel = (collection: string, originalId: string): string => {
    if (isBillingPeriodNotesRow(collection, originalId)) {
        return '账期备注（特殊业态收入 / 缓缴 / 手工应收等）';
    }
    const collLabel = COLLECTION_LABELS[collection] || collection;
    return `${collLabel} ${originalId}`;
};

const incrementalOpLabel = (op: 'create' | 'update' | 'delete'): string => {
    if (op === 'create') return '新增';
    if (op === 'delete') return '删除';
    return '更新';
};

export interface IncrementalSaveDisplayOptions {
    /** 按业务数据解析更易读的中文名称，如租户名、收款客户名 */
    labelFor?: (collection: string, originalId: string) => string | undefined;
};

const formatIncrementalItemLabel = (
    collection: string,
    originalId: string,
    opts?: IncrementalSaveDisplayOptions
): string => {
    const friendly = opts?.labelFor?.(collection, originalId)?.trim();
    const base = incrementalChangeLabel(collection, originalId);
    return friendly ? `${friendly}（${base}）` : base;
};

/** 弹窗标题：部分成功时不应显示「保存失败」 */
export const formatIncrementalSaveAlertTitle = (result: SaveIncrementalResult): string => {
    if (result.success) return '保存成功';
    if (result.applied.length > 0) return '部分保存成功';
    if (result.conflicts.length > 0 && result.errors.length === 0) return '保存冲突';
    return '保存失败';
};

/** 供 UI 展示增量保存的部分成功 / 失败明细 */
export const formatIncrementalSaveDetails = (
    result: SaveIncrementalResult,
    opts?: IncrementalSaveDisplayOptions
): string => {
    const lines: string[] = [];
    const summary: string[] = [];
    if (result.applied.length > 0) summary.push(`成功 ${result.applied.length} 条`);
    if (result.errors.length > 0) summary.push(`失败 ${result.errors.length} 条`);
    if (result.conflicts.length > 0) summary.push(`冲突 ${result.conflicts.length} 条`);
    lines.push(summary.length > 0 ? summary.join('，') : result.message);

    if (result.applied.length > 0 && (result.errors.length > 0 || result.conflicts.length > 0)) {
        lines.push('', '已成功写入：');
        const appliedPreview = result.applied.slice(0, 10);
        for (const item of appliedPreview) {
            lines.push(
                `· ${incrementalOpLabel(item.op)} ${formatIncrementalItemLabel(item.collection, item.originalId, opts)}`
            );
        }
        if (result.applied.length > appliedPreview.length) {
            lines.push(`· … 另有 ${result.applied.length - appliedPreview.length} 条`);
        }
        lines.push('', '未成功的修改仍保留在当前页面，请修正后再次点击保存。');
    }

    if (result.errors.length > 0) {
        lines.push('', '失败明细：');
        for (const err of result.errors) {
            lines.push(
                `· ${incrementalOpLabel(err.op)} ${formatIncrementalItemLabel(err.collection, err.originalId, opts)}：${err.message || '未知错误'}`
            );
        }
    }
    if (result.conflicts.length > 0) {
        lines.push('', `冲突 ${result.conflicts.length} 条，请在冲突弹窗中选择保留本地或服务端版本。`);
        for (const c of result.conflicts.slice(0, 10)) {
            lines.push(`· ${formatIncrementalItemLabel(c.collection, c.originalId, opts)}`);
        }
        if (result.conflicts.length > 10) {
            lines.push(`· … 另有 ${result.conflicts.length - 10} 条冲突`);
        }
    }
    return lines.join('\n');
};

export interface IncrementalConflict {
    collection: string;
    originalId: string;
    /** 服务端最新整条记录 */
    serverRecord: Record<string, any>;
    /** 本地试图写入的字段（updates）或本地标记为删除（deletes 时为 null） */
    localChanges: Record<string, any> | null;
    /** 本地基准 */
    baseUpdated: string;
    /** 服务端最新 updated */
    serverUpdated: string;
    /** 'update' | 'delete' */
    op: 'update' | 'delete';
}

export interface IncrementalApplied {
    collection: string;
    originalId: string;
    op: 'create' | 'update' | 'delete';
    /** 写入后服务端返回的最新 updated（create / update 时存在；delete 时为 null） */
    newUpdated: string | null;
}

export interface IncrementalError {
    collection: string;
    originalId: string;
    op: 'create' | 'update' | 'delete';
    message: string;
}

export interface SaveIncrementalResult {
    success: boolean;
    applied: IncrementalApplied[];
    conflicts: IncrementalConflict[];
    errors: IncrementalError[];
    /** 仅当 conflicts.length === 0 && errors.length === 0 时为 true */
    message: string;
}

/**
 * 增量保存到 PocketBase。
 *
 * 行为约定：
 *   - creates  → POST，不做存在性预检（让数据库唯一索引兜底）。
 *   - updates  → 先按 originalId 找记录 → 比对服务端 `updated` 与 baseUpdated：
 *       一致 → PATCH 仅本次改动字段；不一致 → 记入 conflicts，不写入。
 *   - deletes  → 同样先比对 updated；一致才 DELETE。
 *
 * 设计要点：
 *   - 单条失败不影响其他条（best-effort，非事务）。
 *   - 不再做全局 dashboard_data_version 前置校验。
 *   - 调用方拿到 conflicts 后，可让用户在 ConflictDialog 里选择「用我的值强制覆盖」
 *     或「用服务端值放弃本地」，再视情况二次提交。
 */
export const saveIncrementalToPocketBase = async (
    payload: DirtyPayload,
    projectId: string,
    recordMeta?: RecordMeta
): Promise<SaveIncrementalResult> => {
    if (!pb) {
        return {
            success: false,
            applied: [],
            conflicts: [],
            errors: [],
            message: 'PocketBase 未初始化',
        };
    }

    // 优先尝试 batch 保存（仅当本会话 batch API 仍可用时）。
    // _batchAvailable 为模块级：上一次 batch 被 403/404 拒绝后，这里直接跳过 batch + Phase-1 预查。
    let batchApplied: IncrementalApplied[] = [];
    if (_batchAvailable) {
    try {
        const { batchResult, residualPayload } = await saveBatchToPocketBase(payload, projectId, recordMeta);
        // batch 成功且无残余 → 直接返回
        if (batchResult.applied.length > 0 && batchResult.errors.length === 0 && !residualPayload) {
            return batchResult;
        }
        // 有残余操作 → 只对残余部分走串行，合并 batch 已成功的条目
        if (residualPayload) {
            batchApplied = batchResult.applied;
            payload = residualPayload;
            if (!hasResidual(payload)) {
                return batchResult;
            }
        } else if (batchResult.applied.length === 0) {
            console.warn('[PocketBase] batch 保存未成功，回退串行路径:', batchResult.message);
        }
    } catch {
        console.warn('[PocketBase] batch 保存异常，回退串行路径');
    }
    } // _batchAvailable

    const client = pb;
    const applied: IncrementalApplied[] = [];
    const conflicts: IncrementalConflict[] = [];
    const errors: IncrementalError[] = [];

    const findOne = async (collection: string, originalId: string) => {
        const list = await client.collection(collection).getList(1, 1, {
            filter: buildOriginalIdFilter(collection, originalId, projectId),
        });
        return list.items[0] || null;
    };

    const fallbackBaseUpdated = (
        collection: string,
        originalId: string,
        provided: string
    ): string => {
        if (provided) return provided;
        return recordMeta?.[collection]?.[originalId] || '';
    };

    for (const [collection, bucket] of Object.entries(payload)) {
        // -------- creates --------
        for (const c of bucket.creates) {
            const data = normalizeCreateDataForPocketBase(collection, projectId, c.data);
            try {
                const created = await client.collection(collection).create(data);
                applied.push({
                    collection,
                    originalId: c.originalId,
                    op: 'create',
                    newUpdated: typeof created?.updated === 'string' ? created.updated : null,
                });
            } catch (e: unknown) {
                // 基线未刷新时重复点保存会再次 create；已落库则视为幂等成功并同步 baseline
                if (isDuplicateKeyError(e)) {
                    try {
                        const existing = await findOne(collection, c.originalId);
                        if (existing && createDataMatchesExistingRecord(existing, data)) {
                            applied.push({
                                collection,
                                originalId: c.originalId,
                                op: 'create',
                                newUpdated:
                                    typeof existing.updated === 'string' ? existing.updated : null,
                            });
                            continue;
                        }
                        if (existing) {
                            errors.push({
                                collection,
                                originalId: c.originalId,
                                op: 'create',
                                message: 'original_id 已存在，但服务端记录内容与本次新增内容不一致，已阻止幂等合并',
                            });
                            continue;
                        }
                    } catch (_) {
                        /* fall through to errors */
                    }
                }
                errors.push({
                    collection,
                    originalId: c.originalId,
                    op: 'create',
                    message: errMsg(e) || String(e),
                });
            }
        }

        // -------- updates --------
        for (const u of bucket.updates) {
            try {
                const baseUpdated = fallbackBaseUpdated(collection, u.originalId, u.baseUpdated);
                const server = await findOne(collection, u.originalId);
                if (!server) {
                    // billing_period_notes 是单条 JSON 容器，若服务端缺失则按 upsert 语义直接补建。
                    if (isBillingPeriodNotesRow(collection, u.originalId)) {
                        const created = await client.collection(collection).create({
                            original_id: u.originalId,
                            notes_json: (u.changedFields as any)?.notes_json || {},
                            project_id: projectId,
                        });
                        applied.push({
                            collection,
                            originalId: u.originalId,
                            op: 'create',
                            newUpdated:
                                typeof created?.updated === 'string' ? created.updated : null,
                        });
                        continue;
                    }
                    // 服务端已不存在 → 视为冲突（被别人删了）
                    conflicts.push({
                        collection,
                        originalId: u.originalId,
                        serverRecord: {},
                        localChanges: u.changedFields,
                        baseUpdated,
                        serverUpdated: '',
                        op: 'update',
                    });
                    continue;
                }
                const serverUpdated = typeof server.updated === 'string' ? server.updated : '';
                if (baseUpdated && serverUpdated && serverUpdated !== baseUpdated) {
                    conflicts.push({
                        collection,
                        originalId: u.originalId,
                        serverRecord: server,
                        localChanges: u.changedFields,
                        baseUpdated,
                        serverUpdated,
                        op: 'update',
                    });
                    continue;
                }
                const fieldsToWrite = isBillingPeriodNotesRow(collection, u.originalId)
                    ? resolveBillingNotesUpdateFields(server, u.changedFields)
                    : u.changedFields;
                const updated = await applyPbRecordUpdate(
                    client,
                    collection,
                    server.id,
                    fieldsToWrite as Record<string, unknown>,
                    baseUpdated,
                );
                applied.push({
                    collection,
                    originalId: u.originalId,
                    op: 'update',
                    newUpdated:
                        typeof updated?.updated === 'string' ? updated.updated : null,
                });
            } catch (e: unknown) {
                // 服务端乐观锁 409 → 走冲突流程（ConflictDialog），而非普通错误
                if (isOptimisticLockConflict(e)) {
                    conflicts.push({
                        collection,
                        originalId: u.originalId,
                        serverRecord: {},
                        localChanges: u.changedFields,
                        baseUpdated: fallbackBaseUpdated(collection, u.originalId, u.baseUpdated),
                        serverUpdated: '',
                        op: 'update',
                    });
                } else {
                    errors.push({
                        collection,
                        originalId: u.originalId,
                        op: 'update',
                        message: errMsg(e) || String(e),
                    });
                }
            }
        }

        // -------- deletes --------
        for (const d of bucket.deletes) {
            try {
                const baseUpdated = fallbackBaseUpdated(collection, d.originalId, d.baseUpdated);
                const server = await findOne(collection, d.originalId);
                if (!server) {
                    // 已不存在 → 视为已完成（幂等）
                    applied.push({
                        collection,
                        originalId: d.originalId,
                        op: 'delete',
                        newUpdated: null,
                    });
                    continue;
                }
                const serverUpdated = typeof server.updated === 'string' ? server.updated : '';
                if (baseUpdated && serverUpdated && serverUpdated !== baseUpdated) {
                    conflicts.push({
                        collection,
                        originalId: d.originalId,
                        serverRecord: server,
                        localChanges: null,
                        baseUpdated,
                        serverUpdated,
                        op: 'delete',
                    });
                    continue;
                }
                await client.collection(collection).delete(server.id);
                applied.push({
                    collection,
                    originalId: d.originalId,
                    op: 'delete',
                    newUpdated: null,
                });
            } catch (e: unknown) {
                errors.push({
                    collection,
                    originalId: d.originalId,
                    op: 'delete',
                    message: errMsg(e) || String(e),
                });
            }
        }
    }

    // 合并 batch 已成功的条目
    const allApplied = [...batchApplied, ...applied];
    const allConflicts = [...conflicts];
    const allErrors = [...errors];

    const ok = allConflicts.length === 0 && allErrors.length === 0;
    let message = '';
    if (ok) {
        message = `增量保存成功（共 ${allApplied.length} 条）`;
    } else {
        const parts: string[] = [];
        if (allApplied.length) parts.push(`成功 ${allApplied.length} 条`);
        if (allConflicts.length) parts.push(`冲突 ${allConflicts.length} 条`);
        if (allErrors.length) parts.push(`失败 ${allErrors.length} 条`);
        message = `增量保存部分完成：${parts.join('，')}`;
    }

    return { success: ok, applied: allApplied, conflicts: allConflicts, errors: allErrors, message };
};

/**
 * Batch 保存：将所有 creates/updates/deletes 合并为一个 /api/batch 事务请求。
 * 仅当 PocketBase ≥ 0.23 且在 Admin UI 中启用了 Batch API 时可用。
 *
 * 与 saveIncrementalToPocketBase 的区别：
 *   - 1 次 HTTP 请求 vs 2N 次串行请求
 *   - 单事务（全部成功或全部回滚）vs best-effort
 *   - 冲突检测在服务端原子完成，无 check-then-write 时间窗
 *
 * 返回值：
 *   - batchResult.applied: 已通过 batch 处理的条目
 *   - batchResult.residualPayload: batch 无法处理的操作（notes 合并、ID 未找到等），调用方应走串行路径
 */
const saveBatchToPocketBase = async (
    payload: DirtyPayload,
    projectId: string,
    recordMeta?: RecordMeta
): Promise<{ batchResult: SaveIncrementalResult; residualPayload: DirtyPayload | null }> => {
    const emptyResult = { success: true, applied: [] as IncrementalApplied[], conflicts: [] as IncrementalConflict[], errors: [] as IncrementalError[], message: '' };
    if (!pb) {
        return { batchResult: { ...emptyResult, success: false, message: 'PocketBase 未初始化' }, residualPayload: null };
    }
    _residualAdded.clear();
    const client = pb;

    type BatchRequest = {
        method: 'POST' | 'PATCH' | 'DELETE';
        url: string;
        body?: Record<string, unknown>;
        headers?: Record<string, string>;
    };

    const requests: BatchRequest[] = [];
    const reqMeta: Array<{ collection: string; originalId: string; op: 'create' | 'update' | 'delete' }> = [];
    // 批量请求无法处理的操作：收集为残余 payload，由调用方走串行路径
    const residualPayload: DirtyPayload = {};

    // Phase 1: 批量获取 update/delete 所需的 PB 内部 id + updated（分片避免 URL 过长）
    const pbIdCache = new Map<string, string>(); // key: `${collection}::${originalId}` → PB internal id
    const pbUpdatedCache = new Map<string, string>(); // key: `${collection}::${originalId}` → server updated

    const BATCH_OR_SIZE = 50; // 每个 OR filter 最多包含的 original_id 数量

    for (const [collection, bucket] of Object.entries(payload)) {
        const allOids = new Set<string>();
        for (const u of bucket.updates) allOids.add(u.originalId);
        for (const d of bucket.deletes) allOids.add(d.originalId);

        if (allOids.size === 0) continue;

        const oidList = [...allOids];
        // 分片查询
        for (let i = 0; i < oidList.length; i += BATCH_OR_SIZE) {
            const chunk = oidList.slice(i, i + BATCH_OR_SIZE);
            const filterParts = chunk.map(oid => `original_id="${escFilter(oid)}"`);
            const filter = `project_id="${escFilter(projectId)}" && (${filterParts.join('||')})`;
            try {
                const rows = await client.collection(collection).getFullList({ filter, fields: 'id,original_id,updated' });
                for (const row of rows) {
                    const oid = String(row.original_id || '');
                    const cacheKey = `${collection}::${oid}`;
                    pbIdCache.set(cacheKey, row.id);
                    if (typeof row.updated === 'string') pbUpdatedCache.set(cacheKey, row.updated);
                }
            } catch {
                // 查询失败 → 该 chunk 的所有操作交给串行 fallback
                for (const oid of chunk) {
                    addToResidual(collection, oid, bucket, residualPayload);
                }
            }
        }
    }

    // Phase 2: 构建 batch 请求
    for (const [collection, bucket] of Object.entries(payload)) {
        // creates
        for (const c of bucket.creates) {
            const data = normalizeCreateDataForPocketBase(collection, projectId, c.data);
            requests.push({ method: 'POST', url: `/api/collections/${collection}/records`, body: data });
            reqMeta.push({ collection, originalId: c.originalId, op: 'create' });
        }

        // updates
        for (const u of bucket.updates) {
            const cacheKey = `${collection}::${u.originalId}`;
            const pbId = pbIdCache.get(cacheKey);
            if (!pbId) {
                addToResidual(collection, u.originalId, bucket, residualPayload, 'update');
                continue;
            }
            // notes 行的合并逻辑需要在串行路径处理（resolveBillingNotesUpdateFields）
            if (isBillingPeriodNotesRow(collection, u.originalId)) {
                addToResidual(collection, u.originalId, bucket, residualPayload, 'update');
                continue;
            }
            // 乐观锁：比对 recordMeta 中的 baseUpdated 与服务端实际 updated
            const baseUpdated = recordMeta?.[collection]?.[u.originalId] || '';
            const serverUpdated = pbUpdatedCache.get(cacheKey) || '';
            if (baseUpdated && serverUpdated && serverUpdated !== baseUpdated) {
                // 冲突：不进 batch，由调用方走串行路径处理冲突
                addToResidual(collection, u.originalId, bucket, residualPayload, 'update');
                continue;
            }
            requests.push({
                method: 'PATCH',
                url: `/api/collections/${collection}/records/${pbId}`,
                body: u.changedFields as Record<string, unknown>,
                // 服务端乐观锁基线（pb_hooks CAS 据此比对，PB_CAS_ENABLED=1 时生效）
                ...(baseUpdated ? { headers: { 'X-PB-Expected-Updated': baseUpdated } } : {}),
            });
            reqMeta.push({ collection, originalId: u.originalId, op: 'update' });
        }

        // deletes
        for (const d of bucket.deletes) {
            const cacheKey = `${collection}::${d.originalId}`;
            const pbId = pbIdCache.get(cacheKey);
            if (!pbId) {
                addToResidual(collection, d.originalId, bucket, residualPayload, 'delete');
                continue;
            }
            const baseUpdated = recordMeta?.[collection]?.[d.originalId] || '';
            const serverUpdated = pbUpdatedCache.get(cacheKey) || '';
            if (baseUpdated && serverUpdated && serverUpdated !== baseUpdated) {
                addToResidual(collection, d.originalId, bucket, residualPayload, 'delete');
                continue;
            }
            requests.push({ method: 'DELETE', url: `/api/collections/${collection}/records/${pbId}` });
            reqMeta.push({ collection, originalId: d.originalId, op: 'delete' });
        }
    }

    if (requests.length === 0) {
        return {
            batchResult: { ...emptyResult, message: 'batch: 所有操作需走串行路径' },
            residualPayload: hasResidual(residualPayload) ? residualPayload : null,
        };
    }

    // Phase 3: 发送 batch 请求。PB batch 为单事务（all-or-nothing）。跨多个 batch 分片会丢失原子性——
    // 若后一片失败而前一片已提交，整包回串行会对「已提交行」重复处理（update 因 updated 已变而误判冲突）。
    // 故仅当操作数 ≤ BATCH_MAX_REQUESTS 时走单个 batch；超过则整包交串行（串行可处理任意规模、逐行幂等/冲突可控）。
    if (requests.length > BATCH_MAX_REQUESTS) {
        return {
            batchResult: { ...emptyResult, message: `batch: 操作数 ${requests.length} 超过单事务上限 ${BATCH_MAX_REQUESTS}，转串行` },
            residualPayload: payload,
        };
    }
    try {
        const baseUrl = client.baseUrl.replace(/\/+$/, '');
        const batchResp = await fetch(`${baseUrl}/api/batch`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(client.authStore.token ? { Authorization: client.authStore.token } : {}),
            },
            body: JSON.stringify({ requests }),
        });

        if (!batchResp.ok) {
            // batch API 不可用（404）/未启用（403）→ 本会话记录不可用，后续直接走串行
            if (batchResp.status === 403 || batchResp.status === 404) {
                _batchAvailable = false;
            }
            return {
                batchResult: { ...emptyResult, message: `batch API 返回 ${batchResp.status}，回退串行` },
                residualPayload: payload, // 整个 payload 交串行走
            };
        }

        const batchResponse = await batchResp.json();
        const results: Array<{ status: number; body?: Record<string, unknown> }> =
            Array.isArray(batchResponse) ? batchResponse : [];

        const applied: IncrementalApplied[] = [];
        const conflicts: IncrementalConflict[] = [];
        const errors: IncrementalError[] = [];

        for (let i = 0; i < results.length && i < reqMeta.length; i++) {
            const res = results[i];
            const meta = reqMeta[i];
            const status = res.status || 0;

            if (status >= 200 && status < 300) {
                const newUpdated = res.body?.updated ? String(res.body.updated) : null;
                applied.push({ collection: meta.collection, originalId: meta.originalId, op: meta.op, newUpdated });
            } else if (status === 409 || String(res.body?.message || '').indexOf('OPTIMISTIC_LOCK_CONFLICT') >= 0) {
                // 服务端乐观锁冲突 → 走冲突流程（ConflictDialog），由调用方按基线重拉后重试
                conflicts.push({
                    collection: meta.collection,
                    originalId: meta.originalId,
                    serverRecord: {},
                    localChanges: {},
                    baseUpdated: recordMeta?.[meta.collection]?.[meta.originalId] || '',
                    serverUpdated: '',
                    op: meta.op === 'delete' ? 'delete' : 'update',
                });
            } else {
                errors.push({
                    collection: meta.collection,
                    originalId: meta.originalId,
                    op: meta.op,
                    message: `HTTP ${status}: ${String(res.body?.message || 'unknown')}`,
                });
            }
        }

        const ok = conflicts.length === 0 && errors.length === 0;
        return {
            batchResult: {
                success: ok,
                applied,
                conflicts,
                errors,
                message: ok ? `batch 保存成功（${applied.length} 条）` : `batch 部分完成：成功 ${applied.length}，失败 ${errors.length}`,
            },
            residualPayload: hasResidual(residualPayload) ? residualPayload : null,
        };
    } catch (e: unknown) {
        return {
            batchResult: { ...emptyResult, success: false, message: `batch 请求异常: ${errMsg(e) || String(e)}` },
            residualPayload: payload,
        };
    }
};

const _residualAdded = new Set<string>(); // 防止重复入队

/** 将操作加入残余 payload（幂等：同一 collection::oid 只入队一次） */
function addToResidual(
    collection: string,
    originalId: string,
    bucket: DirtyPayload[string],
    residual: DirtyPayload,
    op?: 'update' | 'delete' | 'create',
) {
    const dedupKey = `${collection}::${originalId}`;
    if (_residualAdded.has(dedupKey)) return;
    if (!residual[collection]) {
        residual[collection] = { creates: [], updates: [], deletes: [] };
    }
    if (op === 'update' || (!op && bucket.updates.some(u => u.originalId === originalId))) {
        const item = bucket.updates.find(u => u.originalId === originalId);
        if (item) { residual[collection].updates.push(item); _residualAdded.add(dedupKey); }
    } else if (op === 'delete' || (!op && bucket.deletes.some(d => d.originalId === originalId))) {
        const item = bucket.deletes.find(d => d.originalId === originalId);
        if (item) { residual[collection].deletes.push(item); _residualAdded.add(dedupKey); }
    } else if (op === 'create') {
        const item = bucket.creates.find(c => c.originalId === originalId);
        if (item) { residual[collection].creates.push(item); _residualAdded.add(dedupKey); }
    }
}

function hasResidual(p: DirtyPayload): boolean {
    for (const b of Object.values(p)) {
        if (b.creates.length > 0 || b.updates.length > 0 || b.deletes.length > 0) return true;
    }
    return false;
}

/**
 * 强制按本地值覆盖某条记录（用户在 ConflictDialog 选择「用我的值」时调用）。
 * 流程：再次拉服务端最新 record，取它的 updated 作为新的 baseUpdated 直接 PATCH。
 * 用户已经确认要覆盖，所以这里不再二次比对。
 */
export const forceOverwriteRecord = async (
    collection: string,
    originalId: string,
    changedFields: Record<string, any>,
    projectId: string
): Promise<{ success: boolean; message: string; newUpdated?: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    try {
        const list = await pb.collection(collection).getList(1, 1, {
            filter: buildOriginalIdFilter(collection, originalId, projectId),
        });
        const server = list.items[0];
        if (!server) {
            if (isBillingPeriodNotesRow(collection, originalId)) {
                const created = await pb.collection(collection).create({
                    original_id: originalId,
                    notes_json: changedFields?.notes_json || {},
                    project_id: projectId,
                });
                return {
                    success: true,
                    message: '服务端缺失，已按本地值补建',
                    newUpdated:
                        typeof created?.updated === 'string' ? created.updated : undefined,
                };
            }
            return { success: false, message: '服务端记录已不存在，无法覆盖' };
        }
        const fieldsToWrite = isBillingPeriodNotesRow(collection, originalId)
            ? resolveBillingNotesUpdateFields(server, changedFields)
            : changedFields;
        const updated = await pb.collection(collection).update(server.id, fieldsToWrite);
        return {
            success: true,
            message: '已强制覆盖',
            newUpdated: typeof updated?.updated === 'string' ? updated.updated : undefined,
        };
    } catch (e: unknown) {
        return { success: false, message: errMsg(e) || String(e) };
    }
};

/** 用户在冲突处理中选择「用我的删除」时，按最新服务端记录强制删除。 */
export const forceDeleteRecord = async (
    collection: string,
    originalId: string,
    projectId: string
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    try {
        const list = await pb.collection(collection).getList(1, 1, {
            filter: buildOriginalIdFilter(collection, originalId, projectId),
        });
        const server = list.items[0];
        if (!server) {
            return { success: true, message: '服务端记录已不存在' };
        }
        await pb.collection(collection).delete(server.id);
        return { success: true, message: '已强制删除' };
    } catch (e: unknown) {
        return { success: false, message: errMsg(e) || String(e) };
    }
};

/**
 * 增量保存成功后可选地把 dashboard_data_version 递增 1。
 * 该字段不再作为前置校验依据，仅用于「最近一次成功保存」的轻量审计。
 */
export const bumpCloudSaveVersion = async (projectId: string): Promise<number | null> => {
    if (!pb) return null;
    try {
        const current = await readCloudSaveVersion(projectId);
        const next = current + 1;
        const existing = await pb.collection('pb_billing_period_notes').getList(1, 1, {
            filter: `project_id = "${escFilter(projectId)}" && original_id = "${escFilter(DASHBOARD_DATA_VERSION_OID)}"`,
            fields: 'id',
        });
        const row = {
            original_id: DASHBOARD_DATA_VERSION_OID,
            notes_json: { version: next },
            project_id: projectId,
        };
        if (existing.items.length > 0) {
            await pb.collection('pb_billing_period_notes').update(existing.items[0].id, row);
        } else {
            await pb.collection('pb_billing_period_notes').create(row);
        }
        return next;
    } catch (e) {
        console.warn('[bumpCloudSaveVersion] 递增失败（可忽略）', e);
        return null;
    }
};

export type KpiSnapshotSummary = {
    annualRevenueTarget: number;
    annualRevenueCollected: number;
    annualInitialBudget: number;
    annualBudgetTarget: number;
    annualContractReceivable: number;
    annualGoalCompletion: number;
    annualBudgetCompletion: number;
    occupancyRate: number;
    annualOccupancyTarget: number;
    tenantCount: number;
    totalArea: number;
    leasedArea: number;
    vacantArea?: number;
    accumulatedArrears?: number;
};

export type KpiSnapshot = {
    projectId: string;
    year: number;
    summary: KpiSnapshotSummary;
    monthlyTrends: MonthlyTrend[];
    dataVersion: number;
    calculatedAt: string;
};

const kpiSnapshotCollection = 'pb_kpi_snapshots';

export const fetchKpiSnapshot = async (
    projectId: string,
    year: number
): Promise<{ success: boolean; snapshot?: KpiSnapshot; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const pid = (projectId || '').trim();
    if (!pid) return { success: false, message: '缺少 project_id' };

    try {
        const res = await pb.collection(kpiSnapshotCollection).getList(1, 1, {
            filter: `project_id = "${escFilter(pid)}" && year = ${Math.floor(year)}`,
        });
        const row = res.items[0];
        if (!row) return { success: false, message: '暂无 KPI 快照' };
        return {
            success: true,
            snapshot: {
                projectId: row.project_id,
                year: row.year,
                summary: (row.summary_json || {}) as KpiSnapshotSummary,
                monthlyTrends: Array.isArray(row.monthly_trends_json) ? row.monthly_trends_json as MonthlyTrend[] : [],
                dataVersion: Number(row.data_version || 0),
                calculatedAt: row.calculated_at || row.updated || '',
            },
            message: '加载成功',
        };
    } catch (e: unknown) {
        return { success: false, message: 'KPI 快照加载失败: ' + (errMsg(e) || '未知错误') };
    }
};

export const upsertKpiSnapshot = async (
    snapshot: KpiSnapshot
): Promise<{ success: boolean; message: string }> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    const pid = (snapshot.projectId || '').trim();
    if (!pid) return { success: false, message: '缺少 project_id' };

    try {
        const filter = `project_id = "${escFilter(pid)}" && year = ${Math.floor(snapshot.year)}`;
        const existing = await pb.collection(kpiSnapshotCollection).getList(1, 1, {
            filter,
            fields: 'id',
        });
        const row = {
            project_id: pid,
            year: Math.floor(snapshot.year),
            summary_json: snapshot.summary as unknown as Record<string, unknown>,
            monthly_trends_json: snapshot.monthlyTrends as unknown as Record<string, unknown>[],
            data_version: Math.max(0, Math.floor(snapshot.dataVersion || 0)),
            calculated_at: snapshot.calculatedAt || new Date().toISOString(),
        };
        if (existing.items.length > 0) {
            await pb.collection(kpiSnapshotCollection).update(existing.items[0].id, row);
        } else {
            await pb.collection(kpiSnapshotCollection).create(row);
        }
        return { success: true, message: 'KPI 快照已更新' };
    } catch (e: unknown) {
        return { success: false, message: 'KPI 快照更新失败: ' + (errMsg(e) || '未知错误') };
    }
};

/** 历史：`pb_billing_period_notes` 中 openclaw_kpi_snapshot；现已由 pb_integration_snapshots 全量快照替代，保留常量供文档/脚本检索 */
export const OPENCLAW_KPI_SNAPSHOT_OID = 'openclaw_kpi_snapshot';

export { INTEGRATION_FULL_SNAPSHOT_KIND } from './integrationSnapshot';

const integrationSnapshotCollection = 'pb_integration_snapshots';

export const upsertIntegrationFullSnapshot = async (
    projectId: string,
    snapshot: IntegrationFullSnapshotV1
): Promise<void> => {
    if (!pb) return;
    const pid = (projectId || '').trim();
    if (!pid) return;

    const filter = `project_id = "${escFilter(pid)}" && snapshot_kind = "${escFilter(INTEGRATION_FULL_SNAPSHOT_KIND)}"`;
    const existing = await pb.collection(integrationSnapshotCollection).getList(1, 1, {
        filter,
        fields: 'id',
    });
    const row = {
        project_id: pid,
        snapshot_kind: INTEGRATION_FULL_SNAPSHOT_KIND,
        payload: snapshot as unknown as Record<string, unknown>,
    };
    if (existing.items.length > 0) {
        await pb.collection(integrationSnapshotCollection).update(existing.items[0].id, row);
    } else {
        await pb.collection(integrationSnapshotCollection).create(row);
    }
};

let integrationSnapshotDebounce: ReturnType<typeof setTimeout> | null = null;
let pendingIntegrationSnapshot: { projectId: string; snapshot: IntegrationFullSnapshotV1 } | null = null;

/** 合并短时间内的多次重算，避免频繁写 PocketBase（与保存成功后 recalculateMetrics 对齐） */
export const scheduleUpsertIntegrationFullSnapshot = (
    projectId: string,
    snapshot: IntegrationFullSnapshotV1
): void => {
    const pid = (projectId || '').trim();
    if (!pid) return;
    pendingIntegrationSnapshot = { projectId: pid, snapshot };
    if (integrationSnapshotDebounce) clearTimeout(integrationSnapshotDebounce);
    integrationSnapshotDebounce = setTimeout(async () => {
        integrationSnapshotDebounce = null;
        const job = pendingIntegrationSnapshot;
        pendingIntegrationSnapshot = null;
        if (!job) return;
        try {
            await upsertIntegrationFullSnapshot(job.projectId, job.snapshot);
        } catch (e) {
            console.warn('[integration_snapshot] 同步失败（可忽略：未初始化 PB 或规则拒绝）', e);
        }
    }, 1600);
};
