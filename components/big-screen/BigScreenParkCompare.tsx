import React from 'react';
import { type BigScreenParkMetric } from '../../services/bigScreenMetrics';
import { formatWan, formatPercent } from '../../services/numberFormat';

interface Props {
  parks: BigScreenParkMetric[];
  year: number;
  hideAmount?: boolean;
}

const fmtWan = (v: number | null | undefined, d = 2, hide = false) =>
  hide ? '***' : formatWan(v, d);

/** 实收 / 年初预算 */
const initialBudgetCompletion = (park: BigScreenParkMetric): number =>
  park.annualInitialBudget > 0
    ? Math.min(100, (park.annualRevenueCollected / park.annualInitialBudget) * 100)
    : 0;

const completionColor = (pct: number): string =>
  pct >= 90 ? 'text-cyan-300' : pct >= 70 ? 'text-amber-400' : 'text-red-400';

const rankColor = (index: number): string => {
  if (index === 0) return 'text-amber-400';
  if (index === 1) return 'text-slate-300';
  if (index === 2) return 'text-amber-700';
  return 'text-slate-500';
};

export const BigScreenParkCompare: React.FC<Props> = ({ parks, year, hideAmount }) => {
  const showManagementFee = parks.some(
    (p) =>
      p.managementFeeBillingEnabled &&
      (p.annualManagementFeeReceivable > 0 || p.annualManagementFeeCollected > 0),
  );
  const byOccupancy = [...parks].sort((a, b) => b.occupancyRate - a.occupancyRate);
  const byCollection = [...parks].sort(
    (a, b) => initialBudgetCompletion(b) - initialBudgetCompletion(a),
  );
  const byRevenue = [...parks].sort(
    (a, b) => b.annualRevenueCollected - a.annualRevenueCollected,
  );

  return (
    <div className="min-h-full flex flex-col px-4 md:px-16 py-4 md:py-8 pb-12 md:pb-16">
      <div className="text-center mb-4 md:mb-8 shrink-0">
        <h2 className="text-2xl font-black md:text-5xl">园区横向对比</h2>
        <p className="mt-1 text-sm font-semibold text-slate-400 md:mt-2 md:text-base">{year}年度</p>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-3 md:gap-6 min-h-0">
        {/* Occupancy ranking */}
        <div className="liquid-bigscreen-panel rounded-[24px] p-6 flex flex-col min-h-0">
          <h3 className="mb-4 text-base font-black text-slate-200">出租率排名</h3>
          <div className="flex-1 overflow-auto space-y-2">
            {byOccupancy.map((park, i) => (
              <div
                key={park.projectId}
                className="liquid-bigscreen-row flex items-center justify-between rounded-2xl px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold tabular-nums w-6 ${rankColor(i)}`}>
                    {i + 1}
                  </span>
                  <span className="text-base truncate max-w-[140px]">{park.parkName}</span>
                </div>
                <span
                  className={`text-base font-bold tabular-nums ${
                    park.occupancyRate >= park.annualOccupancyTarget
                      ? 'text-cyan-300'
                      : 'text-amber-400'
                  }`}
                >
                  {formatPercent(park.occupancyRate, 0)}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Collection ranking */}
        <div className="liquid-bigscreen-panel rounded-[24px] p-6 flex flex-col min-h-0">
          <h3 className="mb-4 text-base font-black text-slate-200">预算完成率排名</h3>
          <div className="flex-1 overflow-auto space-y-2">
            {byCollection.map((park, i) => {
              const pct = initialBudgetCompletion(park);
              return (
              <div
                key={park.projectId}
                className="liquid-bigscreen-row flex items-center justify-between rounded-2xl px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold tabular-nums w-6 ${rankColor(i)}`}>
                    {i + 1}
                  </span>
                  <span className="text-base truncate max-w-[140px]">{park.parkName}</span>
                </div>
                <span className={`text-base font-bold tabular-nums ${completionColor(pct)}`}>
                  {park.annualInitialBudget > 0 ? formatPercent(pct, 0) : '—'}
                </span>
              </div>
            );})}
          </div>
        </div>

        {/* Revenue ranking */}
        <div className="liquid-bigscreen-panel rounded-[24px] p-6 flex flex-col min-h-0">
          <h3 className="mb-4 text-base font-black text-slate-200">实收排名</h3>
          <div className="flex-1 overflow-auto space-y-2">
            {byRevenue.map((park, i) => (
              <div
                key={park.projectId}
                className="liquid-bigscreen-row flex items-center justify-between rounded-2xl px-3 py-2"
              >
                <div className="flex items-center gap-3">
                  <span className={`text-lg font-bold tabular-nums w-6 ${rankColor(i)}`}>
                    {i + 1}
                  </span>
                  <span className="text-base truncate max-w-[140px]">{park.parkName}</span>
                </div>
                <span className="text-base font-bold tabular-nums text-sky-400">
                  {fmtWan(park.annualRevenueCollected, 0, hideAmount)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Summary table */}
      <div className="liquid-bigscreen-table mt-4 shrink-0 overflow-x-auto rounded-[22px] md:mt-6">
        <table className="w-full text-xs md:text-base">
          <thead className="text-slate-300">
            <tr>
              <th className="text-left px-4 py-2">园区</th>
              <th className="text-right px-4 py-2">出租率</th>
              <th className="text-right px-4 py-2">实收</th>
              <th className="text-right px-4 py-2">合同应收</th>
              <th className="text-right px-4 py-2">年初预算</th>
              <th className="text-right px-4 py-2">预算完成率</th>
              <th className="text-right px-4 py-2">预算偏差</th>
              {showManagementFee ? (
                <>
                  <th className="text-right px-4 py-2">物业费实收</th>
                  <th className="text-right px-4 py-2">物业费收缴率</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {byRevenue.map((park) => {
              const budgetPct = initialBudgetCompletion(park);
              return (
              <tr key={park.projectId} className="transition-colors hover:bg-sky-400/10">
                <td className="px-4 py-2 font-medium">{park.parkName}</td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatPercent(park.occupancyRate, 0)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtWan(park.annualRevenueCollected, 0, hideAmount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {fmtWan(park.annualContractReceivable, 0, hideAmount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">
                  {park.annualInitialBudget > 0
                    ? fmtWan(park.annualInitialBudget, 0, hideAmount)
                    : '—'}
                </td>
                <td className={`px-4 py-2 text-right tabular-nums ${completionColor(budgetPct)}`}>
                  {park.annualInitialBudget > 0 ? formatPercent(budgetPct, 0) : '—'}
                </td>
                <td
                  className={`px-4 py-2 text-right tabular-nums ${
                    park.budgetDeviation >= 0 ? 'text-sky-400' : 'text-red-400'
                  }`}
                >
                  {park.annualInitialBudget > 0
                    ? formatPercent(park.budgetDeviation, 0)
                    : '—'}
                </td>
                {showManagementFee ? (
                  <>
                    <td className="px-4 py-2 text-right tabular-nums text-teal-400">
                      {park.managementFeeBillingEnabled
                        ? fmtWan(park.annualManagementFeeCollected, 0, hideAmount)
                        : '—'}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-teal-400">
                      {park.managementFeeBillingEnabled && park.annualManagementFeeReceivable > 0
                        ? formatPercent(park.annualManagementFeeCompletion, 0)
                        : '—'}
                    </td>
                  </>
                ) : null}
              </tr>
            );})}
          </tbody>
        </table>
      </div>
    </div>
  );
};
