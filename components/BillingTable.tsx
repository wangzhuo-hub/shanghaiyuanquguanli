
import React, { useMemo } from 'react';
import { BillingDetail, DashboardData } from '../types';
import { CheckCircle2, AlertCircle, Building2, Wallet, Calendar, ChevronLeft, ChevronRight, Info } from 'lucide-react';
import {
    buildReceivableSections,
    getRentCollectionRemark,
    deferReceivableShellClass,
    receivableBudgetDisplay,
    parseManualReceivableLinesFromNotes,
} from '../services/receivableListHelpers';
import { formatCurrency } from '../services/numberFormat';

const WRITEOFF_LABELS = {
  pending: '待核销',
  settled: '已核销和收款',
  deferred: '已缓缴',
} as const;

function writeOffBadgeClass(label: string) {
  if (label === WRITEOFF_LABELS.pending) return 'text-amber-700 bg-amber-50 border-amber-100';
  if (label === WRITEOFF_LABELS.settled) return 'text-emerald-700 bg-emerald-50 border-emerald-100';
  if (label === WRITEOFF_LABELS.deferred) return 'text-indigo-800 bg-indigo-50 border-indigo-100';
  return 'text-slate-600 bg-slate-50 border-slate-100';
}

interface BillingTableProps {
    data: DashboardData;
    selectedMonth: string;
    onMonthChange: (val: string) => void;
    /** 按租户 + 当前账期保存跟进备注 */
    onUpdateRentRemark?: (tenantId: string, periodYYYYMM: string, remark: string) => void;
}

// Mobile Card Component
const BillingCard: React.FC<{
    item: any;
    building: any;
    unitNames: string;
    writeOffLabel: string;
    remark: string;
    onRemarkChange: (text: string) => void;
    remarkDisabled?: boolean;
}> = ({ item, building, unitNames, writeOffLabel, remark, onRemarkChange, remarkDisabled }) => {
    const deferShell = deferReceivableShellClass(item);
    const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
    const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
    return (
    <div className={`bg-white p-4 border-b border-slate-100 last:border-0 ${deferShell}`}>
        <div className="flex justify-between items-start mb-2">
            <div className="font-medium text-slate-800">
                <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0">
                        {item.tenantName.substring(0,1)}
                    </span>
                    <span>{item.tenantName}</span>
                </div>
                {hasDeferOut && (
                    <div className="mt-1.5 ml-8 text-[10px] font-semibold text-orange-800 leading-snug">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                )}
                {hasDeferIn && (
                    <div className="mt-1 ml-8 text-[10px] font-semibold text-sky-800 leading-snug">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                )}
                {item.budgetAlignmentNote && (
                    <div className="mt-1.5 ml-8 text-[10px] text-rose-800 leading-snug bg-rose-50/90 border border-rose-100 rounded px-1.5 py-1">
                        {item.budgetAlignmentNote}
                    </div>
                )}
            </div>
            <div className={`text-xs font-medium px-2 py-0.5 rounded border flex items-center gap-1 ${writeOffBadgeClass(writeOffLabel)}`}>
                {writeOffLabel === WRITEOFF_LABELS.settled ? <CheckCircle2 size={12} /> : <AlertCircle size={12} />}
                {writeOffLabel}
            </div>
        </div>
        <div className="text-xs text-slate-500 mb-2">
            {building?.name} {unitNames}
        </div>
        <div className="flex justify-between items-center text-sm border-t border-slate-50 pt-2 mt-1">
            <div className="text-slate-500">
                应收: <span className="font-semibold text-slate-700">{formatCurrency(receivableBudgetDisplay(item))}</span>
                {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                    <span className="block text-[10px] text-slate-400 font-normal mt-0.5">原账面应收已全部缓出</span>
                )}
            </div>
            <div className={writeOffLabel === WRITEOFF_LABELS.settled ? 'text-green-600' : 'text-blue-600'}>
                实收: <span className="font-bold">{formatCurrency(item.amountPaid)}</span>
            </div>
        </div>
        <div className="mt-2">
            <label className="text-[10px] text-slate-400 font-medium">备注</label>
            <textarea
                className="mt-0.5 w-full min-h-[52px] text-xs border border-slate-200 rounded-lg p-2 text-slate-700 resize-y"
                placeholder="预期收款日、沟通情况等"
                value={remark}
                onChange={(e) => onRemarkChange(e.target.value)}
                disabled={remarkDisabled}
            />
        </div>
    </div>
    );
};

export const BillingTable: React.FC<BillingTableProps> = ({ data, selectedMonth, onMonthChange, onUpdateRentRemark }) => {
  const billingList = data.currentMonthBilling || [];

  const receivableSections = useMemo(
      () => buildReceivableSections(billingList, selectedMonth, data.payments || [], data.tenants || []),
      [billingList, selectedMonth, data.payments, data.tenants]
  );

  const totalDue = billingList.reduce((acc, curr) => acc + receivableBudgetDisplay(curr), 0);
  const totalPaid = billingList.reduce((acc, curr) => acc + curr.amountPaid, 0);

  // 与「财务报表 本月应收租金」对账：财务报表的合计含手工应收行，工作台不含。
  // 这里读取本月手工应收行金额，提示用户两边差额来源，避免对账困惑。
  const manualReceivableThisMonth = useMemo(() => {
      const lines = parseManualReceivableLinesFromNotes(data.billingPeriodNotes);
      return lines
          .filter((l) => l.periodYYYYMM === selectedMonth)
          .reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
  }, [data.billingPeriodNotes, selectedMonth]);
  const financeTotalDue = totalDue + manualReceivableThisMonth;

  const renderBillingDetailRow = (item: BillingDetail, writeOffLabel: string, rowKey: string) => {
      const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
      const unitNames = item.unitIds.map(uid => {
          const unit = building?.units.find(u => u.id === uid);
          return unit ? unit.name : uid;
      }).join(', ');
      const remark = getRentCollectionRemark(data.billingPeriodNotes, item.tenantId, selectedMonth);
      const paidClass =
          writeOffLabel === WRITEOFF_LABELS.settled
              ? 'text-green-600 font-medium'
              : writeOffLabel === WRITEOFF_LABELS.deferred
                ? 'text-indigo-700 font-medium'
                : 'text-amber-600 font-medium';
      const deferShell = deferReceivableShellClass(item);
      const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
      const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
      return (
          <tr key={rowKey} className={`hover:bg-slate-50 transition-colors group ${deferShell}`}>
              <td className="px-6 py-4 text-slate-800">
                  <div className="flex items-center gap-2 font-medium">
                      <span className="w-8 h-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-xs font-bold shrink-0">
                          {item.tenantName.substring(0, 1)}
                      </span>
                      <div>
                          <div>{item.tenantName}</div>
                          {hasDeferOut && (
                              <div className="mt-0.5 text-[10px] font-semibold text-orange-800">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                          )}
                          {hasDeferIn && (
                              <div className="mt-0.5 text-[10px] font-semibold text-sky-800">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                          )}
                          {item.budgetAlignmentNote && (
                              <div className="mt-1 text-[10px] text-rose-800 leading-snug bg-rose-50/90 border border-rose-100 rounded px-1.5 py-1 max-w-[280px]">
                                  {item.budgetAlignmentNote}
                              </div>
                          )}
                      </div>
                  </div>
              </td>
              <td className="px-6 py-4 text-slate-600">
                  {building?.name} <span className="text-slate-400 ml-1">{unitNames}</span>
              </td>
              <td className="px-6 py-4 font-semibold text-slate-700 align-top">
                  <div>{formatCurrency(receivableBudgetDisplay(item))}</div>
                  {item.earlyTerminationBreakdown && (
                      <div className="text-[10px] text-amber-800 font-medium mt-1 max-w-[220px] leading-snug">
                          {item.earlyTerminationBreakdown}
                      </div>
                  )}
                  {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                      <div className="text-[10px] text-slate-400 font-normal mt-0.5">原账面应收已全部缓出</div>
                  )}
              </td>
              <td className="px-6 py-4">
                  <span className={paidClass}>{formatCurrency(item.amountPaid)}</span>
              </td>
              <td className="px-6 py-4">
                  <div className={`flex items-center gap-1.5 font-medium px-2 py-1 rounded-md w-fit border ${writeOffBadgeClass(writeOffLabel)}`}>
                      {writeOffLabel === WRITEOFF_LABELS.settled ? (
                          <CheckCircle2 size={16} className="shrink-0" />
                      ) : (
                          <AlertCircle size={16} className="shrink-0" />
                      )}
                      <span>{writeOffLabel}</span>
                  </div>
              </td>
              <td className="px-6 py-3 align-top max-w-[240px]">
                  <textarea
                      className="w-full min-h-[52px] text-xs border border-slate-200 rounded-lg p-2 text-slate-700 resize-y"
                      placeholder="预期收款日、沟通情况等"
                      value={remark}
                      onChange={(e) => onUpdateRentRemark?.(item.tenantId, selectedMonth, e.target.value)}
                      disabled={!onUpdateRentRemark}
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
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-slate-100 flex flex-col md:flex-row justify-between items-start md:items-center bg-gradient-to-r from-slate-50 to-white gap-4 min-w-0">
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto justify-between md:justify-start min-w-0">
             <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                 <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
                    <Wallet size={20} />
                 </div>
                 <div>
                    <h3 className="text-lg font-bold text-slate-800">租金账单明细</h3>
                    <p className="text-xs text-slate-500 mt-0.5">来源: 预算管理 (含手动调整)</p>
                 </div>
             </div>
             
             {/* Arrow Navigation */}
             <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 shadow-sm">
                 <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">
                     <ChevronLeft size={16}/>
                 </button>
                 <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 min-w-[80px] justify-center">
                     <Calendar size={14} className="text-slate-400"/>
                     <span>{selectedMonth}</span>
                 </div>
                 <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500 transition-colors">
                     <ChevronRight size={16}/>
                 </button>
             </div>
        </div>
        
        <div className="flex gap-4 md:gap-6 items-center w-full md:w-auto bg-slate-50 md:bg-transparent p-3 md:p-0 rounded-lg justify-around md:justify-end">
             <div
                 className="text-center md:text-right"
                 title={
                     manualReceivableThisMonth > 0
                         ? `工作台：¥${totalDue.toLocaleString()}（仅系统账单口径，与「预算表 月度合计」一致）\n` +
                           `财务报表「本月应收租金」：¥${financeTotalDue.toLocaleString()}（额外含 ¥${manualReceivableThisMonth.toLocaleString()} 手工应收行）\n\n` +
                           `差额来源：本月在「财务报表」录入的手工应收行（如外部水电费、外卖代收等）。`
                         : `本月应收 ¥${totalDue.toLocaleString()}（与「财务报表 本月应收租金」一致，未录入手工应收行）`
                 }
             >
                 <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">当月应收总额</p>
                 <p className="text-base md:text-lg font-bold text-slate-800">{formatCurrency(totalDue)}</p>
                 {manualReceivableThisMonth > 0 && (
                     <p className="text-[10px] text-amber-600 mt-0.5 inline-flex items-center gap-1 justify-end">
                         <Info size={10}/>
                         财务报表另含手工 <span className="font-semibold">{formatCurrency(manualReceivableThisMonth)}</span>
                     </p>
                 )}
             </div>
             <div className="h-8 w-px bg-slate-200 block md:hidden"></div>
             <div className="text-center md:text-right md:border-l md:border-slate-200 md:pl-6">
                 <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold">当月实收总额</p>
                 <p className={`text-base md:text-lg font-bold ${totalPaid >= totalDue ? 'text-emerald-600' : 'text-blue-600'}`}>{formatCurrency(totalPaid)}</p>
             </div>
        </div>
      </div>
      
      {billingList.length === 0 ? (
          <div className="p-12 text-center">
             <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-slate-100 text-slate-400 mb-3">
                 <Building2 size={24} />
             </div>
             <p className="text-slate-500">该月份暂无应收租金账单。</p>
          </div>
      ) : (
        <>
            {/* Desktop View */}
            <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-slate-500 font-medium">
                    <tr>
                    <th className="px-6 py-4">签约客户</th>
                    <th className="px-6 py-4">租赁房号</th>
                    <th className="px-6 py-4">应收租金</th>
                    <th className="px-6 py-4">实收租金</th>
                    <th className="px-6 py-4">应收核销情况</th>
                    <th className="px-6 py-4 min-w-[200px]">备注</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {receivableSections.unsettled.length > 0 && (
                        <>
                            <tr className="bg-amber-50/60">
                                <td colSpan={6} className="px-6 py-2 text-xs font-bold text-amber-900/90 border-t border-amber-100/80">
                                    {WRITEOFF_LABELS.pending}
                                </td>
                            </tr>
                            {receivableSections.unsettled.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.pending, `${item.tenantId}-u-${i}`)
                            )}
                        </>
                    )}
                    {receivableSections.deferred.length > 0 && (
                        <>
                            <tr className="bg-indigo-50/60">
                                <td colSpan={6} className="px-6 py-2 text-xs font-bold text-indigo-900/90 border-t border-indigo-100/80">
                                    {WRITEOFF_LABELS.deferred}（原账期挂账已调至其他月份）
                                </td>
                            </tr>
                            {receivableSections.deferred.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.deferred, `${item.tenantId}-d-${i}`)
                            )}
                        </>
                    )}
                    {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                        <>
                            <tr className="bg-emerald-50/50">
                                <td colSpan={6} className="px-6 py-2 text-xs font-bold text-emerald-900/90 border-t border-emerald-100/80">
                                    {WRITEOFF_LABELS.settled}
                                </td>
                            </tr>
                            {receivableSections.settledThisMonth.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.settled, `${item.tenantId}-s-${i}`)
                            )}
                            {receivableSections.prepaid.map(({ item, i }) =>
                                renderBillingDetailRow(item, WRITEOFF_LABELS.settled, `${item.tenantId}-p-${i}`)
                            )}
                        </>
                    )}
                </tbody>
                </table>
            </div>

            {/* Mobile View */}
            <div className="md:hidden">
                {receivableSections.unsettled.length > 0 && (
                    <>
                        <div className="px-3 py-2 text-xs font-bold bg-amber-50/60 text-amber-900 border-b border-amber-100">{WRITEOFF_LABELS.pending}</div>
                        {receivableSections.unsettled.map(({ item, i }) => {
                            const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
                            const unitNames = item.unitIds.map(uid => {
                                const unit = building?.units.find(u => u.id === uid);
                                return unit ? unit.name : uid;
                            }).join(', ');
                            return (
                                <BillingCard
                                    key={`${item.tenantId}-u-${i}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.pending}
                                    remark={getRentCollectionRemark(data.billingPeriodNotes, item.tenantId, selectedMonth)}
                                    onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, selectedMonth, text)}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
                {receivableSections.deferred.length > 0 && (
                    <>
                        <div className="px-3 py-2 text-xs font-bold bg-indigo-50/70 text-indigo-900 border-b border-indigo-100">{WRITEOFF_LABELS.deferred}（原账期已调至他月）</div>
                        {receivableSections.deferred.map(({ item, i }) => {
                            const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
                            const unitNames = item.unitIds.map(uid => {
                                const unit = building?.units.find(u => u.id === uid);
                                return unit ? unit.name : uid;
                            }).join(', ');
                            return (
                                <BillingCard
                                    key={`${item.tenantId}-d-${i}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.deferred}
                                    remark={getRentCollectionRemark(data.billingPeriodNotes, item.tenantId, selectedMonth)}
                                    onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, selectedMonth, text)}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
                {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                    <>
                        <div className="px-3 py-2 text-xs font-bold bg-emerald-50/50 text-emerald-900 border-b border-emerald-100">{WRITEOFF_LABELS.settled}</div>
                        {[...receivableSections.settledThisMonth, ...receivableSections.prepaid].map((entry, idx) => {
                            const { item } = entry;
                            const building = data.buildings.find(b => b.units.some(u => item.unitIds.includes(u.id)));
                            const unitNames = item.unitIds.map(uid => {
                                const unit = building?.units.find(u => u.id === uid);
                                return unit ? unit.name : uid;
                            }).join(', ');
                            return (
                                <BillingCard
                                    key={`${item.tenantId}-sp-${idx}`}
                                    item={item}
                                    building={building}
                                    unitNames={unitNames}
                                    writeOffLabel={WRITEOFF_LABELS.settled}
                                    remark={getRentCollectionRemark(data.billingPeriodNotes, item.tenantId, selectedMonth)}
                                    onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, selectedMonth, text)}
                                    remarkDisabled={!onUpdateRentRemark}
                                />
                            );
                        })}
                    </>
                )}
            </div>
        </>
      )}
    </div>
  );
};
