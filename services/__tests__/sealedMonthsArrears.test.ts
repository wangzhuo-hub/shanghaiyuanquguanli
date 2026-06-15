import { describe, expect, it } from 'vitest';
import { calculateDashboardMetrics } from '../dashboardMetrics';
import { dashboardDataToPbRecords, diffPbRecords, payloadCount } from '../dataDiff';
import type { DashboardData } from '../../types';

// 空园区：无租户/收款 → 逐月实时欠款必为 0，便于隔离验证「封账增量被直接采用」。
// 用 2026-01（相对今日恒为过去月）做封账月，测试不随运行日期漂移。
const emptyData = (overrides: Partial<DashboardData> = {}): DashboardData => ({
    buildings: [],
    tenants: [],
    payments: [],
    invoices: [],
    yearlyTargets: {},
    initializationData: [],
    budgetAssumptions: [],
    budgetAdjustments: [],
    budgetScenarios: [],
    billingPeriodNotes: {},
    ...overrides,
} as unknown as DashboardData);

const opts = { year: 2026, quarter: 'All' as const, billingSelectedMonth: '2026-06' };

describe('封账快照消费（欠款累计）', () => {
    it('无封账数据时，空园区欠款累计为 0（回退逐月实时计算，行为与历史一致）', () => {
        const { processedData } = calculateDashboardMetrics(emptyData(), opts);
        expect(processedData.accumulatedArrears).toBe(0);
    });

    it('提供封账增量时，欠款累计直接取封账值（跳过该月实时账单生成）', () => {
        const data = emptyData({
            sealedMonths: [{ year: 2026, month: 1, arrearsIncrement: 777, cumulativeArrears: 777 }],
        });
        const { processedData } = calculateDashboardMetrics(data, opts);
        expect(processedData.accumulatedArrears).toBe(777);
    });

    it('多个封账月增量求和（消费侧以 increment 求和为准）', () => {
        const data = emptyData({
            sealedMonths: [
                { year: 2026, month: 1, arrearsIncrement: 100, cumulativeArrears: 100 },
                { year: 2026, month: 2, arrearsIncrement: 50, cumulativeArrears: 150 },
            ],
        });
        const { processedData } = calculateDashboardMetrics(data, opts);
        expect(processedData.accumulatedArrears).toBe(150);
    });

    it('sealedMonths 不进入保存 diff（非业务集合，不产生幽灵写入/删除）', () => {
        const withSeal = emptyData({ sealedMonths: [{ year: 2026, month: 1, arrearsIncrement: 777 }] });
        const baseline = dashboardDataToPbRecords(emptyData(), 'p1');
        const next = dashboardDataToPbRecords(withSeal, 'p1');
        const payload = diffPbRecords(baseline, next, {});
        expect(payloadCount(payload).total).toBe(0);
        expect((next as Record<string, unknown>).pb_sealed_months).toBeUndefined();
    });
});
