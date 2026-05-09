import React, { useState, useMemo } from 'react';
import { X, Save, AlertCircle } from 'lucide-react';
import { Tenant, PaymentCycle, PaymentCycleChange } from '../types';
import { paymentCycleLabelMap } from '../services/sharedUtils';
import { generateBudgetedBills } from '../services/billingService';
import { formatCurrency } from '../services/numberFormat';

interface Props {
  tenant: Tenant;
  onConfirm: (change: PaymentCycleChange) => void;
  onClose: () => void;
}

const cycleOptions: PaymentCycle[] = ['Monthly', 'BiMonthly', 'Quarterly', 'SemiAnnual', 'Annual', 'HalfMonthly', 'Custom'];

export const PaymentCycleChangeDialog: React.FC<Props> = ({ tenant, onConfirm, onClose }) => {
  const [toCycle, setToCycle] = useState<PaymentCycle>('Monthly');
  const [toCycleMonths, setToCycleMonths] = useState<number>(1);
  const [effectiveDate, setEffectiveDate] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 1, 1);
    return d.toISOString().slice(0, 10);
  });
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const fromCycle = tenant.paymentCycle;
  const fromCycleMonths = tenant.paymentCycleMonths;

  // 预览：变更后的账单（模拟）
  const previewBills = useMemo(() => {
    if (!effectiveDate) return { before: [], after: [] };
    const effectiveTime = new Date(effectiveDate).getTime();
    const leaseStart = new Date(tenant.leaseStart);
    const leaseEnd = new Date(tenant.leaseEnd);
    const allBills = generateBudgetedBills(tenant, [], [], leaseStart, leaseEnd);
    const before: typeof allBills = [];
    const after: typeof allBills = [];
    for (const bill of allBills) {
      const billTime = bill.date.getTime();
      if (billTime < effectiveTime) before.push(bill);
      else after.push(bill);
    }
    return { before, after };
  }, [tenant, effectiveDate]);

  // 模拟变更后账单
  const simulatedBills = useMemo(() => {
    if (!effectiveDate) return [];
    const updated: Tenant = {
      ...tenant,
      paymentCycle: toCycle,
      paymentCycleMonths: toCycle === 'Custom' ? toCycleMonths : undefined,
    };
    const leaseStart = new Date(tenant.leaseStart);
    const leaseEnd = new Date(tenant.leaseEnd);
    return generateBudgetedBills(updated, [], [], leaseStart, leaseEnd).filter(b => b.date.getTime() >= new Date(effectiveDate).getTime());
  }, [tenant, toCycle, toCycleMonths, effectiveDate]);

  const handleConfirm = () => {
    if (!effectiveDate) { setError('请选择生效日期'); return; }
    const effDate = new Date(effectiveDate);
    if (effDate <= new Date(tenant.leaseStart)) { setError('生效日期必须在起租日之后'); return; }
    if (effDate >= new Date(tenant.leaseEnd)) { setError('生效日期必须在租期结束之前'); return; }
    if (toCycle === fromCycle) { setError('新周期与当前周期相同'); return; }

    const change: PaymentCycleChange = {
      id: `pcc_${Date.now()}`,
      fromCycle,
      toCycle,
      fromCycleMonths: fromCycleMonths && fromCycleMonths > 0 ? fromCycleMonths : undefined,
      toCycleMonths: toCycle === 'Custom' ? toCycleMonths : undefined,
      effectiveDate,
      reason: reason.trim() || undefined,
      createdAt: new Date().toISOString(),
    };
    onConfirm(change);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b sticky top-0 bg-white z-10">
          <h3 className="text-lg font-bold text-slate-800">变更付款周期</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"><X size={20}/></button>
        </div>

        <div className="p-5 space-y-4">
          {/* 当前信息 */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <div className="text-sm font-medium text-slate-600">当前合同</div>
            <div className="text-sm text-slate-700">
              客户：<span className="font-medium">{tenant.name}</span>
            </div>
            <div className="text-sm text-slate-700">
              当前周期：<span className="font-medium">{paymentCycleLabelMap[fromCycle]}</span>
              {fromCycle === 'Custom' && fromCycleMonths ? ` (${fromCycleMonths}个月)` : ''}
            </div>
            <div className="text-sm text-slate-700">
              租期：{tenant.leaseStart} ~ {tenant.leaseEnd}
            </div>
          </div>

          {/* 变更配置 */}
          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">新付款周期 <span className="text-red-500">*</span></label>
            <select
              className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
              value={toCycle}
              onChange={e => {
                setToCycle(e.target.value as PaymentCycle);
                setError('');
              }}
            >
              {cycleOptions.filter(c => c !== fromCycle).map(c => (
                <option key={c} value={c}>{paymentCycleLabelMap[c]}</option>
              ))}
            </select>
          </div>

          {toCycle === 'Custom' && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-1">自定义月数</label>
              <input
                type="number" min="0.5" step="0.5"
                className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
                value={toCycleMonths || ''}
                onChange={e => setToCycleMonths(Math.max(0.5, Number(e.target.value) || 0.5))}
              />
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">生效日期 <span className="text-red-500">*</span></label>
            <input
              type="date"
              className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
              value={effectiveDate}
              onChange={e => { setEffectiveDate(e.target.value); setError(''); }}
            />
            <p className="text-xs text-slate-400 mt-1">生效日期前的账单按原周期，生效日期起按新周期</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-600 mb-1">变更原因</label>
            <textarea
              className="w-full border border-slate-300 p-2.5 rounded-lg text-sm"
              rows={2}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="如：客户业务调整、协商变更等"
            />
          </div>

          {error && <div className="text-red-500 text-sm flex items-center gap-1"><AlertCircle size={14}/> {error}</div>}

          {/* 账单预览 */}
          {effectiveDate && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">
                账单变更预览
                <span className="text-xs text-slate-400 ml-2">
                  ({new Date(effectiveDate).toISOString().slice(0, 10)} 为分界)
                </span>
              </label>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-slate-50 rounded-lg p-3">
                  <div className="text-xs font-medium text-slate-500 mb-1.5">变更前账单 (原{paymentCycleLabelMap[fromCycle]})</div>
                  {previewBills.before.length > 0 ? previewBills.before.map((b, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-slate-500">{b.date.toISOString().slice(0, 10)}</span>
                      <span className="font-mono text-slate-600">{formatCurrency(b.amount)}</span>
                    </div>
                  )) : <div className="text-xs text-slate-400 italic">无历史账单</div>}
                </div>
                <div className="bg-blue-50 rounded-lg p-3">
                  <div className="text-xs font-medium text-blue-600 mb-1.5">变更后账单 ({paymentCycleLabelMap[toCycle]})</div>
                  {simulatedBills.length > 0 ? simulatedBills.slice(0, 6).map((b, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5">
                      <span className="text-blue-600">{b.date.toISOString().slice(0, 10)}</span>
                      <span className="font-mono text-blue-700">{formatCurrency(b.amount)}</span>
                    </div>
                  )) : <div className="text-xs text-blue-400 italic">无后续账单</div>}
                  {simulatedBills.length > 6 && (
                    <div className="text-xs text-blue-400 mt-1">... 共 {simulatedBills.length} 笔</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 变更历史 */}
          {(tenant.paymentCycleChanges && tenant.paymentCycleChanges.length > 0) && (
            <div>
              <label className="block text-sm font-medium text-slate-600 mb-2">历史变更记录</label>
              <div className="max-h-32 overflow-y-auto space-y-1.5">
                {[...tenant.paymentCycleChanges].reverse().map(r => (
                  <div key={r.id} className="text-xs bg-slate-50 p-2 rounded border border-slate-100">
                    <span className="text-slate-500">{paymentCycleLabelMap[r.fromCycle]}</span>
                    <span className="mx-1.5 text-slate-300">→</span>
                    <span className="font-medium text-slate-700">{paymentCycleLabelMap[r.toCycle]}</span>
                    <span className="ml-2 text-slate-400">生效: {r.effectiveDate}</span>
                    {r.reason && <span className="ml-2 text-slate-400">({r.reason})</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-5 border-t bg-slate-50 sticky bottom-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 rounded-lg">取消</button>
          <button onClick={handleConfirm} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-1.5"><Save size={14}/> 确认变更</button>
        </div>
      </div>
    </div>
  );
};
