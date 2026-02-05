import { CloudConfig, DashboardData, CloudBackupMetadata } from '../types';
import * as supabaseService from './supabaseService';
import * as pocketbaseService from './pocketbaseService';

let supabase: any = null; // 保持向后兼容

export const initCloud = async (config: CloudConfig) => {
    if (config.provider === 'pocketbase' && config.pocketbaseUrl) {
        // 初始化 PocketBase
        const initSuccess = pocketbaseService.initPocketBase(config.pocketbaseUrl);
        if (!initSuccess) return false;
        
        // 如果API Rules已清空，则不需要认证
        // 如果提供了认证信息且不是默认值，尝试认证
        if (config.pocketbaseEmail && 
            config.pocketbasePassword && 
            config.pocketbaseEmail !== 'admin@example.com' &&
            config.pocketbasePassword !== 'your-secure-password') {
            console.log('检测到自定义认证信息，尝试认证...');
            await pocketbaseService.authenticatePocketBase(
                config.pocketbaseEmail, 
                config.pocketbasePassword
            );
        } else {
            console.log('API Rules已清空，跳过认证');
        }
        return true;
    } else if (config.provider === 'supabase' && config.supabaseUrl && config.supabaseKey) {
        return supabaseService.initCloud(config);
    }
    return false;
};

// Check connection using the new table park_backups
export const checkConnection = async (config: CloudConfig): Promise<boolean> => {
    if (config.provider === 'pocketbase' && config.pocketbaseUrl) {
        return pocketbaseService.checkPocketBaseConnection(config.pocketbaseUrl);
    } else if (config.provider === 'supabase') {
        return supabaseService.checkConnection(config);
    }
    return false;
};

// Insert a new backup record (snapshot)
export const saveToCloud = async (data: DashboardData, config: CloudConfig, note: string = ''): Promise<{success: boolean, message: string}> => {
    if (config.provider === 'pocketbase') {
        // 不再强制重新认证，直接尝试保存
        return pocketbaseService.saveToPocketBase(data, config.projectId, note);
    } else {
        return supabaseService.saveToCloud(data, config, note);
    }
};

// Fetch list of backups (metadata only)
export const getCloudHistory = async (config: CloudConfig): Promise<{success: boolean, data?: CloudBackupMetadata[], message: string}> => {
    if (config.provider === 'pocketbase') {
        return pocketbaseService.getPocketBaseHistory(config.projectId);
    } else {
        return supabaseService.getCloudHistory(config);
    }
};

// Fetch a specific backup data by ID
export const fetchCloudBackup = async (config: CloudConfig, backupId: string): Promise<{success: boolean, data?: DashboardData, message: string}> => {
    if (config.provider === 'pocketbase') {
        return pocketbaseService.fetchPocketBaseBackup(backupId);
    } else {
        return supabaseService.fetchCloudBackup(config, backupId);
    }
};