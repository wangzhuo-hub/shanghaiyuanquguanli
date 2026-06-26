import { describe, expect, it } from 'vitest';
import { BillingDetail, ContractStatus, DashboardData, Tenant } from '../../types';
import { buildTenantHistoricalArrears } from '../tenantHistoricalArrears';

const tenant = (patch: Partial<Tenant> = {}): Tenant => ({
    id: 't1',
    name: '历史欠费客户',
    buildingId: 'b1',
    unitIds: [],
    totalArea: 100,
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    status: ContractStatus.Active,
    rentFreePeriods: [],
    paymentCycle: 'Monthly',
    firstPaymentDate: '2026-01-01',
    monthlyRent: 10000,
    depositAmount: 10000,
    depositStatus: 'Paid' as any,
    ...patch,
});

const billing = (patch: Partial<BillingDetail>): BillingDetail => ({
    tenantId: 't1',
    tenantName: '历史欠费客户',
    unitIds: [],
    amountDue: 10000,
    amountPaid: 0,
    status: 'Unpaid',
    feeKind: 'rent',
    ...patch,
} as BillingDetail);

const data = (patch: Partial<DashboardData>): DashboardData => ({
    buildings: [],
    tenants: [tenant()],
    payments: [],
    totalArea: 0,
    leasedArea: 0,
    occupancyRate: 0,
    annualRevenueTarget: 0,
    annualRevenueCollected: 0,
    annualOccupancyTarget: 0,
    monthlyRevenueTarget: 0,
    monthlyRevenueCollected: 0,
    collectionRate: 0,
    accumulatedArrears: 0,
    newContractsCount: 0,
    newContractsArea: 0,
    terminatedContractsCount: 0,
    terminatedContractsArea: 0,
    netIncreaseArea: 0,
    expiringSoonCount: 0,
    recentSignings: [],
    expiringSoon: [],
    monthlyTrends: [],
    currentMonthBilling: [],
    parkingStats: { totalContractSpaces: 0, totalActualSpaces: 0, totalMonthlyRevenue: 0, details: [] },
    budgetAssumptions: [],
    budgetAdjustments: [],
    budgetAnalysis: {} as DashboardData['budgetAnalysis'],
    ...patch,
});

describe('tenant historical arrears', () => {
    it('summarizes tenant arrears from sealed billing details with dashboard arrears status rules', () => {
        const result = buildTenantHistoricalArrears({
            data: data({
                sealedMonths: [
                    {
                        year: 2026,
                        month: 1,
                        arrearsIncrement: 8000,
                        billingDetails: [billing({ status: 'Partial', amountDue: 10000, amountPaid: 2000 })],
                    },
                    {
                        year: 2026,
                        month: 2,
                        arrearsIncrement: 5000,
                        billingDetails: [billing({ status: 'Unpaid', amountDue: 5000, amountPaid: 0 })],
                    },
                ],
            }),
            referenceDate: new Date(2026, 2, 5),
        });

        expect(result.available).toBe(true);
        expect(result.startPeriod).toBe('2026-01');
        expect(result.endPeriod).toBe('2026-02');
        expect(result.byTenantId.get('t1')).toEqual({
            amount: 13000,
            months: 2,
            latestPeriod: '2026-02',
        });
    });

    it('refuses tenant-level filtering when a sealed month lacks billing details', () => {
        const result = buildTenantHistoricalArrears({
            data: data({
                sealedMonths: [
                    { year: 2026, month: 1, arrearsIncrement: 8000 },
                ],
            }),
            referenceDate: new Date(2026, 1, 5),
        });

        expect(result.available).toBe(false);
        expect(result.byTenantId.size).toBe(0);
        expect(result.unavailableReason).toContain('封账月 2026-01');
    });

    it('can filter billing details before tenant aggregation', () => {
        const result = buildTenantHistoricalArrears({
            data: data({
                sealedMonths: [
                    {
                        year: 2026,
                        month: 1,
                        arrearsIncrement: 12000,
                        billingDetails: [
                            billing({ feeKind: 'rent', amountDue: 9000 }),
                            billing({ feeKind: 'management_fee', amountDue: 3000 }),
                        ],
                    },
                ],
            }),
            referenceDate: new Date(2026, 1, 5),
            includeBillingDetail: (detail) => detail.feeKind === 'management_fee',
        });

        expect(result.available).toBe(true);
        expect(result.byTenantId.get('t1')).toEqual({
            amount: 3000,
            months: 1,
            latestPeriod: '2026-01',
        });
    });
});
