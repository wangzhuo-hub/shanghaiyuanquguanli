import PocketBase from 'pocketbase';
import { Unit, UnitStatus, AppData } from '../types';

// 检测运行环境，支持局域网访问
const getHostUrl = (port: number): string => {
  // 如果是浏览器环境，使用当前访问的host
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    // 如果是localhost或127.0.0.1，保持本地访问
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `http://127.0.0.1:${port}`;
    }
    // 否则使用当前访问的IP地址（局域网IP）
    return `http://${hostname}:${port}`;
  }
  // 服务端环境默认使用本地
  return `http://127.0.0.1:${port}`;
};

// 本地PocketBase客户端 (9008端口) - 用于存储本系统的业务快照
const POCKETBASE_URL = getHostUrl(9008);
export const pb = new PocketBase(POCKETBASE_URL);

// 房源物理数据库 (9009端口) - 招商管理系统的PocketBase
const PROPERTY_POCKETBASE_URL = getHostUrl(9009);
export const propertyPb = new PocketBase(PROPERTY_POCKETBASE_URL);

export const PROPERTY_POCKETBASE_URL_DISPLAY = PROPERTY_POCKETBASE_URL;

export interface SyncResponse {
  data: Unit[] | null;
  backupName?: string;
  backupDate?: string;
  error: string | null;
}

const mapStatus = (u: any): UnitStatus => {
  if (u.isSelfUse === true) return UnitStatus.SELF_USE;
  const s = String(u.status || u.unit_status || '').toLowerCase();
  if (s === 'occupied' || s === '已租' || s === 'leasing') return UnitStatus.OCCUPIED;
  if (s === 'vacant' || s === '待租' || s === 'available') return UnitStatus.VACANT;
  if (s === 'reserved' || s === '预留') return UnitStatus.RESERVED;
  return UnitStatus.VACANT;
};

/**
 * 深度数组搜索：在复杂 JSON 中定位业务数组
 */
const deepSeekArray = (obj: any, key: string): any[] | null => {
  if (!obj || typeof obj !== 'object') return null;
  // 检查当前层
  if (Array.isArray(obj[key])) return obj[key];
  // 递归查找子层
  for (const k in obj) {
    if (typeof obj[k] === 'object' && obj[k] !== null) {
      const found = deepSeekArray(obj[k], key);
      if (found) return found;
    }
  }
  return null;
};

/**
 * 带超时和重试的fetch封装
 */
const fetchWithTimeout = async (promise: Promise<any>, timeoutMs: number = 15000): Promise<any> => {
  let timeoutId: NodeJS.Timeout;
  
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`请求超时（${timeoutMs / 1000}秒）`));
    }, timeoutMs);
  });
  
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
};

/**
 * 重试逻辑封装
 */
const retryFetch = async <T>(
  fn: () => Promise<T>, 
  retries: number = 2, 
  delay: number = 1000
): Promise<T> => {
  try {
    return await fn();
  } catch (error: any) {
    if (retries > 0 && (error.message.includes('超时') || error.message.includes('autocancelled'))) {
      console.warn(`同步失败，${delay / 1000}秒后重试... (剩余${retries}次)`);
      await new Promise(resolve => setTimeout(resolve, delay));
      return retryFetch(fn, retries - 1, delay * 1.5);
    }
    throw error;
  }
};

/**
 * 从招商管理PocketBase获取房源数据
 * 带超时控制和自动重试
 */
export const fetchPropertyUnits = async (): Promise<SyncResponse> => {
  console.log("🚀 发起资产自动同步进程：目标项目 park_data_main...");
  
  try {
    // 使用重试和超时控制
    const records = await retryFetch(async () => {
      return await fetchWithTimeout(
        propertyPb.collection('park_backups').getList(1, 1, {
          filter: 'project_id="park_data_main"',
          sort: '-created',
        }),
        15000 // 15秒超时
      );
    }, 2); // 最多重试2次

    if (!records || records.items.length === 0) {
      return { data: [], error: "未发现项目 park_data_main 的云端资产快照。" };
    }

    const record = records.items[0];
    const snapshot = record.data;
    if (!snapshot) return { data: [], error: "快照数据为空。" };

    // 1. 定位关键业务数据源
    const buildings = deepSeekArray(snapshot, 'buildings');
    const tenants = deepSeekArray(snapshot, 'tenants') || [];
    
    // 2. 建立租客映射索引
    const unitTenantMap = new Map<string, string>();
    tenants.forEach((t: any) => {
      if (Array.isArray(t.unitIds)) {
        t.unitIds.forEach((uid: string) => unitTenantMap.set(uid, t.tenantName || t.name));
      }
    });

    const mappedUnits: Unit[] = [];
    
    // 3. 解析嵌套结构
    if (buildings) {
      buildings.forEach((b: any) => {
        const unitsList = b.units || b.unit_list || [];
        if (Array.isArray(unitsList)) {
          unitsList.forEach((u: any) => {
            const unitId = u.id || `U-${b.id}-${u.unitNumber || u.name || u.roomNo}`;
            const linkedTenant = unitTenantMap.get(unitId);
            
            mappedUnits.push({
              id: unitId,
              building: b.name || b.building_name || '默认楼宇',
              floor: Number(u.floor || 1),
              roomNo: String(u.unitNumber || u.name || u.roomNo || '未知'),
              area: Number(u.area || u.size || 0),
              status: linkedTenant ? UnitStatus.OCCUPIED : mapStatus(u),
              tenantName: linkedTenant || u.tenantName || null,
              price: Number(u.unitPrice || u.price || 0) || null,
              vacantSince: u.vacantSince || null
            });
          });
        }
      });
    }

    // 4. 验证解析结果
    if (mappedUnits.length === 0) {
      return { 
        data: null, 
        error: `解析成功但未提取到房源，请确认快照内 buildings 容器是否包含有效单元数据。` 
      };
    }

    return { 
      data: mappedUnits, 
      backupName: record.note || '云端自动快照', 
      backupDate: record.created,
      error: null 
    };

  } catch (err: any) {
    return { data: null, error: `同步引擎解析异常: ${err.message}` };
  }
};

/**
 * 保存备份到本地PocketBase
 */
export const saveBackup = async (name: string, data: AppData): Promise<void> => {
  try {
    await pb.collection('park_leasing_backups').create({
      name,
      data
    });
  } catch (error: any) {
    console.error('保存备份失败:', error);
    throw new Error(`备份保存失败: ${error.message}`);
  }
};

/**
 * 更新现有备份（用于自动同步，不创建新快照）
 * 使用乐观锁机制防止并发冲突
 */
export const updateLatestBackup = async (data: AppData): Promise<{ success: boolean; conflict?: boolean }> => {
  try {
    // 获取最新记录
    const records = await pb.collection('park_leasing_backups').getList(1, 1, {
      sort: '-created',
    });

    if (!records || records.items.length === 0) {
      // 如果没有记录，创建新的
      await pb.collection('park_leasing_backups').create({
        name: '自动同步 - ' + new Date().toLocaleString(),
        data
      });
      return { success: true };
    }

    const latestRecord = records.items[0];
    
    // 更新现有记录
    await pb.collection('park_leasing_backups').update(latestRecord.id, {
      data,
      updated: new Date().toISOString() // 更新时间戳
    });
    
    return { success: true };
  } catch (error: any) {
    console.error('更新备份失败:', error);
    // 检查是否是并发冲突
    if (error.status === 409 || error.message.includes('conflict')) {
      return { success: false, conflict: true };
    }
    throw new Error(`备份更新失败: ${error.message}`);
  }
};

/**
 * 加载最新备份
 */
export const loadLatestBackup = async (): Promise<{ name: string; data: AppData; created: string } | null> => {
  try {
    const records = await pb.collection('park_leasing_backups').getList(1, 1, {
      sort: '-created',
    });

    if (!records || records.items.length === 0) {
      return null;
    }

    const record = records.items[0];
    return {
      name: record.name,
      data: record.data,
      created: record.created
    };
  } catch (error: any) {
    console.error('加载备份失败:', error);
    throw new Error(`备份加载失败: ${error.message}`);
  }
};

/**
 * 获取所有备份列表（用于历史记录）
 */
export const getAllBackups = async (): Promise<Array<{ id: string; name: string; created: string }>> => {
  try {
    const records = await pb.collection('park_leasing_backups').getFullList({
      sort: '-created',
      fields: 'id,name,created'
    });

    return records.map(r => ({
      id: r.id,
      name: r.name,
      created: r.created
    }));
  } catch (error: any) {
    console.error('获取备份列表失败:', error);
    return [];
  }
};
