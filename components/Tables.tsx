
import React from 'react';
import { DashboardData, ContractStatus } from '../types';
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Target, Activity } from 'lucide-react';
import { formatArea, formatPercent, formatWan } from '../services/numberFormat';
import { useMinMdViewport } from '../hooks/useMediaQuery';

const StatusBadge: React.FC<{ status: ContractStatus }> = ({ status }) => {
  const styles = {
    [ContractStatus.Active]: 'bg-green-100 text-green-700',
    [ContractStatus.Expiring]: 'bg-amber-100 text-amber-700',
    [ContractStatus.Terminated]: 'bg-red-100 text-red-700',
    [ContractStatus.Pending]: 'bg-blue-100 text-blue-700',
    [ContractStatus.Expired]: 'bg-slate-100 text-slate-500',
  };

  const labels = {
    [ContractStatus.Active]: '履约中',
    [ContractStatus.Expiring]: '即将到期',
    [ContractStatus.Terminated]: '已退租',
    [ContractStatus.Pending]: '签约中',
    [ContractStatus.Expired]: '已到期(历史)',
  };

  return (
    <span className={`px-2 py-1 rounded-full text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
};

// Mobile Card Component for Recent Activity
const ActivityCard: React.FC<{ tenant: any, buildingName: string, unitNames: string }> = ({ tenant, buildingName, unitNames }) => (
  <div className="bg-white p-4 border-b border-slate-100 last:border-0">
     <div className="flex justify-between items-start mb-2">
         <div className="font-medium text-slate-800">{tenant.name}</div>
         <StatusBadge status={tenant.status} />
     </div>
     <div className="text-xs text-slate-500 space-y-1 min-w-0">
         <div className="flex flex-col gap-1 sm:flex-row sm:justify-between sm:items-start sm:gap-2">
             <span className="min-w-0 break-words">位置: {buildingName} {unitNames}</span>
             <span className="font-semibold text-slate-700 shrink-0 sm:text-right">{formatArea(tenant.totalArea)}</span>
         </div>
         <div className="text-slate-400">{tenant.leaseStart} ~ {tenant.leaseEnd}</div>
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
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden h-full">
      <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-start gap-3">
        <div>
          <h3 className="text-lg font-semibold text-slate-800">最新签约动态</h3>
          <p className="text-[11px] text-slate-500 mt-1">仅展示最近 1 个月内签约（优先签约日，否则起租日）</p>
        </div>
        <span className="text-xs font-medium text-slate-500 bg-slate-100 px-2 py-1 rounded-md shrink-0">近 1 个月</span>
      </div>
      
      {isDesktop ? (
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium">
            <tr>
              <th className="px-6 py-3">企业名称</th>
              <th className="px-6 py-3">位置</th>
              <th className="px-6 py-3 text-right">签约面积</th>
              <th className="px-6 py-3">租赁周期</th>
              <th className="px-6 py-3">状态</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-10 text-center text-slate-400 text-sm">近一个月内暂无签约记录</td>
              </tr>
            )}
            {rows.map(({ tenant, building, unitNames }) => (
              <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-6 py-4 font-medium text-slate-800">{tenant.name}</td>
                <td className="px-6 py-4 text-slate-600">
                  {building?.name} <span className="text-slate-500 text-xs ml-1">{unitNames}</span>
                </td>
                <td className="px-6 py-4 text-slate-800 font-semibold text-right">{formatArea(tenant.totalArea)}</td>
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
      <div>
          {rows.map(({ tenant, building, unitNames }) => (
              <ActivityCard key={tenant.id} tenant={tenant} buildingName={building?.name || ''} unitNames={unitNames} />
          ))}
          {rows.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">暂无近期签约</div>}
      </div>
      )}
    </div>
  );
};

// Mobile Card for Expiring Soon
const ExpiryCard: React.FC<{ tenant: any, daysLeft: number }> = ({ tenant, daysLeft }) => (
    <div className="bg-white p-4 border-b border-slate-100 last:border-0 flex justify-between items-center">
        <div>
            <div className="font-medium text-slate-800 mb-1">{tenant.name}</div>
            <div className="text-xs text-rose-600 font-medium">到期日: {tenant.leaseEnd}</div>
        </div>
        <div className="text-right">
             <div className="text-xs text-slate-400 mb-1">{daysLeft > 0 ? `剩 ${daysLeft} 天` : '已过期'}</div>
             <div className="text-sm font-bold text-slate-700">{formatArea(tenant.totalArea)}</div>
        </div>
    </div>
);

export const ExpiringSoonTable: React.FC<{ data: DashboardData }> = ({ data }) => {
  const totalArea = data.expiringSoon.reduce((sum, t) => sum + (t.totalArea || 0), 0);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden h-full">
      <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-amber-50/50">
        <h3 className="text-lg font-semibold text-amber-900">到期预警</h3>
        <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2 py-1 rounded">合计空置: {formatArea(totalArea)}</span>
      </div>
      
      {/* Desktop View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-slate-50 text-slate-500 font-medium">
            <tr>
              <th className="px-4 py-3">企业</th>
              <th className="px-4 py-3">到期日</th>
              <th className="px-4 py-3 text-right">空置面积</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.expiringSoon.map((tenant) => {
              const daysLeft = Math.ceil((new Date(tenant.leaseEnd).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
              return (
                <tr key={tenant.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-4 font-medium text-slate-800">
                      <div className="truncate max-w-[120px]" title={tenant.name}>{tenant.name}</div>
                  </td>
                  <td className="px-4 py-4">
                      <div className="text-rose-600 font-medium text-xs">{tenant.leaseEnd}</div>
                      <div className="text-slate-400 text-xs">{daysLeft > 0 ? `剩 ${daysLeft} 天` : '已过期'}</div>
                  </td>
                  <td className="px-4 py-4 text-right font-medium text-slate-700">
                     {formatArea(tenant.totalArea)}
                  </td>
                </tr>
              );
            })}
            {data.expiringSoon.length > 0 && (
                <tr className="bg-slate-50 font-bold text-slate-700 border-t border-slate-200">
                    <td className="px-4 py-3" colSpan={2}>合计</td>
                    <td className="px-4 py-3 text-right">{formatArea(totalArea)}</td>
                </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile View */}
      <div className="md:hidden">
          {data.expiringSoon.map((tenant) => {
              const daysLeft = Math.ceil((new Date(tenant.leaseEnd).getTime() - new Date().getTime()) / (1000 * 3600 * 24));
              return <ExpiryCard key={tenant.id} tenant={tenant} daysLeft={daysLeft} />;
          })}
          {data.expiringSoon.length === 0 && <div className="p-4 text-center text-slate-400 text-sm">暂无近期到期</div>}
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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden h-full">
      <div className="p-4 md:p-6 border-b border-slate-100 flex justify-between items-center bg-emerald-50/30">
        <div>
            <div className="flex items-center gap-2 md:gap-4">
                <h3 className="text-base md:text-lg font-semibold text-emerald-900">预算执行 (Budget vs Actual)</h3>
                <span className="hidden md:inline text-xs font-semibold bg-emerald-100 text-emerald-700 px-2 py-1 rounded">实时监控</span>
            </div>
            <div className="mt-1 text-[11px] text-emerald-700/80">数据源：生效预算方案（月度应收）</div>
        </div>
        
        {onYearChange && (
            <div className="flex items-center bg-white border border-emerald-200 rounded-lg p-0.5 shadow-sm">
                <button 
                    onClick={() => onYearChange(displayYear - 1)} 
                    className="p-1 hover:bg-emerald-50 rounded text-emerald-600"
                >
                    <ChevronDown className="rotate-90" size={16}/>
                </button>
                <span className="px-2 md:px-3 py-1 text-sm font-bold text-emerald-800">{displayYear}</span>
                <button 
                    onClick={() => onYearChange(displayYear + 1)} 
                    className="p-1 hover:bg-emerald-50 rounded text-emerald-600"
                >
                    <ChevronRight size={16}/>
                </button>
            </div>
        )}
      </div>
      
      {/* Scrollable Container for both Mobile and Desktop */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left min-w-[600px]">
          <thead className="bg-slate-50 text-slate-500 font-medium">
            <tr>
              <th className="px-4 py-3 text-center sticky left-0 bg-slate-50 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">月份</th>
              <th className="px-4 py-3 text-right bg-blue-50/30 text-blue-700">预算收款(万元)</th>
              <th className="px-4 py-3 text-right bg-emerald-50/30 text-emerald-700">实际收款(万元)</th>
              <th className="px-4 py-3 text-right hidden sm:table-cell">去年同期(万元)</th>
              <th className="px-4 py-3 text-right">同比</th>
              <th className="px-4 py-3 text-right">当月完成率</th>
              <th className="px-4 py-3 text-right border-l border-slate-100 hidden sm:table-cell">累计达成率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visibleTrends.length > 0 ? (
                visibleTrends.map((monthData, index) => {
                cumulativeBudget += monthData.revenueTarget;
                // Only accumulate actual if not null (past/current months)
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

                return (
                    <tr key={index} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3 font-medium text-slate-700 text-center sticky left-0 bg-white z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-100">{monthData.month}</td>
                    <td className="px-4 py-3 text-right text-slate-600 bg-blue-50/10">{execWan(monthData.revenueTarget)}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800 bg-emerald-50/10">
                        {hasActual ? execWan(monthData.revenueCollected!) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-400 text-xs hidden sm:table-cell">
                        {execWan(prevActual)}
                    </td>
                    <td className="px-4 py-3 text-right">
                        {hasActual && prevActual > 0 ? (
                            <span className={`text-xs font-medium ${yoy >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
                                {yoy > 0 ? '+' : ''}{execPct(yoy)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                        {hasActual ? (
                            <span className={`font-bold ${monthlyRate >= 100 ? 'text-emerald-600' : monthlyRate >= 80 ? 'text-blue-600' : 'text-amber-600'}`}>
                            {execPct(monthlyRate)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-right border-l border-slate-100 hidden sm:table-cell">
                        {hasActual ? (
                            <span className={`text-xs px-2 py-0.5 rounded ${cumulativeRate >= 100 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                            {execPct(cumulativeRate)}
                            </span>
                        ) : <span className="text-slate-300">-</span>}
                    </td>
                    </tr>
                );
                })
            ) : (
                <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-400 text-sm">
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
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden mb-6">
            <div className="p-4 md:p-6 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-white">
                <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <TrendingUp size={20} className="text-blue-600"/> 年度经营指标对比
                </h3>
                {showManagementFee && (
                    <p className="text-xs text-slate-500 mt-1">含租金与物业费分项；综合完成率 =（租金实收+物业费实收）÷（租金年初预算+物业费合同应收）</p>
                )}
            </div>
            <div className="overflow-x-auto">
                <table className={`w-full text-sm text-left ${showManagementFee ? 'min-w-[1100px]' : 'min-w-[700px]'}`}>
                    <thead className="bg-slate-50 text-slate-500 font-medium">
                        <tr>
                            <th className="px-6 py-3">年度</th>
                            <th className="px-6 py-3 text-right">年初预算(万元)</th>
                            <th className="px-6 py-3 text-right">租金实收(万元)</th>
                            {showManagementFee && (
                                <>
                                    <th className="px-6 py-3 text-right text-teal-700">物业费应收(万元)</th>
                                    <th className="px-6 py-3 text-right text-teal-700">物业费实收(万元)</th>
                                </>
                            )}
                            <th className="px-6 py-3 text-right">租金完成率</th>
                            {showManagementFee && (
                                <>
                                    <th className="px-6 py-3 text-right text-teal-700">物业费完成率</th>
                                    <th className="px-6 py-3 text-right text-indigo-700">综合完成率</th>
                                </>
                            )}
                            <th className="px-6 py-3 text-right">营收同比</th>
                            <th className="px-6 py-3 text-right">年末出租率</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {data.map((row) => (
                            <tr key={row.year} className="hover:bg-slate-50 transition-colors">
                                <td className="px-6 py-4 font-bold text-slate-700 bg-slate-50/50">{row.year}年</td>
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
                                        <td className="px-6 py-4 text-right text-teal-800">
                                            {formatWan(row.managementFeeContractReceivable || 0, 0)}
                                        </td>
                                        <td className="px-6 py-4 text-right font-medium text-teal-800">
                                            {formatWan(row.managementFeeActual || 0, 0)}
                                        </td>
                                    </>
                                )}
                                <td className="px-6 py-4 text-right">
                                    <span className={`px-2 py-1 rounded text-xs font-bold ${row.revenueCompletionRate >= 100 ? 'bg-emerald-100 text-emerald-700' : row.revenueCompletionRate >= 90 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                                        {formatPercent(row.revenueCompletionRate, 0)}
                                    </span>
                                </td>
                                {showManagementFee && (
                                    <>
                                        <td className="px-6 py-4 text-right">
                                            {row.managementFeeCompletionRate != null ? (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-teal-50 text-teal-700">
                                                    {formatPercent(row.managementFeeCompletionRate, 0)}
                                                </span>
                                            ) : (
                                                <span className="text-slate-300">—</span>
                                            )}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            {row.combinedCompletionRate != null ? (
                                                <span className="px-2 py-1 rounded text-xs font-bold bg-indigo-50 text-indigo-700">
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
                                        <div className={`flex items-center justify-end gap-1 font-medium ${row.revenueYoY >= 0 ? 'text-emerald-600' : 'text-rose-500'}`}>
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
