/**
 * 服务端重算 KPI + 回写 pb_kpi_snapshots / pb_integration_snapshots
 * 用法: PB_URL=... PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... npx tsx scripts/refresh-park-snapshot.mjs shanghai_park 2026
 */
import {
    initPocketBase,
    authenticatePocketBase,
    fetchPocketBaseBackup,
    upsertKpiSnapshot,
    upsertIntegrationFullSnapshot,
} from '../services/pocketbaseService.ts';
import {
    calculateDashboardMetrics,
    buildKpiSummaryFromProcessedData,
    normalizeKpiSummaryWithMonthlyTrends,
} from '../services/dashboardMetrics.ts';
import { buildIntegrationFullSnapshotV1 } from '../services/integrationSnapshot.ts';

const projectId = (process.argv[2] || 'shanghai_park').trim();
const year = Number(process.argv[3] || new Date().getFullYear());

async function main() {
    initPocketBase(process.env.PB_URL || 'http://127.0.0.1:1001');
    const ok = await authenticatePocketBase(
        process.env.PB_ADMIN_EMAIL || '',
        process.env.PB_ADMIN_PASSWORD || ''
    );
    if (!ok) throw new Error('PocketBase auth failed');

    const fetchRes = await fetchPocketBaseBackup(projectId);
    if (!fetchRes.success || !fetchRes.data) {
        throw new Error(fetchRes.message || 'fetch backup failed');
    }

    const options = {
        year,
        quarter: 'All',
        billingSelectedMonth: `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`,
    };
    const { processedData, fullYearMonthlyTrends } = calculateDashboardMetrics(fetchRes.data, options);
    const summary = normalizeKpiSummaryWithMonthlyTrends(
        buildKpiSummaryFromProcessedData(processedData, year),
        fullYearMonthlyTrends
    );

    await upsertKpiSnapshot({
        projectId,
        year,
        summary,
        monthlyTrends: fullYearMonthlyTrends.slice(0, 12),
        computedAt: new Date().toISOString(),
        dataVersion: fetchRes.data.cloudSaveVersion ?? 0,
    });

    const integration = buildIntegrationFullSnapshotV1(processedData, fullYearMonthlyTrends, {
        statsYear: year,
        projectId,
    });
    await upsertIntegrationFullSnapshot(projectId, integration);

    const { buildBillingDetailsForPeriod } = await import('../services/dashboardMetrics.ts');
    const febDet = buildBillingDetailsForPeriod(year, 1, fetchRes.data).filter((d) =>
        d.tenantName?.includes('极然')
    );
    const mayDet = buildBillingDetailsForPeriod(year, 4, fetchRes.data).filter((d) =>
        d.tenantName?.includes('极然')
    );

    console.log(
        JSON.stringify(
            {
                ok: true,
                projectId,
                year,
                kpiWritten: true,
                integrationWritten: true,
                jiranFeb: febDet.map((d) => ({ due: d.amountDue, status: d.status })),
                jiranMay: mayDet.map((d) => ({ due: d.amountDue, status: d.status })),
                generated_at: integration.generated_at,
            },
            null,
            2
        )
    );
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
