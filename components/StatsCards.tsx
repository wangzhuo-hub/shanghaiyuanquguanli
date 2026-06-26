
import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Target, Edit3, CalendarRange, UserPlus, UserMinus } from 'lucide-react';
import { AuthUser, DashboardData, Tenant, MonthlyTrend } from '../types';
import { formatArea, formatPercent, formatWan } from '../services/numberFormat';
import { resolveAnnualInitialBudget } from '../services/dashboardMetricHelpers';
import { resolveInitMonthInitialBudget } from '../services/initDataBudget';
import { isManagementFeeBillingEnabled } from '../services/parkBillingConfig';
import { canViewRentPricing } from '../services/receivablePermissions';
import { summarizeLeaseStats } from '../services/leaseStats';

export { summarizeLeaseStats } from '../services/leaseStats';

type FeeScope = 'rent' | 'management_fee' | 'combined';

interface StatsCardsProps {
  data: DashboardData;
  onEditTargets: (type: 'revenue' | 'occupancy') => void;
  selectedYear: number;
  tenants: Tenant[];
  projectId?: string;
  authUser?: AuthUser | null;
}

export const StatsCards: React.FC<StatsCardsProps> = ({
  data,
  onEditTargets,
  selectedYear,
  tenants,
  projectId: projectIdProp,
  authUser = null,
}) => {
  const [leasePeriod, setLeasePeriod] = React.useState<'year' | 'quarter' | 'month'>('year');
  const projectId = projectIdProp || tenants[0]?.projectId || '';
  const mgmtFeeParkEnabled = isManagementFeeBillingEnabled(projectId);
  const viewRentPricing = canViewRentPricing(authUser);
  const [feeScope, setFeeScope] = React.useState<FeeScope>(() =>
      viewRentPricing ? 'rent' : 'management_fee',
  );

  React.useEffect(() => {
      if (!viewRentPricing && mgmtFeeParkEnabled) {
          setFeeScope('management_fee');
      }
  }, [viewRentPricing, mgmtFeeParkEnabled]);

  const formatWanCurrency = formatWan;
  /** 工作台「预算执行」表：万元、百分比取整 */
  const dashboardWan = (v: number | null | undefined) => formatWan(v, 0);
  const dashboardPct = (v: number | null | undefined) => formatPercent(v, 0);

  const initialBudgetMonthMap = useMemo(() => {
      const map = new Map<number, number>();
      for (const d of data.initializationData || []) {
          if (d.year !== selectedYear) continue;
          const monthBudget = resolveInitMonthInitialBudget(d, projectId);
          if (monthBudget <= 0.005) continue;
          map.set(d.month, monthBudget);
      }
      return map;
  }, [data.initializationData, selectedYear, projectId]);

  /** 与 KPI 快照 / 管理员「所有园区经营汇总」中年初预算列同源 */
  const initialBudgetFooterSum = useMemo(
      () => resolveAnnualInitialBudget(data.yearlyTargets, data.initializationData, selectedYear, projectId),
      [data.yearlyTargets, data.initializationData, selectedYear, projectId]
  );

  /** 营收达成分母：优先年初预算（园区应收目标），未维护时回退年度营收目标 */
  const annualRevenueGoal =
      initialBudgetFooterSum > 0 ? initialBudgetFooterSum : data.annualRevenueTarget;
  const annualProgress =
      annualRevenueGoal > 0
          ? Math.min(100, (data.annualRevenueCollected / annualRevenueGoal) * 100)
          : 0;

  // Occupancy Target Gap
  const occupancyGap = data.annualOccupancyTarget - data.occupancyRate;

  const isNetNegative = data.netIncreaseArea < 0;

  // 后台指标计算已产出时直接展示；旧缓存/离线缺字段时才在前端兜底。
  const leaseStats = useMemo(
      () => data.leaseStats ?? summarizeLeaseStats(tenants, selectedYear),
      [data.leaseStats, tenants, selectedYear]
  );

  // 年初预算年度总值（用于完成率分母）
  const totalInitialBudget = useMemo(
      () => Array.from({ length: 12 }, (_, i) => initialBudgetMonthMap.get(i + 1) ?? 0).reduce((s, v) => s + v, 0),
      [initialBudgetMonthMap]
  );

  const pickScopeAmounts = (
      trend: MonthlyTrend | undefined,
      prevTrend: MonthlyTrend | undefined,
      scope: FeeScope,
  ) => {
      const rentContract = trend?.contractReceivable ?? trend?.revenueTarget ?? 0;
      const rentActual = trend?.revenueCollected ?? 0;
      const rentHasActual = trend?.revenueCollected !== null && trend?.revenueCollected !== undefined;
      const mgmtContract = trend?.managementFeeContractReceivable ?? 0;
      const mgmtActual = trend?.managementFeeCollected ?? 0;
      const mgmtHasActual = trend?.managementFeeCollected !== null && trend?.managementFeeCollected !== undefined;
      const prevRent = prevTrend?.revenueCollected || 0;
      const prevMgmt = prevTrend?.managementFeeCollected || 0;

      if (scope === 'management_fee') {
          return {
              contractReceivable: mgmtContract,
              actual: mgmtHasActual ? mgmtActual : null,
              hasActual: mgmtHasActual,
              prevActual: prevMgmt,
              useInitialBudget: false,
          };
      }
      if (scope === 'combined') {
          const hasActual = rentHasActual || mgmtHasActual;
          const actual =
              (rentHasActual ? rentActual : 0) + (mgmtHasActual ? mgmtActual : 0);
          return {
              contractReceivable: rentContract + mgmtContract,
              actual: hasActual ? actual : null,
              hasActual,
              prevActual: prevRent + prevMgmt,
              useInitialBudget: true,
          };
      }
      return {
          contractReceivable: rentContract,
          actual: rentHasActual ? rentActual : null,
          hasActual: rentHasActual,
          prevActual: prevRent,
          useInitialBudget: true,
      };
  };

  const monthlyBreakdown = useMemo(() => {
      let cumulativeCollected = 0;
      let cumulativeInitialBudget = 0;
      let cumulativeContractGoal = 0;
      return Array.from({ length: 12 }, (_, i) => {
          const trend = data.monthlyTrends[i];
          const prevYearData = data.prevYearMonthlyTrends?.[i];
          const scoped = pickScopeAmounts(trend, prevYearData, feeScope);
          const monthInitialBudget = initialBudgetMonthMap.get(i + 1) ?? 0;
          const monthGoal =
              feeScope === 'management_fee'
                  ? scoped.contractReceivable
                  : monthInitialBudget > 0.005
                    ? monthInitialBudget
                    : scoped.contractReceivable;

          if (scoped.hasActual && scoped.actual != null) {
              cumulativeCollected += scoped.actual;
          }
          if (scoped.useInitialBudget) {
              cumulativeInitialBudget += monthInitialBudget;
          }
          cumulativeContractGoal += scoped.contractReceivable;

          const monthlyRate =
              monthGoal > 0 && scoped.hasActual && scoped.actual != null
                  ? (scoped.actual / monthGoal) * 100
                  : 0;
          const progressDenominator =
              feeScope === 'management_fee'
                  ? cumulativeContractGoal
                  : totalInitialBudget > 0
                    ? totalInitialBudget
                    : cumulativeContractGoal;
          const cumulativeProgress =
              progressDenominator > 0 ? (cumulativeCollected / progressDenominator) * 100 : 0;

          let yoy = 0;
          if (scoped.prevActual > 0 && scoped.hasActual && scoped.actual != null) {
              yoy = ((scoped.actual - scoped.prevActual) / scoped.prevActual) * 100;
          }

          return {
              month: i + 1,
              monthName: trend?.month || `${i + 1}月`,
              budget: scoped.contractReceivable,
              actual: scoped.actual,
              monthGoal,
              monthlyRate,
              cumulativeProgress,
              hasActual: scoped.hasActual,
              prevActual: scoped.prevActual,
              yoy,
              showInitialBudget: scoped.useInitialBudget && feeScope !== 'management_fee',
          };
      });
  }, [
      data.monthlyTrends,
      data.prevYearMonthlyTrends,
      initialBudgetMonthMap,
      totalInitialBudget,
      feeScope,
  ]);

  const budgetExecutionTotal = useMemo(() => {
      const totalContractReceivable = monthlyBreakdown.reduce((sum, month) => sum + month.budget, 0);
      const actualMonths = monthlyBreakdown.filter((month) => month.hasActual);
      const actualBudgetMonths = actualMonths.filter((m) => initialBudgetMonthMap.has(m.month));
      const actualInitialBudget = actualBudgetMonths.reduce(
          (sum, m) => sum + (initialBudgetMonthMap.get(m.month) ?? 0),
          0,
      );
      const totalGoalForRate = actualMonths.reduce((sum, m) => sum + m.monthGoal, 0);
      const totalActual = actualMonths.reduce((sum, month) => sum + (month.actual || 0), 0);
      const comparablePrevActual = actualMonths.reduce((sum, month) => sum + month.prevActual, 0);
      const yearPrevActual = monthlyBreakdown.reduce((sum, month) => sum + month.prevActual, 0);
      const progressDenominator =
          feeScope === 'management_fee'
              ? totalContractReceivable
              : totalInitialBudget > 0
                ? totalInitialBudget
                : totalContractReceivable;

      return {
          totalBudget: totalContractReceivable,
          totalActual,
          comparablePrevActual,
          yearPrevActual,
          monthlyRate: totalGoalForRate > 0 ? (totalActual / totalGoalForRate) * 100 : 0,
          cumulativeProgress: progressDenominator > 0 ? (totalActual / progressDenominator) * 100 : 0,
          yoy: comparablePrevActual > 0 ? ((totalActual - comparablePrevActual) / comparablePrevActual) * 100 : 0,
          hasActual: actualMonths.length > 0,
      };
  }, [monthlyBreakdown, initialBudgetMonthMap, totalInitialBudget, feeScope]);

  const scopeLabels = useMemo(() => {
      if (feeScope === 'management_fee') {
          return {
              budgetTitle: '预算执行 · 物业费',
              contractCol: '物业费应收',
              actualCol: '物业费实收',
              annualTitle: '物业费收缴达成',
              completedLabel: '已收(万元)',
              remainingLabel: '待收(万元)',
          };
      }
      if (feeScope === 'combined') {
          return {
              budgetTitle: '预算执行 · 租金+物业费',
              contractCol: '合计合同应收',
              actualCol: '合计实收',
              annualTitle: '综合收缴达成',
              completedLabel: '已收合计(万元)',
              remainingLabel: '待收合计(万元)',
          };
      }
      return {
          budgetTitle: '预算执行',
          contractCol: '合同应收',
          actualCol: '实际收款',
          annualTitle: '营收达成',
          completedLabel: '已完成(万元)',
          remainingLabel: '剩余目标(万元)',
      };
  }, [feeScope]);

  const annualScopeMetrics = useMemo(() => {
      const rentCollected = data.annualRevenueCollected || 0;
      const rentGoal = annualRevenueGoal;
      const mgmtCollected = data.annualManagementFeeCollected || 0;
      const mgmtGoal = data.annualManagementFeeContractReceivable || 0;

      if (feeScope === 'management_fee') {
          return {
              collected: mgmtCollected,
              goal: mgmtGoal,
              progress: mgmtGoal > 0 ? Math.min(100, (mgmtCollected / mgmtGoal) * 100) : 0,
          };
      }
      if (feeScope === 'combined') {
          const collected = rentCollected + mgmtCollected;
          const goal = rentGoal + mgmtGoal;
          return {
              collected,
              goal,
              progress: goal > 0 ? Math.min(100, (collected / goal) * 100) : 0,
          };
      }
      return {
          collected: rentCollected,
          goal: rentGoal,
          progress: annualProgress,
      };
  }, [
      feeScope,
      data.annualRevenueCollected,
      data.annualManagementFeeCollected,
      data.annualManagementFeeContractReceivable,
      annualRevenueGoal,
      annualProgress,
  ]);

  const feeScopeButtonClass = (scope: FeeScope) =>
      `liquid-pressable min-h-8 rounded-full px-3 py-1.5 transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
          feeScope === scope
              ? 'liquid-action-strong'
              : 'text-slate-600 hover:bg-white/70 hover:text-blue-700'
      }`;

  const leasePeriodButtonClass = (period: typeof leasePeriod) =>
      `liquid-pressable min-h-8 rounded-xl px-3 py-1.5 text-xs font-semibold transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 ${
          leasePeriod === period
              ? 'liquid-action-strong'
              : 'text-slate-600 hover:bg-white/70 hover:text-blue-700'
      }`;

  const workbenchRateToneClass = (hasActual: boolean, rate: number) => {
      if (!hasActual) return 'liquid-workbench-rate-pill--empty';
      if (rate >= 100) return 'liquid-workbench-rate-pill--strong';
      if (rate >= 80) return 'liquid-workbench-rate-pill--good';
      return 'liquid-workbench-rate-pill--warn';
  };

  const workbenchCumulativeToneClass = (hasActual: boolean, rate: number) => {
      if (!hasActual) return 'liquid-workbench-rate-pill--empty';
      return rate >= 100 ? 'liquid-workbench-rate-pill--strong' : 'liquid-workbench-rate-pill--neutral';
  };

  return (
    <div className="space-y-4 md:space-y-6">
        {/* Annual Goal Card with Monthly Breakdown Below */}
        <div className="space-y-4">
            {/* Monthly Breakdown Table - Integrated Budget Execution */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
                {/* Left: Table */}
                <div className="order-1 lg:order-1 liquid-workbench-card rounded-[24px] overflow-hidden min-w-0 flex flex-col transition-shadow duration-300">
                    <div className="liquid-workbench-header px-4 sm:px-5 py-3">
                        <div className="flex flex-wrap items-center justify-between gap-3 text-slate-900 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                                <CalendarRange size={16} className="shrink-0 text-blue-600" />
                                <h3 className="font-bold text-xs sm:text-sm">{scopeLabels.budgetTitle}</h3>
                                <span className="liquid-glass-control shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-blue-700">实时</span>
                            </div>
                            {mgmtFeeParkEnabled && (
                                <div className="liquid-workbench-segment flex shrink-0 rounded-full p-1 text-xs font-semibold">
                                    {viewRentPricing && (
                                        <button type="button" onClick={() => setFeeScope('rent')} className={feeScopeButtonClass('rent')}>租金</button>
                                    )}
                                    <button type="button" onClick={() => setFeeScope('management_fee')} className={feeScopeButtonClass('management_fee')}>物业费</button>
                                    {viewRentPricing && (
                                        <button type="button" onClick={() => setFeeScope('combined')} className={feeScopeButtonClass('combined')}>合计</button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="liquid-workbench-table min-w-0 flex-1">
                        <div className="grid gap-3 p-3 sm:hidden">
                            {monthlyBreakdown.map((month) => (
                                <article key={month.month} className="liquid-workbench-month-card rounded-[20px] p-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <div className="text-xs font-black text-slate-500">月份</div>
                                            <div className="mt-0.5 text-lg font-black text-slate-950">{month.monthName}</div>
                                        </div>
                                        <span className={`liquid-workbench-rate-pill inline-flex min-w-[54px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-black ${workbenchRateToneClass(month.hasActual, month.monthlyRate)}`}>
                                            {month.hasActual ? dashboardPct(month.monthlyRate) : '—'}
                                        </span>
                                    </div>
                                    <div className="mt-3 grid grid-cols-2 gap-2">
                                        {feeScope !== 'management_fee' && (
                                            <div className="liquid-workbench-month-field rounded-2xl px-3 py-2" data-tone="amber">
                                                <div className="text-xs font-black text-amber-700">年初预算</div>
                                                <div className="mt-1 font-black tabular-nums text-slate-900">
                                                    {initialBudgetMonthMap.has(month.month)
                                                        ? dashboardWan(initialBudgetMonthMap.get(month.month)!)
                                                        : '—'}
                                                </div>
                                            </div>
                                        )}
                                        <div className="liquid-workbench-month-field rounded-2xl px-3 py-2" data-tone="blue">
                                            <div className="text-xs font-black text-blue-700">{scopeLabels.contractCol}</div>
                                            <div className="mt-1 font-black tabular-nums text-slate-900">{dashboardWan(month.budget)}</div>
                                        </div>
                                        <div className="liquid-workbench-month-field rounded-2xl px-3 py-2" data-tone="cyan">
                                            <div className="text-xs font-black text-cyan-700">{scopeLabels.actualCol}</div>
                                            <div className="mt-1 font-black tabular-nums text-slate-950">
                                                {month.hasActual ? dashboardWan(month.actual!) : <span className="text-slate-500">-</span>}
                                            </div>
                                        </div>
                                        <div className="liquid-workbench-month-field rounded-2xl px-3 py-2">
                                            <div className="text-xs font-black text-slate-500">去年同期</div>
                                            <div className="mt-1 font-black tabular-nums text-slate-700">{dashboardWan(month.prevActual)}</div>
                                        </div>
                                        <div className="liquid-workbench-month-field rounded-2xl px-3 py-2">
                                            <div className="text-xs font-black text-slate-500">同比</div>
                                            <div className={`mt-1 font-black tabular-nums ${month.hasActual && month.prevActual > 0 ? (month.yoy >= 0 ? 'text-blue-700' : 'text-rose-600') : 'text-slate-500'}`}>
                                                {month.hasActual && month.prevActual > 0
                                                    ? `${month.yoy > 0 ? '+' : ''}${dashboardPct(month.yoy)}`
                                                    : '-'}
                                            </div>
                                        </div>
                                        <div className="liquid-workbench-month-field rounded-2xl px-3 py-2">
                                            <div className="text-xs font-black text-slate-500">累计达成</div>
                                            <span className={`liquid-workbench-rate-pill mt-1 inline-flex min-w-[54px] items-center justify-center rounded-full px-2.5 py-1 text-xs font-black ${workbenchCumulativeToneClass(month.hasActual, month.cumulativeProgress)}`}>
                                                {month.hasActual ? dashboardPct(month.cumulativeProgress) : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </article>
                            ))}
                            <div className="liquid-workbench-mobile-total rounded-[20px] p-3 text-white">
                                <div className="flex items-center justify-between gap-3">
                                    <span className="text-xs font-black text-white/90">合计</span>
                                    <span className="text-sm font-black tabular-nums">{dashboardWan(budgetExecutionTotal.totalBudget)}</span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                                    <div>
                                        <div className="font-semibold text-white/80">已收</div>
                                        <div className="mt-0.5 font-black tabular-nums">
                                            {budgetExecutionTotal.hasActual ? dashboardWan(budgetExecutionTotal.totalActual) : '-'}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="font-semibold text-white/80">累计达成</div>
                                        <div className="mt-0.5 font-black tabular-nums">
                                            {budgetExecutionTotal.hasActual ? dashboardPct(budgetExecutionTotal.cumulativeProgress) : '-'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="hidden overflow-x-auto sm:block">
                        <table className="w-full text-xs min-w-[720px]">
                            <thead>
                                <tr className="liquid-workbench-sticky">
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-center font-semibold text-slate-700 whitespace-nowrap">月份</th>
                                    {feeScope !== 'management_fee' && (
                                        <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-amber-700 whitespace-nowrap" data-tone="amber">年初预算</th>
                                    )}
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-blue-700 whitespace-nowrap" data-tone="blue">{scopeLabels.contractCol}</th>
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-cyan-700 whitespace-nowrap" data-tone="cyan">{scopeLabels.actualCol}</th>
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-slate-700 hidden sm:table-cell whitespace-nowrap">去年同期</th>
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">同比</th>
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-center font-semibold text-slate-700 whitespace-nowrap">完成率</th>
                                    <th className="liquid-workbench-head-cell px-3 py-2.5 text-right font-semibold text-slate-700 hidden sm:table-cell whitespace-nowrap">累计达成</th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthlyBreakdown.map((month) => (
                                    <tr key={month.month} className="liquid-workbench-row transition-colors">
                                        <td className="liquid-workbench-cell px-3 py-2.5 font-medium text-slate-800 text-center">{month.monthName}</td>
                                        {feeScope !== 'management_fee' && (
                                            <td className="liquid-workbench-cell px-3 py-2.5 text-right text-slate-500 tabular-nums whitespace-nowrap" data-tone="amber">
                                                {initialBudgetMonthMap.has(month.month)
                                                    ? dashboardWan(initialBudgetMonthMap.get(month.month)!)
                                                    : '—'}
                                            </td>
                                        )}
                                        <td className="liquid-workbench-cell px-3 py-2.5 text-right text-slate-600 tabular-nums whitespace-nowrap" data-tone="blue">
                                            {dashboardWan(month.budget)}
                                        </td>
                                        <td className="liquid-workbench-cell px-3 py-2.5 text-right font-semibold text-slate-900 tabular-nums whitespace-nowrap" data-tone="cyan">
                                            {month.hasActual ? dashboardWan(month.actual!) : <span className="text-slate-500">-</span>}
                                        </td>
                                        <td className="liquid-workbench-cell hidden whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-500 sm:table-cell">
                                            {dashboardWan(month.prevActual)}
                                        </td>
                                        <td className="liquid-workbench-cell px-3 py-2.5 text-right whitespace-nowrap">
                                            {month.hasActual && month.prevActual > 0 ? (
                                                <span className={`font-medium ${month.yoy >= 0 ? 'text-blue-600' : 'text-rose-500'}`}>
                                                    {month.yoy > 0 ? '+' : ''}{dashboardPct(month.yoy)}
                                                </span>
                                            ) : <span className="text-slate-500">-</span>}
                                        </td>
                                        <td className="liquid-workbench-cell px-3 py-2.5 text-center whitespace-nowrap">
                                            <span className={`liquid-workbench-rate-pill inline-flex min-w-[48px] items-center justify-center rounded-full px-2 py-1 text-xs font-bold ${workbenchRateToneClass(month.hasActual, month.monthlyRate)}`}>
                                                {month.hasActual ? dashboardPct(month.monthlyRate) : '—'}
                                            </span>
                                        </td>
                                        <td className="liquid-workbench-cell px-3 py-2.5 text-right font-medium hidden sm:table-cell whitespace-nowrap" data-divider="left">
                                            {month.hasActual ? (
                                                <span className={`liquid-workbench-rate-pill rounded-full px-2 py-0.5 text-xs font-bold ${workbenchCumulativeToneClass(month.hasActual, month.cumulativeProgress)}`}>
                                                    {dashboardPct(month.cumulativeProgress)}
                                                </span>
                                            ) : <span className="text-slate-500">-</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="liquid-workbench-total-row text-white">
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 font-bold text-center">合计</td>
                                    {feeScope !== 'management_fee' && (
                                        <td className="liquid-workbench-total-cell px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap" data-tone="amber">
                                            {initialBudgetFooterSum > 0 ? dashboardWan(initialBudgetFooterSum) : '—'}
                                        </td>
                                    )}
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap" data-tone="blue">
                                        {dashboardWan(budgetExecutionTotal.totalBudget)}
                                    </td>
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 text-right font-bold tabular-nums whitespace-nowrap" data-tone="cyan">
                                        {budgetExecutionTotal.hasActual ? dashboardWan(budgetExecutionTotal.totalActual) : <span className="text-slate-500">-</span>}
                                    </td>
                                    <td className="liquid-workbench-total-cell hidden whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums text-slate-500 sm:table-cell">
                                        {dashboardWan(budgetExecutionTotal.yearPrevActual)}
                                    </td>
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 text-right whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual && budgetExecutionTotal.comparablePrevActual > 0 ? (
                                            <span className={`text-xs font-bold ${budgetExecutionTotal.yoy >= 0 ? 'text-cyan-200' : 'text-rose-300'}`}>
                                                {budgetExecutionTotal.yoy > 0 ? '+' : ''}{dashboardPct(budgetExecutionTotal.yoy)}
                                            </span>
                                        ) : <span className="text-slate-500">-</span>}
                                    </td>
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 text-center whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual ? (
                                            <span className="liquid-workbench-total-pill inline-flex items-center rounded-full px-2 py-1 text-xs font-bold text-white">
                                                {dashboardPct(budgetExecutionTotal.monthlyRate)}
                                            </span>
                                        ) : <span className="text-slate-500">-</span>}
                                    </td>
                                    <td className="liquid-workbench-total-cell px-3 py-2.5 text-right font-bold hidden sm:table-cell whitespace-nowrap" data-divider="left">
                                        {budgetExecutionTotal.hasActual ? (
                                            <span className="liquid-workbench-total-pill rounded-full px-2 py-0.5 text-xs font-bold text-white">
                                                {dashboardPct(budgetExecutionTotal.cumulativeProgress)}
                                            </span>
                                        ) : <span className="text-slate-500">-</span>}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                        </div>
                    </div>
                </div>

                {/* Right: Annual Completion Visualization */}
                <div className="hidden md:flex order-2 lg:order-2 liquid-workbench-card rounded-[24px] overflow-hidden group flex-col min-w-0 transition-shadow duration-300">
                    <div className="liquid-workbench-header px-3 sm:px-4 py-3 shrink-0">
                        <h3 className="font-semibold text-xs sm:text-sm text-slate-900">年度指标完成率</h3>
                    </div>
                    <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between overflow-y-auto">
                        <div className="space-y-3.5">
                            {/* Revenue Completion */}
                            <div>
                                <div className="flex justify-between items-baseline mb-2">
                                    <span className="text-xs text-slate-600 font-medium">{scopeLabels.annualTitle}</span>
                                    <span className={`text-3xl font-bold tracking-tight tabular-nums ${
                                        annualScopeMetrics.progress >= 100 ? 'text-cyan-700' :
                                        annualScopeMetrics.progress >= 80 ? 'text-blue-600' :
                                        'text-amber-600'
                                    }`}>
                                        {formatPercent(annualScopeMetrics.progress)}
                                    </span>
                                </div>
                                <div className="liquid-workbench-progress w-full rounded-full h-3 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${
                                            annualScopeMetrics.progress >= 100 ? 'bg-gradient-to-r from-cyan-400 to-blue-500' :
                                            annualScopeMetrics.progress >= 80 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                                            'bg-gradient-to-r from-amber-400 to-amber-600'
                                        }`}
                                        style={{ width: `${Math.min(100, annualScopeMetrics.progress)}%` }}
                                    ></div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                                    <div className="liquid-workbench-mini-card rounded-2xl p-2.5">
                                        <div className="text-slate-500 mb-0.5">{scopeLabels.completedLabel}</div>
                                        <div className="font-bold text-blue-700">{formatWanCurrency(annualScopeMetrics.collected)}</div>
                                    </div>
                                    <div className="liquid-workbench-mini-card rounded-2xl p-2.5">
                                        <div className="text-slate-500 mb-0.5">{scopeLabels.remainingLabel}</div>
                                        <div className="font-bold text-slate-700">{annualScopeMetrics.goal > 0
                                                ? formatWanCurrency(Math.max(0, annualScopeMetrics.goal - annualScopeMetrics.collected))
                                                : '—'}</div>
                                    </div>
                                </div>
                            </div>

                            {/* Occupancy Target */}
                            <div className="relative">
                                <div className="flex justify-between items-baseline mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-slate-600 font-medium">出租率</span>
                                        <button 
                                            onClick={() => onEditTargets('occupancy')}
                                            className="liquid-glass-control liquid-pressable rounded-full p-1 text-slate-500 opacity-0 transition-colors hover:text-blue-600 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 group-hover:opacity-100"
                                            title="编辑目标"
                                        >
                                            <Edit3 size={12} />
                                        </button>
                                    </div>
                                    <span className={`text-3xl font-bold tracking-tight tabular-nums ${
                                        occupancyGap <= 0 ? 'text-cyan-700' :
                                        occupancyGap <= 5 ? 'text-blue-600' :
                                        'text-amber-600'
                                    }`}>
                                        {formatPercent(data.occupancyRate)}
                                    </span>
                                </div>
                                <div className="liquid-workbench-progress w-full rounded-full h-3 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${
                                            occupancyGap <= 0 ? 'bg-gradient-to-r from-cyan-400 to-blue-500' :
                                            occupancyGap <= 5 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                                            'bg-gradient-to-r from-amber-400 to-amber-600'
                                        }`}
                                        style={{ width: `${data.occupancyRate}%` }}
                                    ></div>
                                </div>
                                <div className="flex justify-between text-xs text-slate-500 mt-2">
                                    <span>目标: {formatPercent(data.annualOccupancyTarget)}</span>
                                    <span className={occupancyGap > 0 ? 'text-amber-600 font-medium' : 'text-cyan-700 font-medium'}>
                                        {occupancyGap > 0 ? `差 ${formatPercent(occupancyGap)}` : '✓ 已达标'}
                                    </span>
                                </div>
                            </div>

                            {/* 累计欠款 */}
                            <div>
                                <div className="flex justify-between items-baseline mb-2">
                                    <span className="text-xs text-slate-600 font-medium">累计欠款</span>
                                    <span className={`text-xl font-bold tabular-nums ${
                                        data.accumulatedArrears === 0 ? 'text-cyan-700' :
                                        data.accumulatedArrears < 100000 ? 'text-amber-600' :
                                        'text-rose-600'
                                    }`}>
                                        {formatWanCurrency(data.accumulatedArrears)}
                                    </span>
                                </div>
                                <div className="text-xs mt-2">
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                                        data.accumulatedArrears === 0 ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200/70' :
                                        data.accumulatedArrears < 100000 ? 'bg-amber-50 text-amber-700 ring-1 ring-amber-200/70' :
                                        'bg-rose-50 text-rose-700 ring-1 ring-rose-200/70'
                                    }`}>
                                        {data.accumulatedArrears === 0 ? '✓ 无欠款' : `⚠ 待核销账单`}
                                    </span>
                                </div>
                                <div className="mt-0.5 text-xs font-semibold text-slate-500">
                                    2026年1月1日起所有未核销账单
                                </div>
                            </div>

                            {/* 租赁动态 */}
                            <div className="pt-2 border-t border-slate-200/70">
                                <h4 className="text-xs font-semibold text-slate-700 mb-3">租赁维度择取</h4>
                                
                                {/* Tab切换 */}
                                <div className="liquid-workbench-segment rounded-2xl p-1 mb-3 grid grid-cols-3 gap-1">
                                    <button 
                                        onClick={() => setLeasePeriod('year')}
                                        className={leasePeriodButtonClass('year')}
                                    >
                                        本年度
                                    </button>
                                    <button 
                                        onClick={() => setLeasePeriod('quarter')}
                                        className={leasePeriodButtonClass('quarter')}
                                    >
                                        本季度
                                    </button>
                                    <button 
                                        onClick={() => setLeasePeriod('month')}
                                        className={leasePeriodButtonClass('month')}
                                    >
                                        本月
                                    </button>
                                </div>
                                
                                {/* 净增长大卡片 - 根据选中的维度显示数据 */}
                                <div className={`rounded-[22px] p-4 mb-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.28),0_18px_42px_rgba(15,23,42,0.12)] ${
                                    (leasePeriod === 'year' ? leaseStats.netIncreaseYear : 
                                     leasePeriod === 'quarter' ? leaseStats.netIncreaseQuarter : 
                                     leaseStats.netIncreaseMonth) >= 0 
                                        ? 'liquid-workbench-hero-positive'
                                        : 'liquid-workbench-hero-negative'
                                }`}>
                                    <div className="flex items-center gap-2 mb-1">
                                        <TrendingUp size={16} className="text-white/80" />
                                        <span className="text-xs text-white/90 font-medium uppercase tracking-wide">NET GROWTH</span>
                                    </div>
                                    <div className="mb-3">
                                        <div className="text-sm text-white/80 mb-1">期间净增长面积</div>
                                        <div className="text-3xl font-bold text-white tabular-nums">
                                            {leasePeriod === 'year' ? (
                                                <>{leaseStats.netIncreaseYear >= 0 ? '+' : ''}{formatArea(leaseStats.netIncreaseYear).replace('㎡', '')}</>
                                            ) : leasePeriod === 'quarter' ? (
                                                <>{leaseStats.netIncreaseQuarter >= 0 ? '+' : ''}{formatArea(leaseStats.netIncreaseQuarter).replace('㎡', '')}</>
                                            ) : (
                                                <>{leaseStats.netIncreaseMonth >= 0 ? '+' : ''}{formatArea(leaseStats.netIncreaseMonth).replace('㎡', '')}</>
                                            )}
                                            <span className="text-lg ml-1">㎡</span>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-white/90 text-xs">
                                        <div className="flex items-center gap-1">
                                            <UserPlus size={14} className="flex-shrink-0" />
                                            <span>
                                                新租 {leasePeriod === 'year' ? formatArea(leaseStats.newLeasesYearArea) :
                                                     leasePeriod === 'quarter' ? formatArea(leaseStats.newLeasesQuarterArea) :
                                                     formatArea(leaseStats.newLeasesMonthArea)}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <UserMinus size={14} className="flex-shrink-0" />
                                            <span>
                                                退租 {leasePeriod === 'year' ? formatArea(leaseStats.terminatedYearArea) :
                                                     leasePeriod === 'quarter' ? formatArea(leaseStats.terminatedQuarterArea) :
                                                     formatArea(leaseStats.terminatedMonthArea)}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                        
                        {/* Summary Stats at Bottom */}
                        <div className="mt-5 pt-4 border-t border-slate-200/70">
                            <div className="text-xs text-slate-500 text-center">
                                数据截至 {new Date().toLocaleDateString('zh-CN')}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>


    </div>
  );
};
