import { describe, expect, it } from 'vitest';
import type { DashboardData, ParkInfo } from '../../types';
import { ContractStatus, DepositStatus, UnitStatus } from '../../types';
import { buildBigScreenParkData, computeTotals } from '../bigScreenMetrics';

const shenzhenPark: ParkInfo = {
  projectId: 'shenzhen_park',
  name: '深圳园区',
  enabled: true,
};

const shanghaiPark: ParkInfo = {
  projectId: 'shanghai_park',
  name: '上海园区',
  enabled: true,
};

const baseData = (): DashboardData =>
  ({
    buildings: [
      {
        id: 'building-1',
        name: '1号楼',
        units: [{ id: 'unit-101', name: '101', area: 100, floor: 1, status: UnitStatus.Occupied }],
      },
    ],
    tenants: [
      {
        id: 't1',
        name: '租户A',
        projectId: 'shenzhen_park',
        buildingId: 'building-1',
        unitIds: ['unit-101'],
        leaseStart: '2025-01-01',
        leaseEnd: '2026-12-31',
        totalArea: 100,
        monthlyRent: 50000,
        managementFeeEnabled: true,
        managementFeeUnitPrice: 10,
        managementFeeUnitPriceMode: 'monthly',
        paymentCycle: 'Monthly',
        status: ContractStatus.Active,
        rentFreePeriods: [],
        depositAmount: 0,
        depositStatus: DepositStatus.Unpaid,
        firstPaymentDate: '2025-01-01',
      },
    ],
    payments: [
      {
        id: 'p1',
        tenantId: 't1',
        type: 'Rent',
        status: 'Received',
        amount: 50000,
        date: '2025-03-15',
      },
      {
        id: 'p2',
        tenantId: 't1',
        type: 'ManagementFee',
        status: 'Received',
        amount: 10000,
        date: '2025-03-20',
      },
    ],
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
  }) as unknown as DashboardData;

describe('buildBigScreenParkData management fee', () => {
  it('splits current month rent vs management fee for enabled parks', () => {
    const { metrics, billingDetails } = buildBigScreenParkData(
      shenzhenPark,
      baseData(),
      2025,
      '2025-03',
    );

    expect(metrics.managementFeeBillingEnabled).toBe(true);
    expect(metrics.currentMonthReceivable).toBeGreaterThanOrEqual(0);
    expect(metrics.currentMonthManagementFeeReceivable).toBeGreaterThanOrEqual(0);
    expect(metrics.annualManagementFeeCollected).toBe(10000);

    const rentDue = billingDetails
      .filter((b) => b.feeKind !== 'management_fee')
      .reduce((s, b) => s + (b.amountDue || 0), 0);
    const mgmtDue = billingDetails
      .filter((b) => b.feeKind === 'management_fee')
      .reduce((s, b) => s + (b.amountDue || 0), 0);

    expect(metrics.currentMonthReceivable).toBe(rentDue);
    expect(metrics.currentMonthManagementFeeReceivable).toBe(mgmtDue);
  });

  it('returns zero management fee metrics for parks without billing enabled', () => {
    const { metrics } = buildBigScreenParkData(shanghaiPark, baseData(), 2025, '2025-03');

    expect(metrics.managementFeeBillingEnabled).toBe(false);
    expect(metrics.annualManagementFeeCollected).toBe(0);
    expect(metrics.currentMonthManagementFeeReceivable).toBe(0);
  });
});

describe('computeTotals management fee', () => {
  it('aggregates management fee only from enabled parks', () => {
    const sz = buildBigScreenParkData(shenzhenPark, baseData(), 2025, '2025-03').metrics;
    const sh = buildBigScreenParkData(shanghaiPark, baseData(), 2025, '2025-03').metrics;
    const totals = computeTotals([sz, sh]);

    expect(totals.managementFeeBillingEnabled).toBe(true);
    expect(totals.annualManagementFeeCollected).toBe(sz.annualManagementFeeCollected);
    expect(totals.currentMonthManagementFeeReceivable).toBe(sz.currentMonthManagementFeeReceivable);
  });
});
