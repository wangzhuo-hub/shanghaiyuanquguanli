import { describe, expect, it } from 'vitest';
import {
    createBudgetAmountDeltaAdjustment,
    MOBILE_BUDGET_AMOUNT_ADJUSTMENT_REASON,
} from '../budgetMobileAdjustment';

describe('budget mobile adjustment helpers', () => {
    it('creates an amount_delta adjustment that only adds to the selected month', () => {
        const adjustment = createBudgetAmountDeltaAdjustment({
            tenantId: 'tenant-1',
            tenantName: '上海测试客户',
            adjustedYear: 2026,
            adjustedMonth: 5,
            amountDelta: 1234.567,
            reason: '补录预算差额',
            idSeed: 'case-a',
        });

        expect(adjustment).toEqual({
            id: 'budget_amount_delta_tenant-1_2026_6_case-a',
            tenantId: 'tenant-1',
            tenantName: '上海测试客户',
            originalYear: -1,
            originalMonth: -1,
            adjustedYear: 2026,
            adjustedMonth: 5,
            amount: 1234.57,
            reason: '补录预算差额',
            adjustmentKind: 'amount_delta',
        });
    });

    it('uses the mobile default reason when no reason is provided', () => {
        const adjustment = createBudgetAmountDeltaAdjustment({
            tenantId: 'tenant-2',
            adjustedYear: 2026,
            adjustedMonth: 0,
            amountDelta: -88,
            idSeed: 'case-b',
        });

        expect(adjustment.reason).toBe(MOBILE_BUDGET_AMOUNT_ADJUSTMENT_REASON);
        expect(adjustment.tenantName).toBe('tenant-2');
        expect(adjustment.amount).toBe(-88);
    });

    it('rejects unsafe adjustment inputs', () => {
        expect(() =>
            createBudgetAmountDeltaAdjustment({
                tenantId: '',
                adjustedYear: 2026,
                adjustedMonth: 0,
                amountDelta: 100,
            })
        ).toThrow(/tenantId/);
        expect(() =>
            createBudgetAmountDeltaAdjustment({
                tenantId: 'tenant-1',
                adjustedYear: 2026,
                adjustedMonth: 12,
                amountDelta: 100,
            })
        ).toThrow(/adjustedMonth/);
        expect(() =>
            createBudgetAmountDeltaAdjustment({
                tenantId: 'tenant-1',
                adjustedYear: 2026,
                adjustedMonth: 0,
                amountDelta: 0,
            })
        ).toThrow(/amountDelta/);
    });
});
