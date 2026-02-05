import PocketBase from 'pocketbase';
import { DashboardData, CloudBackupMetadata } from '../types';

let pb: PocketBase | null = null;

export const initPocketBase = (url: string) => {
    try {
        console.log('=== Initializing PocketBase ===');
        console.log('URL:', url);
        console.log('Old pb instance:', pb ? 'exists' : 'null');
        
        // 强制重新创建实例
        pb = new PocketBase(url);
        
        console.log('New pb instance created');
        console.log('pb.baseUrl:', pb.baseUrl);
        console.log('pb instance:', pb);
        
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

export const authenticatePocketBase = async (email: string, password: string) => {
    if (!pb) return false;
    try {
        console.log('PocketBase 尝试登录:', email);
        const authData = await pb.collection('users').authWithPassword(email, password);
        console.log('PocketBase 登录成功:', authData.record.email);
        console.log('Token:', pb.authStore.token ? '已生成' : '未生成');
        return true;
    } catch (e: any) {
        console.error("PocketBase 认证失败:", e);
        console.error('错误详情:', {
            status: e.status,
            message: e.message,
            data: e.data
        });
        // 不再弹窗提示，静默失败
        return false;
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

export const saveToPocketBase = async (
    data: DashboardData, 
    projectId: string, 
    note: string = ''
): Promise<{success: boolean, message: string}> => {
    console.log('=== saveToPocketBase called ===');
    console.log('PocketBase info:', getPocketBaseInfo());
    
    if (!pb) {
        console.error('PocketBase 未初始化');
        return { success: false, message: 'PocketBase 未初始化\n\n请点击"保存配置"按钮重新初始化' };
    }
    
    try {
        console.log('=== PocketBase Save Debug ===');
        console.log('PocketBase URL:', pb.baseUrl);
        console.log('Collection name:', 'park_backups');
        
        const payload = {
            project_id: projectId,
            data: data,
            note: note
        };
        console.log('Payload keys:', Object.keys(payload));
        console.log('Payload project_id:', payload.project_id);
        console.log('Payload note:', payload.note);
        console.log('Payload data size:', JSON.stringify(payload.data).length, 'bytes');
        
        // 先查询是否已存在该 project_id 的记录
        const existingRecords = await pb.collection('park_backups').getList(1, 1, {
            filter: `project_id = "${projectId}"`,
            sort: '-created'
        });
        
        let record;
        if (existingRecords.items.length > 0) {
            // 如果已存在，更新最新的记录
            const existingId = existingRecords.items[0].id;
            console.log('更新已有记录:', existingId);
            record = await pb.collection('park_backups').update(existingId, payload);
            console.log('Update successful, record ID:', record.id);
        } else {
            // 如果不存在，创建新记录
            console.log('创建新记录');
            record = await pb.collection('park_backups').create(payload);
            console.log('Create successful, record ID:', record.id);
        }
        
        return { success: true, message: 'PocketBase 备份成功' };
    } catch (e: any) {
        console.error("PocketBase save failed:", e);
        console.error('Error type:', typeof e);
        console.error('Error constructor:', e.constructor.name);
        console.error('Error details:', {
            message: e.message,
            status: e.status,
            response: e.response,
            data: e.data,
            originalError: e.originalError
        });
        
        // 构建详细的错误信息
        let errorMsg = 'PocketBase 保存失败: ';
        
        if (e.data?.message) {
            errorMsg += e.data.message;
        } else if (e.message) {
            errorMsg += e.message;
        } else {
            errorMsg += 'Unknown error';
        }
        
        // 添加字段验证错误详情
        if (e.data?.data) {
            errorMsg += '\n\n字段错误: ' + JSON.stringify(e.data.data, null, 2);
        }
        
        // HTTP 状态码提示
        if (e.status) {
            errorMsg += '\n\nHTTP 状态码: ' + e.status;
        }
        
        // 添加 API Rules 提示
        if (e.status === 403 || e.status === 401) {
            errorMsg += '\n\n可能原因: API Rules 没有清空。';
            errorMsg += '\n请在 PocketBase 管理后台：';
            errorMsg += '\n1. 点击 park_backups';
            errorMsg += '\n2. 点击右上角齿轮图标';
            errorMsg += '\n3. 点击 API Rules 标签';
            errorMsg += '\n4. 把所有规则框都清空';
            errorMsg += '\n5. 点击 Save changes';
        }
        
        // 404 错误提示（Collection 不存在或 API 路径错误）
        if (e.status === 404) {
            errorMsg += '\n\n可能原因: park_backups collection 不存在。';
            errorMsg += '\n请在 PocketBase 管理后台：';
            errorMsg += '\n1. 确保 PocketBase 服务已启动（http://127.0.0.1:8090/_/）';
            errorMsg += '\n2. 检查是否有 park_backups collection';
            errorMsg += '\n3. 如果没有，点击 "New collection" 创建';
            errorMsg += '\n4. Collection 名称必须是: park_backups';
            errorMsg += '\n5. 添加字段: project_id (Text), data (JSON), note (Text)';
            errorMsg += '\n6. API Rules 所有规则框清空';
            errorMsg += '\n7. 点击 Save';
        }
        
        // 网络错误提示
        if (e.message && e.message.includes('fetch')) {
            errorMsg += '\n\n可能是网络连接问题，请检查 PocketBase 服务器是否正在运行。';
        }
        
        return { success: false, message: errorMsg };
    }
};

export const getPocketBaseHistory = async (
    projectId: string
): Promise<{success: boolean, data?: CloudBackupMetadata[], message: string}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    
    try {
        const records = await pb.collection('park_backups').getList(1, 50, {
            filter: `project_id = "${projectId}"`,
            sort: '-created',
            fields: 'id,created,note'
        });
        
        const data = records.items.map((r: any) => ({
            id: r.id,
            created_at: r.created,
            note: r.note
        }));
        
        return { success: true, data, message: '加载成功' };
    } catch (e: any) {
        console.error("PocketBase history failed:", e);
        return { success: false, message: 'PocketBase 历史记录获取失败: ' + e.message };
    }
};

export const fetchPocketBaseBackup = async (
    backupId: string
): Promise<{success: boolean, data?: DashboardData, message: string}> => {
    if (!pb) return { success: false, message: 'PocketBase 未初始化' };
    
    try {
        const record = await pb.collection('park_backups').getOne(backupId);
        return { success: true, data: record.data, message: '获取成功' };
    } catch (e: any) {
        console.error("PocketBase fetch failed:", e);
        return { success: false, message: 'PocketBase 数据获取失败: ' + e.message };
    }
};
