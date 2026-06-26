import React from 'react';
import { Banknote, Target, ArrowDown, ArrowUp } from 'lucide-react';
import { type BigScreenParkMetric } from '../../services/bigScreenMetrics';
import { formatWan, formatPercent, formatArea } from '../../services/numberFormat';
import { BigScreenPeriodCards } from './BigScreenPeriodCards';

interface Props {
  park: BigScreenParkMetric;
  year: number;
  hideAmount?: boolean;
}

const fmtWan = (v: number | null | undefined, d = 2, hide = false) =>
  hide ? '***' : formatWan(v, d);

const kpiCard =
  'liquid-bigscreen-card rounded-xl xl:rounded-2xl flex flex-col justify-center min-h-0 overflow-hidden';

export const BigScreenParkSlide: React.FC<Props> = ({ park, year, hideAmount }) => {
  const occupancyOk = park.occupancyRate >= park.annualOccupancyTarget;
  const collectionOk = park.annualGoalCompletion >= 90;
  const showManagementFee =
    park.managementFeeBillingEnabled &&
    (park.annualManagementFeeReceivable > 0 ||
      park.annualManagementFeeCollected > 0 ||
      park.currentMonthManagementFeeReceivable > 0);

  return (
    <div className="h-full w-full min-h-0 px-6 md:px-10 xl:px-16 py-4 xl:py-5">
      <div
        className={`h-full w-full max-w-[1800px] mx-auto min-h-0 grid gap-3 xl:gap-4 ${
          showManagementFee
            ? 'grid-rows-[auto_minmax(0,2fr)_minmax(0,0.9fr)_minmax(0,0.75fr)_minmax(0,1.4fr)]'
            : 'grid-rows-[auto_minmax(0,2.1fr)_minmax(0,1fr)_minmax(0,1.5fr)]'
        }`}
      >
        {/* Header */}
        <header className="text-center shrink-0">
          <h1 className="text-2xl font-black tracking-tight md:text-4xl xl:text-5xl">{park.parkName}</h1>
          <p className="mt-1 text-sm font-semibold text-slate-400 md:text-base xl:text-lg">{year}年度经营概览</p>
        </header>

        {/* Hero */}
        <section className="min-h-0">
          <div className="liquid-bigscreen-hero flex h-full items-center rounded-xl px-6 py-5 xl:rounded-2xl xl:px-12 xl:py-8">
            <div className="w-full grid grid-cols-1 md:grid-cols-2 gap-6 xl:gap-16">
              <div className="text-center md:text-left">
                <div className="flex items-center justify-center md:justify-start gap-2 mb-2 xl:mb-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-sky-400/16 ring-1 ring-sky-300/20 xl:h-11 xl:w-11">
                    <Banknote className="h-[18px] w-[18px] text-sky-300 xl:h-5 xl:w-5" />
                  </div>
                  <span className="text-sm font-semibold text-slate-300 xl:text-xl">年度租金实收</span>
                </div>
                <div className="text-5xl md:text-6xl xl:text-[5.25rem] font-bold text-white tabular-nums tracking-tight leading-none">
                  {fmtWan(park.annualRevenueCollected, 0, hideAmount)}
                </div>
                <div className="flex items-center justify-center md:justify-start gap-2 xl:gap-3 mt-3 xl:mt-4 flex-wrap">
                  <span className="text-xs xl:text-lg text-slate-500">
                    合同应收 {fmtWan(park.annualContractReceivable, 0, hideAmount)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold xl:text-lg ${collectionOk ? 'bg-cyan-400/16 text-cyan-300 ring-1 ring-cyan-300/20' : 'bg-amber-400/18 text-amber-300 ring-1 ring-amber-300/20'}`}
                  >
                    完成率 {formatPercent(park.annualGoalCompletion, 0)}
                  </span>
                </div>
                {showManagementFee ? (
                  <div className="mt-3 xl:mt-4 pt-3 xl:pt-4 border-t border-cyan-300/15">
                    <div className="text-xs xl:text-lg text-teal-400/80 font-medium">年度物业费实收</div>
                    <div className="text-2xl md:text-3xl xl:text-4xl font-bold text-teal-300 tabular-nums mt-1 leading-none">
                      {fmtWan(park.annualManagementFeeCollected, 0, hideAmount)}
                    </div>
                    <div className="text-xs xl:text-lg text-slate-500 mt-1">
                      应收 {fmtWan(park.annualManagementFeeReceivable, 0, hideAmount)} · 收缴{' '}
                      {formatPercent(park.annualManagementFeeCompletion, 0)}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="text-center md:text-right md:border-l md:border-cyan-300/15 md:pl-8 xl:pl-16">
                <div className="flex items-center justify-center md:justify-end gap-2 mb-2 xl:mb-4">
                  <span className="text-sm font-semibold text-slate-300 xl:text-xl">出租率</span>
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl xl:h-11 xl:w-11 ${occupancyOk ? 'bg-cyan-400/16 ring-1 ring-cyan-300/20' : 'bg-amber-400/18 ring-1 ring-amber-300/20'}`}
                  >
                    <Target className={`h-[18px] w-[18px] xl:h-5 xl:w-5 ${occupancyOk ? 'text-cyan-300' : 'text-amber-300'}`} />
                  </div>
                </div>
                <div
                  className={`text-5xl font-bold tabular-nums leading-none tracking-tight md:text-6xl xl:text-[5.25rem] ${occupancyOk ? 'text-cyan-300' : 'text-amber-300'}`}
                >
                  {formatPercent(park.occupancyRate, 0)}
                </div>
                <div className="flex items-center justify-center md:justify-end gap-2 xl:gap-3 mt-3 xl:mt-4 flex-wrap">
                  <span className="text-xs xl:text-lg text-slate-500">
                    目标 {formatPercent(park.annualOccupancyTarget, 0)}
                  </span>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold xl:text-lg ${occupancyOk ? 'bg-cyan-400/16 text-cyan-300 ring-1 ring-cyan-300/20' : 'bg-amber-400/18 text-amber-300 ring-1 ring-amber-300/20'}`}
                  >
                    {occupancyOk ? '达标' : `差 ${formatPercent(park.annualOccupancyTarget - park.occupancyRate, 0)}`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* 当前账期 · 租金 */}
        <section className="min-h-0">
          <BigScreenPeriodCards
            title="本账期 · 租金"
            receivable={park.currentMonthReceivable}
            collected={park.currentMonthCollected}
            unpaid={park.currentMonthUnpaid}
            hideAmount={hideAmount}
            variant="rent"
          />
        </section>

        {showManagementFee ? (
          <section className="min-h-0">
            <BigScreenPeriodCards
              title="本账期 · 物业费"
              receivable={park.currentMonthManagementFeeReceivable}
              collected={park.currentMonthManagementFeeCollected}
              unpaid={park.currentMonthManagementFeeUnpaid}
              hideAmount={hideAmount}
              variant="management_fee"
            />
          </section>
        ) : null}

        {/* 经营指标 */}
        <section className="min-h-0 flex flex-col gap-2 xl:gap-3">
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-5 h-0.5 rounded-full bg-sky-400/60" />
            <span className="text-xs xl:text-base text-sky-400 uppercase tracking-widest font-semibold">
              经营指标
            </span>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 xl:gap-5 flex-1 min-h-0">
            <div className={`${kpiCard} p-4 xl:p-6`}>
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
            <div className={`${kpiCard} p-4 xl:p-6`}>
              <div className="text-xs xl:text-lg text-slate-500">回款完成率 / 客户</div>
              <div
                className={`text-xl md:text-2xl xl:text-4xl font-bold tabular-nums mt-1 xl:mt-2 leading-tight ${collectionOk ? 'text-cyan-300' : park.annualGoalCompletion >= 70 ? 'text-amber-400' : 'text-red-400'}`}
              >
                {formatPercent(park.annualGoalCompletion, 0)}
              </div>
              <div className="text-xs xl:text-lg text-slate-500 mt-1 xl:mt-2 truncate">
                {park.tenantCount} 户 · {formatArea(park.totalArea, 0)}
              </div>
            </div>
            <div className={`${kpiCard} p-4 text-center xl:p-6`}>
              <div className="flex items-center justify-center gap-1.5 xl:gap-2 mb-1 xl:mb-2">
                <ArrowUp className="h-3.5 w-3.5 text-cyan-300 xl:h-5 xl:w-5" />
                <span className="text-xs font-semibold text-cyan-300/85 xl:text-lg">新签约</span>
              </div>
              <div className="text-xl font-bold tabular-nums leading-tight text-cyan-300 md:text-2xl xl:text-4xl">
                {formatArea(park.newContractsArea, 0)}
              </div>
              <div className="text-xs xl:text-lg text-slate-500 mt-1 xl:mt-2">
                净增 {formatArea(park.netIncreaseArea, 0)}
              </div>
            </div>
            <div className={`${kpiCard} p-4 text-center xl:p-6`}>
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
