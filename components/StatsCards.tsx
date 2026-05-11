
import React, { useMemo } from 'react';
import { TrendingUp, TrendingDown, Target, Edit3, CalendarRange, UserPlus, UserMinus } from 'lucide-react';
import { DashboardData, Tenant, ContractStatus } from '../types';
import { formatArea, formatPercent, formatWan } from '../services/numberFormat';

interface StatsCardsProps {
  data: DashboardData;
  onEditTargets: (type: 'revenue' | 'occupancy') => void;
  selectedYear: number;
  tenants: Tenant[]; // 新增：用于计算新租退租数据
}

export const StatsCards: React.FC<StatsCardsProps> = ({ data, onEditTargets, selectedYear, tenants }) => {
  // 租赁维度切换状态：'year' | 'quarter' | 'month'
  const [leasePeriod, setLeasePeriod] = React.useState<'year' | 'quarter' | 'month'>('year');

  const formatWanCurrency = formatWan;
  /** 工作台「预算执行」表：万元、百分比取整 */
  const dashboardWan = (v: number | null | undefined) => formatWan(v, 0);
  const dashboardPct = (v: number | null | undefined) => formatPercent(v, 0);

  const annualProgress = data.annualRevenueTarget > 0 ? Math.min(100, (data.annualRevenueCollected / data.annualRevenueTarget) * 100) : 0;

  // 年初预算：年度合计来自 yearlyTargets；按月数值来自 initializationData.initialBudget（元）
  const yearTarget = (data.yearlyTargets || {})[selectedYear] || {};
  const annualInitialBudget = (yearTarget as { revenue?: number; occupancy?: number; initialBudget?: number }).initialBudget || 0;

  const initialBudgetMonthMap = useMemo(() => {
      const map = new Map<number, number>();
      for (const d of data.initializationData || []) {
          if (d.year !== selectedYear) continue;
          if (d.initialBudget == null || !Number.isFinite(Number(d.initialBudget))) continue;
          map.set(d.month, Number(d.initialBudget));
      }
      return map;
  }, [data.initializationData, selectedYear]);

  const hasMonthlyInitialBudget = initialBudgetMonthMap.size > 0;
  const initialBudgetFooterSum = useMemo(() => {
      if (hasMonthlyInitialBudget) {
          let sum = 0;
          for (let m = 1; m <= 12; m++) sum += initialBudgetMonthMap.get(m) ?? 0;
          return sum;
      }
      return annualInitialBudget;
  }, [hasMonthlyInitialBudget, initialBudgetMonthMap, annualInitialBudget]);

  // Occupancy Target Gap
  const occupancyGap = data.annualOccupancyTarget - data.occupancyRate;

  const isNetNegative = data.netIncreaseArea < 0;

  // 计算新租、退租数据（含数量和面积）- 使用selectedYear而非当前年份
  const leaseStats = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth(); // 0-11
    const currentQuarter = Math.floor(currentMonth / 3); // 0-3

    // 计算当期新租（根据 signingDate 签约时间）
    const newLeasesYearList = tenants.filter(t => {
      if (!t.signingDate) return false;
      const signingDate = new Date(t.signingDate);
      return signingDate.getFullYear() === selectedYear;
    });
    const newLeasesYear = newLeasesYearList.length;
    const newLeasesYearArea = newLeasesYearList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    const newLeasesQuarterList = tenants.filter(t => {
      if (!t.signingDate) return false;
      const signingDate = new Date(t.signingDate);
      return signingDate.getFullYear() === selectedYear && 
             Math.floor(signingDate.getMonth() / 3) === currentQuarter;
    });
    const newLeasesQuarter = newLeasesQuarterList.length;
    const newLeasesQuarterArea = newLeasesQuarterList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    const newLeasesMonthList = tenants.filter(t => {
      if (!t.signingDate) return false;
      const signingDate = new Date(t.signingDate);
      return signingDate.getFullYear() === selectedYear && 
             signingDate.getMonth() === currentMonth;
    });
    const newLeasesMonth = newLeasesMonthList.length;
    const newLeasesMonthArea = newLeasesMonthList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    // 计算当期退租（根据 terminationDate 或 leaseEnd）
    const terminatedYearList = tenants.filter(t => {
      if (t.status !== ContractStatus.Terminated) return false;
      const endDate = new Date(t.terminationDate || t.leaseEnd);
      return endDate.getFullYear() === selectedYear;
    });
    const terminatedYear = terminatedYearList.length;
    const terminatedYearArea = terminatedYearList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    const terminatedQuarterList = tenants.filter(t => {
      if (t.status !== ContractStatus.Terminated) return false;
      const endDate = new Date(t.terminationDate || t.leaseEnd);
      return endDate.getFullYear() === selectedYear && 
             Math.floor(endDate.getMonth() / 3) === currentQuarter;
    });
    const terminatedQuarter = terminatedQuarterList.length;
    const terminatedQuarterArea = terminatedQuarterList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    const terminatedMonthList = tenants.filter(t => {
      if (t.status !== ContractStatus.Terminated) return false;
      const endDate = new Date(t.terminationDate || t.leaseEnd);
      return endDate.getFullYear() === selectedYear && 
             endDate.getMonth() === currentMonth;
    });
    const terminatedMonth = terminatedMonthList.length;
    const terminatedMonthArea = terminatedMonthList.reduce((sum, t) => sum + (t.totalArea || 0), 0);

    // 计算净增加面积（可为负数）
    const netIncreaseYear = newLeasesYearArea - terminatedYearArea;
    const netIncreaseQuarter = newLeasesQuarterArea - terminatedQuarterArea;
    const netIncreaseMonth = newLeasesMonthArea - terminatedMonthArea;

    return {
      newLeasesYear,
      newLeasesYearArea,
      newLeasesQuarter,
      newLeasesQuarterArea,
      newLeasesMonth,
      newLeasesMonthArea,
      terminatedYear,
      terminatedYearArea,
      terminatedQuarter,
      terminatedQuarterArea,
      terminatedMonth,
      terminatedMonthArea,
      netIncreaseYear,
      netIncreaseQuarter,
      netIncreaseMonth
    };
  }, [tenants, selectedYear]);

  // Calculate Monthly Breakdown Data with YoY comparison
  const monthlyBreakdown = useMemo(() => {
      let cumulativeCollected = 0;
      let cumulativeBudget = 0;
      return Array.from({ length: 12 }, (_, i) => {
          const trend = data.monthlyTrends[i];
          const contractReceivable = trend?.contractReceivable ?? trend?.revenueTarget ?? 0;
          const budget = contractReceivable;
          const actual = trend?.revenueCollected || 0;
          const hasActual = trend?.revenueCollected !== null;
          
          if (hasActual) {
              cumulativeCollected += actual;
          }
          cumulativeBudget += budget;

          const monthlyRate = budget > 0 && hasActual ? (actual / budget) * 100 : 0;
          const cumulativeProgress = cumulativeBudget > 0 ? (cumulativeCollected / cumulativeBudget) * 100 : 0;

          // Get previous year data for YoY comparison
          const prevYearData = data.prevYearMonthlyTrends?.[i];
          const prevActual = prevYearData?.revenueCollected || 0;
          let yoy = 0;
          if (prevActual > 0 && hasActual) {
              yoy = ((actual - prevActual) / prevActual) * 100;
          }

          return {
              month: i + 1,
              monthName: trend?.month || `${i + 1}月`,
              budget,
              actual: hasActual ? actual : null,
              monthlyRate,
              cumulativeProgress,
              hasActual,
              prevActual,
              yoy
          };
      });
  }, [data.monthlyTrends, data.prevYearMonthlyTrends]);

  const budgetExecutionTotal = useMemo(() => {
      const totalBudget = monthlyBreakdown.reduce((sum, month) => sum + month.budget, 0);
      const actualMonths = monthlyBreakdown.filter(month => month.hasActual);
      const actualBudget = actualMonths.reduce((sum, month) => sum + month.budget, 0);
      const totalActual = actualMonths.reduce((sum, month) => sum + (month.actual || 0), 0);
      const comparablePrevActual = actualMonths.reduce((sum, month) => sum + month.prevActual, 0);
      const yearPrevActual = monthlyBreakdown.reduce((sum, month) => sum + month.prevActual, 0);

      return {
          totalBudget,
          totalActual,
          comparablePrevActual,
          yearPrevActual,
          monthlyRate: actualBudget > 0 ? (totalActual / actualBudget) * 100 : 0,
          cumulativeProgress: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
          yoy: comparablePrevActual > 0 ? ((totalActual - comparablePrevActual) / comparablePrevActual) * 100 : 0,
          hasActual: actualMonths.length > 0,
      };
  }, [monthlyBreakdown]);

  return (
    <div className="space-y-4 md:space-y-6">
        {/* Annual Goal Card with Monthly Breakdown Below */}
        <div className="space-y-4">
            {/* Monthly Breakdown Table - Integrated Budget Execution */}
            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4 items-stretch">
                {/* Left: Table */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden min-w-0 flex flex-col hover:shadow-md transition-shadow duration-300">
                    <div className="bg-gradient-to-r from-emerald-50 to-emerald-100 px-4 sm:px-5 py-2.5 border-b border-emerald-200">
                        <div className="flex flex-wrap items-center gap-2 text-emerald-800 min-w-0">
                            <CalendarRange size={16} className="shrink-0" />
                            <h3 className="font-bold text-xs sm:text-sm">预算执行</h3>
                            <span className="text-[10px] font-semibold bg-emerald-600 text-white px-1.5 py-0.5 rounded shrink-0">实时</span>
                        </div>
                    </div>
                    <div className="overflow-x-auto min-w-0 flex-1">
                        <table className="w-full text-xs min-w-[720px]">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    <th className="px-3 py-2.5 text-center font-semibold text-slate-700 whitespace-nowrap">月份</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-amber-700 bg-amber-50/30 whitespace-nowrap">年初预算</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-blue-700 bg-blue-50/30 whitespace-nowrap">合同应收</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-emerald-700 bg-emerald-50/30 whitespace-nowrap">实际收款</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-slate-700 hidden sm:table-cell whitespace-nowrap">去年同期</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-slate-700 whitespace-nowrap">同比</th>
                                    <th className="px-3 py-2.5 text-center font-semibold text-slate-700 whitespace-nowrap">完成率</th>
                                    <th className="px-3 py-2.5 text-right font-semibold text-slate-700 border-l border-slate-200 hidden sm:table-cell whitespace-nowrap">累计达成</th>
                                </tr>
                            </thead>
                            <tbody>
                                {monthlyBreakdown.map((month) => (
                                    <tr key={month.month} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                        <td className="px-3 py-2.5 font-medium text-slate-800 text-center">{month.monthName}</td>
                                        <td className="px-3 py-2.5 text-right text-slate-500 tabular-nums bg-amber-50/10 whitespace-nowrap">
                                            {initialBudgetMonthMap.has(month.month)
                                                ? dashboardWan(initialBudgetMonthMap.get(month.month)!)
                                                : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-slate-600 tabular-nums bg-blue-50/10 whitespace-nowrap">
                                            {dashboardWan(month.budget)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-semibold text-slate-800 tabular-nums bg-emerald-50/10 whitespace-nowrap">
                                            {month.hasActual ? dashboardWan(month.actual!) : <span className="text-slate-300">-</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-right text-slate-400 tabular-nums hidden sm:table-cell whitespace-nowrap">
                                            {dashboardWan(month.prevActual)}
                                        </td>
                                        <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                            {month.hasActual && month.prevActual > 0 ? (
                                                <span className={`font-medium ${month.yoy >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                                    {month.yoy > 0 ? '+' : ''}{dashboardPct(month.yoy)}
                                                </span>
                                            ) : <span className="text-slate-300">-</span>}
                                        </td>
                                        <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                            <span className={`inline-flex items-center justify-center min-w-[48px] px-2 py-1 rounded-full text-[11px] font-bold ${
                                                month.hasActual
                                                    ? month.monthlyRate >= 100 ? 'bg-emerald-100 text-emerald-700' :
                                                      month.monthlyRate >= 80 ? 'bg-blue-100 text-blue-700' :
                                                      'bg-amber-100 text-amber-700'
                                                    : 'text-slate-300'
                                            }`}>
                                                {month.hasActual ? dashboardPct(month.monthlyRate) : '—'}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2.5 text-right font-medium border-l border-slate-200 hidden sm:table-cell whitespace-nowrap">
                                            {month.hasActual ? (
                                                <span className={`text-[11px] px-2 py-0.5 rounded font-bold ${month.cumulativeProgress >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                                                    {dashboardPct(month.cumulativeProgress)}
                                                </span>
                                            ) : <span className="text-slate-300">-</span>}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-800 text-white border-t-2 border-slate-600">
                                    <td className="px-3 py-2.5 font-bold text-center">合计</td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums bg-amber-500/10 whitespace-nowrap">
                                        {initialBudgetFooterSum > 0 ? dashboardWan(initialBudgetFooterSum) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums bg-blue-500/10 whitespace-nowrap">
                                        {dashboardWan(budgetExecutionTotal.totalBudget)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold tabular-nums bg-emerald-500/10 whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual ? dashboardWan(budgetExecutionTotal.totalActual) : <span className="text-slate-400">-</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-slate-300 tabular-nums hidden sm:table-cell whitespace-nowrap">
                                        {dashboardWan(budgetExecutionTotal.yearPrevActual)}
                                    </td>
                                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual && budgetExecutionTotal.comparablePrevActual > 0 ? (
                                            <span className={`text-xs font-bold ${budgetExecutionTotal.yoy >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                                                {budgetExecutionTotal.yoy > 0 ? '+' : ''}{dashboardPct(budgetExecutionTotal.yoy)}
                                            </span>
                                        ) : <span className="text-slate-400">-</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-center whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual ? (
                                            <span className="inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold bg-white/15 text-white">
                                                {dashboardPct(budgetExecutionTotal.monthlyRate)}
                                            </span>
                                        ) : <span className="text-slate-400">-</span>}
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-bold border-l border-slate-700 hidden sm:table-cell whitespace-nowrap">
                                        {budgetExecutionTotal.hasActual ? (
                                            <span className="text-[11px] px-2 py-0.5 rounded font-bold bg-white/15 text-white">
                                                {dashboardPct(budgetExecutionTotal.cumulativeProgress)}
                                            </span>
                                        ) : <span className="text-slate-400">-</span>}
                                    </td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                </div>

                {/* Right: Annual Completion Visualization */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden group flex flex-col min-w-0 hover:shadow-md transition-shadow duration-300">
                    <div className="bg-gradient-to-r from-blue-50 to-blue-100 px-3 sm:px-4 py-2.5 border-b border-blue-200 shrink-0">
                        <h3 className="font-semibold text-xs sm:text-sm text-slate-800">年度指标完成率</h3>
                    </div>
                    <div className="p-3 sm:p-4 flex-1 flex flex-col justify-between overflow-y-auto">
                        <div className="space-y-3.5">
                            {/* Revenue Completion */}
                            <div>
                                <div className="flex justify-between items-baseline mb-2">
                                    <span className="text-xs text-slate-600 font-medium">营收达成</span>
                                    <span className={`text-3xl font-bold tracking-tight tabular-nums ${
                                        annualProgress >= 100 ? 'text-emerald-600' :
                                        annualProgress >= 80 ? 'text-blue-600' :
                                        'text-amber-600'
                                    }`}>
                                        {formatPercent(annualProgress)}
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${
                                            annualProgress >= 100 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' :
                                            annualProgress >= 80 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                                            'bg-gradient-to-r from-amber-400 to-amber-600'
                                        }`}
                                        style={{ width: `${Math.min(100, annualProgress)}%` }}
                                    ></div>
                                </div>
                                <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                                    <div className="bg-blue-50 rounded-lg p-2">
                                        <div className="text-slate-500 mb-0.5">已完成(万元)</div>
                                        <div className="font-bold text-blue-700">{formatWanCurrency(data.annualRevenueCollected)}</div>
                                    </div>
                                    <div className="bg-slate-50 rounded-lg p-2">
                                        <div className="text-slate-500 mb-0.5">剩余目标(万元)</div>
                                        <div className="font-bold text-slate-700">{formatWanCurrency(data.annualRevenueTarget - data.annualRevenueCollected)}</div>
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
                                            className="p-1 text-slate-300 hover:text-blue-500 transition-colors opacity-0 group-hover:opacity-100"
                                            title="编辑目标"
                                        >
                                            <Edit3 size={12} />
                                        </button>
                                    </div>
                                    <span className={`text-3xl font-bold tracking-tight tabular-nums ${
                                        occupancyGap <= 0 ? 'text-emerald-600' :
                                        occupancyGap <= 5 ? 'text-blue-600' :
                                        'text-amber-600'
                                    }`}>
                                        {formatPercent(data.occupancyRate)}
                                    </span>
                                </div>
                                <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${
                                            occupancyGap <= 0 ? 'bg-gradient-to-r from-emerald-400 to-emerald-600' :
                                            occupancyGap <= 5 ? 'bg-gradient-to-r from-blue-400 to-blue-600' :
                                            'bg-gradient-to-r from-amber-400 to-amber-600'
                                        }`}
                                        style={{ width: `${data.occupancyRate}%` }}
                                    ></div>
                                </div>
                                <div className="flex justify-between text-xs text-slate-500 mt-2">
                                    <span>目标: {formatPercent(data.annualOccupancyTarget)}</span>
                                    <span className={occupancyGap > 0 ? 'text-amber-600 font-medium' : 'text-emerald-600 font-medium'}>
                                        {occupancyGap > 0 ? `差 ${formatPercent(occupancyGap)}` : '✓ 已达标'}
                                    </span>
                                </div>
                            </div>

                            {/* 累计欠款 */}
                            <div>
                                <div className="flex justify-between items-baseline mb-2">
                                    <span className="text-xs text-slate-600 font-medium">累计欠款</span>
                                    <span className={`text-xl font-bold tabular-nums ${
                                        data.accumulatedArrears === 0 ? 'text-emerald-600' :
                                        data.accumulatedArrears < 100000 ? 'text-amber-600' :
                                        'text-rose-600'
                                    }`}>
                                        {formatWanCurrency(data.accumulatedArrears)}
                                    </span>
                                </div>
                                <div className="text-xs mt-2">
                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${
                                        data.accumulatedArrears === 0 ? 'bg-emerald-50 text-emerald-700' :
                                        data.accumulatedArrears < 100000 ? 'bg-amber-50 text-amber-700' :
                                        'bg-rose-50 text-rose-700'
                                    }`}>
                                        {data.accumulatedArrears === 0 ? '✓ 无欠款' : `⚠ 待核销账单`}
                                    </span>
                                </div>
                                <div className="text-[10px] text-slate-400 mt-0.5">
                                    2026年1月1日起所有未核销账单
                                </div>
                            </div>

                            {/* 租赁动态 */}
                            <div className="pt-2 border-t border-slate-100">
                                <h4 className="text-xs font-semibold text-slate-700 mb-3">租赁维度择取</h4>
                                
                                {/* Tab切换 */}
                                <div className="bg-slate-50 rounded-lg p-1 mb-3 grid grid-cols-3 gap-1">
                                    <button 
                                        onClick={() => setLeasePeriod('year')}
                                        className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                                            leasePeriod === 'year' 
                                                ? 'bg-blue-600 text-white shadow-sm' 
                                                : 'text-slate-600 hover:bg-white'
                                        }`}
                                    >
                                        本年度
                                    </button>
                                    <button 
                                        onClick={() => setLeasePeriod('quarter')}
                                        className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                                            leasePeriod === 'quarter' 
                                                ? 'bg-blue-600 text-white shadow-sm' 
                                                : 'text-slate-600 hover:bg-white'
                                        }`}
                                    >
                                        本季度
                                    </button>
                                    <button 
                                        onClick={() => setLeasePeriod('month')}
                                        className={`px-3 py-1.5 rounded text-xs font-semibold transition-all ${
                                            leasePeriod === 'month' 
                                                ? 'bg-blue-600 text-white shadow-sm' 
                                                : 'text-slate-600 hover:bg-white'
                                        }`}
                                    >
                                        本月
                                    </button>
                                </div>
                                
                                {/* 净增长大卡片 - 根据选中的维度显示数据 */}
                                <div className={`rounded-xl p-4 mb-3 ${
                                    (leasePeriod === 'year' ? leaseStats.netIncreaseYear : 
                                     leasePeriod === 'quarter' ? leaseStats.netIncreaseQuarter : 
                                     leaseStats.netIncreaseMonth) >= 0 
                                        ? 'bg-gradient-to-br from-blue-500 to-blue-600' 
                                        : 'bg-gradient-to-br from-orange-500 to-orange-600'
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
                        <div className="mt-5 pt-4 border-t border-slate-100">
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
