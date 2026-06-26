import React, { useMemo } from 'react';
import { Zap, FileText, Banknote, FileCheck, AlertTriangle } from 'lucide-react';
import type { BigScreenEvent } from '../../services/bigScreenEvents';

interface Props {
  events: BigScreenEvent[];
}

const typeIcon: Record<string, React.ReactNode> = {
  new_contract: <FileText size={12} className="text-cyan-300" />,
  new_payment: <Banknote size={12} className="text-sky-400" />,
  new_invoice: <FileCheck size={12} className="text-blue-300" />,
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
    <div className="liquid-bigscreen-ticker flex items-stretch overflow-hidden" style={{ height: 'clamp(56px, 8vh, 80px)' }}>
      {/* Label */}
      <div className="flex shrink-0 items-center gap-1.5 border-r border-cyan-300/15 bg-cyan-300/[0.05] px-3 md:px-4">
        <Zap size={12} className="text-sky-400" />
        <span className="whitespace-nowrap text-[11px] font-bold text-slate-300 md:text-sm">
          最新动态
        </span>
      </div>

      {/* Scrolling events */}
      {displayEvents.length > 0 ? (
        <div className="flex min-w-0 flex-1 items-center overflow-hidden">
          <div className="flex gap-3 animate-marquee whitespace-nowrap px-3">
            {[...displayEvents, ...displayEvents].map((event, i) => (
              <div
                key={`${event.id}_${i}`}
                className="liquid-bigscreen-row flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs md:text-sm"
              >
                <span className="shrink-0">
                  {typeIcon[event.type] || <Zap size={12} />}
                </span>
                <span className="text-[11px] font-bold text-slate-400 md:text-sm">
                  {typeLabel[event.type] || event.type}
                </span>
                <span className="max-w-[200px] truncate text-slate-200 md:max-w-[320px]">
                  {event.title}
                </span>
                <span className="text-[11px] tabular-nums text-slate-500 md:text-sm">
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
