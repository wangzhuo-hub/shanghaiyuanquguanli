import { describe, expect, it } from 'vitest';
import {
    RECEIVABLE_TAIL_TOLERANCE,
    billingStatusFromAmounts,
    isCollectAmountAcceptable,
    isReceivableTailSettled,
    normalizeReceivableRemaining,
    receivableTailWaivedAmount,
} from '../receivableListHelpers';

describe('receivable tail tolerance', () => {
    it('treats remaining within 1 yuan as zero', () => {
        expect(normalizeReceivableRemaining(0.01)).toBe(0);
        expect(normalizeReceivableRemaining(0.99)).toBe(0);
        expect(normalizeReceivableRemaining(1)).toBe(0);
        expect(normalizeReceivableRemaining(1.01)).toBe(1.01);
    });

    it('marks billing paid when shortfall is within tolerance', () => {
        expect(billingStatusFromAmounts(12683.76, 12683.75)).toBe('Paid');
        expect(billingStatusFromAmounts(10000, 9999.01)).toBe('Paid');
        expect(billingStatusFromAmounts(10000, 9998.99)).toBe('Partial');
    });

    it('accepts collection within tolerance and records waived tail', () => {
        expect(isCollectAmountAcceptable(0.01, 0)).toBe(false);
        expect(isCollectAmountAcceptable(12683.76, 12683.75)).toBe(true);
        expect(isCollectAmountAcceptable(100, 101)).toBe(true);
        expect(isCollectAmountAcceptable(100, 102.01)).toBe(false);
        expect(receivableTailWaivedAmount(12683.76, 12683.75)).toBe(0.01);
        expect(receivableTailWaivedAmount(100, 100)).toBe(0);
    });

    it('allows partial collection when remaining balance exceeds tail tolerance', () => {
        expect(isCollectAmountAcceptable(55944.6, 50000)).toBe(true);
        expect(receivableTailWaivedAmount(55944.6, 50000)).toBe(0);
        expect(billingStatusFromAmounts(55944.6, 50000)).toBe('Partial');
    });

    it('uses shared tolerance constant', () => {
        expect(RECEIVABLE_TAIL_TOLERANCE).toBe(1);
        expect(isReceivableTailSettled(12683.76, 12683.75)).toBe(true);
    });
});
