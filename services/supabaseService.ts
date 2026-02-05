import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { CloudConfig, DashboardData, CloudBackupMetadata } from '../types';

let supabase: SupabaseClient | null = null;

export const initCloud = (config: CloudConfig) => {
    if (config.supabaseUrl && config.supabaseKey) {
        try {
            // Validate URL to prevent crashes
            new URL(config.supabaseUrl);
            supabase = createClient(config.supabaseUrl, config.supabaseKey);
            return true;
        } catch (e) {
            console.error("Cloud init failed: Invalid URL or Config", e);
            return false;
        }
    }
    return false;
};

// Check connection using the new table park_backups
export const checkConnection = async (config: CloudConfig): Promise<boolean> => {
    if (!config.supabaseUrl || !config.supabaseKey) return false;

    try {
        // 1. Validate URL Format
        try {
            new URL(config.supabaseUrl);
        } catch (e) {
            console.error("Invalid Supabase URL format");
            return false;
        }

        const client = createClient(config.supabaseUrl, config.supabaseKey);
        
        // 2. Try a lightweight HEAD request to check connection and table existence
        const { error } = await client
            .from('park_backups')
            .select('id', { count: 'exact', head: true });
        
        if (error) {
             console.warn("Cloud connection failed, running in offline mode. Error:", error.message);
             return false;
        }
        return true;
    } catch (e) {
        console.warn("Cloud connection failed, running in offline mode:", e);
        return false;
    }
};

// Insert a new backup record (snapshot)
export const saveToCloud = async (data: DashboardData, config: CloudConfig, note: string = ''): Promise<{success: boolean, message: string}> => {
    if (!initCloud(config) || !supabase) return { success: false, message: '云服务未配置或连接失败，将在本地保存' };
    
    try {
        const { error } = await supabase
            .from('park_backups')
            .insert({ 
                project_id: config.projectId, 
                data: data,
                note: note
            });

        if (error) {
            console.warn("云端保存失败，将使用本地存储:", error.message);
            return { success: false, message: '云端保存失败: ' + error.message };
        }
        return { success: true, message: '云端备份成功' };
    } catch (e: any) {
        console.warn("云端保存异常，将使用本地存储:", e);
        return { success: false, message: '云端保存异常: ' + (e.message || '未知错误') };
    }
};

// Fetch list of backups (metadata only)
export const getCloudHistory = async (config: CloudConfig): Promise<{success: boolean, data?: CloudBackupMetadata[], message: string}> => {
    if (!initCloud(config) || !supabase) return { success: false, message: '云服务未配置或连接失败' };

    try {
        const { data, error } = await supabase
            .from('park_backups')
            .select('id, created_at, note')
            .eq('project_id', config.projectId)
            .order('created_at', { ascending: false });

        if (error) {
            console.warn("云端历史记录获取失败:", error.message);
            return { success: false, message: '云端历史记录获取失败: ' + error.message };
        }
        return { success: true, data: data as CloudBackupMetadata[], message: '加载成功' };
    } catch (e: any) {
        console.warn("云端历史记录获取异常:", e);
        return { success: false, message: '云端历史记录获取异常: ' + (e.message || '未知错误') };
    }
};

// Fetch a specific backup data by ID
export const fetchCloudBackup = async (config: CloudConfig, backupId: string): Promise<{success: boolean, data?: DashboardData, message: string}> => {
    // Explicitly create client to ensure fresh config usage and avoid stale global instance issues during restore
    try {
        new URL(config.supabaseUrl || '');
    } catch {
        return { success: false, message: 'Invalid Supabase URL' };
    }

    const client = createClient(config.supabaseUrl!, config.supabaseKey!);

    try {
        console.log("Starting fetch for ID:", backupId);
        const { data, error } = await client
            .from('park_backups')
            .select('data')
            .eq('id', backupId)
            .single();

        if (error) {
             console.error("Supabase Fetch Error:", JSON.stringify(error, null, 2));
             return { success: false, message: `数据库读取失败: ${error.message}` };
        }
        
        if (!data || !data.data) {
             console.error("Backup found but data is empty");
             return { success: false, message: '该备份记录中没有数据' };
        }

        let restoredData = data.data;
        
        // Robustness: Handle if data was stored as stringified JSON
        if (typeof restoredData === 'string') {
            try {
                restoredData = JSON.parse(restoredData);
            } catch (e) {
                console.error("JSON Parsing Error on Fetch:", e);
                return { success: false, message: '数据格式解析失败' };
            }
        }

        console.log("Backup data retrieved successfully.");
        return { success: true, data: restoredData, message: '获取成功' };
    } catch (e: any) {
         console.error("Cloud Fetch Unexpected Error:", e);
         return { success: false, message: e.message || '获取过程发生未知错误' };
    }
};
