/**
 * 多园区大屏看板 —— 智能预警生成
 * 从 KPI 指标和合同、应收明细派生预警事件。
 */
import type { Tenant, BillingDetail } from '../types';
import { ContractStatus } from '../types';
import type { BigScreenParkMetric } from './bigScreenMetrics';

// ---- types ----

export interface BigScreenAlert {
  id: string;
  parkId: string;
  parkName: string;
  type:
    | 'contract_expiring'
    | 'receivable_overdue'
    | 'low_occupancy'
    | 'low_collection'
    | 'large_arrears';
  level: 'low' | 'medium' | 'high';
  title: string;
  description: string;
  tenantId?: string;
  tenantName?: string;
  amount?: number;
  dueDate?: string;
  days?: number;
  statusLabel?: string;
  createdAt: string;
}

// ---- helpers ----

const now = () => new Date();
const daysFromNow = (dateStr: string): number => {
  const d = new Date(dateStr);
  return Math.ceil((d.getTime() - now().getTime()) / 86400000);
};

// ---- contract expiry alerts ----

export const generateContractExpiryAlerts = (
  tenants: Tenant[],
  parkId: string,
  parkName: string,
): BigScreenAlert[] => {
  const alerts: BigScreenAlert[] = [];
  for (const t of tenants) {
    if (
      t.status === ContractStatus.Terminated ||
      t.status === ContractStatus.Expired ||
      t.status === ContractStatus.Pending ||
      !t.leaseEnd
    )
      continue;
    const daysLeft = daysFromNow(t.leaseEnd);
    if (daysLeft < 0 || daysLeft > 90) continue;
    const level = daysLeft <= 30 ? 'high' : daysLeft <= 60 ? 'medium' : 'low';
    alerts.push({
      id: `expiry_${parkId}_${t.id}`,
      parkId,
      parkName,
      type: 'contract_expiring',
      level,
      title: `${parkName} ${t.name} 合同即将到期`,
      description: `剩余 ${daysLeft} 天，面积 ${t.totalArea}㎡，月租 ${(t.monthlyRent / 10000).toFixed(1)}万元`,
      tenantId: t.id,
      tenantName: t.name,
      amount: t.monthlyRent,
      dueDate: t.leaseEnd,
      days: daysLeft,
      createdAt: now().toISOString(),
    });
  }
  return alerts;
};

// ---- overdue receivable alerts ----

export const generateOverdueAlerts = (
  billingDetails: BillingDetail[],
  parkId: string,
  parkName: string,
): BigScreenAlert[] => {
  const alerts: BigScreenAlert[] = [];
  for (const b of billingDetails) {
    const unpaid = b.amountDue - b.amountPaid;
    if (unpaid <= 0) continue;
    if (b.status !== 'Overdue' && b.status !== 'Partial' && b.status !== 'Unpaid')
      continue;
    const unpaidWan = unpaid / 10000;
    const level =
      unpaidWan >= 10 ? 'high' : unpaidWan >= 3 ? 'medium' : 'low';
    const statusLabel =
      b.status === 'Overdue' ? '逾期未收' : b.status === 'Partial' ? '部分未收' : '待收款';
    alerts.push({
      id: `overdue_${parkId}_${b.tenantId}`,
      parkId,
      parkName,
      type: 'receivable_overdue',
      level,
      title: `${parkName} ${b.tenantName || '—'} ${statusLabel}`,
      description: `未收 ${unpaidWan.toFixed(1)}万元`,
      tenantId: b.tenantId,
      tenantName: b.tenantName,
      amount: unpaid,
      statusLabel,
      createdAt: now().toISOString(),
    });
  }
  return alerts;
};

// ---- low occupancy alerts ----

export const generateLowOccupancyAlerts = (
  metrics: BigScreenParkMetric[],
): BigScreenAlert[] =>
  metrics
    .filter((m) => {
      const gap = m.annualOccupancyTarget - m.occupancyRate;
      return gap > 0;
    })
    .map((m) => {
      const gap = m.annualOccupancyTarget - m.occupancyRate;
      const level = gap >= 10 ? 'high' : gap >= 5 ? 'medium' : 'low';
      return {
        id: `occ_${m.projectId}`,
        parkId: m.projectId,
        parkName: m.parkName,
        type: 'low_occupancy' as const,
        level,
        title: `${m.parkName} 出租率低于目标`,
        description: `出租率 ${m.occupancyRate.toFixed(1)}%，目标 ${m.annualOccupancyTarget.toFixed(1)}%，差距 ${gap.toFixed(1)} 个百分点`,
        createdAt: now().toISOString(),
      };
    });

// ---- low collection alerts ----

export const generateLowCollectionAlerts = (
  metrics: BigScreenParkMetric[],
): BigScreenAlert[] => {
  const timeProgress = ((now().getMonth() + 1) / 12) * 100;
  return metrics
    .filter((m) => {
      const gap = timeProgress - m.annualGoalCompletion;
      return gap > 5;
    })
    .map((m) => {
      const gap = timeProgress - m.annualGoalCompletion;
      const level = gap >= 20 ? 'high' : gap >= 10 ? 'medium' : 'low';
      return {
        id: `coll_${m.projectId}`,
        parkId: m.projectId,
        parkName: m.parkName,
        type: 'low_collection' as const,
        level,
        title: `${m.parkName} 回款进度落后`,
        description: `回款率 ${m.annualGoalCompletion.toFixed(1)}%，时间进度 ${timeProgress.toFixed(1)}%，落后 ${gap.toFixed(1)} 个百分点`,
        createdAt: now().toISOString(),
      };
    });
};

// ---- aggregate ----

export const generateAllAlerts = (
  tenants: Tenant[],
  billingDetails: BillingDetail[],
  parkId: string,
  parkName: string,
): BigScreenAlert[] => [
  ...generateContractExpiryAlerts(tenants, parkId, parkName),
  ...generateOverdueAlerts(billingDetails, parkId, parkName),
];

/** Sort: type priority → level → amount desc / days asc */
export const sortAlertsByLevel = (alerts: BigScreenAlert[]): BigScreenAlert[] => {
  const typeOrder: Record<string, number> = {
    receivable_overdue: 0,
    contract_expiring: 1,
    low_occupancy: 2,
    low_collection: 3,
    large_arrears: 4,
  };
  const levelOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...alerts].sort((a, b) => {
    const tDiff = (typeOrder[a.type] ?? 99) - (typeOrder[b.type] ?? 99);
    if (tDiff !== 0) return tDiff;
    const lDiff = (levelOrder[a.level] ?? 99) - (levelOrder[b.level] ?? 99);
    if (lDiff !== 0) return lDiff;
    // Within same type+level: amount desc, days asc
    if (a.type === 'contract_expiring') return (a.days ?? 999) - (b.days ?? 999);
    return (b.amount ?? 0) - (a.amount ?? 0);
  });
};
