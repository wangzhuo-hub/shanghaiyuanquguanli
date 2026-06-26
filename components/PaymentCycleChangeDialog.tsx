import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, Save, AlertCircle, CalendarClock } from 'lucide-react';
import { CloudConfig, Tenant, PaymentCycle, PaymentCycleChange } from '../types';
import { paymentCycleLabelMap } from '../services/sharedUtils';
import type { BudgetedBill } from '../services/billingService';
import { createBudgetedBillCache, type BillGenerationCache } from '../services/billGenerationCache';
import { fetchCloudBudgetedBillsPreviewBatch } from '../services/cloudComputeClient';
import { shouldRunLocalBudgetedBillPreviewFallback } from '../services/computeFallbackPolicy';
import { indexBudgetedBillPreviewBatchResult } from '../services/budgetedBillPreviewBatch';
import { formatCurrency } from '../services/numberFormat';

interface Props {
  tenant: Tenant;
  cloudConfig?: CloudConfig;
  serverComputeEnabled?: boolean;
  onConfirm: (change: PaymentCycleChange) => void;
  onClose: () => void;
}

const cycleOptions: PaymentCycle[] = ['Monthly', 'BiMonthly', 'Quarterly', 'SemiAnnual', 'Annual', 'HalfMonthly', 'Custom'];

type CyclePreviewState = {
  before: BudgetedBill[];
  after: BudgetedBill[];
  simulated: BudgetedBill[];
  loading: boolean;
  error?: string;
};

const emptyPreviewState: CyclePreviewState = {
  before: [],
  after: [],
  simulated: [],
  loading: false,
};

export const PaymentCycleChangeDialog: React.FC<Props> = ({
  tenant,
  cloudConfig,
  serverComputeEnabled = false,
  onConfirm,
  onClose,
}) => {
  const billCacheRef = useRef<BillGenerationCache | null>(null);
  const getLocalBillCache = useCallback(async (): Promise<BillGenerationCache> => {
    if (billCacheRef.current) return billCacheRef.current;
    const { generateBudgetedBills } = await import('../services/billingService');
    const cache = createBudgetedBillCache({ maxEntries: 48, generateBudgetedBills });
    billCacheRef.current = cache;
    return cache;
  }, []);
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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const buildUpdatedTenant = useCallback((): Tenant => ({
    ...tenant,
    paymentCycle: toCycle,
    paymentCycleMonths: toCycle === 'Custom' ? toCycleMonths : undefined,
  }), [tenant, toCycle, toCycleMonths]);

  const splitBillsByEffectiveDate = useCallback((allBills: BudgetedBill[]) => {
    const effectiveTime = new Date(effectiveDate).getTime();
    const before: typeof allBills = [];
    const after: typeof allBills = [];
    for (const bill of allBills) {
      const billTime = bill.date.getTime();
      if (billTime < effectiveTime) before.push(bill);
      else after.push(bill);
    }
    return { before, after };
  }, [effectiveDate]);

  const buildLocalPreview = useCallback(async (): Promise<CyclePreviewState> => {
    if (!effectiveDate) return emptyPreviewState;
    const cache = await getLocalBillCache();
    const leaseStart = new Date(tenant.leaseStart);
    const leaseEnd = new Date(tenant.leaseEnd);
    const allBills = cache.get({
      tenant,
      assumptions: [],
      adjustments: [],
      start: leaseStart,
      end: leaseEnd,
      scopeHint: `cycle-change:${tenant.id}:before`,
    });
    const updatedBills = cache.get({
      tenant: buildUpdatedTenant(),
      assumptions: [],
      adjustments: [],
      start: leaseStart,
      end: leaseEnd,
      scopeHint: `cycle-change:${tenant.id}:after`,
    });
    return {
      ...splitBillsByEffectiveDate(allBills),
      simulated: updatedBills.filter(b => b.date.getTime() >= new Date(effectiveDate).getTime()),
      loading: false,
    };
  }, [buildUpdatedTenant, effectiveDate, getLocalBillCache, splitBillsByEffectiveDate, tenant]);

  const [previewState, setPreviewState] = useState<CyclePreviewState>(emptyPreviewState);

  useEffect(() => {
    if (!effectiveDate) {
      setPreviewState(emptyPreviewState);
      return;
    }

    const leaseStart = new Date(tenant.leaseStart);
    const leaseEnd = new Date(tenant.leaseEnd);
    const canUseServer = serverComputeEnabled && !!cloudConfig?.projectId;
    let cancelled = false;
    const setLocalPreview = () => {
      setPreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
      buildLocalPreview()
        .then((state) => {
          if (!cancelled) setPreviewState(state);
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            setPreviewState({
              ...emptyPreviewState,
              error: err instanceof Error ? err.message : '本地账单预览计算模块加载失败。',
            });
          }
        });
    };

    if (!canUseServer || !cloudConfig) {
      if (!shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: false })) {
        setPreviewState({
          ...emptyPreviewState,
          error: '后台账单预览计算不可用，未执行前端本地重算。',
        });
        return;
      }
      setLocalPreview();
      return () => {
        cancelled = true;
      };
    }

    setPreviewState((prev) => ({ ...prev, loading: true }));
    const updatedTenant = buildUpdatedTenant();

    fetchCloudBudgetedBillsPreviewBatch(cloudConfig, {
      items: [{
        id: 'current',
        tenant,
        assumptions: [],
        adjustments: [],
        startDate: leaseStart,
        endDate: leaseEnd,
      }, {
        id: 'updated',
        tenant: updatedTenant,
        assumptions: [],
        adjustments: [],
        startDate: leaseStart,
        endDate: leaseEnd,
      }],
    }).then((result) => {
      if (cancelled) return;
      const lookup = indexBudgetedBillPreviewBatchResult(result, ['current', 'updated']);
      if (lookup.ok) {
        const currentBills = lookup.billsById.get('current') || [];
        const updatedBills = lookup.billsById.get('updated') || [];
        setPreviewState({
          ...splitBillsByEffectiveDate(currentBills),
          simulated: updatedBills.filter(b => b.date.getTime() >= new Date(effectiveDate).getTime()),
          loading: false,
        });
        return;
      }
      if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
        setLocalPreview();
        return;
      }
      setPreviewState({
        ...emptyPreviewState,
        error: lookup.message || '后台批量账单预览计算失败，未执行前端本地重算。',
      });
    }).catch((err: unknown) => {
      if (!cancelled) {
        if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
          setLocalPreview();
          return;
        }
        setPreviewState({
          ...emptyPreviewState,
          error: err instanceof Error ? err.message : '后台账单预览计算失败，未执行前端本地重算。',
        });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    buildLocalPreview,
    buildUpdatedTenant,
    cloudConfig,
    effectiveDate,
    serverComputeEnabled,
    splitBillsByEffectiveDate,
    tenant,
  ]);

  const previewBills = { before: previewState.before, after: previewState.after };
  const simulatedBills = previewState.simulated;

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
    <div className="liquid-elevated-backdrop fixed inset-0 z-[9999] flex items-end justify-center p-3 sm:p-4 md:items-center" onClick={onClose}>
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="payment-cycle-change-dialog-title"
        className="liquid-elevated-panel flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-[28px]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="liquid-elevated-header sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-white/60 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-start gap-3">
            <div className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
              <CalendarClock size={20} />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black uppercase text-blue-700/75">Payment Cycle</p>
              <h3 id="payment-cycle-change-dialog-title" className="truncate text-lg font-black text-slate-950">变更付款周期</h3>
            </div>
          </div>
          <button onClick={onClose} className="liquid-glass-control liquid-pressable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-900" aria-label="关闭付款周期变更"><X size={18}/></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
          {/* 当前信息 */}
          <div className="liquid-glass-readable rounded-3xl p-4">
            <div className="mb-3 text-sm font-black text-slate-800">当前合同</div>
            <div className="grid gap-3 text-sm md:grid-cols-3">
              <div>
                <p className="text-xs font-black text-slate-500">客户</p>
                <p className="mt-1 truncate font-black text-slate-950">{tenant.name}</p>
              </div>
              <div>
                <p className="text-xs font-black text-slate-500">当前周期</p>
                <p className="mt-1 font-black text-blue-700">
                  {paymentCycleLabelMap[fromCycle]}
                  {fromCycle === 'Custom' && fromCycleMonths ? ` (${fromCycleMonths}个月)` : ''}
                </p>
              </div>
              <div>
                <p className="text-xs font-black text-slate-500">租期</p>
                <p className="mt-1 font-bold text-slate-700">{tenant.leaseStart} ~ {tenant.leaseEnd}</p>
              </div>
            </div>
          </div>

          {/* 变更配置 */}
          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">新付款周期 <span className="text-rose-500">*</span></label>
            <select
              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-base font-black text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:font-semibold md:text-slate-900"
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
              <label className="mb-1.5 block text-xs font-black text-slate-500">自定义月数</label>
              <input
                type="number" min="0.5" step="0.5"
                inputMode="decimal"
                enterKeyHint="done"
                className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:font-semibold md:text-slate-900"
                value={toCycleMonths || ''}
                onChange={e => setToCycleMonths(Math.max(0.5, Number(e.target.value) || 0.5))}
              />
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">生效日期 <span className="text-rose-500">*</span></label>
            <input
              type="date"
              className="liquid-elevated-field w-full rounded-2xl px-3.5 py-3 text-base font-black tabular-nums text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:font-semibold md:text-slate-900"
              value={effectiveDate}
              onChange={e => { setEffectiveDate(e.target.value); setError(''); }}
            />
            <p className="mt-1 text-xs font-semibold text-slate-500">生效日期前的账单按原周期，生效日期起按新周期</p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-black text-slate-500">变更原因</label>
            <textarea
              className="liquid-elevated-field w-full resize-none rounded-2xl px-3.5 py-3 text-base font-semibold leading-relaxed text-slate-950 outline-none focus:ring-4 focus:ring-blue-500/10 md:text-sm md:text-slate-900"
              rows={3}
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="如：客户业务调整、协商变更等"
            />
          </div>

          {error && <div className="liquid-elevated-alert flex items-center gap-2 rounded-2xl px-3.5 py-2.5 text-sm font-bold"><AlertCircle size={14}/> {error}</div>}

          {/* 账单预览 */}
          {effectiveDate && (
            <div>
              <label className="mb-2 block text-xs font-black text-slate-500">
                账单变更预览
                <span className="ml-2 text-xs font-semibold text-slate-500">
                  ({new Date(effectiveDate).toISOString().slice(0, 10)} 为分界)
                </span>
              </label>
              {previewState.error ? (
                <div className="liquid-elevated-alert liquid-elevated-alert--amber mb-3 flex items-start gap-2 rounded-2xl px-3 py-2 text-xs font-bold">
                  <AlertCircle size={14} className="mt-0.5 shrink-0" />
                  <span>{previewState.error}</span>
                </div>
              ) : null}
              <div className="grid gap-3 md:grid-cols-2">
                <div className="liquid-glass-readable rounded-3xl p-3.5">
                  <div className="mb-2 text-xs font-black text-slate-500">变更前账单 (原{paymentCycleLabelMap[fromCycle]})</div>
                  {previewState.loading ? (
                    <div className="text-xs font-bold italic text-slate-500">计算中...</div>
                  ) : previewBills.before.length > 0 ? previewBills.before.map((b, i) => (
                    <div key={i} className="liquid-elevated-preview-row flex justify-between rounded-xl px-2 py-1 text-xs font-bold">
                      <span className="text-slate-500">{b.date.toISOString().slice(0, 10)}</span>
                      <span className="font-mono text-slate-700">{formatCurrency(b.amount)}</span>
                    </div>
                  )) : <div className="text-xs font-bold italic text-slate-500">无历史账单</div>}
                </div>
                <div className="liquid-glass-readable rounded-3xl border-blue-200/70 p-3.5">
                  <div className="mb-2 text-xs font-black text-blue-700">变更后账单 ({paymentCycleLabelMap[toCycle]})</div>
                  {previewState.loading ? (
                    <div className="text-xs font-bold italic text-blue-700">计算中...</div>
                  ) : simulatedBills.length > 0 ? simulatedBills.slice(0, 6).map((b, i) => (
                    <div key={i} className="liquid-elevated-preview-row liquid-elevated-preview-row--blue flex justify-between rounded-xl px-2 py-1 text-xs font-bold">
                      <span className="text-blue-700">{b.date.toISOString().slice(0, 10)}</span>
                      <span className="font-mono text-blue-800">{formatCurrency(b.amount)}</span>
                    </div>
                  )) : <div className="text-xs font-bold italic text-blue-700">无后续账单</div>}
                  {simulatedBills.length > 6 && (
                    <div className="mt-1 text-xs font-bold text-blue-700">... 共 {simulatedBills.length} 笔</div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* 变更历史 */}
          {(tenant.paymentCycleChanges && tenant.paymentCycleChanges.length > 0) && (
            <div>
              <label className="mb-2 block text-xs font-black text-slate-500">历史变更记录</label>
              <div className="liquid-glass-readable max-h-36 space-y-1.5 overflow-y-auto rounded-3xl p-2">
                {[...tenant.paymentCycleChanges].reverse().map(r => (
                  <div key={r.id} className="liquid-elevated-history-row rounded-2xl p-2.5 text-xs">
                    <div className="font-black text-slate-800">
                      <span className="text-slate-500">{paymentCycleLabelMap[r.fromCycle]}</span>
                      <span className="mx-1.5 font-black text-slate-500">→</span>
                      <span>{paymentCycleLabelMap[r.toCycle]}</span>
                    </div>
                    <div className="mt-1 font-bold text-slate-500">
                      生效: {r.effectiveDate}{r.reason ? ` · ${r.reason}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="liquid-elevated-footer sticky bottom-0 grid grid-cols-2 gap-2 border-t border-white/60 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex sm:justify-end sm:px-5 sm:pb-4">
          <button onClick={onClose} className="liquid-glass-control liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-slate-600">取消</button>
          <button onClick={handleConfirm} className="liquid-action-strong liquid-pressable flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-black"><Save size={14}/> 确认变更</button>
        </div>
      </section>
    </div>
  );
};
