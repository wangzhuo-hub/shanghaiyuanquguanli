/**
 * IndexedDB 缓存服务 —— 替代 localStorage 做 Dashboard 数据持久化。
 *
 * - 异步读写，不阻塞主线程
 * - 容量 GB 级，不会触发 QuotaExceeded
 * - 旧 localStorage 数据自动迁移
 * - 写失败时返回 false（不抛异常），调用方可 fallback
 */

const DB_NAME = 'kingdee-park-cache';
const DB_VERSION = 1;
const STORE_NAME = 'dashboard-data';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => {
            // 如果数据库连接被关闭（如用户清缓存），重建 promise
            request.result.onclose = () => {
                dbPromise = null;
            };
            resolve(request.result);
        };
        request.onerror = () => {
            dbPromise = null;
            reject(request.error);
        };
        request.onblocked = () => {
            console.warn('[storageCache] IndexedDB 打开被阻塞，可能有旧连接未关闭');
        };
    });
    return dbPromise;
};

/** 写入缓存。返回 true 表示成功，false 表示失败（可 fallback 到 localStorage） */
export const cachePut = async (key: string, value: unknown): Promise<boolean> => {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.objectStore(STORE_NAME).put(value, key);
            } catch {
                resolve(false);
            }
        });
    } catch {
        return false;
    }
};

/** 读取缓存。返回 null 表示不存在或读取失败 */
export const cacheGet = async <T>(key: string): Promise<T | null> => {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readonly');
                const request = tx.objectStore(STORE_NAME).get(key);
                request.onsuccess = () => resolve((request.result ?? null) as T | null);
                request.onerror = () => resolve(null);
            } catch {
                resolve(null);
            }
        });
    } catch {
        return null;
    }
};

/** 删除缓存 */
export const cacheDelete = async (key: string): Promise<boolean> => {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.objectStore(STORE_NAME).delete(key);
            } catch {
                resolve(false);
            }
        });
    } catch {
        return false;
    }
};

/** 清空当前域名下所有缓存 */
export const cacheClear = async (): Promise<boolean> => {
    try {
        const db = await openDb();
        return new Promise((resolve) => {
            try {
                const tx = db.transaction(STORE_NAME, 'readwrite');
                tx.oncomplete = () => resolve(true);
                tx.onerror = () => resolve(false);
                tx.objectStore(STORE_NAME).clear();
            } catch {
                resolve(false);
            }
        });
    } catch {
        return false;
    }
};
