import React, { useMemo } from 'react';
import { AlertTriangle, Building2 } from 'lucide-react';
import type { BigScreenAlert } from '../../services/bigScreenAlerts';
import { formatWan } from '../../services/numberFormat';

interface Props {
  alerts: BigScreenAlert[];
}

const fmtWan = (v: number | null | undefined, d = 2) => formatWan(v, d);

const sectionStyle = 'liquid-bigscreen-panel rounded-[24px] p-3 md:p-4 flex flex-col min-h-0';

const levelLabel: Record<BigScreenAlert['level'], string> = {
  high: '高风险',
  medium: '中风险',
  low: '低风险',
};

interface ParkRiskGroup {
  parkName: string;
  types: { typeLabel: string; items: BigScreenAlert[] }[];
}

const groupByParkAndRiskType = (
  items: BigScreenAlert[],
  getRiskTypeLabel: (a: BigScreenAlert) => string,
  sortItems: (a: BigScreenAlert, b: BigScreenAlert) => number = (a, b) =>
    (b.amount ?? 0) - (a.amount ?? 0),
): ParkRiskGroup[] => {
  const parkOrder: string[] = [];
  const parkMap = new Map<string, Map<string, BigScreenAlert[]>>();

  for (const alert of items) {
    if (!parkMap.has(alert.parkName)) {
      parkMap.set(alert.parkName, new Map());
      parkOrder.push(alert.parkName);
    }
    const typeMap = parkMap.get(alert.parkName)!;
    const typeLabel = getRiskTypeLabel(alert);
    if (!typeMap.has(typeLabel)) typeMap.set(typeLabel, []);
    typeMap.get(typeLabel)!.push(alert);
  }

  return parkOrder.map((parkName) => {
    const typeMap = parkMap.get(parkName)!;
    const types = [...typeMap.entries()].map(([typeLabel, groupItems]) => ({
      typeLabel,
      items: [...groupItems].sort(sortItems),
    }));
    types.sort((a, b) => {
      const amountA = a.items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
      const amountB = b.items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
      return amountB - amountA;
    });
    return { parkName, types };
  });
};

const receivableRiskType = (a: BigScreenAlert) => a.statusLabel || levelLabel[a.level];

const contractRiskType = (a: BigScreenAlert) => `${levelLabel[a.level]} · 合同到期`;

const operationalRiskType = (a: BigScreenAlert) =>
  a.type === 'low_occupancy' ? '出租率偏低' : '回款进度落后';

interface GroupedAlertListProps {
  groups: ParkRiskGroup[];
  emptyText: string;
  accent: 'red' | 'amber' | 'cyan';
  renderMeta: (a: BigScreenAlert) => React.ReactNode;
}

const accentStyles = {
  red: {
    park: 'text-red-300/90',
    type: 'text-red-400/70',
    card: 'bg-red-500/8 border-red-500/10',
    meta: 'text-red-400',
    text: 'text-red-300/80',
  },
  amber: {
    park: 'text-amber-300/90',
    type: 'text-amber-400/70',
    card: 'bg-amber-500/8 border-amber-500/10',
    meta: 'text-amber-400',
    text: 'text-amber-300/80',
  },
  cyan: {
    park: 'text-cyan-300/90',
    type: 'text-cyan-300/70',
    card: 'bg-cyan-400/8 border-cyan-300/10',
    meta: 'text-cyan-300',
    text: 'text-slate-300',
  },
};

const GroupedAlertList: React.FC<GroupedAlertListProps> = ({
  groups,
  emptyText,
  accent,
  renderMeta,
}) => {
  const styles = accentStyles[accent];

  if (groups.length === 0) {
    return <div className="text-[11px] md:text-sm text-slate-500 py-2 text-center">{emptyText}</div>;
  }

  return (
    <div className="space-y-3 md:space-y-4">
      {groups.map((park) => {
        const itemCount = park.types.reduce((sum, t) => sum + t.items.length, 0);
        return (
          <div key={park.parkName}>
            <div className={`flex items-center gap-1.5 mb-1.5 md:mb-2 text-xs md:text-sm font-semibold ${styles.park}`}>
              <Building2 size={12} className="shrink-0 opacity-70" />
              <span>{park.parkName}</span>
              <span className="text-slate-500 font-normal">{itemCount} 条</span>
            </div>
            <div className="space-y-2 md:space-y-2.5 ml-1 border-l border-white/8 pl-2.5 md:pl-3">
              {park.types.map((typeGroup) => (
                <div key={`${park.parkName}_${typeGroup.typeLabel}`}>
                  <div className={`text-[10px] md:text-xs font-medium mb-1 ${styles.type}`}>
                    {typeGroup.typeLabel}
                    <span className="text-slate-600 font-normal ml-1.5">{typeGroup.items.length}</span>
                  </div>
                  <div className="space-y-1 md:space-y-1.5">
                    {typeGroup.items.map((a) => {
                      const meta = renderMeta(a);
                      return (
                      <div
                        key={a.id}
                        className={`liquid-bigscreen-row rounded-2xl px-2.5 py-1.5 md:px-3 md:py-2 ${styles.card}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-[11px] md:text-sm truncate ${styles.text}`}>
                            {a.tenantName || a.title}
                          </span>
                          {meta ? (
                            <span className={`text-[11px] md:text-sm font-bold tabular-nums shrink-0 ${styles.meta}`}>
                              {meta}
                            </span>
                          ) : null}
                        </div>
                        {!meta && a.description ? (
                          <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 truncate">{a.description}</p>
                        ) : null}
                      </div>
                    );})}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const BigScreenAlerts: React.FC<Props> = ({ alerts }) => {
  const { receivables, contractExpiring, operational, groupedReceivables, groupedExpiring, groupedOperational } =
    useMemo(() => {
      const recv = alerts.filter((a) => a.type === 'receivable_overdue');
      const expiring = alerts.filter((a) => a.type === 'contract_expiring');
      const ops = alerts.filter((a) => ['low_occupancy', 'low_collection'].includes(a.type));
      return {
        receivables: recv,
        contractExpiring: expiring,
        operational: ops,
        groupedReceivables: groupByParkAndRiskType(recv, receivableRiskType),
        groupedExpiring: groupByParkAndRiskType(
          expiring,
          contractRiskType,
          (a, b) => (a.days ?? 999) - (b.days ?? 999),
        ),
        groupedOperational: groupByParkAndRiskType(ops, operationalRiskType),
      };
    }, [alerts]);

  const highCount = alerts.filter((a) => a.level === 'high').length;
  const mediumCount = alerts.filter((a) => a.level === 'medium').length;
  const lowCount = alerts.filter((a) => a.level === 'low').length;

  return (
    <div className="h-full flex flex-col px-4 md:px-8 pt-3 md:pt-5 pb-4 md:pb-6">
      {/* ====== Header + stats ====== */}
      <div className="text-center mb-3 md:mb-4 shrink-0">
        <h2 className="text-xl font-black md:text-4xl">智能预警</h2>
        <p className="mt-0.5 text-[11px] font-semibold text-slate-400 md:text-sm">
          共 {alerts.length} 条风险 · 按园区 / 风险类型分组
        </p>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-2 md:gap-3 mb-3 md:mb-4 shrink-0 max-w-md mx-auto w-full">
        <div className="liquid-bigscreen-card rounded-2xl p-2 text-center md:p-3">
          <div className="text-lg md:text-2xl font-bold text-red-400">{highCount}</div>
          <div className="text-[11px] md:text-sm text-red-300/60">高风险</div>
        </div>
        <div className="liquid-bigscreen-card rounded-2xl p-2 text-center md:p-3">
          <div className="text-lg md:text-2xl font-bold text-amber-400">{mediumCount}</div>
          <div className="text-[11px] md:text-sm text-amber-300/60">中风险</div>
        </div>
        <div className="liquid-bigscreen-card rounded-2xl p-2 text-center md:p-3">
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
          {/* Left: Receivables by park + risk type */}
          <div className={`${sectionStyle} ${receivables.length > 0 ? 'border-red-500/20' : ''}`}>
            <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
              <div className="w-5 h-0.5 rounded-full bg-red-400/60" />
              <span className="text-xs md:text-sm text-red-400 font-semibold uppercase tracking-wider">
                待收款预警
              </span>
              <span className="text-[11px] md:text-sm text-slate-500">{receivables.length} 条</span>
            </div>
            <div className="flex-1 overflow-auto min-h-0">
              <GroupedAlertList
                groups={groupedReceivables}
                emptyText="无待收款预警"
                accent="red"
                renderMeta={(a) => `未收 ${fmtWan(a.amount, 0)}`}
              />
            </div>
          </div>

          {/* Right: Contract expiry + Operational */}
          <div className="flex flex-col gap-2 md:gap-3 min-h-0">
            <div className={`${sectionStyle} flex-1 min-h-0`}>
              <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
                <div className="w-5 h-0.5 rounded-full bg-amber-400/60" />
                <span className="text-xs md:text-sm text-amber-400 font-semibold uppercase tracking-wider">
                  合同到期预警
                </span>
                <span className="text-[11px] md:text-sm text-slate-500">{contractExpiring.length} 条</span>
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                <GroupedAlertList
                  groups={groupedExpiring}
                  emptyText="无即将到期合同"
                  accent="amber"
                  renderMeta={(a) => `剩余 ${a.days ?? '?'} 天`}
                />
              </div>
            </div>

            <div className={`${sectionStyle} flex-1 min-h-0`}>
              <div className="flex items-center gap-2 mb-2 md:mb-3 shrink-0">
                <div className="w-5 h-0.5 rounded-full bg-cyan-400/70" />
                <span className="text-xs md:text-sm text-cyan-300 font-semibold uppercase tracking-wider">
                  经营指标风险
                </span>
                <span className="text-[11px] md:text-sm text-slate-500">{operational.length} 条</span>
              </div>
              <div className="flex-1 overflow-auto min-h-0">
                <GroupedAlertList
                  groups={groupedOperational}
                  emptyText="经营指标正常"
                  accent="cyan"
                  renderMeta={() => ''}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
