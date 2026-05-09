import { describe, expect, it } from 'vitest';
import { buildBillingDetailsForPeriod, calculateDashboardMetrics } from '../dashboardMetrics';
import { writeImportedBudgetTable, type BudgetTableSnapshot } from '../budgetTableImport';
import {
    ContractStatus,
    DepositStatus,
    UnitStatus,
    type BudgetAssumption,
    type BudgetScenario,
    type DashboardData,
    type PaymentRecord,
    type Tenant,
} from '../../types';

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
    it('does not invent January receivable from import when contract bills zero that month', () => {
        const months = Array(12).fill(0);
        months[0] = 746536;

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
                    total: 746536,
                },
            ],
            monthlyTotals: months,
            annualTotal: 746536,
        };

        const noJanBill = tenant({
            id: 'tenant-no-jan',
            leaseStart: '2026-05-01',
            leaseEnd: '2026-12-31',
            firstPaymentDate: '2026-05-01',
            firstPaymentMonths: 3,
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            monthlyRent: 100000,
        });
        const data = dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot), { tenants: [noJanBill] });
        expect(buildBillingDetailsForPeriod(2026, 0, data).filter((d) => d.tenantId === 'tenant-no-jan')).toEqual([]);
    });

    it('applies import only when contract already bills that month; never import-only ghost rows', () => {
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

        const baseNoImport = dashboardData(undefined);
        const contractMonths = new Set<number>();
        for (let m = 0; m < 12; m++) {
            if (buildBillingDetailsForPeriod(2026, m, baseNoImport).some((d) => d.tenantId === 'tenant-junke')) {
                contractMonths.add(m);
            }
        }
        expect(contractMonths.size).toBeGreaterThan(0);

        const data = dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot));

        for (let m = 0; m < 12; m++) {
            const row = buildBillingDetailsForPeriod(2026, m, data).find((d) => d.tenantId === 'tenant-junke');
            const importCell = Math.round(Number(months[m] || 0));
            if (!contractMonths.has(m) && importCell > 0.005) {
                expect(row).toBeUndefined();
            }
            if (contractMonths.has(m)) {
                expect(row).toBeDefined();
                expect(row!.amountDue).toBeGreaterThan(0.005);
            }
        }
    });

    it('Defer mode: monthly receivable follows bill date month (same as 合同概要账单月)', () => {
        const deferTenant = tenant({
            id: 'tenant-defer-q',
            name: 'Defer 季付样例',
            leaseStart: '2026-05-01',
            leaseEnd: '2026-12-31',
            monthlyRent: 100000,
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            firstPaymentMonths: 3,
            firstPaymentDate: undefined,
            freeRentHandling: 'Defer',
            rentFreePeriods: [],
        });
        const data = dashboardData(undefined, { tenants: [deferTenant] });

        // 收款日落在 4 月、覆盖期从 5 月起：核销归属仍按账单日 4 月，与合同概要「账单月」列一致
        expect(buildBillingDetailsForPeriod(2026, 3, data)).toMatchObject([
            { tenantId: 'tenant-defer-q', amountDue: 300000, amountPaid: 0, status: 'Unpaid' },
        ]);
        expect(buildBillingDetailsForPeriod(2026, 4, data)).toEqual([]);
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

    it('imported budget cell 0 does not wipe contract receivable for that month (核销与合同预览一致)', () => {
        const months = Array(12).fill(0);
        months[0] = 50000;
        months[1] = 50000;
        months[2] = 0;
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
                    total: 100000,
                },
            ],
            monthlyTotals: months,
            annualTotal: 100000,
        };
        const t = tenant({
            leaseStart: '2026-01-01',
            leaseEnd: '2026-12-31',
            firstPaymentDate: '2026-03-01',
            firstPaymentMonths: 1,
            paymentCycle: 'Monthly',
            paymentCycleMonths: 1,
            monthlyRent: 62319,
        });
        const data = dashboardData(writeImportedBudgetTable(undefined, 2026, snapshot), { tenants: [t] });
        const march = buildBillingDetailsForPeriod(2026, 2, data);
        expect(march.some((r) => r.tenantId === 'tenant-junke' && r.amountDue > 0.005)).toBe(true);
    });
});

describe('buildBillingDetailsForPeriod receivable scenario vs live assumptions', () => {
    const existingAsm = (shift: number): BudgetAssumption => ({
        id: `asm-${shift}`,
        targetType: 'Existing',
        targetId: 'tenant-junke',
        targetName: '军科',
        strategy: 'Renewal',
        projectedSignDate: '2026-01-01',
        projectedUnitPrice: 0,
        projectedRentFreeMonths: 0,
        billingCycleShiftMonths: shift,
    });

    const dedicated2026 = (scenarioShift: number): BudgetScenario => {
        const t = tenant();
        const buildings = dashboardData().buildings!;
        return {
            id: 'invoice_dedicated_2026',
            name: '2026应收款专用方案',
            budgetYear: 2026,
            description: '',
            createdAt: '2026-01-01T00:00:00.000Z',
            isActive: false,
            isReceivableActive: true,
            assumptions: [existingAsm(scenarioShift)],
            adjustments: [],
            baseDataSnapshot: { tenants: [t], buildings },
        };
    };

    it('根级 budgetAssumptions 覆盖应收专用方案快照中的同 target 账期偏移', () => {
        const dataScenarioOnly = dashboardData(undefined, {
            budgetScenarios: [dedicated2026(0)],
            budgetAssumptions: [],
        });
        const dataWithLiveShift = dashboardData(undefined, {
            budgetScenarios: [dedicated2026(0)],
            budgetAssumptions: [existingAsm(-2)],
        });
        // 首期收款日 2026-01-01：无偏移时账单在 2026-01；提前 2 个月则落在 2025-11，故对比 2025 年 11 月
        const nov2025NoLive = buildBillingDetailsForPeriod(2025, 10, dataScenarioOnly).find((d) => d.tenantId === 'tenant-junke')
            ?.amountDue ?? 0;
        const nov2025Merged = buildBillingDetailsForPeriod(2025, 10, dataWithLiveShift).find((d) => d.tenantId === 'tenant-junke')
            ?.amountDue ?? 0;
        expect(nov2025NoLive).toBeLessThan(0.005);
        expect(nov2025Merged).toBeGreaterThan(0.005);
    });
});

describe('buildBillingDetailsForPeriod payment tenant rootId chain', () => {
    it('attributes payments recorded under legacy tenantId to current contract billing row', () => {
        const buildings = dashboardData().buildings!;
        const current = tenant({
            id: 'junke-current',
            rootId: 'root-junke',
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            firstPaymentDate: '2026-01-01',
            firstPaymentMonths: 3,
            monthlyRent: 100000,
        });
        const legacy = tenant({
            id: 'junke-legacy',
            rootId: 'root-junke',
            status: ContractStatus.Terminated,
            terminationDate: '2025-08-31',
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            firstPaymentDate: '2026-01-01',
            firstPaymentMonths: 3,
            monthlyRent: 100000,
        });
        const payments: PaymentRecord[] = [
            {
                id: 'pay-on-legacy-id',
                tenantId: 'junke-legacy',
                tenantName: current.name,
                amount: 300000,
                type: 'Rent',
                date: '2026-01-10',
                period: '2026-01',
                status: 'Received',
            },
        ];
        const data = dashboardData(undefined, {
            tenants: [current, legacy],
            payments,
            budgetScenarios: [
                {
                    id: 'invoice_dedicated_2026',
                    name: '2026应收款专用方案',
                    budgetYear: 2026,
                    description: '',
                    createdAt: '2026-01-01T00:00:00.000Z',
                    isActive: false,
                    isReceivableActive: true,
                    assumptions: [],
                    adjustments: [],
                    baseDataSnapshot: { tenants: [current], buildings },
                },
            ],
        });
        const jan = buildBillingDetailsForPeriod(2026, 0, data).find((d) => d.tenantId === 'junke-current');
        expect(jan?.amountPaid ?? 0).toBeGreaterThan(200000);
    });
});

describe('buildBillingDetailsForPeriod orphan payment tenantId', () => {
    it('attributes Rent when payment.tenantId not in tenant list but tenantName matches contract row', () => {
        const current = tenant({
            id: 'junke-current',
            rootId: 'root-j',
            paymentCycle: 'Quarterly',
            paymentCycleMonths: 3,
            firstPaymentDate: '2026-01-01',
            firstPaymentMonths: 3,
            monthlyRent: 100000,
        });
        const payments: PaymentRecord[] = [
            {
                id: 'pay-orphan-id',
                tenantId: 'pb-record-id-no-longer-in-tenant-table',
                tenantName: current.name,
                amount: 250000,
                type: 'Rent',
                date: '2026-01-12',
                period: '2026-01',
                status: 'Received',
            },
        ];
        const data = dashboardData(undefined, { tenants: [current], payments });
        const jan = buildBillingDetailsForPeriod(2026, 0, data).find((d) => d.tenantId === 'junke-current');
        expect(jan?.amountPaid ?? 0).toBeGreaterThan(240000);
    });
});
