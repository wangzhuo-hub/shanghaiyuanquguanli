import type { DashboardData, MonthlyTrend } from '../types';
import { buildOpenClawKpiSnapshot, type OpenClawKpiSnapshot } from './openclawKpiSnapshot';

/** 与 pb_integration_snapshots.snapshot_kind 一致 */
export const INTEGRATION_FULL_SNAPSHOT_KIND = 'full_dashboard_v1';

export const INTEGRATION_FULL_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * 全量集成快照 v1：含与界面一致的 dashboard、全年趋势、以及原 OpenClaw KPI 结构（payload.kpi）。
 * 面积口径：payload.dashboard.leasedArea / totalArea / occupancyRate 与前端资产管理、看板完全一致；
 * OpenClaw 亦可通过 payload.kpi.leased_area_sqm / leasable_area_sqm 读取同值。
 */
export type IntegrationFullSnapshotV1 = {
    schema_version: typeof INTEGRATION_FULL_SNAPSHOT_SCHEMA_VERSION;
    generated_at: string;
    project_id: string;
    /** 与 dashboard_data_version / 乐观锁一致 */
    source_cloud_save_version: number;
    stats_year: number;
    kpi: OpenClawKpiSnapshot;
    /**
     * 指标计算后的看板数据，用于首屏直接渲染。
     * 兼容历史字段名 `dashboard`，OpenClaw 仍从这里读。
     */
    dashboard: DashboardData;
    /**
     * 原始业务数据基线，用于前端生成保存 diff。
     * 老快照没有该字段，消费端应回退到 dashboard。
     */
    baseline_dashboard?: DashboardData;
    /** 前端行级乐观锁基线。老快照没有该字段，消费端应回退空对象。 */
    record_meta?: Record<string, Record<string, string>>;
    /** 快照计算时的加载范围，默认 full。 */
    load_scope?: { kind: 'full' } | { kind: 'year'; year: number };
    /** calculateTrends(..., quarter='All')，与 KPI 同源 */
    full_year_monthly_trends: MonthlyTrend[];
};

function cloneForJson<T>(v: T): T {
    return structuredClone(v);
}

export function buildIntegrationFullSnapshotV1(
    processedData: DashboardData,
    fullYearMonthlyTrends: MonthlyTrend[],
    context: {
        statsYear: number;
        projectId: string;
        generatedAt?: Date;
        baselineData?: DashboardData;
        recordMeta?: Record<string, Record<string, string>>;
        loadScope?: { kind: 'full' } | { kind: 'year'; year: number };
    }
): IntegrationFullSnapshotV1 {
    const projectId = context.projectId.trim();
    const kpi = buildOpenClawKpiSnapshot(processedData, fullYearMonthlyTrends, {
        statsYear: context.statsYear,
        projectId,
        generatedAt: context.generatedAt,
    });
    const cloudSaveVersion =
        typeof processedData.cloudSaveVersion === 'number' && Number.isFinite(processedData.cloudSaveVersion)
            ? Math.max(0, Math.floor(processedData.cloudSaveVersion))
            : 0;
    return {
        schema_version: INTEGRATION_FULL_SNAPSHOT_SCHEMA_VERSION,
        generated_at: (context.generatedAt ?? new Date()).toISOString(),
        project_id: projectId,
        source_cloud_save_version: cloudSaveVersion,
        stats_year: context.statsYear,
        kpi,
        dashboard: cloneForJson(processedData),
        ...(context.baselineData ? { baseline_dashboard: cloneForJson(context.baselineData) } : {}),
        ...(context.recordMeta ? { record_meta: cloneForJson(context.recordMeta) } : {}),
        ...(context.loadScope ? { load_scope: cloneForJson(context.loadScope) } : {}),
        full_year_monthly_trends: cloneForJson(fullYearMonthlyTrends),
    };
}
