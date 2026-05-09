import { describe, expect, it } from 'vitest';
import {
    auditReceivableMonthVsCoverageForTenants,
    calendarMonthsOverlappingClosedRange,
} from '../receivableMonthCoverageAudit';
import { ContractStatus, DepositStatus, Tenant } from '../../types';

function baseTenant(overrides: Partial<Tenant>): Tenant {
    return {
        id: 't-audit-1',
        name: '口径测试客户',
        buildingId: 'b1',
        unitIds: ['u1'],
        totalArea: 100,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        monthlyRent: 30000,
        rentFreePeriods: [],
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentMonths: 3,
        firstPaymentDate: '2026-01-01',
        depositAmount: 0,
        depositStatus: DepositStatus.Unpaid,
        status: ContractStatus.Active,
        ...overrides,
    };
}

describe('calendarMonthsOverlappingClosedRange', () => {
    it('lists every calendar month touched by the closed interval', () => {
        const start = new Date(2026, 2, 29); // Mar 29
        const end = new Date(2026, 5, 28); // Jun 28
        expect(calendarMonthsOverlappingClosedRange(start, end)).toEqual([
            '2026-03',
            '2026-04',
            '2026-05',
            '2026-06',
        ]);
    });

    it('handles same-month ranges', () => {
        const d = new Date(2026, 3, 15);
        expect(calendarMonthsOverlappingClosedRange(d, d)).toEqual(['2026-04']);
    });
});

describe('auditReceivableMonthVsCoverageForTenants', () => {
    it('flags quarters where service months extend beyond the collection month (财务报表口径)', () => {
        const issues = auditReceivableMonthVsCoverageForTenants([baseTenant({})], [], [], {
            genStart: new Date(2025, 0, 1),
            genEnd: new Date(2027, 11, 31),
        });

        expect(issues.length).toBeGreaterThan(0);
        // 季付下一笔覆盖 3 个自然月，仅收款月入账 → 至少有两个「服务月」不在收款月
        expect(issues.some((i) => i.serviceMonthsAttributedElsewhere.length >= 2)).toBe(true);
    });

    it('skips special-business tenants', () => {
        const issues = auditReceivableMonthVsCoverageForTenants(
            [baseTenant({ id: 'sb', isSpecialBusiness: true })],
            [],
            [],
            { genStart: new Date(2025, 0, 1), genEnd: new Date(2027, 11, 31) }
        );
        expect(issues).toEqual([]);
    });
});
