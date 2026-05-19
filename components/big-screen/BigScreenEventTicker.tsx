import React, { useMemo } from 'react';
import { Zap, FileText, Banknote, FileCheck, AlertTriangle } from 'lucide-react';
import type { BigScreenEvent } from '../../services/bigScreenEvents';

interface Props {
  events: BigScreenEvent[];
}

const typeIcon: Record<string, React.ReactNode> = {
  new_contract: <FileText size={12} className="text-emerald-400" />,
  new_payment: <Banknote size={12} className="text-sky-400" />,
  new_invoice: <FileCheck size={12} className="text-purple-400" />,
  expiring_contract: <AlertTriangle size={12} className="text-amber-400" />,
  overdue_receivable: <AlertTriangle size={12} className="text-red-400" />,
};

const typeLabel: Record<string, string> = {
  new_contract: '签约',
  new_payment: '收款',
  new_invoice: '开票',
  expiring_contract: '到期',
  overdue_receivable: '逾期',
};

export const BigScreenEventTicker: React.FC<Props> = ({ events }) => {
  // Business events (contract/payment/invoice) + top 3 high-priority risk events only
  const displayEvents = useMemo(() => {
    const bizEvents = events.filter((e) =>
      ['new_contract', 'new_payment', 'new_invoice'].includes(e.type),
    );
    const riskEvents = events
      .filter((e) =>
        ['expiring_contract', 'overdue_receivable'].includes(e.type) && e.level === 'danger',
      )
      .slice(0, 3);
    return [...riskEvents, ...bizEvents].slice(0, 50);
  }, [events]);

  return (
    <div className="border-t border-white/10 bg-white/5 flex items-stretch overflow-hidden" style={{ height: 'clamp(56px, 8vh, 80px)' }}>
      {/* Label */}
      <div className="shrink-0 flex items-center gap-1.5 px-3 md:px-4 border-r border-white/5 bg-white/[0.03]">
        <Zap size={12} className="text-sky-400" />
        <span className="text-[11px] md:text-sm text-slate-400 font-semibold whitespace-nowrap">
          最新动态
        </span>
      </div>

      {/* Scrolling events */}
      {displayEvents.length > 0 ? (
        <div className="flex-1 overflow-hidden flex items-center min-w-0">
          <div className="flex gap-3 animate-marquee whitespace-nowrap px-3">
            {[...displayEvents, ...displayEvents].map((event, i) => (
              <div
                key={`${event.id}_${i}`}
                className="shrink-0 flex items-center gap-2 text-xs md:text-sm"
              >
                <span className="shrink-0">
                  {typeIcon[event.type] || <Zap size={12} />}
                </span>
                <span className="text-slate-400 text-[11px] md:text-sm">
                  {typeLabel[event.type] || event.type}
                </span>
                <span className="text-slate-300 truncate max-w-[200px] md:max-w-[320px]">
                  {event.title}
                </span>
                <span className="text-slate-600 text-[11px] md:text-sm tabular-nums">
                  {event.occurredAt?.slice(0, 10) || ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex items-center px-3 text-[11px] md:text-sm text-slate-600">
          近30天暂无新动态
        </div>
      )}
    </div>
  );
};
