import React, { createContext, useContext, useMemo, useRef } from 'react';
import { DirtyTracker } from './dirtyTracker';
import type { RecordMeta } from './pocketbaseService';

/**
 * DirtyTrackerContext
 *
 * 把单例 DirtyTracker + 当前 recordMeta（行级乐观锁基准表）注入 React 树。
 *
 * 业务组件用法示例（伪代码）：
 *
 *   const { tracker, getBaseUpdated } = useDirtyTracker();
 *
 *   const onChangeRent = (tenantId: string, newRent: number) => {
 *       setTenants(prev => prev.map(t => t.id === tenantId ? { ...t, monthlyRent: newRent } : t));
 *       tracker?.markUpdate('pb_tenants', tenantId, { monthly_rent: newRent }, getBaseUpdated('pb_tenants', tenantId));
 *   };
 *
 *   const onAddTenant = (newTenant) => {
 *       setTenants(prev => [...prev, newTenant]);
 *       tracker?.markCreate('pb_tenants', toPocketBasePayload(newTenant));
 *   };
 *
 *   const onDeleteTenant = (tenantId) => {
 *       setTenants(prev => prev.filter(t => t.id !== tenantId));
 *       tracker?.markDelete('pb_tenants', tenantId, getBaseUpdated('pb_tenants', tenantId));
 *   };
 *
 * 其中 getBaseUpdated 负责从 recordMeta 读取「该记录最近一次被加载时」的 updated 时间戳。
 */
export interface DirtyTrackerContextValue {
    tracker: DirtyTracker;
    /** 取某条记录的 baseUpdated；未在 meta 中（例如本地刚创建的记录）则返回 '' */
    getBaseUpdated: (collection: string, originalId: string) => string;
    /** 当前的 RecordMeta（只读视图）—— 通常组件只通过 getBaseUpdated 间接使用 */
    recordMeta: RecordMeta;
}

const DirtyTrackerContext = createContext<DirtyTrackerContextValue | null>(null);

export interface DirtyTrackerProviderProps {
    /** 来自 App 顶层的最新 recordMeta；保存成功后由 App 重新拉取并更新 */
    recordMeta: RecordMeta;
    /** 可选：外部注入的 tracker 实例（一般用于测试）。不传时 Provider 自己持有一个 ref 单例 */
    tracker?: DirtyTracker;
    children: React.ReactNode;
}

export const DirtyTrackerProvider: React.FC<DirtyTrackerProviderProps> = ({
    recordMeta,
    tracker: injected,
    children,
}) => {
    // useRef 保证整个生命周期内同一个 tracker 实例（不会因为 re-render 而被新 new 出来）
    const internalRef = useRef<DirtyTracker | null>(null);
    if (!internalRef.current && !injected) {
        internalRef.current = new DirtyTracker();
    }
    const tracker = injected ?? internalRef.current!;

    const value = useMemo<DirtyTrackerContextValue>(
        () => ({
            tracker,
            recordMeta,
            getBaseUpdated: (collection, originalId) =>
                recordMeta?.[collection]?.[originalId] || '',
        }),
        [tracker, recordMeta]
    );

    return (
        <DirtyTrackerContext.Provider value={value}>
            {children}
        </DirtyTrackerContext.Provider>
    );
};

/**
 * 在业务组件里读取 tracker。Provider 之外调用会返回 null —— 组件应做空值保护，
 * 当 tracker 为 null 时退化为「只更新 React state，不登记 dirty」（即沿用旧的全量保存路径）。
 */
export const useDirtyTracker = (): DirtyTrackerContextValue | null => {
    return useContext(DirtyTrackerContext);
};
