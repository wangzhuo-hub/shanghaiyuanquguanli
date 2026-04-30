import { describe, expect, it } from 'vitest';
import { computeEarlyTerminationFreeRentClawbackAmount, generateBudgetedBills } from '../billingService';
import { ContractStatus, DepositStatus, Tenant } from '../../types';

function tenant(overrides: Partial<Tenant>): Tenant {
  return {
    id: 'tenant-1',
    name: '测试客户',
    buildingId: 'building-1',
    unitIds: ['unit-1'],
    totalArea: 100,
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    monthlyRent: 30000,
    rentFreePeriods: [],
    paymentCycle: 'Quarterly',
    firstPaymentDate: '2026-01-01',
    depositAmount: 0,
    depositStatus: DepositStatus.Unpaid,
    status: ContractStatus.Active,
    ...overrides,
  };
}

function formatLocalDate(date: Date | undefined): string | undefined {
  if (!date) return undefined;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

describe('generateBudgetedBills payment cycles', () => {
  it('generates half-monthly bills', () => {
    const bills = generateBudgetedBills(
      tenant({ leaseEnd: '2026-01-31', paymentCycle: 'HalfMonthly', paymentCycleMonths: 0.5, firstPaymentMonths: 0.5 }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => bill.amount)).toEqual([15000, 15000, 1000]);
  });

  it('generates bi-monthly bills', () => {
    const bills = generateBudgetedBills(
      tenant({ leaseEnd: '2026-04-30', paymentCycle: 'BiMonthly', paymentCycleMonths: 2, firstPaymentMonths: 2 }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => bill.amount)).toEqual([60000, 60000]);
  });

  it('keeps billing coverage anchored to the lease start day', () => {
    const bills = generateBudgetedBills(
      tenant({
        leaseStart: '2026-01-15',
        leaseEnd: '2026-03-14',
        paymentCycle: 'Monthly',
        paymentCycleMonths: 1,
        firstPaymentMonths: 1,
        firstPaymentDate: '2026-01-15',
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => [
      formatLocalDate(bill.coverageStart),
      formatLocalDate(bill.coverageEnd),
    ])).toEqual([
      ['2026-01-15', '2026-02-14'],
      ['2026-02-15', '2026-03-14'],
    ]);
  });

  it('generates custom 1.5 month bills', () => {
    const bills = generateBudgetedBills(
      tenant({ leaseEnd: '2026-03-31', paymentCycle: 'Custom', paymentCycleMonths: 1.5, firstPaymentMonths: 1.5 }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => bill.amount)).toEqual([45000, 45000, 1000]);
  });

  it('aggregates different unit prices and unit-level rent-free periods', () => {
    const bills = generateBudgetedBills(
      tenant({
        leaseEnd: '2026-03-31',
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentMonths: 3,
        monthlyRent: 0,
        unitTerms: [
          { unitId: 'unit-1', area: 100, monthlyRent: 30000, rentFreePeriods: [] },
          { unitId: 'unit-2', area: 50, monthlyRent: 15000, rentFreePeriods: [{ start: '2026-01-01', end: '2026-01-31', description: '装修免租' }] },
        ],
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills).toHaveLength(1);
    expect(bills[0].amount).toBe(120000);
  });

  it('deducts rent-free periods by whole monthly rent for anniversary-month ranges', () => {
    const bills = generateBudgetedBills(
      tenant({
        leaseStart: '2026-01-15',
        leaseEnd: '2026-04-14',
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentMonths: 3,
        firstPaymentDate: '2026-01-15',
        rentFreePeriods: [{ start: '2026-01-15', end: '2026-02-14', description: '首月免租' }],
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills).toHaveLength(1);
    expect(bills[0].amount).toBe(60000);
  });

  it('shifts subsequent periods when first receivable custom amount exceeds default first cycle', () => {
    const bills = generateBudgetedBills(
      tenant({
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentMonths: 3,
        firstPaymentDate: '2026-01-01',
        monthlyRent: 30000,
        firstReceivableAmount: 150000, // 5个月
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => bill.amount)).toEqual([150000, 90000, 90000, 30000]);
    expect(bills.map((bill) => formatLocalDate(bill.coverageStart))).toEqual([
      '2026-01-01',
      '2026-06-01',
      '2026-09-01',
      '2026-12-01',
    ]);
    expect(bills.map((bill) => formatLocalDate(bill.coverageEnd))).toEqual([
      '2026-03-31',
      '2026-08-30',
      '2026-11-30',
      '2026-12-31',
    ]);
  });

  it('keeps default schedule when first receivable custom amount is not provided', () => {
    const bills = generateBudgetedBills(
      tenant({
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        paymentCycle: 'Quarterly',
        paymentCycleMonths: 3,
        firstPaymentMonths: 3,
        firstPaymentDate: '2026-01-01',
        monthlyRent: 30000,
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
    );

    expect(bills.map((bill) => bill.amount)).toEqual([90000, 90000, 90000, 90000]);
    expect(bills.map((bill) => formatLocalDate(bill.coverageStart))).toEqual([
      '2026-01-01',
      '2026-04-01',
      '2026-07-01',
      '2026-10-01',
    ]);
  });

  it('computes zero early-termination clawback when no rent-free periods', () => {
    const claw = computeEarlyTerminationFreeRentClawbackAmount(
      tenant({
        terminationType: 'Early',
        terminationDate: '2026-06-30',
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        rentFreePeriods: [],
      })
    );
    expect(claw).toBe(0);
  });

  it('creates the final early-termination receivable in termination month', () => {
    const bills = generateBudgetedBills(
      tenant({
        terminationType: 'Early',
        terminationDate: '2026-05-15',
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        paymentCycle: 'Monthly',
        firstPaymentDate: '2026-01-01',
        monthlyRent: 30000,
        rentFreePeriods: [],
        earlyTerminationDepositDeduction: 5000,
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31)
    );
    const tagged = bills.filter((b) => b.earlyTerminationExtraAmount != null && b.earlyTerminationExtraAmount !== 0);
    expect(tagged).toHaveLength(1);
    expect(formatLocalDate(tagged[0].date)).toBe('2026-05-15');
    // 本期应收租金(5/1-5/15=15000) + 押金扣款5000 + 免租扣回0
    expect(tagged[0].amount).toBe(20000);
    expect(tagged[0].earlyTerminationExtraDetail).toEqual({ clawback: 0, deposit: 5000, other: 0 });
  });

  it('supports editable final receivable adjustment on early termination', () => {
    const bills = generateBudgetedBills(
      tenant({
        terminationType: 'Early',
        terminationDate: '2026-05-15',
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        paymentCycle: 'Monthly',
        firstPaymentDate: '2026-01-01',
        monthlyRent: 30000,
        rentFreePeriods: [],
        earlyTerminationDepositDeduction: 5000,
        earlyTerminationOtherAdjustment: -3000, // 抵扣水电物业等
      }),
      [],
      [],
      new Date(2026, 0, 1),
      new Date(2026, 11, 31)
    );

    const tagged = bills.filter((b) => b.earlyTerminationExtraAmount != null && b.earlyTerminationExtraAmount !== 0);
    expect(tagged).toHaveLength(1);
    expect(formatLocalDate(tagged[0].date)).toBe('2026-05-15');
    // 本期租金15000 + 押金5000 - 其它抵扣3000
    expect(tagged[0].amount).toBe(17000);
    expect(tagged[0].earlyTerminationExtraDetail).toEqual({ clawback: 0, deposit: 5000, other: -3000 });
  });
});
