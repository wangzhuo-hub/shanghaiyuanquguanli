import { describe, expect, it } from 'vitest';
import { buildBillingDetailsForPeriod, calculateDashboardMetrics } from '../dashboardMetrics';
import { writeImportedBudgetTable, type BudgetTableSnapshot } from '../budgetTableImport';
import { ContractStatus, DepositStatus, UnitStatus, type DashboardData, type PaymentRecord, type Tenant } from '../../types';

function tenant(overrides: Partial<Tenant> = {}): Tenant {
    return {
        id: 'tenant-junke',
        name: '军科正源（上海）生物医药科技有限公司',
        buildingId: 'building-1',
        unitIds: ['unit-101'],
        totalArea: 100,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        monthlyRent: 100000,
        rentFreePeriods: [],
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentDate: '2026-01-01',
        firstPaymentMonths: 3,
        depositAmount: 0,
        depositStatus: DepositStatus.Unpaid,
        status: ContractStatus.Active,
        ...overrides,
    };
}

function dashboardData(notes?: Record<string, string>, overrides: Partial<DashboardData> = {}): DashboardData {
    return {
        buildings: [
            {
                id: 'building-1',
                name: '1号楼',
                units: [{ id: 'unit-101', name: '101', area: 100, floor: 1, status: UnitStatus.Occupied }],
            },
        ],
        tenants: [tenant()],
        payments: [],
        totalArea: 100,
        leasedArea: 100,
        occupancyRate: 100,
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
        budgetAnalysis: { occupancy: '', revenue: '' },
        budgetScenarios: [],
        initializationData: [],
        invoices: [],
        billingPeriodNotes: notes,
        ...overrides,
    };
}

describe('buildBillingDetailsForPeriod imported budget alignment', () => {
    it('uses imported budget rows for receivable months and creates rows for shifted periods', () => {
        const months = Array(12).fill(0);
        months[1] = 300000;
        months[4] = 300000;
        months[7] = 300000;
        months[10] = 300000;

        const snapshot: BudgetTableSnapshot = {
            importedAt: '2026-01-01T00:00:00.000Z',
            sourceSheet: '2026年',
            rows: [
                {
                    customer: '军科正源（上海）生物医药科技有限公司',
                    unit: '101',
                    building: '1号楼',
                    area: 100,
                    category: '存量客户',
                    unitPrice: null,
                    rentFreeText: '',
                    months,
                    total: 1200000,
                },
            ],
            monthlyTotals: months,
            annualTotal: 1200000,
        };

        const data = dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot));

        expect(buildBillingDetailsForPeriod(2026, 0, data)).toEqual([]);
        expect(buildBillingDetailsForPeriod(2026, 1, data)).toMatchObject([
            { tenantId: 'tenant-junke', amountDue: 300000, amountPaid: 0, status: 'Unpaid' },
        ]);
        expect(buildBillingDetailsForPeriod(2026, 3, data)).toEqual([]);
        expect(buildBillingDetailsForPeriod(2026, 4, data)).toMatchObject([
            { tenantId: 'tenant-junke', amountDue: 300000, amountPaid: 0, status: 'Unpaid' },
        ]);
    });

    it('attributes budget execution actual collection by payment received date', () => {
        const payments: PaymentRecord[] = [
            {
                id: 'p-period-jan',
                tenantId: 'tenant-junke',
                tenantName: '军科正源（上海）生物医药科技有限公司',
                amount: 120000,
                type: 'Rent',
                date: '2026-03-15',
                period: '2026-01',
                status: 'Received',
            },
        ];

        const result = calculateDashboardMetrics(dashboardData(undefined, { payments }), {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-01',
        });

        expect(result.processedData.monthlyTrends[0].revenueCollected).toBe(0);
        expect(result.processedData.monthlyTrends[2].revenueCollected).toBe(120000);
    });

    it('does not let imported initialization rows overwrite payment actual collection', () => {
        const payments: PaymentRecord[] = [
            {
                id: 'p-actual-jan',
                tenantId: 'tenant-junke',
                tenantName: '军科正源（上海）生物医药科技有限公司',
                amount: 340000,
                type: 'Rent',
                date: '2026-01-20',
                status: 'Received',
            },
        ];

        const result = calculateDashboardMetrics(dashboardData(undefined, {
            payments,
            initializationData: [
                { year: 2026, month: 1, revenueTarget: 340000, revenueCollected: 0, occupancyRate: 90 },
            ],
        }), {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-01',
        });

        expect(result.processedData.monthlyTrends[0].revenueTarget).toBe(340000);
        expect(result.processedData.monthlyTrends[0].revenueCollected).toBe(340000);
    });

    it('uses restored initialization actuals for previous-year comparison when no payment records exist', () => {
        const result = calculateDashboardMetrics(dashboardData(undefined, {
            initializationData: [
                { year: 2025, month: 1, revenueTarget: 300000, revenueCollected: 870000, occupancyRate: 90 },
            ],
        }), {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-01',
        });

        expect(result.processedData.prevYearMonthlyTrends?.[0].revenueCollected).toBe(870000);
    });

    it('falls back to imported budget when initialization revenueTarget is zero', () => {
        const months = Array(12).fill(0);
        months[0] = 888000;
        const snapshot: BudgetTableSnapshot = {
            importedAt: '2026-01-01T00:00:00.000Z',
            sourceSheet: '2026年',
            rows: [],
            monthlyTotals: months,
            annualTotal: 888000,
        };

        const result = calculateDashboardMetrics(
            dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot), {
                initializationData: [{ year: 2026, month: 1, revenueTarget: 0, revenueCollected: 0, occupancyRate: 0 }],
            }),
            { year: 2026, quarter: 'All', billingSelectedMonth: '2026-01' }
        );

        expect(result.processedData.monthlyTrends[0].revenueTarget).toBe(888000);
    });

    it('prefers positive initialization revenueTarget over imported budget table', () => {
        const months = Array(12).fill(0);
        months[0] = 888000;
        const snapshot: BudgetTableSnapshot = {
            importedAt: '2026-01-01T00:00:00.000Z',
            sourceSheet: '2026年',
            rows: [],
            monthlyTotals: months,
            annualTotal: 888000,
        };

        const result = calculateDashboardMetrics(
            dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot), {
                initializationData: [{ year: 2026, month: 1, revenueTarget: 999000, revenueCollected: 0, occupancyRate: 0 }],
            }),
            { year: 2026, quarter: 'All', billingSelectedMonth: '2026-01' }
        );

        expect(result.processedData.monthlyTrends[0].revenueTarget).toBe(999000);
    });
});
