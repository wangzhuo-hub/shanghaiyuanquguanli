import React from 'react';
import { formatWan } from '../../services/numberFormat';

interface Props {
  title?: string;
  receivable: number;
  collected: number;
  unpaid: number;
  hideAmount?: boolean;
  variant?: 'rent' | 'management_fee';
}

const fmtWan = (v: number, hide = false) => (hide ? '***' : formatWan(v, 0));

const themes = {
  rent: {
    collected: {
      box: 'bg-emerald-500/5 border-emerald-500/10',
      label: 'text-emerald-400/70',
      value: 'text-emerald-400',
    },
    receivable: {
      box: 'bg-sky-500/5 border-sky-500/10',
      label: 'text-sky-400/70',
      value: 'text-sky-400',
    },
    unpaid: {
      ok: { box: 'bg-emerald-500/5 border-emerald-500/10', label: 'text-emerald-400/70', value: 'text-emerald-400' },
      warn: { box: 'bg-red-500/5 border-red-500/10', label: 'text-red-400/70', value: 'text-red-400' },
    },
  },
  management_fee: {
    collected: {
      box: 'bg-teal-500/5 border-teal-500/10',
      label: 'text-teal-400/70',
      value: 'text-teal-400',
    },
    receivable: {
      box: 'bg-cyan-500/5 border-cyan-500/10',
      label: 'text-cyan-400/70',
      value: 'text-cyan-400',
    },
    unpaid: {
      ok: { box: 'bg-teal-500/5 border-teal-500/10', label: 'text-teal-400/70', value: 'text-teal-400' },
      warn: { box: 'bg-red-500/5 border-red-500/10', label: 'text-red-400/70', value: 'text-red-400' },
    },
  },
};

export const BigScreenPeriodCards: React.FC<Props> = ({
  title,
  receivable,
  collected,
  unpaid,
  hideAmount,
  variant = 'rent',
}) => {
  const theme = themes[variant];
  const unpaidTheme = unpaid > 0 ? theme.unpaid.warn : theme.unpaid.ok;
  const collectedLabel = variant === 'management_fee' ? '本账期已收 · 物业费' : '本账期已收';
  const receivableLabel = variant === 'management_fee' ? '本账期应收 · 物业费' : '本账期应收';
  const unpaidLabel = variant === 'management_fee' ? '本账期末收 · 物业费' : '本账期末收';

  return (
    <div className="min-h-0 flex flex-col gap-2 xl:gap-3">
      {title ? (
        <div className="flex items-center gap-2 shrink-0">
          <div className={`w-5 h-0.5 rounded-full ${variant === 'management_fee' ? 'bg-teal-400/60' : 'bg-sky-400/60'}`} />
          <span
            className={`text-xs xl:text-base uppercase tracking-widest font-semibold ${variant === 'management_fee' ? 'text-teal-400' : 'text-sky-400'}`}
          >
            {title}
          </span>
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-3 xl:gap-5 h-full min-h-[88px]">
        <div className={`rounded-xl xl:rounded-2xl border px-4 xl:px-6 flex flex-col justify-center text-center min-h-0 ${theme.collected.box}`}>
          <div className={`text-xs xl:text-lg font-medium ${theme.collected.label}`}>{collectedLabel}</div>
          <div className={`text-2xl md:text-3xl xl:text-5xl font-bold tabular-nums whitespace-nowrap mt-1 leading-none ${theme.collected.value}`}>
            {fmtWan(collected, hideAmount)}
          </div>
        </div>
        <div className={`rounded-xl xl:rounded-2xl border px-4 xl:px-6 flex flex-col justify-center text-center min-h-0 ${theme.receivable.box}`}>
          <div className={`text-xs xl:text-lg font-medium ${theme.receivable.label}`}>{receivableLabel}</div>
          <div className={`text-2xl md:text-3xl xl:text-5xl font-bold tabular-nums whitespace-nowrap mt-1 leading-none ${theme.receivable.value}`}>
            {fmtWan(receivable, hideAmount)}
          </div>
        </div>
        <div className={`rounded-xl xl:rounded-2xl border px-4 xl:px-6 flex flex-col justify-center text-center min-h-0 ${unpaidTheme.box}`}>
          <div className={`text-xs xl:text-lg font-medium ${unpaidTheme.label}`}>{unpaidLabel}</div>
          <div className={`text-2xl md:text-3xl xl:text-5xl font-bold tabular-nums whitespace-nowrap mt-1 leading-none ${unpaidTheme.value}`}>
            {fmtWan(unpaid, hideAmount)}
          </div>
        </div>
      </div>
    </div>
  );
};
