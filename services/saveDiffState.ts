import { payloadCount } from './dataDiff';
import type { DirtyPayload } from './dirtyTracker';

export interface SaveDiffState {
    dirtyCollectionCount: number;
    lastTrackedData: unknown;
    currentData: unknown;
}

export interface AutoSaveScheduleState extends SaveDiffState {
    dashboardCacheDirty: boolean;
    cloudAutoSync: boolean;
    cloudConnected: boolean;
}

export interface AutoSaveExecutionState extends AutoSaveScheduleState {
    isPreview: boolean;
    isSyncing: boolean;
    hasBaseline: boolean;
    currentProjectId: string;
    scheduledProjectId: string;
    dataProjectConsistent: boolean;
}

export interface ManualCloudSaveState {
    currentData: unknown;
    isPreview: boolean;
    cloudConnected: boolean;
    currentProjectId: string;
    dataProjectConsistent: boolean;
}

export type ManualCloudSaveGuard =
    | { allowed: true }
    | { allowed: false; message: string };

export function isSaveDiffKnownClean(options: SaveDiffState): boolean {
    return options.dirtyCollectionCount === 0 && options.lastTrackedData === options.currentData;
}

export function shouldRunSaveDiff(options: SaveDiffState): boolean {
    return !isSaveDiffKnownClean(options);
}

export function shouldWriteDashboardCache(options: SaveDiffState): boolean {
    return shouldRunSaveDiff(options);
}

export function shouldScheduleAutoSave(options: AutoSaveScheduleState): boolean {
    if (!options.currentData) return false;
    if (options.dashboardCacheDirty || shouldWriteDashboardCache(options)) return true;
    if (!options.cloudConnected || !options.cloudAutoSync) return false;
    return shouldRunSaveDiff(options);
}

export function shouldWriteDashboardCacheDuringAutoSave(options: AutoSaveExecutionState): boolean {
    if (!options.currentData) return false;
    if (options.isPreview) return false;
    if (!options.scheduledProjectId) return false;
    if (options.currentProjectId !== options.scheduledProjectId) return false;
    if (!options.dataProjectConsistent) return false;
    if (!options.hasBaseline && options.isSyncing) return false;
    return options.dashboardCacheDirty || shouldWriteDashboardCache(options);
}

export function shouldAttemptCloudSaveDuringAutoSave(options: AutoSaveExecutionState): boolean {
    if (!options.currentData) return false;
    if (options.isPreview) return false;
    if (!options.scheduledProjectId) return false;
    if (options.currentProjectId !== options.scheduledProjectId) return false;
    if (!options.hasBaseline) return false;
    if (!options.cloudConnected || !options.cloudAutoSync) return false;
    if (!options.dataProjectConsistent) return false;
    return shouldRunSaveDiff(options);
}

export function validateManualCloudSave(options: ManualCloudSaveState): ManualCloudSaveGuard {
    if (!options.currentData) return { allowed: false, message: '当前没有可保存的数据。' };
    if (options.isPreview) {
        return {
            allowed: false,
            message: '后台正在同步或计算全量业务数据，请等待完成后再保存。当前页面仅展示快照或缓存预览。',
        };
    }
    if (!options.cloudConnected) {
        return {
            allowed: false,
            message: '未连接 PocketBase。请到「系统与备份」填写地址并点击「保存配置」。',
        };
    }
    if (!options.currentProjectId) {
        return { allowed: false, message: '缺少目标园区，已阻止保存。请重新选择园区后再试。' };
    }
    if (!options.dataProjectConsistent) {
        return {
            allowed: false,
            message: '数据一致性校验失败：当前页面数据不属于目标园区，已阻止保存。请切换园区后重新操作。',
        };
    }
    return { allowed: true };
}

export async function hasPendingSaveDiff(options: {
    hasBaseline: boolean;
    currentData: unknown;
    projectId: string;
    dirtyCollectionCount: number;
    lastTrackedData: unknown;
    buildPayload: () => DirtyPayload;
    schedule?: <T>(task: () => T) => Promise<T>;
}): Promise<boolean> {
    if (!options.hasBaseline || !options.currentData || !options.projectId) return true;
    if (isSaveDiffKnownClean({
        dirtyCollectionCount: options.dirtyCollectionCount,
        lastTrackedData: options.lastTrackedData,
        currentData: options.currentData,
    })) {
        return false;
    }
    try {
        const payload = options.schedule
            ? await options.schedule(options.buildPayload)
            : options.buildPayload();
        return payloadCount(payload).total > 0;
    } catch {
        return true;
    }
}
