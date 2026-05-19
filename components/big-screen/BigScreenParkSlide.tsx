import React from 'react';
import { Banknote, Target, ArrowDown, ArrowUp } from 'lucide-react';
import { type BigScreenParkMetric } from '../../services/bigScreenMetrics';
import { formatWan, formatPercent, formatArea } from '../../services/numberFormat';

interface Props {
  park: BigScreenParkMetric;
  year: number;
  hideAmount?: boolean;
}

const fmtWan = (v: number | null | undefined, d = 2, hide = false) =>
  hide ? '***' : formatWan(v, d);

const kpiCard =
  'rounded-xl xl:rounded-2xl flex flex-col justify-center min-h-0 overflow-hidden';

export const BigScreenParkSlide: React.FC<Props> = ({ park, year, hideAmount }) => {
  const occupancyOk = park.occupancyRate >= park.annualOccupancyTarget;
  const collectionOk = park.annualGoalCompletion >= 90;
  const hasUnpaid = park.currentMonthUnpaid > 0;

  return (
    <div className="h-full w-full min-h-0 px-6 md:px-10 xl:px-16 py-4 xl:py-5">
      <div className="h-full w-full max-w-[1800px] mx-auto min-h-0 grid grid-rows-[auto_minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1.5fr)] gap-3 xl:gap-4">
        {/* Header */}
        <header className="text-center shrink-0">
          <h1 className="text-2xl md:text-4xl xl:text-5xl font-bold tracking-tight">{park.parkName}</h1>
          <p className="text-slate-500 mt-1 text-sm md:text-base xl:text-lg">{year}年度经营概览</p>
        </header>

        {/* Hero */}
        <section className="min-h-0">
          <div className="h-full bg-gradient-to-br from-white/8 to-white/3 rounded-xl xl:rounded-2xl border border-white/10 px-6 xl:px-12 py-5 xl:py-8 flex items-center">
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 xl:gap-16">
              <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 xl:mb-4">
                  <div className="w-9 h-9 xl:w-11 xl:h-11 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                    <Banknote className="text-emerald-400 w-[18px] h-[18px] xl:w-5 xl:h-5" />
                  </div>
                  <span className="text-sm xl:text-xl text-slate-400 font-medium">年度累计实收</span>
                </div>
                <div className="text-5xl md:text-6xl xl:text-[5.25rem] font-bold text-white tabular-nums tracking-tight leading-none">
                  {fmtWan(park.annualRevenueCollected, 0, hideAmount)}
                </div>
                <div className="flex items-center justify-center md:justify-start gap-2 xl:gap-3 mt-3 xl:mt-4 flex-wrap">
                  <span className="text-xs xl:text-lg text-slate-500">
                    合同应收 {fmtWan(park.annualContractReceivable, 0, hideAmount)}
                  </span>
                  <span
                    className={`text-xs xl:text-lg px-2.5 py-0.5 rounded-full font-medium ${collectionOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}
                  >
                    完成率 {formatPercent(park.annualGoalCompletion, 0)}
                  </span>
                </div>
              </div>

              <div className="text-center md:text-right md:border-l md:border-white/10 md:pl-8 xl:pl-16">
                <div className="flex items-center justify-center md:justify-end gap-2 mb-2 xl:mb-4">
                  <span className="text-sm xl:text-xl text-slate-400 font-medium">出租率</span>
                  <div
                    className={`w-9 h-9 xl:w-11 xl:h-11 rounded-lg ${occupancyOk ? 'bg-emerald-500/20' : 'bg-amber-500/20'} flex items-center justify-center shrink-0`}
                  >
                    <Target className={`w-[18px] h-[18px] xl:w-5 xl:h-5 ${occupancyOk ? 'text-emerald-400' : 'text-amber-400'}`} />
                  </div>
                </div>
                <div
                  className={`text-5xl md:text-6xl xl:text-[5.25rem] font-bold tabular-nums tracking-tight leading-none ${occupancyOk ? 'text-emerald-400' : 'text-amber-400'}`}
                >
                  {formatPercent(park.occupancyRate, 0)}
                </div>
                <div className="flex items-center justify-center md:justify-end gap-2 xl:gap-3 mt-3 xl:mt-4 flex-wrap">
                  <span className="text-xs xl:text-lg text-slate-500">
                    目标 {formatPercent(park.annualOccupancyTarget, 0)}
                  </span>
                  <span
                    className={`text-xs xl:text-lg px-2.5 py-0.5 rounded-full font-medium ${occupancyOk ? 'bg-emerald-500/20 text-emerald-400' : 'bg-amber-500/20 text-amber-400'}`}
                  >
                    {occupancyOk ? '达标' : `差 ${formatPercent(park.annualOccupancyTarget - park.occupancyRate, 0)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 当前账期 */}
        <section className="min-h-0">
          <div className="grid grid-cols-3 gap-3 xl:gap-5 h-full min-h-[88px]">
            <div className="bg-emerald-500/5 rounded-xl xl:rounded-2xl border border-emerald-500/10 px-4 xl:px-6 flex flex-col justify-center text-center min-h-0">
              <div className="text-xs xl:text-lg text-emerald-400/70 font-medium">本账期已收</div>
              <div className="text-2xl md:text-3xl xl:text-5xl font-bold text-emerald-400 tabular-nums whitespace-nowrap mt-1 leading-none">
                {fmtWan(park.currentMonthCollected, 0, hideAmount)}
              </div>
            </div>
            <div className="bg-sky-500/5 rounded-xl xl:rounded-2xl border border-sky-500/10 px-4 xl:px-6 flex flex-col justify-center text-center min-h-0">
              <div className="text-xs xl:text-lg text-sky-400/70 font-medium">本账期应收</div>
              <div className="text-2xl md:text-3xl xl:text-5xl font-bold text-sky-400 tabular-nums whitespace-nowrap mt-1 leading-none">
                {fmtWan(park.currentMonthReceivable, 0, hideAmount)}
              </div>
            </div>
            <div
              className={`rounded-xl xl:rounded-2xl border px-4 xl:px-6 flex flex-col justify-center text-center min-h-0 ${hasUnpaid ? 'bg-red-500/5 border-red-500/10' : 'bg-emerald-500/5 border-emerald-500/10'}`}
            >
              <div className={`text-xs xl:text-lg font-medium ${hasUnpaid ? 'text-red-400/70' : 'text-emerald-400/70'}`}>
                本账期末收
              </div>
              <div
                className={`text-2xl md:text-3xl xl:text-5xl font-bold tabular-nums whitespace-nowrap mt-1 leading-none ${hasUnpaid ? 'text-red-400' : 'text-emerald-400'}`}
              >
                {fmtWan(park.currentMonthUnpaid, 0, hideAmount)}
              </div>
            </div>
          </div>
        </section>

        {/* 经营指标 */}
        <section className="min-h-0 flex flex-col gap-2 xl:gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-5 h-0.5 rounded-full bg-sky-400/60" />
            <span className="text-xs xl:text-base text-sky-400 uppercase tracking-widest font-semibold">
              经营指标
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 xl:gap-5 flex-1 min-h-0">
            <div className={`${kpiCard} bg-white/5 border border-white/5 p-4 xl:p-6`}>
              <div className="text-xs xl:text-lg text-slate-500">年初预算</div>
              <div className="text-xl md:text-2xl xl:text-4xl font-bold text-white tabular-nums mt-1 xl:mt-2 leading-tight">
                {fmtWan(park.annualInitialBudget, 0, hideAmount)}
              </div>
              <div
                className={`text-xs xl:text-lg mt-1 xl:mt-2 ${park.budgetDeviation >= 0 ? 'text-sky-400' : 'text-red-400'}`}
              >
                偏差 {formatPercent(park.budgetDeviation, 0)}
              </div>
            </div>
            <div className={`${kpiCard} bg-white/5 border border-white/5 p-4 xl:p-6`}>
              <div className="text-xs xl:text-lg text-slate-500">回款完成率 / 客户</div>
              <div
                className={`text-xl md:text-2xl xl:text-4xl font-bold tabular-nums mt-1 xl:mt-2 leading-tight ${collectionOk ? 'text-emerald-400' : park.annualGoalCompletion >= 70 ? 'text-amber-400' : 'text-red-400'}`}
              >
                {formatPercent(park.annualGoalCompletion, 0)}
              </div>
              <div className="text-xs xl:text-lg text-slate-500 mt-1 xl:mt-2 truncate">
                {park.tenantCount} 户 · {formatArea(park.totalArea, 0)}
              </div>
            </div>
            <div className={`${kpiCard} bg-emerald-500/5 border border-emerald-500/10 p-4 xl:p-6 text-center`}>
              <div className="flex items-center justify-center gap-1.5 xl:gap-2 mb-1 xl:mb-2">
                <ArrowUp className="text-emerald-400 w-3.5 h-3.5 xl:w-5 xl:h-5" />
                <span className="text-xs xl:text-lg text-emerald-400/80 font-medium">新签约</span>
              </div>
              <div className="text-xl md:text-2xl xl:text-4xl font-bold text-emerald-400 tabular-nums leading-tight">
                {formatArea(park.newContractsArea, 0)}
              </div>
              <div className="text-xs xl:text-lg text-slate-500 mt-1 xl:mt-2">
                净增 {formatArea(park.netIncreaseArea, 0)}
              </div>
            </div>
            <div className={`${kpiCard} bg-red-500/5 border border-red-500/10 p-4 xl:p-6 text-center`}>
              <div className="flex items-center justify-center gap-1.5 xl:gap-2 mb-1 xl:mb-2">
                <ArrowDown className="text-red-400 w-3.5 h-3.5 xl:w-5 xl:h-5" />
                <span className="text-xs xl:text-lg text-red-400/80 font-medium">退租</span>
              </div>
              <div className="text-xl md:text-2xl xl:text-4xl font-bold text-red-400 tabular-nums leading-tight">
                {formatArea(park.terminatedContractsArea, 0)}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};
