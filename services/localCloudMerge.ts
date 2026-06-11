import type { DashboardData, PaymentRecord, SpecialBusinessReceivable, Tenant } from '../types';
import {
    MANUAL_RECEIVABLE_LINES_NOTE_KEY,
    parseManualReceivableLinesFromNotes,
    parseSpecialBusinessReceivablesFromNotes,
    SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY,
    stringifySpecialBusinessReceivables,
} from './receivableListHelpers';

/**
 * 启动 / 切园时：把浏览器 localStorage 里「云端尚未落库」的财务侧修改补回界面。
 * 典型场景：增量保存部分失败（如收款成功、特殊业态备注失败）后用户刷新页面，
 * 若直接以云端为准会丢失 localStorage 里仍保留的手工录入。
 *
 * 注意：特殊业态 / 手工应收 JSON 数组不能整包以 local 覆盖 cloud，否则会把
 * 已在云端（或机器人脚本）删除的旧行 resurrect 回来。
 */
export function mergeLocalDashboardCacheIntoCloud(
    cloud: DashboardData,
    local: DashboardData
): { data: DashboardData; recovered: boolean } {
    let recovered = false;

    const mergedNotes = { ...(cloud.billingPeriodNotes || {}) };
    for (const [key, value] of Object.entries(local.billingPeriodNotes || {})) {
        if (key === SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY) {
            const merged = mergeSpecialBusinessReceivableNotes(
                cloud.billingPeriodNotes?.[key],
                value
            );
            if (merged !== undefined && merged !== cloud.billingPeriodNotes?.[key]) {
                mergedNotes[key] = merged;
                recovered = true;
            }
            continue;
        }
        if (key === MANUAL_RECEIVABLE_LINES_NOTE_KEY) {
            const merged = mergeManualReceivableLineNotes(
                cloud.billingPeriodNotes?.[key],
                value
            );
            if (merged !== undefined && merged !== cloud.billingPeriodNotes?.[key]) {
                mergedNotes[key] = merged;
                recovered = true;
            }
            continue;
        }
        if (mergedNotes[key] !== value) {
            mergedNotes[key] = value;
            recovered = true;
        }
    }

    const { payments: mergedPayments, recovered: paymentsRecovered } = mergePaymentsFromLocalCache(
        cloud.payments || [],
        local.payments || [],
        cloud.cloudSaveVersion ?? 0,
        local.cloudSaveVersion ?? 0
    );
    if (paymentsRecovered) recovered = true;

    const localTenantMap = new Map((local.tenants || []).map((t) => [t.id, t]));
    const mergedTenants: Tenant[] = (cloud.tenants || []).map((t) => {
        const localTenant = localTenantMap.get(t.id);
        if (localTenant?.isSpecialBusiness && !t.isSpecialBusiness) {
            recovered = true;
            return { ...t, isSpecialBusiness: true };
        }
        return t;
    });

    if (!recovered) {
        return { data: cloud, recovered: false };
    }

    return {
        data: {
            ...cloud,
            billingPeriodNotes: mergedNotes,
            payments: mergedPayments,
            tenants: mergedTenants,
        },
        recovered: true,
    };
}

const receivableEntryKey = (tenantId: string, periodYYYYMM: string): string =>
    `${tenantId}\0${periodYYYYMM}`;

const parseUpdatedAtMs = (value: string | undefined): number => {
    if (!value) return 0;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
};

const maxUpdatedAtMs = (rows: Array<{ updatedAt?: string }>): number =>
    rows.reduce((max, row) => Math.max(max, parseUpdatedAtMs(row.updatedAt)), 0);

/**
 * 以云端为删除权威：仅补回 local 中「云端不存在且 updatedAt 新于云端最新写入」的条目。
 */
export function mergeSpecialBusinessReceivableNotes(
    cloudRaw: string | undefined,
    localRaw: string | undefined
): string | undefined {
    const cloudNotes = cloudRaw ? { [SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY]: cloudRaw } : undefined;
    const localNotes = localRaw ? { [SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY]: localRaw } : undefined;
    const cloudRows = parseSpecialBusinessReceivablesFromNotes(cloudNotes);
    const localRows = parseSpecialBusinessReceivablesFromNotes(localNotes);
    if (localRows.length === 0) return cloudRaw;
    if (cloudRows.length === 0) return localRaw;

    const cloudMaxUpdatedAt = maxUpdatedAtMs(cloudRows);
    const merged = new Map<string, SpecialBusinessReceivable>();
    for (const row of cloudRows) {
        merged.set(receivableEntryKey(row.tenantId, row.periodYYYYMM), row);
    }
    for (const row of localRows) {
        const key = receivableEntryKey(row.tenantId, row.periodYYYYMM);
        const existing = merged.get(key);
        if (!existing) {
            const localUpdatedAt = parseUpdatedAtMs(row.updatedAt);
            if (localUpdatedAt > cloudMaxUpdatedAt) {
                merged.set(key, row);
            }
            continue;
        }
        if (parseUpdatedAtMs(row.updatedAt) >= parseUpdatedAtMs(existing.updatedAt)) {
            merged.set(key, row);
        }
    }
    const out = [...merged.values()];
    return out.length > 0 ? stringifySpecialBusinessReceivables(out) : undefined;
}

/** 手工应收行无 updatedAt；云端已有数据时以云端为准，避免删行 resurrect。 */
export function mergeManualReceivableLineNotes(
    cloudRaw: string | undefined,
    localRaw: string | undefined
): string | undefined {
    const cloudNotes = cloudRaw ? { [MANUAL_RECEIVABLE_LINES_NOTE_KEY]: cloudRaw } : undefined;
    const localNotes = localRaw ? { [MANUAL_RECEIVABLE_LINES_NOTE_KEY]: localRaw } : undefined;
    const cloudRows = parseManualReceivableLinesFromNotes(cloudNotes);
    const localRows = parseManualReceivableLinesFromNotes(localNotes);
    if (localRows.length === 0) return cloudRaw;
    if (cloudRows.length === 0) return localRaw;
    return cloudRaw;
}

/**
 * 收款合并：默认以云端为准。
 * local 多出来的行仅在「本地 cloudSaveVersion 高于云端」时补回（极少见），
 * 否则视为已删收款仍残留在 localStorage 的 stale 缓存。
 */
export function mergePaymentsFromLocalCache(
    cloudPayments: PaymentRecord[],
    localPayments: PaymentRecord[],
    cloudSaveVersion = 0,
    localSaveVersion = 0
): { payments: PaymentRecord[]; recovered: boolean } {
    const cloudList = cloudPayments || [];
    const localList = localPayments || [];
    const cloudIds = new Set(cloudList.map((p) => p.id));
    const localOnly = localList.filter((p) => p?.id && !cloudIds.has(p.id));
    if (localOnly.length === 0) {
        return { payments: cloudList, recovered: false };
    }
    if (cloudSaveVersion >= localSaveVersion) {
        return { payments: cloudList, recovered: false };
    }
    return { payments: [...localOnly, ...cloudList], recovered: true };
}
