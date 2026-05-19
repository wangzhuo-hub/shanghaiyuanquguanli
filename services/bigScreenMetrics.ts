/**
 * 多园区大屏看板 —— 指标聚合层
 * 不另建计算逻辑，严格复用 dashboardMetrics 现有函数。
 */
import type { DashboardData, ParkInfo } from '../types';
import {
  calculateDashboardMetrics,
  buildKpiSummaryFromProcessedData,
  type DashboardQuarter,
} from './dashboardMetrics';
import type { BigScreenEvent } from './bigScreenEvents';
import type { BigScreenAlert } from './bigScreenAlerts';

export interface BigScreenParkMetric {
  projectId: string;
  parkName: string;
  totalArea: number;
  tenantCount: number;
  occupancyRate: number;
  annualOccupancyTarget: number;
  annualInitialBudget: number;
  annualContractReceivable: number;
  annualRevenueCollected: number;
  annualGoalCompletion: number;
  annualBudgetTarget: number;
  annualBudgetCompletion: number;
  budgetDeviation: number;
  /** 本月应收（当前账期 billing amountDue 汇总） */
  currentMonthReceivable: number;
  /** 本月实收（当前账期 billing amountPaid 汇总） */
  currentMonthCollected: number;
  /** 本月未收（amountDue - amountPaid，只计正数） */
  currentMonthUnpaid: number;
  /** 本年累计新签约面积 */
  newContractsArea: number;
  /** 本年累计退租面积 */
  terminatedContractsArea: number;
  /** 净增面积 */
  netIncreaseArea: number;
  latestUpdatedAt?: string;
}

export interface BigScreenData {
  year: number;
  parks: BigScreenParkMetric[];
  totals: BigScreenParkMetric;
  events: BigScreenEvent[];
  alerts: BigScreenAlert[];
  refreshedAt: string;
}

export const buildBigScreenParkMetric = (
  park: ParkInfo,
  rawData: DashboardData,
  year: number,
  billingSelectedMonth: string,
): BigScreenParkMetric => {
  const { processedData } = calculateDashboardMetrics(rawData, {
    year,
    quarter: 'All' as DashboardQuarter,
    billingSelectedMonth,
  });
  const summary = buildKpiSummaryFromProcessedData(processedData, year);
  const annualInitialBudget = summary.annualInitialBudget || 0;
  const annualContractReceivable =
    summary.annualContractReceivable || summary.annualRevenueTarget || 0;
  return {
    projectId: park.projectId,
    parkName: park.name || park.projectId,
    totalArea: summary.totalArea,
    tenantCount: summary.tenantCount,
    occupancyRate: summary.occupancyRate,
    annualOccupancyTarget: summary.annualOccupancyTarget,
    annualInitialBudget,
    annualContractReceivable,
    annualRevenueCollected: summary.annualRevenueCollected,
    annualGoalCompletion: summary.annualGoalCompletion,
    annualBudgetTarget: summary.annualBudgetTarget,
    annualBudgetCompletion: summary.annualBudgetCompletion,
    budgetDeviation:
      annualInitialBudget > 0
        ? ((annualContractReceivable - annualInitialBudget) / annualInitialBudget) * 100
        : 0,
    currentMonthReceivable: 0,
    currentMonthCollected: 0,
    currentMonthUnpaid: 0,
    newContractsArea: 0,
    terminatedContractsArea: 0,
    netIncreaseArea: 0,
  };
};

export interface BigScreenParkData {
  metrics: BigScreenParkMetric;
  /** 当月应收明细（用于逾期预警生成） */
  billingDetails: import('../types').BillingDetail[];
}

export const buildBigScreenParkData = (
  park: ParkInfo,
  rawData: DashboardData,
  year: number,
  billingSelectedMonth: string,
): BigScreenParkData => {
  const { processedData } = calculateDashboardMetrics(rawData, {
    year,
    quarter: 'All' as DashboardQuarter,
    billingSelectedMonth,
  });
  const summary = buildKpiSummaryFromProcessedData(processedData, year);
  const annualInitialBudget = summary.annualInitialBudget || 0;
  const annualContractReceivable =
    summary.annualContractReceivable || summary.annualRevenueTarget || 0;
  const billingDetails: import('../types').BillingDetail[] = processedData.currentMonthBilling || [];
  const currentMonthReceivable = billingDetails.reduce((s, b) => s + (b.amountDue || 0), 0);
  const currentMonthCollected = billingDetails.reduce((s, b) => s + (b.amountPaid || 0), 0);
  const currentMonthUnpaid = billingDetails.reduce(
    (s, b) => s + Math.max(0, (b.amountDue || 0) - (b.amountPaid || 0)),
    0,
  );

  return {
    metrics: {
      projectId: park.projectId,
      parkName: park.name || park.projectId,
      totalArea: summary.totalArea,
      tenantCount: summary.tenantCount,
      occupancyRate: summary.occupancyRate,
      annualOccupancyTarget: summary.annualOccupancyTarget,
      annualInitialBudget,
      annualContractReceivable,
      annualRevenueCollected: summary.annualRevenueCollected,
      annualGoalCompletion: summary.annualGoalCompletion,
      annualBudgetTarget: summary.annualBudgetTarget,
      annualBudgetCompletion: summary.annualBudgetCompletion,
      budgetDeviation:
        annualInitialBudget > 0
          ? ((annualContractReceivable - annualInitialBudget) / annualInitialBudget) * 100
          : 0,
      currentMonthReceivable,
      currentMonthCollected,
      currentMonthUnpaid,
      newContractsArea: processedData.newContractsArea || 0,
      terminatedContractsArea: processedData.terminatedContractsArea || 0,
      netIncreaseArea: processedData.netIncreaseArea || 0,
    },
    billingDetails,
  };
};

export const computeTotals = (parks: BigScreenParkMetric[]): BigScreenParkMetric => {
  const acc = parks.reduce(
    (a, p) => {
      a.totalArea += p.totalArea;
      a.tenantCount += p.tenantCount;
      a.annualInitialBudget += p.annualInitialBudget;
      a.annualContractReceivable += p.annualContractReceivable;
      a.annualRevenueCollected += p.annualRevenueCollected;
      a.annualBudgetTarget += p.annualBudgetTarget;
      a.currentMonthReceivable += p.currentMonthReceivable || 0;
      a.currentMonthCollected += p.currentMonthCollected || 0;
      a.currentMonthUnpaid += p.currentMonthUnpaid || 0;
      a.newContractsArea += p.newContractsArea || 0;
      a.terminatedContractsArea += p.terminatedContractsArea || 0;
      a.netIncreaseArea += p.netIncreaseArea || 0;
      a.occupancyWeightedArea += p.totalArea * p.occupancyRate;
      a.occupancyTargetWeightedArea += p.totalArea * p.annualOccupancyTarget;
      return a;
    },
    {
      totalArea: 0,
      tenantCount: 0,
      annualInitialBudget: 0,
      annualContractReceivable: 0,
      annualRevenueCollected: 0,
      annualBudgetTarget: 0,
      currentMonthReceivable: 0,
      currentMonthCollected: 0,
      currentMonthUnpaid: 0,
      newContractsArea: 0,
      terminatedContractsArea: 0,
      netIncreaseArea: 0,
      occupancyWeightedArea: 0,
      occupancyTargetWeightedArea: 0,
    },
  );
  return {
    projectId: '__totals__',
    parkName: '全部园区',
    totalArea: acc.totalArea,
    tenantCount: acc.tenantCount,
    occupancyRate: acc.totalArea > 0 ? acc.occupancyWeightedArea / acc.totalArea : 0,
    annualOccupancyTarget:
      acc.totalArea > 0 ? acc.occupancyTargetWeightedArea / acc.totalArea : 0,
    annualInitialBudget: acc.annualInitialBudget,
    annualContractReceivable: acc.annualContractReceivable,
    annualRevenueCollected: acc.annualRevenueCollected,
    annualGoalCompletion:
      acc.annualContractReceivable > 0
        ? Math.min(100, (acc.annualRevenueCollected / acc.annualContractReceivable) * 100)
        : 0,
    annualBudgetTarget: acc.annualBudgetTarget,
    annualBudgetCompletion:
      acc.annualBudgetTarget > 0
        ? Math.min(100, (acc.annualRevenueCollected / acc.annualBudgetTarget) * 100)
        : 0,
    budgetDeviation:
      acc.annualInitialBudget > 0
        ? ((acc.annualContractReceivable - acc.annualInitialBudget) / acc.annualInitialBudget) * 100
        : 0,
    currentMonthReceivable: acc.currentMonthReceivable,
    currentMonthCollected: acc.currentMonthCollected,
    currentMonthUnpaid: acc.currentMonthUnpaid,
    newContractsArea: acc.newContractsArea,
    terminatedContractsArea: acc.terminatedContractsArea,
    netIncreaseArea: acc.netIncreaseArea,
  };
};
