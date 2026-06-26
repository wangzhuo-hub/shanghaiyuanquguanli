import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  version: 7,
  initPocketBase: vi.fn(),
  authenticatePocketBase: vi.fn().mockResolvedValue(undefined),
  readCloudSaveVersion: vi.fn(async () => mocks.version),
  fetchPocketBaseBackup: vi.fn(async () => ({
    success: true,
    data: {
      cloudSaveVersion: mocks.version,
      buildings: [],
      tenants: [],
      payments: [],
      initializationData: [],
    },
  })),
  calculateDashboardMetrics: vi.fn(() => ({
    processedData: {
      currentMonthBilling: [
        {
          tenantId: 't1',
          tenantName: '测试租户',
          amountDue: 100,
          amountPaid: 40,
          status: 'Partial',
          feeKind: 'rent',
        },
      ],
    },
    fullYearMonthlyTrends: [],
  })),
  createBillingCache: vi.fn(() => ({ cacheId: 'billing-cache' })),
  buildContractOnlyReceivableForPeriod: vi.fn((_year: number, month: number) => ({
    totalAmountDue: month + 1,
    byTenantId: new Map([['t1', month + 1]]),
  })),
  generateBudgetedBills: vi.fn(() => [
    {
      date: new Date('2026-01-05T00:00:00.000Z'),
      amount: 100,
      coverageStart: new Date('2026-01-01T00:00:00.000Z'),
      coverageEnd: new Date('2026-01-31T00:00:00.000Z'),
    },
  ]),
}));

vi.mock('../../services/pocketbaseService', () => ({
  initPocketBase: mocks.initPocketBase,
  authenticatePocketBase: mocks.authenticatePocketBase,
  readCloudSaveVersion: mocks.readCloudSaveVersion,
  fetchPocketBaseBackup: mocks.fetchPocketBaseBackup,
}));

vi.mock('../../services/dashboardMetrics', () => ({
  calculateDashboardMetrics: mocks.calculateDashboardMetrics,
  buildContractOnlyReceivableForPeriod: mocks.buildContractOnlyReceivableForPeriod,
  buildKpiSummaryFromProcessedData: vi.fn(() => ({})),
  createBillingCache: mocks.createBillingCache,
  normalizeKpiSummaryWithMonthlyTrends: vi.fn((summary) => summary),
  normalizeYearlyTargetsFromInitialization: vi.fn((targets) => targets || {}),
}));

vi.mock('../../services/billingService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/billingService')>();
  return {
    ...actual,
    generateBudgetedBills: mocks.generateBudgetedBills,
  };
});

describe('compute-engine caches', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv('PB_ADMIN_EMAIL', 'admin@example.com');
    vi.stubEnv('PB_ADMIN_PASSWORD', 'password');
    mocks.version = 7;
    const { clearComputeCaches } = await import('../compute-engine');
    clearComputeCaches();
  });

  it('reuses billing result for the same project, period and data version', async () => {
    const { computeBilling } = await import('../compute-engine');

    const first = await computeBilling('shanghai_park', 2026, 4);
    const second = await computeBilling('shanghai_park', 2026, 4);

    expect(first.totalDue).toBe(100);
    expect(second.totalDue).toBe(100);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(1);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(1);
    expect(mocks.readCloudSaveVersion).toHaveBeenCalledTimes(1);
  });

  it('filters tenant historical arrears by receivable permissions', async () => {
    mocks.calculateDashboardMetrics.mockReturnValueOnce({
      processedData: {
        buildings: [],
        tenants: [{ id: 't1', name: '测试租户' }],
        payments: [],
        initializationData: [],
        sealedMonths: [
          {
            year: 2026,
            month: 1,
            billingDetails: [
              {
                tenantId: 't1',
                tenantName: '测试租户',
                amountDue: 9000,
                amountPaid: 0,
                status: 'Unpaid',
                feeKind: 'rent',
              },
              {
                tenantId: 't1',
                tenantName: '测试租户',
                amountDue: 3000,
                amountPaid: 0,
                status: 'Unpaid',
                feeKind: 'management_fee',
              },
            ],
          },
        ],
      },
      fullYearMonthlyTrends: [],
    });
    const { computeTenantHistoricalArrears } = await import('../compute-engine');

    const result = await computeTenantHistoricalArrears('shanghai_park', {
      referenceDate: '2026-02-05',
      receivablePermissions: ['mgmt_fee_receivable'],
    });

    expect(result.ok).toBe(true);
    expect(result.available).toBe(true);
    expect(result.items).toEqual([
      {
        tenantId: 't1',
        amount: 3000,
        months: 1,
        latestPeriod: '2026-01',
      },
    ]);
  });

  it('does not reuse billing cache when the data version is zero', async () => {
    mocks.version = 0;
    const { computeBilling } = await import('../compute-engine');

    const first = await computeBilling('shanghai_park', 2026, 4);
    const second = await computeBilling('shanghai_park', 2026, 4);

    expect(first.dataVersion).toBe(0);
    expect(second.dataVersion).toBe(0);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it('recomputes when dashboard data version changes', async () => {
    const { clearComputeCaches, computeBilling } = await import('../compute-engine');

    await computeBilling('shanghai_park', 2026, 4);
    mocks.version = 8;
    clearComputeCaches('shanghai_park');
    await computeBilling('shanghai_park', 2026, 4);

    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
    expect(mocks.readCloudSaveVersion).toHaveBeenCalledTimes(2);
  });

  it('can clear cached results for one project', async () => {
    const { clearComputeCaches, computeBilling } = await import('../compute-engine');

    await computeBilling('shanghai_park', 2026, 4);
    clearComputeCaches('shanghai_park');
    await computeBilling('shanghai_park', 2026, 4);

    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it('reuses dashboard result for the same project, options and data version', async () => {
    const { computeDashboardData } = await import('../compute-engine');

    const first = await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });
    first.processedData.currentMonthBilling[0].amountDue = 999;
    const second = await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });

    expect(second.processedData.currentMonthBilling[0].amountDue).toBe(100);
    expect(second.dataVersion).toBe(7);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(1);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it('keeps dashboard cache entries separate for previous-year trend mode', async () => {
    const { computeDashboardData } = await import('../compute-engine');

    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: false,
      includeCurrentMonthBilling: false,
      includePrevYearTrends: false,
    });
    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: false,
      includeCurrentMonthBilling: false,
      includePrevYearTrends: true,
    });

    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ includePrevYearTrends: false }),
    );
    expect(mocks.calculateDashboardMetrics).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ includePrevYearTrends: true }),
    );
  });

  it('does not reuse dashboard cache when the data version is zero', async () => {
    mocks.version = 0;
    const { computeDashboardData } = await import('../compute-engine');

    const first = await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });
    const second = await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });

    expect(first.dataVersion).toBe(0);
    expect(second.dataVersion).toBe(0);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it('reuses the short-lived data version read across adjacent dashboard and billing computes', async () => {
    const { computeBilling, computeDashboardData } = await import('../compute-engine');

    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-05',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });
    await computeBilling('shanghai_park', 2026, 4);

    expect(mocks.readCloudSaveVersion).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
  });

  it('computes a draft dashboard from provided data without fetching PocketBase backup', async () => {
    const { computeDashboardDraft } = await import('../compute-engine');

    const result = await computeDashboardDraft('shanghai_park', {
      cloudSaveVersion: 12,
      buildings: [],
      tenants: [],
      payments: [],
      initializationData: [],
    } as any, {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
      includeCurrentMonthBilling: false,
    });

    expect(result.ok).toBe(true);
    expect(result.dataVersion).toBe(12);
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it('computes draft billing from provided data without fetching PocketBase backup', async () => {
    const { computeBillingDraft } = await import('../compute-engine');

    const result = await computeBillingDraft('shanghai_park', {
      cloudSaveVersion: 12,
      buildings: [],
      tenants: [],
      payments: [],
      initializationData: [],
    } as any, 2026, 4);

    expect(result.ok).toBe(true);
    expect(result.totalDue).toBe(100);
    expect(result.dataVersion).toBe(12);
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(1);
  });

  it('returns the source data version when sealing a month', async () => {
    const { sealMonth } = await import('../compute-engine');

    const result = await sealMonth('shanghai_park', 2026, 4);

    expect(result.ok).toBe(true);
    expect(result.dataVersion).toBe(7);
    expect(result.arrearsIncrement).toBe(60);
  });

  it('computes budgeted bill preview from provided tenant data without fetching PocketBase backup', async () => {
    const { computeBudgetedBillsPreview } = await import('../compute-engine');

    const result = await computeBudgetedBillsPreview('shanghai_park', {
      tenant: {
        id: 't1',
        name: '测试客户',
        buildingId: 'b1',
        unitIds: ['u1'],
        totalArea: 100,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        monthlyRent: 10000,
        paymentCycle: 'Monthly',
        depositAmount: 0,
        depositStatus: 'Unpaid',
        status: 'Active',
        rentFreePeriods: [],
      } as any,
      assumptions: [],
      adjustments: [],
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    });

    expect(result.ok).toBe(true);
    expect(result.projectId).toBe('shanghai_park');
    expect(result.count).toBe(1);
    expect(result.bills[0].amount).toBe(100);
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
    expect(mocks.generateBudgetedBills).toHaveBeenCalledTimes(1);
    expect(mocks.generateBudgetedBills.mock.calls[0][3]).toBeInstanceOf(Date);
    expect(mocks.generateBudgetedBills.mock.calls[0][4]).toBeInstanceOf(Date);
  });

  it('computes budgeted bill previews in batch without fetching PocketBase backup', async () => {
    const { computeBudgetedBillsPreviewBatch } = await import('../compute-engine');

    const tenant = {
      id: 't1',
      name: '测试客户',
      buildingId: 'b1',
      unitIds: ['u1'],
      totalArea: 100,
      leaseStart: '2026-01-01',
      leaseEnd: '2026-12-31',
      monthlyRent: 10000,
      paymentCycle: 'Monthly',
      depositAmount: 0,
      depositStatus: 'Unpaid',
      status: 'Active',
      rentFreePeriods: [],
    } as any;

    const result = await computeBudgetedBillsPreviewBatch('shanghai_park', [
      {
        id: 'first',
        tenant,
        assumptions: [],
        adjustments: [],
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
      {
        id: 'second',
        tenant: { ...tenant, id: 't2' },
        assumptions: [],
        adjustments: [],
        startDate: '2026-01-01',
        endDate: '2026-12-31',
      },
    ]);

    expect(result.ok).toBe(true);
    expect(result.count).toBe(2);
    expect(result.items.map((item) => item.id)).toEqual(['first', 'second']);
    expect(result.items[0].bills[0].amount).toBe(100);
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
    expect(mocks.generateBudgetedBills).toHaveBeenCalledTimes(2);
  });

  it('computes contract receivable monthly summary from provided context without fetching PocketBase backup', async () => {
    const { computeContractReceivableMonthly } = await import('../compute-engine');

    const result = await computeContractReceivableMonthly('shanghai_park', {
      year: 2026,
      tenants: [{ id: 't1', name: '测试客户' } as any],
      buildings: [],
      payments: [],
      initializationData: [],
      budgetAssumptions: [],
      budgetAdjustments: [],
      budgetScenarios: [],
    });

    expect(result.ok).toBe(true);
    expect(result.projectId).toBe('shanghai_park');
    expect(result.year).toBe(2026);
    expect(result.months).toHaveLength(12);
    expect(result.months[0]).toMatchObject({
      month: 1,
      totalAmountDue: 1,
      byTenantId: [{ tenantId: 't1', amount: 1 }],
    });
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
    expect(mocks.createBillingCache).toHaveBeenCalledTimes(1);
    expect(mocks.buildContractOnlyReceivableForPeriod).toHaveBeenCalledTimes(12);
    expect(mocks.buildContractOnlyReceivableForPeriod.mock.calls[0][3]).toBe(
      mocks.buildContractOnlyReceivableForPeriod.mock.calls[1][3],
    );
  });

  it('computes source agent metrics from provided tenant data without fetching PocketBase backup', async () => {
    const { computeSourceAgentMetricsPreview } = await import('../compute-engine');

    const result = await computeSourceAgentMetricsPreview('shanghai_park', {
      period: 'Year',
      referenceDate: '2026-06-20T00:00:00.000Z',
      tenants: [{
        id: 't1',
        name: '测试客户',
        sourceAgentName: '张三',
        buildingId: 'b1',
        unitIds: ['u1'],
        totalArea: 100,
        signingDate: '2026-01-01',
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        monthlyRent: 10000,
        paymentCycle: 'Monthly',
        depositAmount: 0,
        depositStatus: 'Unpaid',
        status: 'Active',
        rentFreePeriods: [],
      } as any],
    });

    expect(result.ok).toBe(true);
    expect(result.projectId).toBe('shanghai_park');
    expect(result.summary.period).toBe('Year');
    expect(result.summary.rows[0]).toMatchObject({
      sourceName: '张三',
      contractCount: 1,
      signedArea: 100,
    });
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
  });

  it('computes contract analysis metrics from provided tenant data without fetching PocketBase backup', async () => {
    const { computeContractAnalysisMetricsPreview } = await import('../compute-engine');

    const result = await computeContractAnalysisMetricsPreview('shanghai_park', {
      period: 'Month',
      referenceDate: '2026-06-20T00:00:00.000Z',
      tenants: [
        {
          id: 'signed-current',
          name: '本月新签',
          buildingId: 'b1',
          unitIds: ['u1'],
          totalArea: 100,
          signingDate: '2026-06-01',
          leaseStart: '2026-06-01',
          leaseEnd: '2027-05-31',
          monthlyRent: 10000,
          paymentCycle: 'Monthly',
          depositAmount: 0,
          depositStatus: 'Unpaid',
          status: 'Active',
          rentFreePeriods: [],
        },
        {
          id: 'terminated-current',
          name: '本月退租',
          buildingId: 'b1',
          unitIds: ['u2'],
          totalArea: 40,
          signingDate: '2026-01-01',
          leaseStart: '2026-01-01',
          leaseEnd: '2026-12-31',
          terminationDate: '2026-06-10',
          terminationType: 'Early',
          terminationReason: '经营调整',
          monthlyRent: 4000,
          paymentCycle: 'Monthly',
          depositAmount: 0,
          depositStatus: 'Unpaid',
          status: 'Terminated',
          rentFreePeriods: [],
        },
      ] as any,
    });

    expect(result.ok).toBe(true);
    expect(result.projectId).toBe('shanghai_park');
    expect(result.metrics.metrics).toMatchObject({
      signedCount: 1,
      signedArea: 100,
      terminatedCount: 1,
      terminatedArea: 40,
      netArea: 60,
    });
    expect(result.metrics.reasons).toEqual([{ name: '经营调整', value: 1 }]);
    expect(result.metrics.earlyRate).toBe(100);
    expect(mocks.fetchPocketBaseBackup).not.toHaveBeenCalled();
  });

  it('recomputes dashboard result when data version changes', async () => {
    const { clearComputeCaches, computeDashboardData } = await import('../compute-engine');

    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
    });
    mocks.version = 8;
    clearComputeCaches('shanghai_park');
    const result = await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
    });

    expect(result.dataVersion).toBe(8);
    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it('keeps dashboard cache entries separate for calculation options', async () => {
    const { computeDashboardData } = await import('../compute-engine');

    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: true,
    });
    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
      quickMode: false,
    });

    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });

  it('can clear dashboard cached results for one project', async () => {
    const { clearComputeCaches, computeDashboardData } = await import('../compute-engine');

    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
    });
    clearComputeCaches('shanghai_park');
    await computeDashboardData('shanghai_park', {
      year: 2026,
      quarter: 'All',
      billingSelectedMonth: '2026-04',
    });

    expect(mocks.fetchPocketBaseBackup).toHaveBeenCalledTimes(2);
    expect(mocks.calculateDashboardMetrics).toHaveBeenCalledTimes(2);
  });
});
