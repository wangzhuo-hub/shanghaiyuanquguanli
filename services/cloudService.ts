import { CloudConfig, DashboardData, CloudBackupMetadata } from '../types';
import * as pocketbaseService from './pocketbaseService';

/** 仅 PocketBase：前端直连本地/内网后端，无中间云端服务层 */
export const initCloud = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    const ok = pocketbaseService.initPocketBase(config.pocketbaseUrl);
    if (!ok) return false;
    if (
        config.pocketbaseEmail &&
        config.pocketbasePassword &&
        config.pocketbaseEmail !== 'admin@example.com' &&
        config.pocketbasePassword !== 'your-secure-password'
    ) {
        await pocketbaseService.authenticatePocketBase(config.pocketbaseEmail, config.pocketbasePassword);
    }
    return true;
};

export const checkConnection = async (config: CloudConfig): Promise<boolean> => {
    if (!config.pocketbaseUrl) return false;
    return pocketbaseService.checkPocketBaseConnection(config.pocketbaseUrl);
};

export const saveToCloud = async (
    data: DashboardData,
    config: CloudConfig,
    note: string = ''
): Promise<{ success: boolean; message: string }> => {
    return pocketbaseService.saveToPocketBase(data, config.projectId, note);
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
    return pocketbaseService.fetchPocketBaseBackup(backupId);
};
