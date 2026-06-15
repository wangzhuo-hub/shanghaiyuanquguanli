import { describe, expect, it } from 'vitest';
import { getOrCreateBillingCacheFor } from '../dashboardMetrics';
import type { DashboardData } from '../../types';

const data = (): DashboardData => ({
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
} as unknown as DashboardData);

describe('getOrCreateBillingCacheFor（A4 共享缓存）', () => {
    it('同一 data 引用 → 复用同一 BillingCache 实例', () => {
        const d = data();
        expect(getOrCreateBillingCacheFor(d)).toBe(getOrCreateBillingCacheFor(d));
    });

    it('不同 data 引用 → 各自独立缓存（WeakMap 按引用失效）', () => {
        expect(getOrCreateBillingCacheFor(data())).not.toBe(getOrCreateBillingCacheFor(data()));
    });
});
