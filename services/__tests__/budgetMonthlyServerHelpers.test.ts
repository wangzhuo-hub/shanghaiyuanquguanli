import { describe, expect, it, vi } from 'vitest';
import type { BudgetedBill } from '../billingService';
import {
    resolveBudgetMonthlyBillsForKey,
    shouldBuildBudgetMonthlyComputeRequest,
    shouldBuildBudgetMonthlyDetailRows,
    shouldRunBudgetMonthlyLocalFallback,
    validateBudgetMonthlyServerPayload,
    type BudgetMonthlyServerData,
} from '../budgetMonthlyServerHelpers';

const bill = (amount: number): BudgetedBill => ({
    date: new Date('2026-01-01T00:00:00.000Z'),
    amount,
});

describe('budget monthly server helpers', () => {
    it('uses server bills without calling local generation', () => {
        const serverBills = [bill(100)];
        const serverData: BudgetMonthlyServerData = {
            billsByKey: new Map([['tenant:t1:budget', serverBills]]),
        };
        const localGetter = vi.fn(() => [bill(200)]);

        const result = resolveBudgetMonthlyBillsForKey('tenant:t1:budget', serverData, localGetter);

        expect(result).toBe(serverBills);
        expect(localGetter).not.toHaveBeenCalled();
    });

    it('does not silently local-recompute when accepted server data misses a key', () => {
        const serverData: BudgetMonthlyServerData = {
            billsByKey: new Map(),
        };
        const localGetter = vi.fn(() => [bill(200)]);

        const result = resolveBudgetMonthlyBillsForKey('tenant:t1:budget', serverData, localGetter);

        expect(result).toEqual([]);
        expect(localGetter).not.toHaveBeenCalled();
    });

    it('falls back to local generation only when server data is absent', () => {
        const localBills = [bill(200)];
        const localGetter = vi.fn(() => localBills);

        const result = resolveBudgetMonthlyBillsForKey('tenant:t1:budget', undefined, localGetter);

        expect(result).toBe(localBills);
        expect(localGetter).toHaveBeenCalledTimes(1);
    });

    it('validates complete bill keys and all 12 contract receivable months', () => {
        expect(validateBudgetMonthlyServerPayload(
            ['tenant:t1:budget'],
            new Map([['tenant:t1:budget', []]]),
            new Set(Array.from({ length: 12 }, (_, index) => index + 1)),
        )).toBeNull();

        expect(validateBudgetMonthlyServerPayload(
            ['tenant:t1:budget', 'tenant:t2:budget'],
            new Map([['tenant:t1:budget', []]]),
            new Set(Array.from({ length: 12 }, (_, index) => index + 1)),
        )).toContain('缺少 1 个账单结果');

        expect(validateBudgetMonthlyServerPayload(
            ['tenant:t1:budget'],
            new Map([['tenant:t1:budget', []]]),
            new Set([1, 2, 3]),
        )).toBe('后台合同应收月度汇总不完整');
    });

    it('does not run local monthly fallback after a server compute attempt', () => {
        expect(shouldRunBudgetMonthlyLocalFallback({
            shouldUseServer: true,
            serverAttempted: true,
        })).toBe(false);

        expect(shouldRunBudgetMonthlyLocalFallback({
            shouldUseServer: true,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunBudgetMonthlyLocalFallback({
            shouldUseServer: false,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunBudgetMonthlyLocalFallback({
            shouldUseServer: false,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('builds heavy monthly compute requests only for monthly and execution views', () => {
        expect(shouldBuildBudgetMonthlyComputeRequest('Monthly')).toBe(true);
        expect(shouldBuildBudgetMonthlyComputeRequest('Execution')).toBe(true);
        expect(shouldBuildBudgetMonthlyComputeRequest('Settings')).toBe(false);
        expect(shouldBuildBudgetMonthlyComputeRequest('Renewal')).toBe(false);
    });

    it('builds monthly detail rows only for views that render the detail table', () => {
        expect(shouldBuildBudgetMonthlyDetailRows('Monthly')).toBe(true);
        expect(shouldBuildBudgetMonthlyDetailRows('Execution')).toBe(true);
        expect(shouldBuildBudgetMonthlyDetailRows('Settings')).toBe(false);
        expect(shouldBuildBudgetMonthlyDetailRows('Renewal')).toBe(false);
    });
});
