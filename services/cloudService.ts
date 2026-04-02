import { CloudConfig, DashboardData, CloudBackupMetadata } from '../types';
import * as pocketbaseService from './pocketbaseService';

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
): Promise<{ success: boolean; data?: DashboardData; message: string }> => {
    void backupId;
    return pocketbaseService.fetchPocketBaseBackup(config.projectId);
};

/** 将全量集成快照写入 pb_integration_snapshots（防抖）；OpenClaw / 外部系统读 payload（含 payload.kpi） */
export const scheduleUpsertIntegrationFullSnapshot = pocketbaseService.scheduleUpsertIntegrationFullSnapshot;
export const INTEGRATION_FULL_SNAPSHOT_KIND = pocketbaseService.INTEGRATION_FULL_SNAPSHOT_KIND;
/** 已废弃写入路径：历史记录在 pb_billing_period_notes.openclaw_kpi_snapshot，新集成请用 pb_integration_snapshots */
export const OPENCLAW_KPI_SNAPSHOT_OID = pocketbaseService.OPENCLAW_KPI_SNAPSHOT_OID;
