import { CloudConfig, DashboardData, CloudBackupMetadata } from '../types';
import * as pocketbaseService from './pocketbaseService';
import type { DirtyPayload } from './dirtyTracker';
import type { KpiSnapshot, RecordMeta, SaveIncrementalResult } from './pocketbaseService';
import type { AuthUser, ParkInfo } from '../types';
import type { CreateManagedUserInput, ManagedUserAccount, SignupRequestRecord, UpdateManagedUserInput } from './pocketbaseService';

export type { RecordMeta, SaveIncrementalResult } from './pocketbaseService';
export type { KpiSnapshot, KpiSnapshotSummary } from './pocketbaseService';
export type { ManagedUserAccount, CreateManagedUserInput, UpdateManagedUserInput, SignupRequestRecord } from './pocketbaseService';
export type {
    IncrementalConflict,
    IncrementalApplied,
    IncrementalError,
} from './pocketbaseService';

/** 仅 PocketBase：前端直连本地/内网后端，无中间云端服务层 */
const PLACEHOLDER_PASSWORD = 'your-secure-password';

export const initCloud = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    const ok = pocketbaseService.initPocketBase(config.pocketbaseUrl);
    if (!ok) return false;
    const email = (config.pocketbaseEmail || '').trim();
    const password = (config.pocketbasePassword || '').trim();
    if (email && password && password !== PLACEHOLDER_PASSWORD) {
        await pocketbaseService.authenticatePocketBase(email, password);
    }
    return true;
};

export const checkConnection = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    return pocketbaseService.checkPocketBaseConnection(config.pocketbaseUrl);
};

export const loginCloudUser = async (
    config: CloudConfig,
    email: string,
    password: string
): Promise<{ success: boolean; user?: AuthUser; message: string }> => {
    if (!config.pocketbaseUrl) return { success: false, message: '请填写 PocketBase URL' };
    const ok = pocketbaseService.initPocketBase(config.pocketbaseUrl);
    if (!ok) return { success: false, message: 'PocketBase 初始化失败' };
    return pocketbaseService.authenticatePocketBaseUser(email, password);
};

export const logoutCloudUser = () => {
    pocketbaseService.logoutPocketBase();
};

export const getCurrentCloudUser = (): AuthUser | null => {
    return pocketbaseService.getCurrentAuthUser();
};

export const isCloudUserAuthenticated = (): boolean => {
    return pocketbaseService.isAuthenticated();
};

export const fetchAuthorizedParks = async (): Promise<{ success: boolean; parks: ParkInfo[]; message: string }> => {
    return pocketbaseService.fetchAuthorizedParks();
};

export const fetchManagedCloudUsers = async (): Promise<{ success: boolean; users: ManagedUserAccount[]; message: string }> => {
    return pocketbaseService.fetchManagedUsers();
};

export const fetchPublicCloudParks = async (): Promise<{ success: boolean; parks: ParkInfo[]; message: string }> => {
    return pocketbaseService.fetchPublicParks();
};

export const submitCloudSignupRequest = async (
    email: string,
    password: string,
    requestedProjectIds: string[],
    applicantName: string
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.submitSignupRequest(email, password, requestedProjectIds, applicantName);
};

export const fetchCloudSignupRequests = async (): Promise<{ success: boolean; requests: SignupRequestRecord[]; message: string }> => {
    return pocketbaseService.fetchSignupRequests();
};

export const approveCloudSignupRequest = async (
    requestId: string,
    reviewerNote: string = ''
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.approveSignupRequest(requestId, reviewerNote);
};

export const createManagedCloudUser = async (
    input: CreateManagedUserInput
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    return pocketbaseService.createManagedUser(input);
};

export const updateManagedCloudUserEnabled = async (
    userId: string,
    enabled: boolean
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.updateManagedUserEnabled(userId, enabled);
};

export const updateManagedCloudUser = async (
    input: UpdateManagedUserInput
): Promise<{ success: boolean; user?: ManagedUserAccount; message: string }> => {
    return pocketbaseService.updateManagedUser(input);
};

export const deleteManagedCloudUser = async (
    userId: string,
    currentAuthUserId?: string
): Promise<{ success: boolean; message: string; cleanedSignupCount?: number }> => {
    return pocketbaseService.deleteManagedUser(userId, currentAuthUserId);
};

export const deleteCloudSignupRequest = async (
    requestId: string
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.deleteSignupRequest(requestId);
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

export const saveToCloud = async (
    data: DashboardData,
    config: CloudConfig,
    note: string = '',
    options?: { skipVersionCheck?: boolean }
): Promise<SaveToCloudResult> => {
    return pocketbaseService.saveToPocketBase(data, config.projectId, note, {
        expectedVersion: data.cloudSaveVersion ?? 0,
        skipVersionCheck: options?.skipVersionCheck === true,
    });
};

export const getCloudHistory = async (
    config: CloudConfig
): Promise<{ success: boolean; data?: CloudBackupMetadata[]; message: string }> => {
    return pocketbaseService.getPocketBaseHistory(config.projectId);
};

export const fetchCloudBackup = async (
    config: CloudConfig,
    backupId: string
): Promise<{ success: boolean; data?: DashboardData; message: string; recordMeta?: RecordMeta }> => {
    void backupId;
    return pocketbaseService.fetchPocketBaseBackup(config.projectId);
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
    recordMeta?: RecordMeta
): Promise<SaveIncrementalResult> => {
    return pocketbaseService.saveIncrementalToPocketBase(payload, config.projectId, recordMeta);
};

/** 用户在 ConflictDialog 选择「用我的值」后强制覆盖一条记录。 */
export const forceOverwriteCloudRecord = async (
    config: CloudConfig,
    collection: string,
    originalId: string,
    changedFields: Record<string, any>
): Promise<{ success: boolean; message: string; newUpdated?: string }> => {
    return pocketbaseService.forceOverwriteRecord(
        collection,
        originalId,
        changedFields,
        config.projectId
    );
};

/** 增量保存成功后可选地把 dashboard_data_version +1，仅用于审计。 */
export const bumpCloudSaveVersion = async (config: CloudConfig): Promise<number | null> => {
    return pocketbaseService.bumpCloudSaveVersion(config.projectId);
};

export const fetchCloudKpiSnapshot = async (
    config: CloudConfig,
    year: number
): Promise<{ success: boolean; snapshot?: KpiSnapshot; message: string }> => {
    return pocketbaseService.fetchKpiSnapshot(config.projectId, year);
};

export const upsertCloudKpiSnapshot = async (
    config: CloudConfig,
    snapshot: Omit<KpiSnapshot, 'projectId'> & { projectId?: string }
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.upsertKpiSnapshot({
        ...snapshot,
        projectId: snapshot.projectId || config.projectId,
    });
};

/** 将全量集成快照写入 pb_integration_snapshots（防抖）；OpenClaw / 外部系统读 payload（含 payload.kpi） */
export const scheduleUpsertIntegrationFullSnapshot = pocketbaseService.scheduleUpsertIntegrationFullSnapshot;
export const INTEGRATION_FULL_SNAPSHOT_KIND = pocketbaseService.INTEGRATION_FULL_SNAPSHOT_KIND;
/** 已废弃写入路径：历史记录在 pb_billing_period_notes.openclaw_kpi_snapshot，新集成请用 pb_integration_snapshots */
export const OPENCLAW_KPI_SNAPSHOT_OID = pocketbaseService.OPENCLAW_KPI_SNAPSHOT_OID;
