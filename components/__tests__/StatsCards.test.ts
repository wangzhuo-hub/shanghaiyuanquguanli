import { describe, expect, it } from 'vitest';
import { summarizeLeaseStats } from '../StatsCards';
import { ContractStatus, DepositStatus, type Tenant } from '../../types';

const tenant = (overrides: Partial<Tenant>): Tenant => ({
    id: overrides.id || 'tenant',
    name: overrides.name || 'tenant',
    buildingId: overrides.buildingId || 'b1',
    unitIds: overrides.unitIds || [],
    totalArea: overrides.totalArea ?? 0,
    leaseStart: overrides.leaseStart || '2026-01-01',
    leaseEnd: overrides.leaseEnd || '2026-12-31',
    monthlyRent: overrides.monthlyRent ?? 0,
    rentFreePeriods: overrides.rentFreePeriods || [],
    paymentCycle: overrides.paymentCycle || 'Monthly',
    firstPaymentDate: overrides.firstPaymentDate || '2026-01-01',
    depositAmount: overrides.depositAmount ?? 0,
    depositStatus: overrides.depositStatus || DepositStatus.Unpaid,
    status: overrides.status || ContractStatus.Active,
    ...overrides,
});

describe('summarizeLeaseStats', () => {
    it('summarizes year, current quarter, and current month in one pass', () => {
        const stats = summarizeLeaseStats([
            tenant({ id: 'new-month', signingDate: '2026-06-01', totalArea: 100 }),
            tenant({ id: 'new-quarter', signingDate: '2026-04-15', totalArea: 80 }),
            tenant({ id: 'new-year', signingDate: '2026-02-01', totalArea: 50 }),
            tenant({
                id: 'term-month',
                status: ContractStatus.Terminated,
                terminationDate: '2026-06-10',
                totalArea: 30,
            }),
            tenant({
                id: 'term-quarter',
                status: ContractStatus.Terminated,
                leaseEnd: '2026-04-30',
                totalArea: 20,
            }),
            tenant({
                id: 'term-invalid',
                status: ContractStatus.Terminated,
                terminationDate: 'not-a-date',
                totalArea: 999,
            }),
        ], 2026, new Date('2026-06-20T00:00:00.000Z'));

        expect(stats).toMatchObject({
            newLeasesYear: 3,
            newLeasesYearArea: 230,
            newLeasesQuarter: 2,
            newLeasesQuarterArea: 180,
            newLeasesMonth: 1,
            newLeasesMonthArea: 100,
            terminatedYear: 2,
            terminatedYearArea: 50,
            terminatedQuarter: 2,
            terminatedQuarterArea: 50,
            terminatedMonth: 1,
            terminatedMonthArea: 30,
            netIncreaseYear: 180,
            netIncreaseQuarter: 130,
            netIncreaseMonth: 70,
        });
    });

    it('ignores records outside the selected year or with invalid dates', () => {
        const stats = summarizeLeaseStats([
            tenant({ id: 'new-prev-year', signingDate: '2025-06-01', totalArea: 100 }),
            tenant({ id: 'new-invalid', signingDate: 'bad-date', totalArea: 100 }),
            tenant({
                id: 'term-next-year',
                status: ContractStatus.Terminated,
                terminationDate: '2027-06-01',
                totalArea: 100,
            }),
        ], 2026, new Date('2026-06-20T00:00:00.000Z'));

        expect(stats.newLeasesYear).toBe(0);
        expect(stats.terminatedYear).toBe(0);
        expect(stats.netIncreaseYear).toBe(0);
    });
});
