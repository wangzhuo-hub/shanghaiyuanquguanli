import { describe, expect, it } from 'vitest';
import {
    buildBillingDetailsForPeriod,
    buildKpiSummaryFromProcessedData,
    calculateDashboardMetrics,
    normalizeScenarioForReceivable,
    resolveAnnualInitialBudget,
} from '../dashboardMetrics';
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

describe('syncInvoiceDedicatedSnapshotsFromLive', () => {
    it('refreshes invoice_dedicated snapshot from live tenants on normalize', () => {
        const live = tenant({
            id: 'tenant-shunjiang',
            leaseStart: '2025-12-01',
            leaseEnd: '2028-11-30',
            monthlyRent: 31672.88,
            firstPaymentDate: '2025-10-30',
            freeRentHandling: 'Deduct',
            rentFreePeriods: [{ start: '2026-06-01', end: '2026-07-31', description: '免租' }],
            paymentTerms: [{ unitId: 'unit-101', area: 801, monthlyRent: 31672.88, rentFreePeriods: [] }],
            projectId: 'beijing_park',
        });
        const stale = tenant({
            id: 'tenant-shunjiang',
            leaseStart: '2025-12-01',
            leaseEnd: '2028-11-30',
            monthlyRent: 31672.88,
            firstPaymentDate: '2025-10-30',
            freeRentHandling: 'Deduct',
            rentFreePeriods: [{ start: '2026-03-01', end: '2026-03-31', description: '免租' }],
            paymentTerms: [{ unitId: 'unit-101', area: 801, monthlyRent: 31672.88, rentFreePeriods: [] }],
            projectId: 'beijing_park',
        });
        const buildings = dashboardData().buildings!;
        const scenarios: BudgetScenario[] = [
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
                baseDataSnapshot: { tenants: [stale], buildings },
            },
        ];
        const normalized = normalizeScenarioForReceivable(scenarios, [live], buildings);
        const dedicated = normalized.find((s) => s.id === 'invoice_dedicated_2026');
        expect(dedicated?.baseDataSnapshot?.tenants?.[0]?.rentFreePeriods).toEqual(live.rentFreePeriods);
        const mayDue = buildBillingDetailsForPeriod(
            2026,
            4,
            dashboardData(undefined, { budgetScenarios: normalized, tenants: [live] }),
        ).find((d) => d.tenantId === 'tenant-shunjiang')?.amountDue;
        expect(mayDue).toBeCloseTo(31672.88, 0);
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
        // 查询 2026-01 且当年命中应收专用方案时：根级 `billingCycleShiftMonths=-2` 必须覆盖快照内同 target 的偏移，
        // 使合并后的首期滚动金额与「仅方案快照、根级假设为空」不同（具体落月随 generateBudgetedBills 规则变化，故只比对两口径差异）。
        const jan2026ScenarioOnly = buildBillingDetailsForPeriod(2026, 0, dataScenarioOnly).find((d) => d.tenantId === 'tenant-junke')
            ?.amountDue ?? 0;
        const jan2026Merged = buildBillingDetailsForPeriod(2026, 0, dataWithLiveShift).find((d) => d.tenantId === 'tenant-junke')
            ?.amountDue ?? 0;
        expect(jan2026ScenarioOnly).toBeGreaterThan(0.005);
        expect(jan2026Merged).toBeGreaterThan(0.005);
        expect(jan2026Merged).not.toBeCloseTo(jan2026ScenarioOnly, 0.01);
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

describe('monthly trend contractReceivable matches finance receivable engine', () => {
    /** 用户截图：预算管理「实际合同口径」=工作台「合同应收」=财务报表「应收租金」三处必须一致 */
    it('uses receivable scenario context (not active scenario) for contractReceivable, matching finance', () => {
        const t = tenant({
            id: 'tenant-x',
            paymentCycle: 'Monthly',
            paymentCycleMonths: 1,
            firstPaymentDate: '2026-01-01',
            firstPaymentMonths: 1,
            monthlyRent: 100000,
        });
        const buildings = dashboardData().buildings!;
        // 「年初预算方案」生效（含一条 Existing 调价：单价提到 5 元/㎡·天 → 月租 100×5×30=15,000，但
        // 由于调价区间不覆盖 2026 全年，对原账单影响保持为 0；保留它仅为模拟「active 与 receivable 不同」的真实场景）
        const yearStart: BudgetScenario = {
            id: 'scenario_yearstart',
            name: '年初预算方案',
            budgetYear: 2026,
            description: '',
            createdAt: '2026-01-01T00:00:00.000Z',
            isActive: true,
            isReceivableActive: false,
            assumptions: [
                {
                    id: 'asm-yearstart-existing',
                    targetType: 'Existing',
                    targetId: 'tenant-x',
                    targetName: t.name,
                    strategy: 'Renewal',
                    projectedSignDate: '2026-01-01',
                    projectedUnitPrice: 0,
                    projectedRentFreeMonths: 0,
                    paymentShift: { isActive: true, amount: 100000, fromYear: 2026, fromMonth: 0, toYear: 2026, toMonth: 5 },
                },
            ],
            adjustments: [],
            baseDataSnapshot: { tenants: [t], buildings },
        };
        // 「实际合同口径方案」既是 receivable，又没有任何 Existing 假设：合同应保持原状，不做付款转移
        const actualReceivable: BudgetScenario = {
            id: 'scenario_actual',
            name: '发票/实收专用方案',
            budgetYear: 2026,
            description: '',
            createdAt: '2026-01-02T00:00:00.000Z',
            isActive: false,
            isReceivableActive: true,
            assumptions: [],
            adjustments: [],
            baseDataSnapshot: { tenants: [t], buildings },
        };
        const data = dashboardData(undefined, {
            tenants: [t],
            budgetScenarios: [yearStart, actualReceivable],
        });
        const result = calculateDashboardMetrics(data, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-01',
        });
        const trends = result.processedData.monthlyTrends || [];
        // 工作台「预算执行」表 / KPI 中的 contractReceivable 应等于 receivable 方案下的滚动应收。
        // 1 月：原本应收 100,000，年初预算方案的 paymentShift 把 1 月转到 6 月（→1 月归零、6 月翻倍）。
        // 修复后 contractReceivable 取 receivable 方案视角，1 月应保留 100,000、6 月仍为 100,000。
        const jan = trends.find((m) => m.month === '1月');
        const jun = trends.find((m) => m.month === '6月');
        expect(jan?.contractReceivable ?? 0).toBeGreaterThan(80000);
        expect(jun?.contractReceivable ?? 0).toBeGreaterThan(80000);
        expect(jun?.contractReceivable ?? 0).toBeLessThan(150000);
    });
});

describe('buildBillingDetailsForPeriod attaches contractAmountDue for three-way alignment', () => {
    /** 单测目的：保证 buildBillingDetailsForPeriod 返回的每行 BillingDetail.contractAmountDue
     *  与工作台 calculateTrends.contractReceivable / 预算管理「每月应收」三处使用同一个"纯合同口径"。
     *  缓缴备注修改了 amountDue，但 contractAmountDue 必须保持合同滚动的原值。 */
    it('contractAmountDue 保持合同纯口径，不被缓缴/导入预算覆盖', () => {
        // 使用深圳园区 projectId 使「应收月偏移 = 0」（账单日与覆盖期同一自然月），
        // 简化断言：Feb 的覆盖 Feb 的应收。
        const t = tenant({
            id: 'tenant-x',
            projectId: 'shenzhen_park',
            paymentCycle: 'Monthly',
            paymentCycleMonths: 1,
            firstPaymentDate: '2026-02-01',
            firstPaymentMonths: 1,
            monthlyRent: 100000,
            leaseStart: '2026-02-01',
            leaseEnd: '2026-12-31',
        });
        const buildings = dashboardData().buildings!;
        const receivableScenario: BudgetScenario = {
            id: 'scenario_actual',
            name: '应收款专用方案',
            budgetYear: 2026,
            description: '',
            createdAt: '2026-01-02T00:00:00.000Z',
            isActive: false,
            isReceivableActive: true,
            assumptions: [],
            adjustments: [],
            baseDataSnapshot: { tenants: [t], buildings },
        };
        // 写入一条缓缴备注：把 2026-02 的 100,000 挪到 2026-03。
        const deferNoteKey = '__defer__tenant-x_2026_1_2026_2_test123';
        const deferNote = JSON.stringify({
            tenantId: 'tenant-x',
            fromYear: 2026,
            fromMonth: 1,
            toYear: 2026,
            toMonth: 2,
            amount: 100000,
        });
        const data = dashboardData({ [deferNoteKey]: deferNote }, {
            tenants: [t],
            budgetScenarios: [receivableScenario],
        });
        const febDetails = buildBillingDetailsForPeriod(2026, 1, data);
        const febRow = febDetails.find((d) => d.tenantId === 'tenant-x');
        expect(febRow).toBeDefined();
        // 实际核销金额（amountDue）= 缓出后 0
        expect(febRow!.amountDue).toBeLessThan(0.005);
        // 合同应收 contractAmountDue 必须仍是 100,000（与工作台一致，未被缓缴影响）
        expect(febRow!.contractAmountDue ?? 0).toBeGreaterThan(99999);
        expect(febRow!.contractAmountDue ?? 0).toBeLessThan(100001);

        // 对账：工作台 contractReceivable 应等于 febRow.contractAmountDue 之和
        const result = calculateDashboardMetrics(data, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-02',
        });
        const trends = result.processedData.monthlyTrends || [];
        const febTrend = trends.find((m) => m.month === '2月');
        const dashContract = febTrend?.contractReceivable ?? 0;
        const financeContractSum = febDetails.reduce((sum, d) => sum + (d.contractAmountDue ?? 0), 0);
        expect(Math.abs(dashContract - financeContractSum)).toBeLessThan(0.5);
    });
});

describe('resolveAnnualInitialBudget（与预算执行表合计 / KPI 同源）', () => {
    it('无月度年初预算时回落 yearlyTargets.initialBudget', () => {
        expect(
            resolveAnnualInitialBudget({ 2026: { revenue: 0, occupancy: 0, initialBudget: 21_710_000 } }, [], 2026)
        ).toBe(21_710_000);
    });

    it('任一月有 initialBudget 时用 12 个月之和（缺月按 0）', () => {
        const init = [
            { year: 2026, month: 1, revenueTarget: 0, revenueCollected: 0, occupancyRate: 0, initialBudget: 10_000_000 },
            { year: 2026, month: 3, revenueTarget: 0, revenueCollected: 0, occupancyRate: 0, initialBudget: 11_710_000 },
        ];
        expect(
            resolveAnnualInitialBudget({ 2026: { revenue: 0, occupancy: 0, initialBudget: 99_999_999 } }, init, 2026)
        ).toBe(21_710_000);
    });

    it('buildKpiSummaryFromProcessedData 使用该口径', () => {
        const base = dashboardData(undefined, {
            yearlyTargets: { 2026: { revenue: 0, occupancy: 0, initialBudget: 1 } },
            initializationData: [
                {
                    year: 2026,
                    month: 1,
                    revenueTarget: 0,
                    revenueCollected: 0,
                    occupancyRate: 0,
                    initialBudget: 5_000_000,
                },
            ],
        });
        const { processedData } = calculateDashboardMetrics(base, {
            year: 2026,
            quarter: 'All',
            billingSelectedMonth: '2026-01',
        });
        const summary = buildKpiSummaryFromProcessedData(processedData, 2026);
        expect(summary.annualInitialBudget).toBe(5_000_000);
    });
});
