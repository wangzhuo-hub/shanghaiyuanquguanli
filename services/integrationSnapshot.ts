import type { DashboardData, MonthlyTrend } from '../types';
import { buildOpenClawKpiSnapshot, type OpenClawKpiSnapshot } from './openclawKpiSnapshot';

/** 与 pb_integration_snapshots.snapshot_kind 一致 */
export const INTEGRATION_FULL_SNAPSHOT_KIND = 'full_dashboard_v1';

export const INTEGRATION_FULL_SNAPSHOT_SCHEMA_VERSION = 1 as const;

/**
 * 全量集成快照 v1：含与界面一致的 dashboard、全年趋势、以及原 OpenClaw KPI 结构（payload.kpi）。
 */
export type IntegrationFullSnapshotV1 = {
    schema_version: typeof INTEGRATION_FULL_SNAPSHOT_SCHEMA_VERSION;
    generated_at: string;
    project_id: string;
    /** 与 dashboard_data_version / 乐观锁一致 */
    source_cloud_save_version: number;
    stats_year: number;
    kpi: OpenClawKpiSnapshot;
    dashboard: DashboardData;
    /** calculateTrends(..., quarter='All')，与 KPI 同源 */
    full_year_monthly_trends: MonthlyTrend[];
};

function cloneForJson<T>(v: T): T {
    return structuredClone(v);
}

export function buildIntegrationFullSnapshotV1(
    processedData: DashboardData,
    fullYearMonthlyTrends: MonthlyTrend[],
    context: { statsYear: number; projectId: string; generatedAt?: Date }
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
        full_year_monthly_trends: cloneForJson(fullYearMonthlyTrends),
    };
}
