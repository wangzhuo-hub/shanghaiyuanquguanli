
import React from 'react';
import { DashboardData, ContractStatus } from '../types';
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Target, Activity } from 'lucide-react';
import { formatArea, formatPercent, formatWan } from '../services/numberFormat';
import { useMinMdViewport } from '../hooks/useMediaQuery';

const StatusBadge: React.FC<{ status: ContractStatus }> = ({ status }) => {
  const styles = {
    [ContractStatus.Active]: 'bg-blue-100/80 text-blue-700 ring-1 ring-blue-200/80',
    [ContractStatus.Expiring]: 'bg-amber-100/85 text-amber-700 ring-1 ring-amber-200/80',
    [ContractStatus.Terminated]: 'bg-rose-100/85 text-rose-700 ring-1 ring-rose-200/80',
    [ContractStatus.Pending]: 'bg-cyan-100/80 text-cyan-700 ring-1 ring-cyan-200/80',
    [ContractStatus.Expired]: 'bg-slate-100/85 text-slate-500 ring-1 ring-slate-200/80',
  };

  const labels = {
    [ContractStatus.Active]: '履约中',
    [ContractStatus.Expiring]: '即将到期',
    [ContractStatus.Terminated]: '已退租',
    [ContractStatus.Pending]: '签约中',
    [ContractStatus.Expired]: '已到期(历史)',
  };

  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

// Mobile Card Component for Recent Activity
const ActivityCard: React.FC<{ tenant: any, buildingName: string, unitNames: string }> = ({ tenant, buildingName, unitNames }) => (
  <div className="liquid-glass-readable liquid-pressable rounded-[18px] p-4">
     <div className="flex justify-between items-start mb-2">
         <div className="font-bold text-slate-900">{tenant.name}</div>
         <StatusBadge status={tenant.status} />
     </div>
     <div className="text-xs text-slate-500 space-y-1 min-w-0">
         <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-start sm:gap-2">
             <span className="min-w-0 break-words">位置: {buildingName} {unitNames}</span>
             <span className="font-semibold text-slate-700 shrink-0 sm:text-right">{formatArea(tenant.totalArea)}</span>
         </div>
         <div className="font-semibold text-slate-500">{tenant.leaseStart} ~ {tenant.leaseEnd}</div>
     </div>
  </div>
);

export const RecentActivityTable: React.FC<{ data: DashboardData }> = ({ data }) => {
  const isDesktop = useMinMdViewport();

  const rows = data.recentSignings.map((tenant) => {
      const building = data.buildings.find(b => b.id === tenant.buildingId);
      const unitNames = tenant.unitIds.map(uid => {
          const unit = building?.units.find(u => u.id === uid);
          return unit ? unit.name : uid;
      }).join(', ');
      return { tenant, building, unitNames };
  });

  return (
    <div className="liquid-glass-readable h-full overflow-hidden rounded-[24px]">
      <div className="liquid-glass-toolbar flex items-start justify-between gap-3 px-4 py-4 md:px-6 md:py-5">
        <div>
          <h3 className="text-lg font-black text-slate-950">最新签约动态</h3>
          <p className="mt-1 text-xs font-semibold text-slate-500">仅展示最近 1 个月内签约（优先签约日，否则起租日）</p>
        </div>
        <span className="liquid-glass-control shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-blue-700">近 1 个月</span>
      </div>
      
      {isDesktop ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="liquid-shared-table-head text-slate-500 font-bold">
            <tr>
              <th className="px-6 py-3">企业名称</th>
              <th className="px-6 py-3">位置</th>
              <th className="px-6 py-3 text-right">签约面积</th>
              <th className="px-6 py-3">租赁周期</th>
              <th className="px-6 py-3">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="liquid-shared-empty px-6 py-10 text-center text-sm font-semibold text-slate-500">近一个月内暂无签约记录</td>
              </tr>
            )}
            {rows.map(({ tenant, building, unitNames }) => (
              <tr key={tenant.id} className="transition-colors hover:bg-blue-50/35">
                <td className="px-6 py-4 font-bold text-slate-900">{tenant.name}</td>
                <td className="px-6 py-4 text-slate-600">
                  {building?.name} <span className="text-slate-500 text-xs ml-1">{unitNames}</span>
                </td>
                <td className="px-6 py-4 text-slate-900 font-black text-right">{formatArea(tenant.totalArea)}</td>
                <td className="px-6 py-4 text-slate-500">{tenant.leaseStart} 至 {tenant.leaseEnd}</td>
                <td className="px-6 py-4">
                  <StatusBadge status={tenant.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      ) : (
      <div className="space-y-2 p-2">
          {rows.map(({ tenant, building, unitNames }) => (
              <ActivityCard key={tenant.id} tenant={tenant} buildingName={building?.name || ''} unitNames={unitNames} />
          ))}
          {rows.length === 0 && <div className="p-4 text-center text-sm font-semibold text-slate-500">暂无近期签约</div>}
      </div>
      )}
    </div>
  );
};

// Mobile Card for Expiring Soon
const ExpiryCard: React.FC<{ tenant: any, daysLeft: number }> = ({ tenant, daysLeft }) => (
    <div className="liquid-glass-readable liquid-pressable flex items-center justify-between rounded-[18px] p-4">
        <div>
            <div className="font-bold text-slate-900 mb-1">{tenant.name}</div>
            <div className="text-xs text-rose-600 font-medium">到期日: {tenant.leaseEnd}</div>
        </div>
        <div className="text-right">
             <div className="mb-1 text-xs font-semibold text-slate-500">{daysLeft > 0 ? `剩 ${daysLeft} 天` : '已过期'}</div>
             <div className="text-sm font-bold text-slate-700">{formatArea(tenant.totalArea)}</div>
        </div>
    </div>
);

export const ExpiringSoonTable: React.FC<{ data: DashboardData }> = ({ data }) => {
  const totalArea = data.expiringSoon.reduce((sum, t) => sum + (t.totalArea || 0), 0);

  return (
    <div className="liquid-glass-readable h-full overflow-hidden rounded-[24px]">
      <div className="liquid-glass-toolbar flex items-center justify-between gap-3 px-4 py-4 md:px-6 md:py-5">
        <h3 className="text-lg font-black text-slate-950">到期预警</h3>
        <span className="liquid-glass-control shrink-0 rounded-full px-3 py-1.5 text-xs font-bold text-amber-700">合计空置: {formatArea(totalArea)}</span>
      </div>
      
      {/* Desktop View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="liquid-shared-table-head text-slate-500 font-bold">
            <tr>
              <th className="px-4 py-3">企业</th>
              <th className="px-4 py-3">到期日</th>
              <th className="px-4 py-3 text-right">空置面积</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60">
            {data.expiringSoon.map((tenant) => {
              const daysLeft = Math.ceil((new Date(tenant.leaseEnd).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
              return (
                <tr key={tenant.id} className="transition-colors hover:bg-amber-50/35">
                  <td className="px-4 py-4 font-bold text-slate-900">
                      <div className="truncate max-w-[120px]" title={tenant.name}>{tenant.name}</div>
                  </td>
                  <td className="px-4 py-4">
                      <div className="text-rose-600 font-medium text-xs">{tenant.leaseEnd}</div>
                      <div className="text-xs font-semibold text-slate-500">{daysLeft > 0 ? `剩 ${daysLeft} 天` : '已过期'}</div>
                  </td>
                  <td className="px-4 py-4 text-right font-black text-slate-900">
                     {formatArea(tenant.totalArea)}
                  </td>
                </tr>
              );
            })}
            {data.expiringSoon.length > 0 && (
                <tr className="liquid-shared-total-row font-bold text-white">
                    <td className="px-4 py-3" colSpan={2}>合计</td>
                    <td className="px-4 py-3 text-right">{formatArea(totalArea)}</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile View */}
      <div className="space-y-2 p-2 md:hidden">
          {data.expiringSoon.map((tenant) => {
              const daysLeft = Math.ceil((new Date(tenant.leaseEnd).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
              return <ExpiryCard key={tenant.id} tenant={tenant} daysLeft={daysLeft} />;
          })}
          {data.expiringSoon.length === 0 && <div className="p-4 text-center text-sm font-semibold text-slate-500">暂无近期到期</div>}
      </div>
    </div>
  );
};

interface BudgetExecutionProps {
    data: DashboardData;
    selectedYear?: number;
    onYearChange?: (year: number) => void;
}

export const BudgetExecutionSummaryTable: React.FC<BudgetExecutionProps> = ({ data, selectedYear, onYearChange }) => {
  let cumulativeBudget = 0;
  let cumulativeActual = 0;
  const execWan = (v: number | null | undefined) => formatWan(v, 0);
  const execPct = (v: number | null | undefined) => formatPercent(v, 0);
  
  const displayYear = selectedYear || new Date().getFullYear();
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonthIdx = now.getMonth(); 

  // Show all trends for past years, or up to 12 months for current/future (though future data will be null)
  const visibleTrends = data.monthlyTrends;
  const executionRows = visibleTrends.map((monthData, index) => {
    cumulativeBudget += monthData.revenueTarget;
    if (monthData.revenueCollected !== null) {
        cumulativeActual += monthData.revenueCollected;
    }

    const hasActual = monthData.revenueCollected !== null;
    const monthlyRate = (hasActual && monthData.revenueTarget > 0)
        ? (monthData.revenueCollected! / monthData.revenueTarget) * 100
        : 0;

    const cumulativeRate = cumulativeBudget > 0
        ? (cumulativeActual / cumulativeBudget) * 100
        : 0;

    const prevYearData = data.prevYearMonthlyTrends?.[index];
    const prevActual = prevYearData?.revenueCollected || 0;
    let yoy = 0;
    if (prevActual > 0 && hasActual) {
        yoy = ((monthData.revenueCollected! - prevActual) / prevActual) * 100;
    }

    return {
        monthData,
        index,
        hasActual,
        monthlyRate,
        cumulativeRate,
        prevActual,
        yoy,
    };
  });

  return (
    <div className="liquid-glass-readable h-full overflow-hidden rounded-[24px]">
      <div className="liquid-glass-toolbar flex items-center justify-between gap-3 px-4 py-4 md:px-6 md:py-5">
        <div>
            <div className="flex items-center gap-2 md:gap-4">
                <h3 className="text-base md:text-lg font-black text-slate-950">预算执行 (Budget vs Actual)</h3>
                <span className="liquid-glass-control hidden rounded-full px-3 py-1.5 text-xs font-bold text-blue-700 md:inline-flex">实时监控</span>
            </div>
            <div className="mt-1 text-xs font-semibold text-slate-500">数据源：生效预算方案（月度应收）</div>
        </div>
        
        {onYearChange && (
            <div className="liquid-glass-control flex items-center rounded-full p-1">
                <button 
                    onClick={() => onYearChange(displayYear - 1)} 
                    className="liquid-pressable rounded-full p-1.5 text-blue-700 hover:bg-blue-50/70"
                >
                    <ChevronDown className="rotate-90" size={16}/>
                </button>
                <span className="px-2 md:px-3 py-1 text-sm font-black text-slate-950">{displayYear}</span>
                <button 
                    onClick={() => onYearChange(displayYear + 1)} 
                    className="liquid-pressable rounded-full p-1.5 text-blue-700 hover:bg-blue-50/70"
                >
                    <ChevronRight size={16}/>
                </button>
            </div>
        )}
      </div>
      
      <div className="space-y-2 p-2 md:hidden">
        {executionRows.length > 0 ? (
            executionRows.map(({ monthData, index, hasActual, monthlyRate, cumulativeRate, prevActual, yoy }) => (
                <div key={index} className="liquid-glass-readable liquid-pressable rounded-[18px] p-4">
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-base font-black text-slate-950">{monthData.month}</div>
                            <div className="mt-0.5 text-xs font-semibold text-slate-500">预算执行月度明细</div>
                        </div>
                        <span className={`liquid-glass-control shrink-0 rounded-full px-2.5 py-1 text-xs font-black tabular-nums ${hasActual ? 'text-blue-700' : 'text-slate-500'}`}>
                            累计 {hasActual ? execPct(cumulativeRate) : '-'}
                        </span>
                    </div>
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        <div className="liquid-glass-subtle rounded-2xl p-3">
                            <div className="text-xs font-semibold text-blue-700">预算收款</div>
                            <div className="mt-1 text-lg font-black tabular-nums text-slate-950">{execWan(monthData.revenueTarget)}</div>
                        </div>
                        <div className="liquid-glass-subtle rounded-2xl p-3">
                            <div className="text-xs font-semibold text-cyan-700">实际收款</div>
                            <div className="mt-1 text-lg font-black tabular-nums text-slate-950">
                                {hasActual ? execWan(monthData.revenueCollected!) : <span className="text-slate-500">-</span>}
                            </div>
                        </div>
                        <div className="liquid-glass-subtle rounded-2xl p-3">
                            <div className="text-xs font-semibold text-slate-500">去年同期</div>
                            <div className="mt-1 text-sm font-black tabular-nums text-slate-800">{execWan(prevActual)}</div>
                        </div>
                        <div className="liquid-glass-subtle rounded-2xl p-3">
                            <div className="text-xs font-semibold text-slate-500">同比 / 完成率</div>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-black">
                                {hasActual && prevActual > 0 ? (
                                    <span className={yoy >= 0 ? 'text-blue-700' : 'text-rose-500'}>{yoy > 0 ? '+' : ''}{execPct(yoy)}</span>
                                ) : <span className="text-slate-500">-</span>}
                                <span className={hasActual ? monthlyRate >= 100 ? 'text-cyan-700' : monthlyRate >= 80 ? 'text-blue-600' : 'text-amber-600' : 'text-slate-500'}>
                                    {hasActual ? execPct(monthlyRate) : '-'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            ))
        ) : (
            <div className="liquid-shared-empty rounded-2xl px-4 py-8 text-center text-sm font-semibold text-slate-500">
                {displayYear > currentYear ? "未来年份暂无执行数据" : "暂无数据"}
            </div>
        )}
      </div>

      {/* Desktop table keeps the dense comparison view. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm text-left min-w-[600px]">
          <thead className="liquid-shared-table-head text-slate-500 font-bold">
            <tr>
              <th className="liquid-shared-sticky-cell sticky left-0 z-10 px-4 py-3 text-center">月份</th>
              <th className="px-4 py-3 text-right text-blue-700">预算收款(万元)</th>
              <th className="px-4 py-3 text-right text-cyan-700">实际收款(万元)</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">去年同期(万元)</th>
              <th className="px-4 py-3 text-right">同比</th>
              <th className="px-4 py-3 text-right">当月完成率</th>
              <th className="hidden px-4 py-3 text-right shadow-[inset_1px_0_rgba(255,255,255,0.70)] sm:table-cell">累计达成率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/60">
            {executionRows.length > 0 ? (
                executionRows.map(({ monthData, index, hasActual, monthlyRate, cumulativeRate, prevActual, yoy }) => {
                return (
                    <tr key={index} className="transition-colors hover:bg-blue-50/35">
                    <td className="liquid-shared-sticky-cell sticky left-0 z-10 px-4 py-3 text-center font-bold text-slate-800">{monthData.month}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{execWan(monthData.revenueTarget)}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                        {hasActual ? execWan(monthData.revenueCollected!) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-right text-xs font-semibold text-slate-500 sm:table-cell">
                        {execWan(prevActual)}
                    </td>
                    <td className="px-4 py-3 text-right">
                        {hasActual && prevActual > 0 ? (
                            <span className={`text-xs font-bold ${yoy >= 0 ? 'text-blue-700' : 'text-rose-500'}`}>
                                {yoy > 0 ? '+' : ''}{execPct(yoy)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                        {hasActual ? (
                            <span className={`font-bold ${monthlyRate >= 100 ? 'text-cyan-700' : monthlyRate >= 80 ? 'text-blue-600' : 'text-amber-600'}`}>
                            {execPct(monthlyRate)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="hidden px-4 py-3 text-right shadow-[inset_1px_0_rgba(255,255,255,0.70)] sm:table-cell">
                        {hasActual ? (
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${cumulativeRate >= 100 ? 'bg-cyan-100/80 text-cyan-700 ring-1 ring-cyan-200/70' : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200/70'}`}>
                            {execPct(cumulativeRate)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    </tr>
                );
                })
            ) : (
                <tr>
                    <td colSpan={7} className="liquid-shared-empty py-8 text-center text-sm font-semibold text-slate-500">
                        {displayYear > currentYear ? "未来年份暂无执行数据" : "暂无数据"}
                    </td>
                </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export interface AnnualComparisonData {
    year: number;
    revenueTarget: number;
    revenueActual: number;
    revenueCompletionRate: number;
    revenueYoY: number | null; // %
    occupancyRate: number; // Snapshot at year end
    occupancyYoY: number | null; // % difference (points)
    managementFeeActual?: number;
    managementFeeContractReceivable?: number;
    managementFeeCompletionRate?: number;
    combinedActual?: number;
    combinedCompletionRate?: number;
}

interface AnnualMetricComparisonTableProps {
    data: AnnualComparisonData[];
    showManagementFee?: boolean;
}

export const AnnualMetricComparisonTable: React.FC<AnnualMetricComparisonTableProps> = ({
    data,
    showManagementFee = false,
}) => {
    return (
        <div className="liquid-glass-readable mb-6 overflow-hidden rounded-[24px]">
            <div className="liquid-glass-toolbar px-4 py-4 md:px-6 md:py-5">
                <h3 className="flex items-center gap-2 text-lg font-black text-slate-950">
                    <TrendingUp size={20} className="text-blue-600"/> 年度经营指标对比
                </h3>
                {showManagementFee && (
                    <p className="text-xs text-slate-500 mt-1">含租金与物业费分项；综合完成率 =（租金实收+物业费实收）÷（租金年初预算+物业费合同应收）</p>
                )}
            </div>
            <div className="space-y-2 p-2 md:hidden">
                {data.map((row) => (
                    <div key={row.year} className="liquid-glass-subtle rounded-[18px] p-4">
                        <div className="flex items-start justify-between gap-3">
                            <div>
                                <div className="text-base font-black text-slate-900">{row.year}年</div>
                                <div className="mt-0.5 text-xs text-slate-500">年度经营表现</div>
                            </div>
                            <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${row.revenueCompletionRate >= 100 ? 'bg-cyan-100/80 text-cyan-700 ring-1 ring-cyan-200/70' : row.revenueCompletionRate >= 90 ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200/70' : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/70'}`}>
                                租金 {formatPercent(row.revenueCompletionRate, 0)}
                            </span>
                        </div>
                        <div className="mt-4 grid grid-cols-2 gap-3">
                            <div className="liquid-glass-readable rounded-2xl p-3">
                                <div className="text-xs font-semibold text-slate-500">年初预算</div>
                                <div className="mt-1 text-lg font-black tabular-nums text-slate-900">{formatWan(row.revenueTarget, 0)}</div>
                            </div>
                            <div className="liquid-glass-readable rounded-2xl p-3">
                                <div className="text-xs font-semibold text-blue-700">租金实收</div>
                                <div className="mt-1 text-lg font-black tabular-nums text-blue-900">{formatWan(row.revenueActual, 0)}</div>
                            </div>
                        </div>
                        {showManagementFee && (
                            <div className="mt-3 grid grid-cols-2 gap-3">
                                <div className="liquid-glass-readable rounded-2xl p-3">
                                    <div className="text-xs font-semibold text-cyan-700">物业费实收</div>
                                    <div className="mt-1 text-base font-black tabular-nums text-cyan-900">{formatWan(row.managementFeeActual || 0, 0)}</div>
                                </div>
                                <div className="liquid-glass-readable rounded-2xl p-3">
                                    <div className="text-xs font-semibold text-blue-700">综合完成率</div>
                                    <div className="mt-1 text-base font-black tabular-nums text-blue-900">
                                        {row.combinedCompletionRate != null ? formatPercent(row.combinedCompletionRate, 0) : '—'}
                                    </div>
                                </div>
                            </div>
                        )}
                        <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                            <span className={`inline-flex items-center gap-1 font-semibold ${row.revenueYoY == null ? 'text-slate-500' : row.revenueYoY >= 0 ? 'text-blue-700' : 'text-rose-500'}`}>
                                {row.revenueYoY == null ? (
                                    '营收同比 —'
                                ) : (
                                    <>
                                        {row.revenueYoY >= 0 ? <TrendingUp size={13}/> : <TrendingDown size={13}/>}
                                        营收同比 {row.revenueYoY > 0 ? '+' : ''}{formatPercent(row.revenueYoY, 0)}
                                    </>
                                )}
                            </span>
                            <span className="font-semibold text-blue-700">出租率 {formatPercent(row.occupancyRate, 0)}</span>
                        </div>
                    </div>
                ))}
            </div>
            <div className="hidden md:block overflow-x-auto">
                <table className={`w-full text-sm text-left ${showManagementFee ? 'min-w-[1100px]' : 'min-w-[700px]'}`}>
                    <thead className="liquid-shared-table-head text-slate-500 font-bold">
                        <tr>
                            <th className="px-6 py-3">年度</th>
                            <th className="px-6 py-3 text-right">年初预算(万元)</th>
                            <th className="px-6 py-3 text-right">租金实收(万元)</th>
                            {showManagementFee && (
                                <>
                                    <th className="px-6 py-3 text-right text-cyan-700">物业费应收(万元)</th>
                                    <th className="px-6 py-3 text-right text-cyan-700">物业费实收(万元)</th>
                                </>
                            )}
                            <th className="px-6 py-3 text-right">租金完成率</th>
                            {showManagementFee && (
                                <>
                                    <th className="px-6 py-3 text-right text-cyan-700">物业费完成率</th>
                                    <th className="px-6 py-3 text-right text-blue-700">综合完成率</th>
                                </>
                            )}
                            <th className="px-6 py-3 text-right">营收同比</th>
                            <th className="px-6 py-3 text-right">年末出租率</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/60">
                        {data.map((row) => (
                            <tr key={row.year} className="transition-colors hover:bg-blue-50/35">
                                <td className="liquid-shared-year-cell px-6 py-4 font-black text-slate-800">{row.year}年</td>
                                <td className="px-6 py-4 text-right text-slate-500">
                                    <div className="flex items-center justify-end gap-1">
                                        <Target size={12} className="text-slate-300"/>
                                        {formatWan(row.revenueTarget, 0)}
                                    </div>
                                </td>
                                <td className="px-6 py-4 text-right font-medium text-slate-800">
                                    {formatWan(row.revenueActual, 0)}
                                </td>
                                {showManagementFee && (
                                    <>
                                        <td className="px-6 py-4 text-right text-cyan-800">
                                            {formatWan(row.managementFeeContractReceivable || 0, 0)}
                                        </td>
                                        <td className="px-6 py-4 text-right font-bold text-cyan-900">
                                            {formatWan(row.managementFeeActual || 0, 0)}
                                        </td>
                                    </>
                                )}
                                <td className="px-6 py-4 text-right">
                                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${row.revenueCompletionRate >= 100 ? 'bg-cyan-100/80 text-cyan-700 ring-1 ring-cyan-200/70' : row.revenueCompletionRate >= 90 ? 'bg-blue-100 text-blue-700 ring-1 ring-blue-200/70' : 'bg-amber-100 text-amber-700 ring-1 ring-amber-200/70'}`}>
                                        {formatPercent(row.revenueCompletionRate, 0)}
                                    </span>
                                </td>
                                {showManagementFee && (
                                    <>
                                        <td className="px-6 py-4 text-right">
                                            {row.managementFeeCompletionRate != null ? (
                                                <span className="rounded-full bg-cyan-100/80 px-2.5 py-1 text-xs font-bold text-cyan-700">
                                                    {formatPercent(row.managementFeeCompletionRate, 0)}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {row.combinedCompletionRate != null ? (
                                                <span className="rounded-full bg-blue-100/80 px-2.5 py-1 text-xs font-bold text-blue-700">
                                                    {formatPercent(row.combinedCompletionRate, 0)}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                    </>
                                )}
                                <td className="px-6 py-4 text-right">
                                    {row.revenueYoY !== null ? (
                                        <div className={`flex items-center justify-end gap-1 font-bold ${row.revenueYoY >= 0 ? 'text-blue-700' : 'text-rose-500'}`}>
                                            {row.revenueYoY > 0 ? <TrendingUp size={14}/> : <TrendingDown size={14}/>}
                                            {row.revenueYoY > 0 ? '+' : ''}{formatPercent(row.revenueYoY, 0)}
                                        </div>
                                    ) : <span className="text-slate-300">-</span>}
                                </td>
                                <td className="px-6 py-4 text-right">
                                    <div className="flex items-center justify-end gap-1 font-medium text-blue-700">
                                        <Activity size={14} className="text-blue-400"/>
                                        {formatPercent(row.occupancyRate, 0)}
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
