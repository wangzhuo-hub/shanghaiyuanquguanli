import React from 'react';
import { Banknote, Target, TrendingUp, Building2 } from 'lucide-react';
import { type BigScreenParkMetric } from '../../services/bigScreenMetrics';
import { formatWan, formatPercent, formatArea } from '../../services/numberFormat';

interface Props {
  totals: BigScreenParkMetric;
  parkCount: number;
  year: number;
  hideAmount?: boolean;
}

const fmtWan = (v: number | null | undefined, d = 2, hide = false) =>
  hide ? '***' : formatWan(v, d);

export const BigScreenSummary: React.FC<Props> = ({ totals, parkCount, year, hideAmount }) => {
  const occupancyOk = totals.occupancyRate >= totals.annualOccupancyTarget;
  const collectionOk = totals.annualGoalCompletion >= 90;
  const hasUnpaid = totals.currentMonthUnpaid > 0;

  return (
    <div className="h-full flex flex-col items-center px-4 md:px-8 py-3 md:py-4 min-h-0 gap-2 md:gap-3">
      {/* ====== Header ====== */}
      <div className="text-center shrink-0">
        <h1 className="text-xl md:text-6xl font-bold tracking-tight">集团经营总览</h1>
        <p className="text-slate-500 mt-0.5 md:mt-1.5 text-xs md:text-lg">
          {year}年度 · {parkCount} 个园区
        </p>
      </div>

      {/* ====== Hero (flex-grow) ====== */}
      <div className="w-full max-w-6xl flex-[1.4] min-h-0 flex items-stretch">
        <div className="w-full bg-gradient-to-br from-white/8 to-white/3 rounded-xl md:rounded-2xl border border-white/10 p-4 md:p-8 flex items-center">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-10 w-full">
            {/* Left: 年度累计实收 */}
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-2 md:mb-3">
                <div className="w-8 h-8 md:w-10 md:h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Banknote size={18} className="text-emerald-400 md:w-5 md:h-5" />
                </div>
                <span className="text-xs md:text-lg text-slate-400 font-medium">年度累计实收</span>
              </div>
              <div className="text-4xl md:text-[clamp(2.75rem,9vh,5.5rem)] font-bold text-white tabular-nums tracking-tight leading-none">
                {fmtWan(totals.annualRevenueCollected, 0, hideAmount)}
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2 mt-2 md:mt-3 flex-wrap">
                <span className="text-[11px] md:text-base text-slate-500">
                  合同应收 {fmtWan(totals.annualContractReceivable, 0, hideAmount)}
                </span>
                <span className={`text-[11px] md:text-base px-2 py-0.5 rounded-full font-medium ${collectionOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  完成率 {formatPercent(totals.annualGoalCompletion, 0)}
                </span>
              </div>
            </div>

            {/* Right: 综合出租率 */}
            <div className="text-center md:text-right md:border-l md:border-white/10 md:pl-10">
              <div className="flex items-center justify-center md:justify-end gap-2 mb-2 md:mb-3">
                <span className="text-xs md:text-lg text-slate-400 font-medium">综合出租率</span>
                <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg ${occupancyOk ? 'bg-emerald-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                  <Target size={18} className={occupancyOk ? 'text-emerald-400' : 'text-amber-400'} />
                </div>
              </div>
              <div className={`text-4xl md:text-[clamp(2.75rem,9vh,5.5rem)] font-bold tabular-nums tracking-tight leading-none ${occupancyOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatPercent(totals.occupancyRate, 0)}
              </div>
              <div className="flex items-center justify-center md:justify-end gap-2 mt-2 md:mt-3 flex-wrap">
                <span className="text-[11px] md:text-base text-slate-500">
                  目标 {formatPercent(totals.annualOccupancyTarget, 0)}
                </span>
                <span className={`text-[11px] md:text-base px-2 py-0.5 rounded-full font-medium ${occupancyOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {occupancyOk ? '达标' : `差 ${formatPercent(totals.annualOccupancyTarget - totals.occupancyRate, 0)}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== 当前账期 ====== */}
      <div className="w-full max-w-6xl flex-[0.75] min-h-[72px] max-h-[160px]">
        <div className="grid grid-cols-3 gap-2 md:gap-4 h-full">
          <div className="bg-emerald-500/5 rounded-xl border border-emerald-500/10 p-3 md:p-5 text-center h-full flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-emerald-400/70 font-medium">本账期已收</div>
            <div className="text-xl md:text-[clamp(1.5rem,5vh,2.75rem)] font-bold text-emerald-400 tabular-nums whitespace-nowrap mt-0.5 md:mt-1 leading-none">
              {fmtWan(totals.currentMonthCollected, 0, hideAmount)}
            </div>
          </div>
          <div className="bg-sky-500/5 rounded-xl border border-sky-500/10 p-3 md:p-5 text-center h-full flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-sky-400/70 font-medium">本账期应收</div>
            <div className="text-xl md:text-[clamp(1.5rem,5vh,2.75rem)] font-bold text-sky-400 tabular-nums whitespace-nowrap mt-0.5 md:mt-1 leading-none">
              {fmtWan(totals.currentMonthReceivable, 0, hideAmount)}
            </div>
          </div>
          <div className={`rounded-xl border p-3 md:p-5 text-center h-full flex flex-col justify-center ${hasUnpaid ? 'bg-red-500/5 border-red-500/10' : 'bg-emerald-500/5 border-emerald-500/10'}`}>
            <div className={`text-[11px] md:text-base font-medium ${hasUnpaid ? 'text-red-400/70' : 'text-emerald-400/70'}`}>本账期末收</div>
            <div className={`text-xl md:text-[clamp(1.5rem,5vh,2.75rem)] font-bold tabular-nums whitespace-nowrap mt-0.5 md:mt-1 leading-none ${hasUnpaid ? 'text-red-400' : 'text-emerald-400'}`}>
              {fmtWan(totals.currentMonthUnpaid, 0, hideAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* ====== 关键指标 ====== */}
      <div className="w-full max-w-6xl flex-1 min-h-0 flex flex-col">
        <div className="flex items-center gap-2 mb-2 shrink-0">
          <div className="w-4 h-0.5 rounded-full bg-purple-400/60" />
          <span className="text-[11px] md:text-base text-purple-400 uppercase tracking-widest font-semibold">关键指标</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3 flex-1 min-h-0">
          <div className="bg-white/5 rounded-xl p-3 md:p-5 border border-white/5 flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-slate-500">年初预算</div>
            <div className="text-base md:text-[clamp(1.25rem,3.5vh,2rem)] font-bold text-white tabular-nums whitespace-nowrap mt-0.5 md:mt-1">
              {fmtWan(totals.annualInitialBudget, 0, hideAmount)}
            </div>
            <div className={`text-[11px] md:text-base mt-0.5 md:mt-1 ${totals.budgetDeviation >= 0 ? 'text-sky-400' : 'text-red-400'}`}>
              偏差 {formatPercent(totals.budgetDeviation, 0)}
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 md:p-5 border border-white/5 flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-slate-500">回款完成率</div>
            <div className={`text-base md:text-[clamp(1.25rem,3.5vh,2rem)] font-bold tabular-nums mt-0.5 md:mt-1 ${collectionOk ? 'text-emerald-400' : totals.annualGoalCompletion >= 70 ? 'text-amber-400' : 'text-red-400'}`}>
              {formatPercent(totals.annualGoalCompletion, 0)}
            </div>
            <div className="text-[11px] md:text-base text-slate-500 mt-0.5 md:mt-1">{collectionOk ? '进度良好' : '需关注'}</div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 md:p-5 border border-white/5 flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-slate-500">新签约 / 退租</div>
            <div className="text-base md:text-[clamp(1.25rem,3.5vh,2rem)] font-bold tabular-nums mt-0.5 md:mt-1 whitespace-nowrap">
              <span className="text-emerald-400">{formatArea(totals.newContractsArea, 0)}</span>
              <span className="text-slate-600"> / </span>
              <span className="text-red-400">{formatArea(totals.terminatedContractsArea, 0)}</span>
            </div>
            <div className="text-[11px] md:text-base text-slate-500 mt-0.5 md:mt-1">
              净增 {formatArea(totals.netIncreaseArea, 0)}
            </div>
          </div>
          <div className="bg-white/5 rounded-xl p-3 md:p-5 border border-white/5 flex flex-col justify-center">
            <div className="text-[11px] md:text-base text-slate-500">园区 / 客户</div>
            <div className="text-base md:text-[clamp(1.25rem,3.5vh,2rem)] font-bold text-white tabular-nums mt-0.5 md:mt-1">
              {parkCount}<span className="text-slate-500 text-[11px] md:text-base font-normal"> 个园区</span>
            </div>
            <div className="text-[11px] md:text-base text-slate-500 mt-0.5 md:mt-1">{totals.tenantCount} 个客户 · {formatArea(totals.totalArea, 0)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
