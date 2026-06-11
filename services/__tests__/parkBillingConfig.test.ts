import { describe, expect, it } from 'vitest';
import {
    isBeijingLateMonthLeaseStart,
    leaseStartDayOfMonth,
    snapBeijingLateMonthReceivableBillDate,
    usesSameMonthReceivableBillDate,
} from '../parkBillingConfig';

describe('parkBillingConfig late-month lease', () => {
    it('detects Beijing 28-31 lease starts', () => {
        expect(leaseStartDayOfMonth('2025-12-31')).toBe(31);
        expect(isBeijingLateMonthLeaseStart('beijing_park', '2025-12-31')).toBe(true);
        expect(isBeijingLateMonthLeaseStart('beijing_park', '2025-02-28')).toBe(true);
        expect(isBeijingLateMonthLeaseStart('beijing_park', '2025-12-15')).toBe(false);
        expect(isBeijingLateMonthLeaseStart('shanghai_park', '2025-12-31')).toBe(false);
    });

    it('uses same-month receivable for Shenzhen and Beijing late-month', () => {
        expect(
            usesSameMonthReceivableBillDate({ projectId: 'shenzhen_park', leaseStart: '2025-01-01' }),
        ).toBe(true);
        expect(
            usesSameMonthReceivableBillDate({ projectId: 'beijing_park', leaseStart: '2025-12-31' }),
        ).toBe(true);
        expect(
            usesSameMonthReceivableBillDate({ projectId: 'beijing_park', leaseStart: '2025-12-01' }),
        ).toBe(false);
    });

    it('snaps quarterly bill date to 4/1 when coverage starts on Mar 31', () => {
        const coverage = new Date(2026, 2, 31);
        const tentative = new Date(2026, 2, 31);
        const snapped = snapBeijingLateMonthReceivableBillDate(
            coverage,
            tentative,
            'beijing_park',
            '2025-12-31',
            'Quarterly',
        );
        expect(snapped.getFullYear()).toBe(2026);
        expect(snapped.getMonth()).toBe(3);
        expect(snapped.getDate()).toBe(1);
    });
});
