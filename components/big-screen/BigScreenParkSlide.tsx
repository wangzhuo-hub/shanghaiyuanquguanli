import React from 'react';
import { Banknote, Target, TrendingUp, ArrowDown, ArrowUp } from 'lucide-react';
import { type BigScreenParkMetric } from '../../services/bigScreenMetrics';
import { formatWan, formatPercent, formatArea } from '../../services/numberFormat';

interface Props {
  park: BigScreenParkMetric;
  year: number;
  hideAmount?: boolean;
}

const fmtWan = (v: number | null | undefined, d = 2, hide = false) =>
  hide ? '***' : formatWan(v, d);

export const BigScreenParkSlide: React.FC<Props> = ({ park, year, hideAmount }) => {
  const occupancyOk = park.occupancyRate >= park.annualOccupancyTarget;
  const collectionOk = park.annualGoalCompletion >= 90;
  const hasUnpaid = park.currentMonthUnpaid > 0;

  return (
    <div className="h-full flex flex-col items-center px-4 md:px-8 pt-3 md:pt-5 pb-4 md:pb-6">
      {/* ====== Header ====== */}
      <div className="text-center mb-3 md:mb-5 shrink-0">
        <h1 className="text-xl md:text-5xl font-bold tracking-tight">{park.parkName}</h1>
        <p className="text-slate-500 mt-0.5 md:mt-1 text-xs md:text-base">{year}年度经营概览</p>
      </div>

      {/* ====== Hero ====== */}
      <div className="w-full max-w-5xl mb-3 md:mb-5 shrink-0">
        <div className="bg-gradient-to-br from-white/8 to-white/3 rounded-xl md:rounded-2xl border border-white/10 p-4 md:p-7">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8">
            <div className="text-center md:text-left">
              <div className="flex items-center justify-center md:justify-start gap-2 mb-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                  <Banknote size={14} className="text-emerald-400" />
                </div>
                <span className="text-[11px] md:text-sm text-slate-400 font-medium">年度累计实收</span>
              </div>
              <div className="text-4xl md:text-7xl font-bold text-white tabular-nums tracking-tight">
                {fmtWan(park.annualRevenueCollected, 0, hideAmount)}
              </div>
              <div className="flex items-center justify-center md:justify-start gap-2 mt-1 md:mt-2">
                <span className="text-[11px] md:text-sm text-slate-500">合同应收 {fmtWan(park.annualContractReceivable, 0, hideAmount)}</span>
                <span className={`text-[11px] md:text-sm px-1.5 py-0.5 rounded-full font-medium ${collectionOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  完成率 {formatPercent(park.annualGoalCompletion, 0)}
                </span>
              </div>
            </div>
            <div className="text-center md:text-right md:border-l md:border-white/10 md:pl-8">
              <div className="flex items-center justify-center md:justify-end gap-2 mb-2">
                <span className="text-[11px] md:text-sm text-slate-400 font-medium">出租率</span>
                <div className={`w-7 h-7 rounded-lg ${occupancyOk ? 'bg-emerald-500/20' : 'bg-amber-500/20'} flex items-center justify-center`}>
                  <Target size={14} className={occupancyOk ? 'text-emerald-400' : 'text-amber-400'} />
                </div>
              </div>
              <div className={`text-4xl md:text-7xl font-bold tabular-nums tracking-tight ${occupancyOk ? 'text-emerald-400' : 'text-amber-400'}`}>
                {formatPercent(park.occupancyRate, 0)}
              </div>
              <div className="flex items-center justify-center md:justify-end gap-2 mt-1 md:mt-2">
                <span className="text-[11px] md:text-sm text-slate-500">目标 {formatPercent(park.annualOccupancyTarget, 0)}</span>
                <span className={`text-[11px] md:text-sm px-1.5 py-0.5 rounded-full font-medium ${occupancyOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}>
                  {occupancyOk ? '达标' : `差 ${formatPercent(park.annualOccupancyTarget - park.occupancyRate, 0)}`}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ====== 当前账期 ====== */}
      <div className="w-full max-w-5xl mb-3 md:mb-5 shrink-0">
        <div className="grid grid-cols-3 gap-2 md:gap-4">
          <div className="bg-emerald-500/5 rounded-xl border border-emerald-500/10 p-3 md:p-4 text-center h-[72px] md:h-[96px] flex flex-col justify-center">
            <div className="text-[11px] md:text-sm text-emerald-400/70 font-medium">本账期已收</div>
            <div className="text-xl md:text-4xl font-bold text-emerald-400 tabular-nums whitespace-nowrap mt-0.5">
              {fmtWan(park.currentMonthCollected, 0, hideAmount)}
            </div>
          </div>
          <div className="bg-sky-500/5 rounded-xl border border-sky-500/10 p-3 md:p-4 text-center h-[72px] md:h-[96px] flex flex-col justify-center">
            <div className="text-[11px] md:text-sm text-sky-400/70 font-medium">本账期应收</div>
            <div className="text-xl md:text-4xl font-bold text-sky-400 tabular-nums whitespace-nowrap mt-0.5">
              {fmtWan(park.currentMonthReceivable, 0, hideAmount)}
            </div>
          </div>
          <div className={`rounded-xl border p-3 md:p-4 text-center h-[72px] md:h-[96px] flex flex-col justify-center ${hasUnpaid ? 'bg-red-500/5 border-red-500/10' : 'bg-emerald-500/5 border-emerald-500/10'}`}>
            <div className={`text-[11px] md:text-sm font-medium ${hasUnpaid ? 'text-red-400/70' : 'text-emerald-400/70'}`}>本账期末收</div>
            <div className={`text-xl md:text-4xl font-bold tabular-nums whitespace-nowrap mt-0.5 ${hasUnpaid ? 'text-red-400' : 'text-emerald-400'}`}>
              {fmtWan(park.currentMonthUnpaid, 0, hideAmount)}
            </div>
          </div>
        </div>
      </div>

      {/* ====== 关键指标 + 面积动态 ====== */}
      <div className="w-full max-w-5xl shrink-0 grid grid-cols-2 md:grid-cols-4 gap-2 md:gap-3">
        <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5">
          <div className="text-[11px] md:text-sm text-slate-500">年初预算</div>
          <div className="text-base md:text-2xl font-bold text-white tabular-nums whitespace-nowrap mt-0.5">{fmtWan(park.annualInitialBudget, 0, hideAmount)}</div>
        </div>
        <div className="bg-white/5 rounded-xl p-3 md:p-4 border border-white/5">
          <div className="text-[11px] md:text-sm text-slate-500">回款完成率 / 客户</div>
          <div className="text-base md:text-2xl font-bold tabular-nums mt-0.5">
            <span className={collectionOk ? 'text-emerald-400' : park.annualGoalCompletion >= 70 ? 'text-amber-400' : 'text-red-400'}>{formatPercent(park.annualGoalCompletion, 0)}</span>
          </div>
          <div className="text-[11px] md:text-sm text-slate-500 mt-0.5">{park.tenantCount} 户 · {formatArea(park.totalArea, 0)}</div>
        </div>
        <div className="bg-emerald-500/5 rounded-xl border border-emerald-500/10 p-3 md:p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ArrowUp size={12} className="text-emerald-400" />
            <span className="text-[11px] md:text-sm text-emerald-400/70 font-medium">新签约</span>
          </div>
          <div className="text-base md:text-2xl font-bold text-emerald-400 tabular-nums">{formatArea(park.newContractsArea, 0)}</div>
        </div>
        <div className="bg-red-500/5 rounded-xl border border-red-500/10 p-3 md:p-4 text-center">
          <div className="flex items-center justify-center gap-1 mb-1">
            <ArrowDown size={12} className="text-red-400" />
            <span className="text-[11px] md:text-sm text-red-400/70 font-medium">退租</span>
          </div>
          <div className="text-base md:text-2xl font-bold text-red-400 tabular-nums">{formatArea(park.terminatedContractsArea, 0)}</div>
        </div>
      </div>
    </div>
  );
};
