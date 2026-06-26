import { CloudBackupMetadata, CloudConfig, DashboardData } from '../types';
import type { DirtyPayload } from './dirtyTracker';
import type {
    KpiSnapshot,
    RecordMeta,
    SaveIncrementalResult,
} from './pocketbaseService';
import {
    authenticatePocketBase,
    authenticatePocketBaseUser,
    bumpCloudSaveVersion as bumpPocketBaseCloudSaveVersion,
    checkPocketBaseConnection,
    fetchAuthorizedParks as fetchPocketBaseAuthorizedParks,
    fetchKpiSnapshot,
    fetchPocketBaseBackup,
    forceDeleteRecord,
    forceOverwriteRecord,
    getCurrentAuthToken,
    getCurrentAuthUser,
    getPocketBaseHistory,
    initPocketBase,
    isAuthenticated,
    logoutPocketBase,
    readCloudSaveVersion as readPocketBaseCloudSaveVersion,
    refreshAuthRecord,
    restorePocketBaseSessionFromCookie,
    saveIncrementalToPocketBase,
    saveToPocketBase,
    setLoadWindowSinceYear,
} from './pocketbaseService';
import type { AuthUser, ParkInfo } from '../types';

export type { RecordMeta, SaveIncrementalResult } from './pocketbaseService';
export type { KpiSnapshot, KpiSnapshotSummary } from './pocketbaseService';
export type {
    IncrementalConflict,
    IncrementalApplied,
    IncrementalError,
} from './pocketbaseService';
export {
    formatIncrementalSaveDetails,
    formatIncrementalSaveAlertTitle,
    scheduleUpsertIntegrationFullSnapshot,
    INTEGRATION_FULL_SNAPSHOT_KIND,
    OPENCLAW_KPI_SNAPSHOT_OID,
} from './pocketbaseService';
export type { IncrementalSaveDisplayOptions } from './pocketbaseService';

/** 仅 PocketBase：前端直连本地/内网后端，无中间云端服务层 */
const PLACEHOLDER_PASSWORD = 'your-secure-password';

export const initCloud = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    const ok = initPocketBase(config.pocketbaseUrl);
    if (!ok) return false;
    await restorePocketBaseSessionFromCookie();
    const email = (config.pocketbaseEmail || '').trim();
    const password = (config.pocketbasePassword || '').trim();
    if (email && password && password !== PLACEHOLDER_PASSWORD) {
        await authenticatePocketBase(email, password);
    }
    return true;
};

export const checkConnection = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    return checkPocketBaseConnection(config.pocketbaseUrl);
};

export const loginCloudUser = async (
    config: CloudConfig,
    email: string,
    password: string,
): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    if (!config.pocketbaseUrl) return { success: false, message: '请填写 PocketBase URL' };
    const ok = initPocketBase(config.pocketbaseUrl);
    if (!ok) return { success: false, message: 'PocketBase 初始化失败' };
    return authenticatePocketBaseUser(email, password);
};

export const logoutCloudUser = (): void => {
    logoutPocketBase();
};

export const getCurrentCloudUser = (): AuthUser | null => {
    return getCurrentAuthUser();
};

export const getCurrentCloudAuthToken = (): string => {
    return getCurrentAuthToken();
};

export const refreshCloudAuthRecord = async () => {
    return refreshAuthRecord();
};

export const isCloudUserAuthenticated = (): boolean => {
    return isAuthenticated();
};

export const fetchAuthorizedParks = async (): Promise<{
    success: boolean;
    parks: ParkInfo[];
    message: string;
}> => {
    return fetchPocketBaseAuthorizedParks();
};

export const setCloudLoadWindowSinceYear = (sinceYear: number | null): void => {
    setLoadWindowSinceYear(sinceYear);
};

/**
 * 仅供初始化/灾备恢复等显式全量覆盖流程使用。
 * 正常业务保存必须走 saveIncrementalToCloud，避免多人协作时删表重建。
 */
export type SaveToCloudResult = {
    success: boolean;
    message: string;
    conflict?: boolean;
    newVersion?: number;
};

type CloudBackupResult = {
    success: boolean;
    data?: DashboardData;
    message: string;
    recordMeta?: RecordMeta;
};

const inFlightCloudBackups = new Map<string, Promise<CloudBackupResult>>();
const inFlightKpiSnapshots = new Map<string, Promise<{
    success: boolean;
    snapshot?: KpiSnapshot;
    message: string;
}>>();

const backupRequestKey = (
    config: CloudConfig,
    backupId: string,
    options?: { year?: number; sinceYear?: number },
): string => [
    config.pocketbaseUrl || '',
    config.projectId || '',
    backupId || '',
    options?.year ?? '',
    options?.sinceYear ?? '',
].join('|');

export const saveToCloud = async (
    data: DashboardData,
    config: CloudConfig,
    note: string = '',
    options?: { skipVersionCheck?: boolean },
): Promise<SaveToCloudResult> => {
    return saveToPocketBase(data, config.projectId, note, {
        expectedVersion: data.cloudSaveVersion ?? 0,
        skipVersionCheck: options?.skipVersionCheck === true,
    });
};

export const getCloudHistory = async (
    config: CloudConfig,
): Promise<{ success: boolean; data?: CloudBackupMetadata[]; message: string }> => {
    return getPocketBaseHistory(config.projectId);
};

export const fetchCloudBackup = async (
    config: CloudConfig,
    backupId: string,
    options?: { year?: number; sinceYear?: number },
): Promise<CloudBackupResult> => {
    void backupId;
    const key = backupRequestKey(config, backupId, options);
    const existing = inFlightCloudBackups.get(key);
    if (existing) return existing;
    const request = fetchPocketBaseBackup(config.projectId, options)
        .finally(() => {
            inFlightCloudBackups.delete(key);
        });
    inFlightCloudBackups.set(key, request);
    return request;
};

/**
 * 增量保存 —— 行级乐观锁，只提交 dirtyTracker 登记的 create/update/delete。
 *
 * 调用方：App.tsx 在用户点击「保存」时构造 payload 并调用本函数。
 * - 若返回 conflicts.length > 0，请把它们交给 ConflictDialog 让用户决策。
 * - 成功后建议立刻 fetchCloudBackup 刷新 recordMeta，避免后续保存基准过时。
 */
export const saveIncrementalToCloud = async (
    payload: DirtyPayload,
    config: CloudConfig,
    recordMeta?: RecordMeta,
): Promise<SaveIncrementalResult> => {
    return saveIncrementalToPocketBase(payload, config.projectId, recordMeta);
};

/** 用户在 ConflictDialog 选择「用我的值」后强制覆盖一条记录。 */
export const forceOverwriteCloudRecord = async (
    config: CloudConfig,
    collection: string,
    originalId: string,
    changedFields: Record<string, any>,
): Promise<{ success: boolean; message: string; newUpdated?: string }> => {
    return forceOverwriteRecord(
        collection,
        originalId,
        changedFields,
        config.projectId,
    );
};

/** 用户在 ConflictDialog 选择「用我的删除」后强制删除一条记录。 */
export const forceDeleteCloudRecord = async (
    config: CloudConfig,
    collection: string,
    originalId: string,
): Promise<{ success: boolean; message: string }> => {
    return forceDeleteRecord(
        collection,
        originalId,
        config.projectId,
    );
};

/** 增量保存成功后可选地把 dashboard_data_version +1，仅用于审计。 */
export const bumpCloudSaveVersion = async (config: CloudConfig): Promise<number | null> => {
    return bumpPocketBaseCloudSaveVersion(config.projectId);
};

/** 读取云端 dashboard_data_version（任一端写入成功即 +1），用于外部写入感知轮询。 */
export const readCloudSaveVersion = async (config: CloudConfig): Promise<number> => {
    return readPocketBaseCloudSaveVersion(config.projectId);
};

export const fetchCloudKpiSnapshot = async (
    config: CloudConfig,
    year: number,
): Promise<{ success: boolean; snapshot?: KpiSnapshot; message: string }> => {
    const key = `${config.pocketbaseUrl || ''}|${config.projectId || ''}|${Math.floor(year)}`;
    const existing = inFlightKpiSnapshots.get(key);
    if (existing) return existing;
    const request = fetchKpiSnapshot(config.projectId, year)
        .finally(() => {
            inFlightKpiSnapshots.delete(key);
        });
    inFlightKpiSnapshots.set(key, request);
    return request;
};

// upsertCloudKpiSnapshot 已删除：KPI 快照唯一作者收敛为服务端 compute-engine（compute/refresh），
// 前端不再上传，避免用陈旧本地数据覆盖 gateway 刚写的新值（第五轮 2.2）。
