
import React, { useEffect, useMemo, useState } from 'react';
import { AuthUser, BillingDetail, Building, DashboardData } from '../types';
import { CheckCircle2, AlertCircle, Building2, Wallet, Calendar, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import {
    buildReceivableSections,
    getRentCollectionRemark,
    deferReceivableShellClass,
    receivableBudgetDisplay,
    parseManualReceivableLinesFromNotes,
} from '../services/receivableListHelpers';
import { formatCurrency, formatPercent } from '../services/numberFormat';
import { isManagementFeeBillingEnabled } from '../services/parkBillingConfig';
import { canViewRentPricing } from '../services/receivablePermissions';
import { useMinMdViewport } from '../hooks/useMediaQuery';

function isMgmtFeeRow(row: BillingDetail): boolean {
    return (row.feeKind || 'rent') === 'management_fee';
}

/** 备注仅本地编辑，debounce 后写入父级，避免每次按键触发整页重渲染 */
const RentRemarkField: React.FC<{
    tenantId: string;
    periodYYYYMM: string;
    notes: Record<string, string> | undefined;
    onSave?: (tenantId: string, period: string, text: string) => void;
    className?: string;
}> = ({ tenantId, periodYYYYMM, notes, onSave, className }) => {
    const saved = getRentCollectionRemark(notes, tenantId, periodYYYYMM);
    const [draft, setDraft] = useState(saved);
    useEffect(() => {
        setDraft(saved);
    }, [saved, tenantId, periodYYYYMM]);
    return (
        <textarea
            className={className}
            placeholder="预期收款日、沟通情况等"
            value={draft}
            onChange={(e) => {
                const next = e.target.value;
                setDraft(next);
                onSave?.(tenantId, periodYYYYMM, next);
            }}
            disabled={!onSave}
        />
    );
};

function sumBillingTotals(rows: BillingDetail[]) {
    const totalDue = rows.reduce((acc, curr) => acc + receivableBudgetDisplay(curr), 0);
    const totalPaid = rows.reduce((acc, curr) => acc + (curr.amountPaid ?? 0), 0);
    const collectionRate = totalDue > 0.005 ? (totalPaid / totalDue) * 100 : totalPaid > 0.005 ? 100 : 0;
    return { totalDue, totalPaid, collectionRate };
}

const WRITEOFF_LABELS = {
  pending: '待核销',
  settled: '已核销和收款',
  deferred: '已缓缴',
} as const;

function writeOffBadgeClass(label: string) {
  if (label === WRITEOFF_LABELS.pending) return 'liquid-finance-writeoff-badge liquid-finance-writeoff-badge--pending';
  if (label === WRITEOFF_LABELS.settled) return 'liquid-finance-writeoff-badge liquid-finance-writeoff-badge--settled';
  if (label === WRITEOFF_LABELS.deferred) return 'liquid-finance-writeoff-badge liquid-finance-writeoff-badge--deferred';
  return 'liquid-finance-writeoff-badge liquid-finance-writeoff-badge--muted';
}

function writeOffSectionClass(label: string) {
  if (label === WRITEOFF_LABELS.pending) return 'liquid-finance-section-heading liquid-finance-section-heading--pending';
  if (label === WRITEOFF_LABELS.settled) return 'liquid-finance-section-heading liquid-finance-section-heading--settled';
  if (label === WRITEOFF_LABELS.deferred) return 'liquid-finance-section-heading liquid-finance-section-heading--deferred';
  return 'liquid-finance-section-heading liquid-finance-section-heading--muted';
}

interface BillingTableProps {
    data: DashboardData;
    selectedMonth: string;
    onMonthChange: (val: string) => void;
    /** 按租户 + 当前账期保存跟进备注 */
    onUpdateRentRemark?: (tenantId: string, periodYYYYMM: string, remark: string) => void;
    projectId?: string;
    authUser?: AuthUser | null;
}

// Mobile Card Component
const BillingCard: React.FC<{
    item: any;
    building: any;
    unitNames: string;
    writeOffLabel: string;
    notes: Record<string, string> | undefined;
    selectedMonth: string;
    onRemarkSave?: (tenantId: string, period: string, text: string) => void;
    remarkDisabled?: boolean;
}> = ({ item, building, unitNames, writeOffLabel, notes, selectedMonth, onRemarkSave, remarkDisabled }) => {
    const deferShell = deferReceivableShellClass(item);
    const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
    const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
    const cardSummaryLabel = `${item.tenantName}，${building?.name || '未匹配楼宇'} ${unitNames || '未匹配房号'}，${writeOffLabel}，应收 ${formatCurrency(receivableBudgetDisplay(item))}，实收 ${formatCurrency(item.amountPaid)}${hasDeferOut ? `，缓出至 ${item.deferredToPeriod} ${formatCurrency(item.deferredAmount ?? 0)}` : ''}${hasDeferIn ? `，由 ${item.deferredInFromSummary} 缓入 ${formatCurrency(item.deferredInAmount ?? 0)}` : ''}`;
    return (
    <div
        className={`liquid-finance-mobile-card mobile-card-enter m-2 rounded-[22px] border border-white/70 p-4 ${deferShell}`}
        role="group"
        aria-label={cardSummaryLabel}
        title={cardSummaryLabel}
    >
        <div className="flex justify-between items-start mb-2">
            <div className="font-medium text-slate-800">
                <div className="flex items-center gap-2">
                    <span className="liquid-icon-well flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-xs font-black text-blue-700">
                        {item.tenantName.substring(0,1)}
                    </span>
                    <span className="font-black text-slate-950">{item.tenantName}</span>
                </div>
                {hasDeferOut && (
                    <div className="ml-8 mt-1.5 text-xs font-semibold leading-snug text-orange-800">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                )}
                {hasDeferIn && (
                    <div className="ml-8 mt-1 text-xs font-semibold leading-snug text-sky-800">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                )}
                {item.budgetAlignmentNote && (
                    <div className="liquid-finance-alignment-note ml-8 mt-1.5 rounded-xl px-2 py-1 text-xs font-semibold leading-snug">
                        {item.budgetAlignmentNote}
                    </div>
                )}
            </div>
            <div className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-black ${writeOffBadgeClass(writeOffLabel)}`}>
                {writeOffLabel === WRITEOFF_LABELS.settled ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {writeOffLabel}
            </div>
        </div>
        <div className="mb-2 text-xs font-semibold text-slate-500">
            {building?.name} {unitNames}
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-white/70 pt-2 text-sm">
            <div className="text-slate-500">
                应收: <span className="font-semibold text-slate-700">{formatCurrency(receivableBudgetDisplay(item))}</span>
                {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                    <span className="mt-0.5 block text-xs font-semibold text-slate-500">原账面应收已全部缓出</span>
                )}
            </div>
            <div className={writeOffLabel === WRITEOFF_LABELS.settled ? 'text-cyan-700' : 'text-blue-700'}>
                实收: <span className="font-bold">{formatCurrency(item.amountPaid)}</span>
            </div>
        </div>
        <div className="mt-2">
            <label className="text-xs font-bold text-slate-500">备注</label>
            <RentRemarkField
                tenantId={item.tenantId}
                periodYYYYMM={selectedMonth}
                notes={notes}
                onSave={remarkDisabled ? undefined : onRemarkSave}
                className="liquid-elevated-field mt-1 min-h-[56px] w-full resize-y rounded-2xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
            />
        </div>
    </div>
    );
};

export const BillingTable: React.FC<BillingTableProps> = ({
  data,
  selectedMonth,
  onMonthChange,
  onUpdateRentRemark,
  projectId: projectIdProp,
  authUser = null,
}) => {
  const isDesktop = useMinMdViewport();
  const projectId =
      projectIdProp ||
      data.tenants?.find((t) => (t.projectId || '').trim())?.projectId ||
      '';
  const mgmtFeeParkEnabled = isManagementFeeBillingEnabled(projectId);
  const viewRentPricing = canViewRentPricing(authUser);
  const [feeTab, setFeeTab] = useState<'rent' | 'management_fee'>(() =>
      viewRentPricing ? 'rent' : 'management_fee',
  );

  useEffect(() => {
      if (!viewRentPricing && mgmtFeeParkEnabled) {
          setFeeTab('management_fee');
      }
  }, [viewRentPricing, mgmtFeeParkEnabled]);

  const fullBillingList = data.currentMonthBilling || [];
  const rentRows = useMemo(
      () => fullBillingList.filter((row) => !isMgmtFeeRow(row)),
      [fullBillingList],
  );
  const mgmtRows = useMemo(() => fullBillingList.filter(isMgmtFeeRow), [fullBillingList]);
  const billingList = feeTab === 'management_fee' ? mgmtRows : rentRows;

  const receivableSections = useMemo(
      () => buildReceivableSections(billingList, selectedMonth, data.payments || [], data.tenants || []),
      [billingList, selectedMonth, data.payments, data.tenants]
  );

  const { totalDue, totalPaid } = useMemo(() => sumBillingTotals(billingList), [billingList]);
  const rentTotals = useMemo(() => sumBillingTotals(rentRows), [rentRows]);
  const mgmtTotals = useMemo(() => sumBillingTotals(mgmtRows), [mgmtRows]);

  // 与「财务报表 本月应收租金」对账：财务报表的合计含手工应收行，工作台不含。
  // 这里读取本月手工应收行金额，提示用户两边差额来源，避免对账困惑。
  const manualReceivableThisMonth = useMemo(() => {
      const lines = parseManualReceivableLinesFromNotes(data.billingPeriodNotes);
      return lines
          .filter((l) => l.periodYYYYMM === selectedMonth)
          .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  }, [data.billingPeriodNotes, selectedMonth]);
  const financeTotalDue = totalDue + manualReceivableThisMonth;

  const isMgmtTab = feeTab === 'management_fee';
  const dueColumnLabel = isMgmtTab ? '应收物业费' : '应收租金';
  const paidColumnLabel = isMgmtTab ? '实收物业费' : '实收租金';
  const panelTitle = isMgmtTab ? '物业费账单明细' : '租金账单明细';
  const panelSubtitle = isMgmtTab
      ? '来源: 合同物业费条款 · 与财务报表「物业费应收」一致'
      : '来源: 预算管理 (含手动调整) · 与财务报表「租金应收」一致';

  const unitLocationByUnitId = useMemo(() => {
      const map = new Map<string, { building: Building; unitName: string }>();
      for (const building of data.buildings) {
          for (const unit of building.units) {
              map.set(unit.id, { building, unitName: unit.name });
          }
      }
      return map;
  }, [data.buildings]);

  const resolveUnitLocation = (unitIds: string[]) => {
      const names: string[] = [];
      let building: Building | undefined;
      for (const uid of unitIds) {
          const hit = unitLocationByUnitId.get(uid);
          if (hit) {
              building = hit.building;
              names.push(hit.unitName);
          } else {
              names.push(uid);
          }
      }
      return { building, unitNames: names.join(', ') };
  };

  const renderBillingDetailRow = (item: BillingDetail, writeOffLabel: string, rowKey: string) => {
      const { building, unitNames } = resolveUnitLocation(item.unitIds);
      const paidClass =
          writeOffLabel === WRITEOFF_LABELS.settled
              ? 'text-cyan-700 font-bold'
              : writeOffLabel === WRITEOFF_LABELS.deferred
                ? 'text-blue-700 font-bold'
                : 'text-amber-700 font-bold';
      const deferShell = deferReceivableShellClass(item);
      const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
      const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
      return (
          <tr key={rowKey} className={`liquid-finance-table-row transition-colors group ${deferShell}`}>
              <td className="px-6 py-4 text-slate-800">
                  <div className="flex items-center gap-2 font-bold">
                      <span className="liquid-icon-well flex h-8 w-8 shrink-0 items-center justify-center rounded-2xl text-xs font-black text-blue-700">
                          {item.tenantName.substring(0, 1)}
                      </span>
                      <div>
                          <div className="text-slate-950">{item.tenantName}</div>
                          {hasDeferOut && (
                              <div className="mt-0.5 text-xs font-semibold text-orange-800">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                          )}
                          {hasDeferIn && (
                              <div className="mt-0.5 text-xs font-semibold text-sky-800">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                          )}
                          {item.budgetAlignmentNote && (
                              <div className="liquid-finance-alignment-note mt-1 max-w-[280px] rounded-xl px-2 py-1 text-xs font-semibold leading-snug">
                                  {item.budgetAlignmentNote}
                              </div>
                          )}
                      </div>
                  </div>
              </td>
              <td className="px-6 py-4 text-slate-600">
                  {building?.name} <span className="ml-1 font-semibold text-slate-500">{unitNames}</span>
              </td>
              <td className="px-6 py-4 font-semibold text-slate-700 align-top">
                  <div>{formatCurrency(receivableBudgetDisplay(item))}</div>
                  {item.earlyTerminationBreakdown && (
                      <div className="mt-1 max-w-[220px] text-xs font-semibold leading-snug text-amber-800">
                          {item.earlyTerminationBreakdown}
                      </div>
                  )}
                  {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                      <div className="mt-0.5 text-xs font-semibold text-slate-500">原账面应收已全部缓出</div>
                  )}
              </td>
              <td className="px-6 py-4">
                  <span className={paidClass}>{formatCurrency(item.amountPaid)}</span>
              </td>
              <td className="px-6 py-4">
                  <div className={`flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-1 font-black ${writeOffBadgeClass(writeOffLabel)}`}>
                      {writeOffLabel === WRITEOFF_LABELS.settled ? (
                          <CheckCircle2 size={16} className="shrink-0" />
                      ) : (
                          <AlertCircle size={16} className="shrink-0" />
                      )}
                      <span>{writeOffLabel}</span>
                  </div>
              </td>
              <td className="px-6 py-3 align-top max-w-[240px]">
                  <RentRemarkField
                      tenantId={item.tenantId}
                      periodYYYYMM={selectedMonth}
                      notes={data.billingPeriodNotes}
                      onSave={onUpdateRentRemark}
                      className="liquid-elevated-field min-h-[56px] w-full resize-y rounded-2xl px-3 py-2 text-xs font-semibold text-slate-700 outline-none focus-visible:ring-4 focus-visible:ring-blue-500/10"
                  />
              </td>
          </tr>
      );
  };

  const handlePrevMonth = () => {
      if (!selectedMonth) return;
      const parts = selectedMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      
      let newYear = year;
      let newMonth = month - 1;
      if (newMonth < 1) {
          newMonth = 12;
          newYear -= 1;
      }
      onMonthChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
      if (!selectedMonth) return;
      const parts = selectedMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      
      let newYear = year;
      let newMonth = month + 1;
      if (newMonth > 12) {
          newMonth = 1;
          newYear += 1;
      }
      onMonthChange(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  return (
    <div className="liquid-finance-table overflow-hidden rounded-[26px]">
      <div className="liquid-glass-toolbar flex min-w-0 flex-col items-start justify-between gap-4 px-4 py-4 md:flex-row md:items-center md:px-6 md:py-5">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-start min-w-0">
             <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                 <div className="liquid-icon-well rounded-2xl p-2 text-blue-700">
                    <Wallet size={20} />
                 </div>
                 <div>
                    <h3 className="text-lg font-black text-slate-950">{panelTitle}</h3>
                    <p className="mt-0.5 text-xs font-semibold text-slate-500">{panelSubtitle}</p>
                 </div>
             </div>

             {mgmtFeeParkEnabled && viewRentPricing && (
                 <div className="liquid-glass-control flex shrink-0 overflow-hidden rounded-full p-1 text-xs font-bold">
                     <button
                         type="button"
                         onClick={() => setFeeTab('rent')}
                         className={`liquid-pressable rounded-full px-3 py-1.5 ${feeTab === 'rent' ? 'liquid-action-strong' : 'text-slate-600 hover:bg-blue-50/70 hover:text-blue-700'}`}
                     >
                         租金收款
                     </button>
                     <button
                         type="button"
                         onClick={() => setFeeTab('management_fee')}
                         className={`liquid-pressable rounded-full px-3 py-1.5 ${feeTab === 'management_fee' ? 'liquid-action-strong' : 'text-slate-600 hover:bg-blue-50/70 hover:text-blue-700'}`}
                     >
                         物业费收款
                     </button>
                 </div>
             )}
             {mgmtFeeParkEnabled && !viewRentPricing && (
                 <span className="liquid-glass-control shrink-0 rounded-full px-3 py-1 text-xs font-bold text-cyan-700">
                     物业费收款
                 </span>
             )}

             {/* Arrow Navigation */}
             <div className="liquid-glass-readable flex items-center gap-1 rounded-full p-1">
                 <button onClick={handlePrevMonth} className="liquid-pressable rounded-full p-1 text-slate-500 transition-colors hover:bg-blue-50/70 hover:text-blue-700">
                     <ChevronLeft size={16}/>
                 </button>
                 <div className="flex min-w-[92px] items-center justify-center gap-2 px-2 text-sm font-bold text-slate-700">
                     <Calendar size={14} className="text-slate-400"/>
                     <span>{selectedMonth}</span>
                 </div>
                 <button onClick={handleNextMonth} className="liquid-pressable rounded-full p-1 text-slate-500 transition-colors hover:bg-blue-50/70 hover:text-blue-700">
                     <ChevronRight size={16}/>
                 </button>
             </div>
        </div>
        
        <div className="liquid-glass-readable flex w-full items-center justify-around gap-4 rounded-2xl p-3 md:w-auto md:justify-end md:gap-6 md:bg-transparent md:p-0 md:shadow-none md:ring-0">
             <div
                 className="text-center md:text-right"
                 title={
                     isMgmtTab
                         ? `本月物业费应收 ¥${totalDue.toLocaleString()}（与财务报表「物业费应收」一致）`
                         : manualReceivableThisMonth > 0
                           ? `工作台：¥${totalDue.toLocaleString()}（仅系统账单口径，与「预算表 月度合计」一致）\n` +
                             `财务报表「本月应收租金」：¥${financeTotalDue.toLocaleString()}（额外含 ¥${manualReceivableThisMonth.toLocaleString()} 手工应收行）\n\n` +
                             `差额来源：本月在「财务报表」录入的手工应收行（如外部水电费、外卖代收等）。`
                           : `本月应收 ¥${totalDue.toLocaleString()}（与「财务报表 本月应收租金」一致，未录入手工应收行）`
                 }
             >
                 <p className="text-xs font-black uppercase tracking-wide text-slate-500">{isMgmtTab ? "当月应收物业费" : "当月应收租金"}</p>
                 <p className="text-base font-black text-slate-950 md:text-lg">{formatCurrency(totalDue)}</p>
                 {(!isMgmtTab && manualReceivableThisMonth > 0) && (
                     <p className="mt-0.5 inline-flex items-center justify-end gap-1 text-xs font-bold text-amber-700">
                         <Info size={12}/>
                         财务报表另含手工 <span className="font-semibold">{formatCurrency(manualReceivableThisMonth)}</span>
                     </p>
                 )}
             </div>
             <div className="block h-8 w-px bg-slate-200/70 md:hidden"></div>
             <div className="text-center md:border-l md:border-white/70 md:pl-6 md:text-right">
                 <p className="text-xs font-black uppercase tracking-wide text-slate-500">{isMgmtTab ? "当月实收物业费" : "当月实收租金"}</p>
                 <p className={`text-base font-black md:text-lg ${totalPaid >= totalDue ? 'text-cyan-700' : 'text-blue-700'}`}>{formatCurrency(totalPaid)}</p>
             </div>
        </div>
      </div>

      {mgmtFeeParkEnabled && viewRentPricing && feeTab === 'rent' && (
          <div className="liquid-finance-summary-band border-y border-white/70 px-4 py-4 md:px-6">
              <p className="mb-3 text-xs font-black text-slate-600">租金及物业费收款汇总（{selectedMonth}）</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="liquid-glass-readable rounded-2xl p-3">
                      <p className="mb-2 text-xs font-black uppercase tracking-wide text-blue-800">租金</p>
                      <div className="flex justify-between text-sm"><span className="text-slate-600">应收</span><span className="font-bold text-slate-800">{formatCurrency(rentTotals.totalDue)}</span></div>
                      <div className="mt-1 flex justify-between text-sm"><span className="text-slate-600">实收</span><span className="font-bold text-blue-700">{formatCurrency(rentTotals.totalPaid)}</span></div>
                      <div className="flex justify-between text-xs mt-2 text-slate-500"><span>收缴率</span><span className="font-semibold text-blue-700">{formatPercent(rentTotals.collectionRate, 1)}</span></div>
                  </div>
                  <div className="liquid-glass-readable rounded-2xl p-3">
                      <p className="mb-2 text-xs font-black uppercase tracking-wide text-cyan-800">物业费</p>
                      <div className="flex justify-between text-sm"><span className="text-slate-600">应收</span><span className="font-bold text-slate-800">{formatCurrency(mgmtTotals.totalDue)}</span></div>
                      <div className="mt-1 flex justify-between text-sm"><span className="text-slate-600">实收</span><span className="font-bold text-cyan-700">{formatCurrency(mgmtTotals.totalPaid)}</span></div>
                      <div className="flex justify-between text-xs mt-2 text-slate-500"><span>收缴率</span><span className="font-semibold text-cyan-700">{formatPercent(mgmtTotals.collectionRate, 1)}</span></div>
                  </div>
              </div>
          </div>
      )}


      {billingList.length === 0 ? (
          <div className="p-12 text-center">
             <div className="liquid-glass-readable mb-3 inline-flex h-12 w-12 items-center justify-center rounded-[20px] text-slate-400">
                 <Building2 size={24} />
             </div>
             <p className="font-semibold text-slate-500">{isMgmtTab ? "该月份暂无应收物业费账单。" : "该月份暂无应收租金账单。"}</p>
          </div>
      ) : isDesktop ? (
            <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                <thead className="liquid-finance-sticky font-bold text-slate-600">
                    <tr>
                    <th className="px-6 py-4">签约客户</th>
                    <th className="px-6 py-4">租赁房号</th>
                    <th className="px-6 py-4">{dueColumnLabel}</th>
                    <th className="px-6 py-4">{paidColumnLabel}</th>
                    <th className="px-6 py-4">应收核销情况</th>
                    <th className="px-6 py-4 min-w-[200px]">备注</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-white/70">
                    {receivableSections.unsettled.length > 0 && (
                        <>
                            <tr className="liquid-finance-section-row liquid-finance-section-row--pending">
                                <td colSpan={6} className={`${writeOffSectionClass(WRITEOFF_LABELS.pending)} px-6 py-2 text-xs font-black`}>
                                    {WRITEOFF_LABELS.pending}
                                </td>
                            </tr>
                            {receivableSections.unsettled.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.pending, `${item.feeKind || 'rent'}|${item.tenantId}-u-${i}`)
                            )}
                        </>
                    )}
                    {receivableSections.deferred.length > 0 && (
                        <>
                            <tr className="liquid-finance-section-row liquid-finance-section-row--deferred">
                                <td colSpan={6} className={`${writeOffSectionClass(WRITEOFF_LABELS.deferred)} px-6 py-2 text-xs font-black`}>
                                    {WRITEOFF_LABELS.deferred}（原账期挂账已调至其他月份）
                                </td>
                            </tr>
                            {receivableSections.deferred.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.deferred, `${item.feeKind || 'rent'}|${item.tenantId}-d-${i}`)
                            )}
                        </>
                    )}
                    {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                        <>
                            <tr className="liquid-finance-section-row liquid-finance-section-row--settled">
                                <td colSpan={6} className={`${writeOffSectionClass(WRITEOFF_LABELS.settled)} px-6 py-2 text-xs font-black`}>
                                    {WRITEOFF_LABELS.settled}
                                </td>
                            </tr>
                            {receivableSections.settledThisMonth.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.settled, `${item.feeKind || 'rent'}|${item.tenantId}-s-${i}`)
                            )}
                            {receivableSections.prepaid.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.settled, `${item.feeKind || 'rent'}|${item.tenantId}-p-${i}`)
                            )}
                        </>
                    )}
                </tbody>
                </table>
            </div>
      ) : (
            <div className="space-y-2 px-1 pb-2 pt-1">
                {receivableSections.unsettled.length > 0 && (
                    <>
                        <div className={`${writeOffSectionClass(WRITEOFF_LABELS.pending)} liquid-finance-section-pill mx-2 rounded-full px-3 py-2 text-xs font-black`}>{WRITEOFF_LABELS.pending}</div>
                        {receivableSections.unsettled.map(({ item, i }) => {
                            const { building, unitNames } = resolveUnitLocation(item.unitIds);
                            return (
                                <BillingCard
                                    key={`${item.feeKind || 'rent'}|${item.tenantId}-u-${i}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.pending}
                                    notes={data.billingPeriodNotes}
                                    selectedMonth={selectedMonth}
                                    onRemarkSave={onUpdateRentRemark}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
                {receivableSections.deferred.length > 0 && (
                    <>
                        <div className={`${writeOffSectionClass(WRITEOFF_LABELS.deferred)} liquid-finance-section-pill mx-2 rounded-full px-3 py-2 text-xs font-black`}>{WRITEOFF_LABELS.deferred}（原账期已调至他月）</div>
                        {receivableSections.deferred.map(({ item, i }) => {
                            const { building, unitNames } = resolveUnitLocation(item.unitIds);
                            return (
                                <BillingCard
                                    key={`${item.feeKind || 'rent'}|${item.tenantId}-d-${i}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.deferred}
                                    notes={data.billingPeriodNotes}
                                    selectedMonth={selectedMonth}
                                    onRemarkSave={onUpdateRentRemark}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
                {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                    <>
                        <div className={`${writeOffSectionClass(WRITEOFF_LABELS.settled)} liquid-finance-section-pill mx-2 rounded-full px-3 py-2 text-xs font-black`}>{WRITEOFF_LABELS.settled}</div>
                        {[...receivableSections.settledThisMonth, ...receivableSections.prepaid].map((entry, idx) => {
                            const { item } = entry;
                            const { building, unitNames } = resolveUnitLocation(item.unitIds);
                            return (
                                <BillingCard
                                    key={`${item.feeKind || 'rent'}|${item.tenantId}-sp-${idx}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.settled}
                                    notes={data.billingPeriodNotes}
                                    selectedMonth={selectedMonth}
                                    onRemarkSave={onUpdateRentRemark}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
            </div>
      )}
    </div>
  );
};
