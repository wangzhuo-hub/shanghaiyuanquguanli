import React, { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { BigScreenAlert } from '../../services/bigScreenAlerts';
import { formatWan } from '../../services/numberFormat';

interface Props {
  alerts: BigScreenAlert[];
}

const fmtWan = (v: number | null | undefined, d = 2) => formatWan(v, d);

const sectionStyle = 'bg-white/[0.03] rounded-xl border border-white/8 p-3 md:p-4 flex flex-col min-h-0';

export const BigScreenAlerts: React.FC<Props> = ({ alerts }) => {
  const { highReceivables, contractExpiring, operational } = useMemo(() => {
    const high = alerts.filter(
      (a) => a.type === 'receivable_overdue' && a.level === 'high',
    );
    const expiring = alerts.filter((a) => a.type === 'contract_expiring');
    const ops = alerts.filter((a) =>
      ['low_occupancy', 'low_collection'].includes(a.type),
    );
    return { highReceivables: high, contractExpiring: expiring, operational: ops };
  }, [alerts]);

  const highCount = alerts.filter((a) => a.level === 'high').length;
  const mediumCount = alerts.filter((a) => a.level === 'medium').length;
  const lowCount = alerts.filter((a) => a.level === 'low').length;

  return (
    <div className="h-full flex flex-col px-4 md:px-8 pt-3 md:pt-5 pb-4 md:pb-6">
      {/* ====== Header + stats ====== */}
      <div className="text-center mb-3 md:mb-4 shrink-0">
        <h2 className="text-xl md:text-4xl font-bold">智能预警</h2>
        <p className="text-slate-500 mt-0.5 text-[11px] md:text-sm">
          共 {alerts.length} 条风险
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3 md:mb-4 shrink-0 max-w-md mx-auto w-full">
        <div className="bg-red-500/10 rounded-lg p-2 md:p-3 border border-red-500/20 text-center">
          <div className="text-lg md:text-2xl font-bold text-red-400">{highCount}</div>
          <div className="text-[11px] md:text-sm text-red-300/60">高风险</div>
        </div>
        <div className="bg-amber-500/10 rounded-lg p-2 md:p-3 border border-amber-500/20 text-center">
          <div className="text-lg md:text-2xl font-bold text-amber-400">{mediumCount}</div>
          <div className="text-[11px] md:text-sm text-amber-300/60">中风险</div>
        </div>
        <div className="bg-sky-500/10 rounded-lg p-2 md:p-3 border border-sky-500/20 text-center">
          <div className="text-lg md:text-2xl font-bold text-sky-400">{lowCount}</div>
          <div className="text-[11px] md:text-sm text-sky-300/60">低风险</div>
        </div>
      </div>

      {alerts.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-slate-500">
          <div className="text-center">
            <AlertTriangle size={32} className="mx-auto mb-2 text-slate-600" />
            <p className="text-xs md:text-sm">当前无预警，经营状态良好</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 md:grid-cols-[1.4fr_1fr] gap-2 md:gap-3 min-h-0">
          {/* Left: High-risk receivables */}
          <div className={`${sectionStyle} ${highReceivables.length > 0 ? 'border-red-500/15' : ''}`}>
            <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
              <div className="w-5 h-0.5 rounded-full bg-red-400/60" />
              <span className="text-xs md:text-sm text-red-400 font-semibold uppercase tracking-wider">
                高风险待收款
              </span>
              <span className="text-[11px] md:text-sm text-slate-500">{highReceivables.length} 条</span>
            </div>
            <div className="flex-1 overflow-auto space-y-1.5 min-h-0">
              {highReceivables.slice(0, 6).map((a) => (
                <div key={a.id} className="bg-red-500/8 border border-red-500/10 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] md:text-sm text-red-300/80 truncate max-w-[55%]">{a.parkName} · {a.tenantName || '—'}</span>
                    <span className="text-[11px] md:text-sm font-bold text-red-400 tabular-nums">未收 {fmtWan(a.amount, 0)}</span>
                  </div>
                </div>
              ))}
              {highReceivables.length === 0 && (
                <div className="text-[11px] md:text-sm text-slate-500 py-2 text-center">无高风险待收款</div>
              )}
            </div>
          </div>

          {/* Right: Contract expiry + Operational */}
          <div className="flex flex-col gap-2 md:gap-3 min-h-0">
            {/* Contract expiry */}
            <div className={`${sectionStyle} flex-1`}>
              <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
                <div className="w-5 h-0.5 rounded-full bg-amber-400/60" />
                <span className="text-xs md:text-sm text-amber-400 font-semibold uppercase tracking-wider">
                  合同到期预警
                </span>
                <span className="text-[11px] md:text-sm text-slate-500">{contractExpiring.length} 条</span>
              </div>
              <div className="flex-1 overflow-auto space-y-1.5 min-h-0">
                {contractExpiring.slice(0, 4).map((a) => (
                  <div key={a.id} className="bg-amber-500/8 border border-amber-500/10 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] md:text-sm text-amber-300/80 truncate max-w-[55%]">{a.parkName} · {a.tenantName || '—'}</span>
                      <span className="text-[11px] md:text-sm font-bold text-amber-400 tabular-nums">剩余 {a.days || '?'} 天</span>
                    </div>
                  </div>
                ))}
                {contractExpiring.length === 0 && (
                  <div className="text-[11px] md:text-sm text-slate-500 py-2 text-center">无即将到期合同</div>
                )}
              </div>
            </div>

            {/* Operational risks */}
            <div className={`${sectionStyle} ${operational.length > 0 ? '' : ''}`}>
              <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
                <div className="w-5 h-0.5 rounded-full bg-purple-400/60" />
                <span className="text-xs md:text-sm text-purple-400 font-semibold uppercase tracking-wider">
                  经营指标风险
                </span>
                <span className="text-[11px] md:text-sm text-slate-500">{operational.length} 条</span>
              </div>
              <div className="overflow-auto space-y-1.5 max-h-[120px] md:max-h-[150px]">
                {operational.slice(0, 4).map((a) => (
                  <div key={a.id} className="bg-purple-500/8 border border-purple-500/10 rounded-lg px-3 py-2">
                    <p className="text-[11px] md:text-sm text-slate-300 truncate">{a.title}</p>
                  </div>
                ))}
                {operational.length === 0 && (
                  <div className="text-[11px] md:text-sm text-slate-500 py-2 text-center">经营指标正常</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
