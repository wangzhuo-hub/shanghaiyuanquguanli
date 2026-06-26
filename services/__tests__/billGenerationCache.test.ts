import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BudgetAdjustment, BudgetAssumption, Tenant } from '../../types';
import { createBudgetedBillCache } from '../billGenerationCache';
import { generateBudgetedBills } from '../billingService';

vi.mock('../billingService', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../billingService')>();
    return {
        ...actual,
        generateBudgetedBills: vi.fn(() => [
            {
                date: new Date('2026-01-05T00:00:00.000Z'),
                amount: 100,
                originalDate: new Date('2025-12-05T00:00:00.000Z'),
                coverageStart: new Date('2026-01-01T00:00:00.000Z'),
                coverageEnd: new Date('2026-01-31T00:00:00.000Z'),
            },
        ]),
    };
});

const mockedGenerateBudgetedBills = vi.mocked(generateBudgetedBills);
const createCache = (options: { maxEntries?: number } = {}) =>
    createBudgetedBillCache({
        ...options,
        generateBudgetedBills: mockedGenerateBudgetedBills,
    });

const tenant = (overrides: Partial<Tenant> = {}): Tenant => ({
    id: 't1',
    name: '测试客户',
    buildingId: 'b1',
    unitIds: ['u1'],
    totalArea: 100,
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    monthlyRent: 10000,
    paymentCycle: 'Monthly',
    depositAmount: 0,
    depositStatus: 'Unpaid',
    status: 'Active',
    rentFreePeriods: [],
    ...overrides,
} as Tenant);

describe('createBudgetedBillCache', () => {
    beforeEach(() => {
        mockedGenerateBudgetedBills.mockClear();
    });

    it('deduplicates repeated bill generation for the same input', () => {
        const cache = createCache();
        const input = {
            tenant: tenant(),
            assumptions: [] as BudgetAssumption[],
            adjustments: [] as BudgetAdjustment[],
            start: new Date('2026-01-01T00:00:00.000Z'),
            end: new Date('2026-12-31T00:00:00.000Z'),
        };

        const first = cache.get(input);
        const second = cache.get(input);

        expect(mockedGenerateBudgetedBills).toHaveBeenCalledTimes(1);
        expect(first).toHaveLength(1);
        expect(second).toHaveLength(1);
        expect(cache.size()).toBe(1);
    });

    it('returns cloned bills so callers cannot mutate cached dates', () => {
        const cache = createCache();
        const input = {
            tenant: tenant(),
            assumptions: [] as BudgetAssumption[],
            adjustments: [] as BudgetAdjustment[],
            start: new Date('2026-01-01T00:00:00.000Z'),
            end: new Date('2026-12-31T00:00:00.000Z'),
        };

        const first = cache.get(input);
        first[0].amount = 999;
        first[0].date.setFullYear(2030);
        first[0].coverageStart?.setFullYear(2030);

        const second = cache.get(input);

        expect(second[0].amount).toBe(100);
        expect(second[0].date.getFullYear()).toBe(2026);
        expect(second[0].coverageStart?.getFullYear()).toBe(2026);
        expect(second[0]).not.toBe(first[0]);
    });

    it('uses tenant and budget inputs as part of the cache key', () => {
        const cache = createCache();
        const base = {
            tenant: tenant(),
            adjustments: [] as BudgetAdjustment[],
            start: new Date('2026-01-01T00:00:00.000Z'),
            end: new Date('2026-12-31T00:00:00.000Z'),
        };

        cache.get({ ...base, assumptions: [] });
        cache.get({
            ...base,
            assumptions: [{
                id: 'a1',
                targetId: 't1',
                targetName: '测试客户',
                targetType: 'Existing',
                projectedSignDate: '2026-01-01',
                projectedUnitPrice: 4,
                projectedRentFreeMonths: 0,
                priceAdjustment: { startDate: '2026-06-01', endDate: '2026-12-31', newUnitPrice: 4 },
            } as BudgetAssumption],
        });
        cache.get({ ...base, tenant: tenant({ monthlyRent: 12000 }), assumptions: [] });

        expect(mockedGenerateBudgetedBills).toHaveBeenCalledTimes(3);
        expect(cache.size()).toBe(3);
    });

    it('evicts the oldest entries when maxEntries is reached', () => {
        const cache = createCache({ maxEntries: 2 });
        const base = {
            assumptions: [] as BudgetAssumption[],
            adjustments: [] as BudgetAdjustment[],
            start: new Date('2026-01-01T00:00:00.000Z'),
            end: new Date('2026-12-31T00:00:00.000Z'),
        };

        cache.get({ ...base, tenant: tenant({ id: 't1' }) });
        cache.get({ ...base, tenant: tenant({ id: 't2' }) });
        cache.get({ ...base, tenant: tenant({ id: 't3' }) });
        cache.get({ ...base, tenant: tenant({ id: 't1' }) });

        expect(mockedGenerateBudgetedBills).toHaveBeenCalledTimes(4);
        expect(cache.size()).toBe(2);
    });
});
