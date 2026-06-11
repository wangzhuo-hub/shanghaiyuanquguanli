
import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
    AuthUser,
    PaymentRecord,
    Tenant,
    ContractStatus,
    DepositStatus,
    BillingDetail,
    InvoiceRecord,
    SpecialBusinessReceivable,
    Building,
    BudgetAssumption,
    BudgetAdjustment,
} from '../types';
import { canViewRentPricing, canWriteReceivableScope, assertCanMutatePayment } from '../services/receivablePermissions';
import { isManagementFeeBillingEnabled } from '../services/parkBillingConfig';
import { BadgeCheck, Plus, ArrowRightLeft, Check, X, AlertCircle, Banknote, Wallet, TrendingUp, ArrowDownRight, CreditCard, Trash2, Edit2, Download, Upload, FileSpreadsheet, Calendar, ListChecks, Clock, Receipt, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, Sparkles, Save, Undo2, Info } from 'lucide-react';
import {
    getRentCollectionRemark,
    deferReceivableShellClass,
    receivableBudgetDisplay,
    classifyReceivableRow,
    parseManualReceivableLinesFromNotes,
    sumBudgetReceivableForFinance,
    sumSystemBudgetReceivable,
    sumManualArReceivable,
    isManualArTenantId,
    SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY,
    parseSpecialBusinessReceivablesFromNotes,
    upsertSpecialBusinessReceivable,
    removeSpecialBusinessReceivable,
    stringifySpecialBusinessReceivables,
    isSpecialBusinessArTenantId,
    realTenantIdFromSpecialBusinessAr,
    countReceivableTabResetImpact,
    isFullDeferOutSourceRow,
    resolveRentWriteOffPaymentPeriod,
    realTenantIdFromDeferInDisplayTenantId,
    isDeferInDisplayTenantId,
    deferBillingNoteKeyFromDeferInDisplayTenantId,
    paymentTenantMatchesBillingTenant,
    normalizeReceivableRemaining,
    isReceivableTailSettled,
    isCollectAmountAcceptable,
    receivableTailWaivedAmount,
    billingStatusFromAmounts,
    RECEIVABLE_TAIL_TOLERANCE,
} from '../services/receivableListHelpers';
import { formatCurrency, roundMoney2 } from '../services/numberFormat';
import { ContractSummaryModal, type ContractSummaryContent, resolveTenantAssetLabels } from './ContractSummaryModal';
import { SearchableTenantSelect } from './SearchableTenantSelect';
import * as XLSX from 'xlsx';

/** 核销展示：待核销 → 已缓缴（原账期调出）→ 已核销和收款 */
const WRITEOFF_LABELS = {
  pending: '待核销',
  settled: '已核销和收款',
  deferred: '已缓缴',
} as const;

/** 与顶部「结算侧调整」卡片同口径：展示应收 − 合同滚动（合同列「—」的合成行按基数 0） */
function receivableRowSettlementDelta(item: BillingDetail): number {
    const hideContract =
        isManualArTenantId(item.tenantId) ||
        isSpecialBusinessArTenantId(item.tenantId) ||
        isDeferInDisplayTenantId(item.tenantId);
    const contractBase = hideContract ? 0 : (item.contractAmountDue ?? 0);
    return roundMoney2(receivableBudgetDisplay(item) - contractBase);
}

function nextReceivableMonthLabel(yyyyMm: string): string {
  const parts = yyyyMm.split('-');
  if (parts.length !== 2) return yyyyMm;
  let y = parseInt(parts[0], 10);
  let m = parseInt(parts[1], 10);
  if (Number.isNaN(y) || Number.isNaN(m)) return yyyyMm;
  m += 1;
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return `${y}-${String(m).padStart(2, '0')}`;
}

function parseBillingPeriods(periodRaw?: string): string[] {
  if (!periodRaw) return [];
  const parts = periodRaw
    .split(/[,\n;，；\s]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => /^\d{4}-\d{2}$/.test(s));
  return Array.from(new Set(parts));
}

function normalizeBillingPeriods(periodRaw?: string): string | undefined {
  const list = parseBillingPeriods(periodRaw);
  return list.length > 0 ? list.join(',') : undefined;
}

function downloadFinanceXlsx(filename: string, rows: Record<string, unknown>[], sheetName = 'Sheet1') {
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  const safeSheet = sheetName.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
  XLSX.utils.book_append_sheet(wb, ws, safeSheet);
  XLSX.writeFile(wb, filename);
}

function paymentRecordTypeLabel(type: PaymentRecord['type']): string {
  switch (type) {
    case 'Rent':
      return '租金';
    case 'Deposit':
      return '押金收取';
    case 'DepositRefund':
      return '押金退还';
    case 'DepositToRent':
      return '押金转租金';
    case 'ManagementFee':
      return '物业费';
    case 'ParkingFee':
      return '停车费';
    default:
      return '其他';
  }
}

interface FinanceManagerProps {
  payments: PaymentRecord[];
  tenants: Tenant[];
  invoices: InvoiceRecord[];
  billingPeriodNotes?: Record<string, string>;
  onUpdatePayments: (payments: PaymentRecord[]) => void;
  onUpdateTenants: (tenants: Tenant[]) => void;
  onUpdateInvoices: (invoices: InvoiceRecord[]) => void;
  onBatchUpdate?: (updates: {
      tenants?: Tenant[];
      payments?: PaymentRecord[];
      billingPeriodNotes?: Record<string, string>;
  }) => void;
  getBillingDetails: (year: number, month: number) => BillingDetail[];
  onDeferPayment: (tenantId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => void;
  /** 撤销单条缓缴备注（billingPeriodNotes 键），调入行删除、金额回原账期 */
  onRevokeDeferBillingNote?: (noteKey: string) => void;
  /** 一键撤回全部缓缴 + 应收核销自动生成的收款流水（不误删收款明细手工记账） */
  onResetReceivableApplications?: () => void;
  onUpdateRentRemark?: (tenantId: string, periodYYYYMM: string, remark: string) => void;
  /** 用于合同概要弹窗：楼宇名 / 房号解析及与预算一致的推算应收 */
  buildings?: Building[];
  budgetAssumptions?: BudgetAssumption[];
  budgetAdjustments?: BudgetAdjustment[];
  /** 手机窄屏：仅保留「应收核销」视图，隐藏收款明细与特殊业态录入入口 */
  mobileReceivableOnly?: boolean;
  authUser?: AuthUser | null;
  projectId?: string;
}

// Mobile Payment Card
const PaymentCard: React.FC<{ p: PaymentRecord, onEdit: () => void, onDelete: () => void }> = ({ p, onEdit, onDelete }) => (
    <div className="bg-white p-4 border-b border-slate-100 last:border-0 relative">
        <div className="flex justify-between items-start mb-2 pr-6">
            <div className="font-medium text-slate-800">{p.tenantName}</div>
            <div className={`font-bold ${p.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                 {p.amount > 0 ? '+' : ''}{formatCurrency(p.amount)}
            </div>
        </div>
        <div className="flex flex-wrap gap-2 text-xs mb-2">
            <span className={`px-2 py-0.5 rounded 
                ${p.type === 'DepositToRent' ? 'bg-indigo-100 text-indigo-700' 
                : p.type === 'DepositRefund' ? 'bg-rose-100 text-rose-700' 
                : 'bg-slate-100 text-slate-600'}`}>
                {p.type === 'Rent' ? '租金' : p.type === 'Deposit' ? '押金' : p.type === 'DepositToRent' ? '押金转租' : p.type === 'DepositRefund' ? '押金退还' : '其他'}
            </span>
            <span className="text-slate-400">{p.date}</span>
        </div>
        <div className="text-xs text-slate-400 italic mb-2">{p.remarks || '无备注'}</div>
        {p.period && <div className="text-[11px] text-indigo-600 mb-2">关联账期：{p.period}</div>}
        
        <div className="absolute top-4 right-2 flex flex-col gap-2">
            <button onClick={onEdit} className="p-1 text-blue-600 hover:bg-blue-50 rounded"><Edit2 size={16}/></button>
            <button onClick={onDelete} className="p-1 text-red-600 hover:bg-red-50 rounded"><Trash2 size={16}/></button>
        </div>
    </div>
);

// Mobile Receivable Card
const ReceivableCard: React.FC<{ 
    item: BillingDetail, 
    remaining: number, 
    isPaid: boolean, 
    paidAmount: number,
    remark: string,
    onRemarkChange: (text: string) => void,
    remarkDisabled?: boolean,
    onConfirm: () => void,
    onDefer?: () => void,
    onRevoke: () => void,
    /** 缓缴调入行：撤销该笔缓缴 */
    onRevokeDefer?: () => void,
    onOpenContractSummary?: () => void,
    /** 全额缓出原账期：不展示收款/缓缴，仅提示至目标账期核销 */
    collectBlockedHint?: string | null,
}> = ({ item, remaining, isPaid, paidAmount, remark, onRemarkChange, remarkDisabled, onConfirm, onDefer, onRevoke, onRevokeDefer, onOpenContractSummary, collectBlockedHint }) => {
    const deferShell = deferReceivableShellClass(item);
    const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
    const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
    return (
    <div className={`bg-white p-4 border-b border-slate-100 last:border-0 ${isPaid ? 'opacity-60' : ''} ${deferShell}`}>
        <div className="mb-2">
            <div>
                <div
                    role={onOpenContractSummary ? 'button' : undefined}
                    tabIndex={onOpenContractSummary ? 0 : undefined}
                    className={`font-medium text-slate-800 ${onOpenContractSummary ? 'cursor-pointer hover:text-blue-700 underline-offset-2 hover:underline decoration-blue-400/70 text-left' : ''}`}
                    title={onOpenContractSummary ? '点击查看合同概要' : undefined}
                    onClick={
                        onOpenContractSummary
                            ? (e) => {
                                  e.stopPropagation();
                                  onOpenContractSummary();
                              }
                            : undefined
                    }
                    onKeyDown={
                        onOpenContractSummary
                            ? (e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      onOpenContractSummary();
                                  }
                              }
                            : undefined
                    }
                >
                    {item.tenantName}
                </div>
                {hasDeferOut && (
                    <div className="mt-1 text-[10px] font-semibold text-orange-800 leading-snug">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                )}
                {hasDeferIn && (
                    <div className="mt-1 text-[10px] font-semibold text-sky-800 leading-snug">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                )}
                {item.budgetAlignmentNote && (
                    <div className="mt-1.5 text-[10px] text-rose-800 leading-snug bg-rose-50/90 border border-rose-100 rounded px-1.5 py-1">
                        {item.budgetAlignmentNote}
                    </div>
                )}
            </div>
        </div>
        {(() => {
            const d = receivableRowSettlementDelta(item);
            if (Math.abs(d) <= 0.005) return null;
            return (
                <div className="mb-2 flex items-center justify-between rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs">
                    <span className="font-semibold text-amber-900">结算调整</span>
                    <span className="font-mono tabular-nums font-bold text-amber-950">
                        {d > 0.005 ? '+' : ''}
                        {formatCurrency(d)}
                    </span>
                </div>
            );
        })()}
        <div className="grid grid-cols-3 gap-2 text-xs text-center bg-slate-50 p-2 rounded mb-3">
            <div>
                <div className="text-slate-400">实际核销</div>
                <div className="font-semibold text-slate-700">{formatCurrency(receivableBudgetDisplay(item))}</div>
                {(() => {
                    const contractOnly = item.contractAmountDue ?? 0;
                    const actual = receivableBudgetDisplay(item);
                    if (Math.abs(contractOnly - actual) > 0.005 && contractOnly > 0.005) {
                        return (
                            <div className="text-[9px] text-slate-500 font-normal mt-0.5" title="合同滚动推算的纯口径（含缓缴前）">
                                合同 {formatCurrency(contractOnly)}
                            </div>
                        );
                    }
                    return null;
                })()}
                {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                    <div className="text-[9px] text-slate-400 font-normal mt-0.5">原账面已全部缓出</div>
                )}
            </div>
            <div>
                <div className="text-slate-400">已收</div>
                <div className="font-semibold text-blue-600">{formatCurrency(paidAmount)}</div>
            </div>
            <div>
                <div className="text-slate-400">待收</div>
                <div className="font-semibold text-amber-600">{remaining > 0 ? formatCurrency(remaining) : '-'}</div>
            </div>
        </div>
        <div className="mb-3">
            <label className="text-[10px] text-slate-400 font-medium">备注</label>
            <textarea
                className="mt-0.5 w-full min-h-[52px] text-xs border border-slate-200 rounded-lg p-2 text-slate-700 resize-y"
                placeholder="预期收款日、沟通情况等"
                value={remark}
                onChange={(e) => onRemarkChange(e.target.value)}
                disabled={remarkDisabled}
            />
        </div>
        <div className="flex justify-end items-center gap-2">
            {collectBlockedHint && !isPaid ? (
                <p className="text-[11px] text-slate-500 text-right leading-snug max-w-[220px]">{collectBlockedHint}</p>
            ) : !isPaid && (remaining > 0 || onRevokeDefer != null) ? (
                <>
                    {onRevokeDefer != null && (
                        <button
                            type="button"
                            onClick={onRevokeDefer}
                            className="px-3 py-1.5 border border-amber-200 text-amber-800 bg-amber-50/80 rounded text-xs font-medium"
                        >
                            缓缴撤销
                        </button>
                    )}
                    {onDefer != null && (
                        <button type="button" onClick={onDefer} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs">缓缴</button>
                    )}
                    {remaining > 0 ? (
                        <button type="button" onClick={onConfirm} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">收款</button>
                    ) : null}
                </>
            ) : isPaid ? (
                <div className="flex flex-wrap justify-end gap-2">
                    {onRevokeDefer != null && (
                        <button
                            type="button"
                            onClick={onRevokeDefer}
                            className="px-3 py-1.5 border border-amber-200 text-amber-800 bg-amber-50/80 rounded text-xs font-medium"
                        >
                            缓缴撤销
                        </button>
                    )}
                    <button type="button" onClick={onRevoke} className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded text-xs">
                        撤销
                    </button>
                </div>
            ) : (
                <span className="text-xs text-slate-400">—</span>
            )}
        </div>
    </div>
    );
};

export const FinanceManager: React.FC<FinanceManagerProps> = ({
    payments,
    tenants,
    invoices,
    billingPeriodNotes = {},
    onUpdatePayments,
    onUpdateTenants,
    onUpdateInvoices,
    onBatchUpdate,
    getBillingDetails,
    onDeferPayment,
    onRevokeDeferBillingNote,
    onResetReceivableApplications,
    onUpdateRentRemark,
    buildings,
    budgetAssumptions = [],
    budgetAdjustments = [],
    mobileReceivableOnly = false,
    authUser = null,
    projectId: projectIdProp,
}) => {
  const projectId = projectIdProp || tenants[0]?.projectId || '';
  const mgmtFeeParkEnabled = isManagementFeeBillingEnabled(projectId);
  const viewRentPricing = canViewRentPricing(authUser);
  const [receivableFeeTab, setReceivableFeeTab] = useState<'rent' | 'management_fee'>(
    () => (canViewRentPricing(authUser) ? 'rent' : 'management_fee'),
  );

  useEffect(() => {
    if (!viewRentPricing && mgmtFeeParkEnabled) {
      setReceivableFeeTab('management_fee');
    }
  }, [viewRentPricing, mgmtFeeParkEnabled]);
  const [showForm, setShowForm] = useState(false);
  const [showDepositTransfer, setShowDepositTransfer] = useState(false);
  const [activeView, setActiveView] = useState<'Payments' | 'Receivables' | 'SpecialBusiness'>('Receivables'); // Default to Receivables

  useEffect(() => {
    if (!mobileReceivableOnly) return;
    setActiveView('Receivables');
  }, [mobileReceivableOnly]);
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [receivableMonth, setReceivableMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const today = new Date().toISOString().split('T')[0];
  const [currentPayment, setCurrentPayment] = useState<Partial<PaymentRecord>>({ date: today, period: today.slice(0, 7) });
  const [isEditing, setIsEditing] = useState(false);
  const [transferData, setTransferData] = useState({ tenantId: '', amount: 0, date: new Date().toISOString().split('T')[0] });
  const [deferModalTenant, setDeferModalTenant] = useState<BillingDetail | null>(null);
  const [deferTargetMonth, setDeferTargetMonth] = useState('');
  const [collectModalDetail, setCollectModalDetail] = useState<BillingDetail | null>(null);
  const [collectModalAmount, setCollectModalAmount] = useState('');
  const [batchPartialOpen, setBatchPartialOpen] = useState(false);
  const [batchSelectedIds, setBatchSelectedIds] = useState<Set<string>>(() => new Set());
  const [batchAmountInputs, setBatchAmountInputs] = useState<Record<string, string>>({});
  const [receivableKeyword, setReceivableKeyword] = useState('');
  const [receivableBucketFilter, setReceivableBucketFilter] = useState<'all' | 'pending' | 'deferred' | 'settled'>('all');
  const [paymentKeyword, setPaymentKeyword] = useState('');
  const [paymentTypeFilter, setPaymentTypeFilter] = useState<'all' | PaymentRecord['type']>('all');
  const [periodPickerYear, setPeriodPickerYear] = useState<number>(new Date().getFullYear());
  const desktopViewportRef = useRef<HTMLDivElement | null>(null);
  const desktopContentRef = useRef<HTMLDivElement | null>(null);
  const [desktopScale, setDesktopScale] = useState(1);
  const [desktopScaledHeight, setDesktopScaledHeight] = useState<number | null>(null);
  const [contractSummaryContent, setContractSummaryContent] = useState<ContractSummaryContent | null>(null);

  const receivableYear = useMemo(() => {
      const y = parseInt(String(receivableMonth).slice(0, 4), 10);
      return Number.isFinite(y) ? y : currentYear;
  }, [receivableMonth, currentYear]);

  const openReceivableContractSummary = (item: BillingDetail) => {
      if (isManualArTenantId(item.tenantId)) {
          alert('手工应收行未关联正式合同，无法展示合同概要。');
          return;
      }
      const realId =
          realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? realTenantIdFromSpecialBusinessAr(item.tenantId);
      const tenantLive = tenants.find((x) => x.id === realId);
      const tenantForBills = item.billingTermsTenant ?? tenantLive;
      if (!tenantForBills) {
          setContractSummaryContent({ kind: 'missing', hint: '未找到该客户的合同档案，无法展示明细。' });
          return;
      }
      const { buildingLabel, unitNamesLabel } = resolveTenantAssetLabels(tenantLive ?? tenantForBills, buildings);
      setContractSummaryContent({
          kind: 'tenant',
          tenant: tenantForBills,
          buildingLabel,
          unitNamesLabel,
      });
  };

  // --- Statistics Calculation ---
  // 1. Annual Cumulative Rent (Actual Received in selected Year)
  const annualRentCollection = useMemo(() => {
      return payments
        .filter(p => p.date.startsWith(selectedYear.toString()) && (p.type === 'Rent' || p.type === 'DepositToRent'))
        .reduce((sum, p) => sum + p.amount, 0);
  }, [payments, selectedYear]);

  const manualReceivableLinesAll = useMemo(
      () => parseManualReceivableLinesFromNotes(billingPeriodNotes),
      [billingPeriodNotes]
  );

  // ---------- 特殊业态收入录入 ----------
  const specialBusinessTenants = useMemo(
      () =>
          tenants.filter(
              (t) =>
                  !!t.isSpecialBusiness &&
                  t.status !== ContractStatus.Terminated &&
                  t.status !== ContractStatus.Expired
          ),
      [tenants]
  );

  const specialBusinessReceivablesAll = useMemo(
      () => parseSpecialBusinessReceivablesFromNotes(billingPeriodNotes),
      [billingPeriodNotes]
  );

  /** 当前账期已存的特殊业态应收（按 tenantId 索引） */
  const specialBusinessSavedByTenantInMonth = useMemo(() => {
      const map = new Map<string, SpecialBusinessReceivable>();
      for (const r of specialBusinessReceivablesAll) {
          if (r.periodYYYYMM === receivableMonth) map.set(r.tenantId, r);
      }
      return map;
  }, [specialBusinessReceivablesAll, receivableMonth]);

  const [specialBizAmountDraft, setSpecialBizAmountDraft] = useState<Record<string, string>>({});
  const [specialBizRemarkDraft, setSpecialBizRemarkDraft] = useState<Record<string, string>>({});
  const [specialBizKeyword, setSpecialBizKeyword] = useState('');

  // 切换账期 / 数据变化时，把已保存值同步到草稿（避免不同账期之间错乱）
  useEffect(() => {
      const amt: Record<string, string> = {};
      const rem: Record<string, string> = {};
      for (const t of specialBusinessTenants) {
          const saved = specialBusinessSavedByTenantInMonth.get(t.id);
          amt[t.id] = saved && saved.amount > 0 ? String(saved.amount) : '';
          rem[t.id] = saved?.remark || '';
      }
      setSpecialBizAmountDraft(amt);
      setSpecialBizRemarkDraft(rem);
  }, [receivableMonth, specialBusinessTenants, specialBusinessSavedByTenantInMonth]);

  const persistSpecialBusinessReceivables = (next: SpecialBusinessReceivable[]) => {
      if (!onBatchUpdate) {
          alert('当前环境不支持批量保存，已忽略录入');
          return;
      }
      onBatchUpdate({
          billingPeriodNotes: {
              ...billingPeriodNotes,
              [SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY]: stringifySpecialBusinessReceivables(next),
          },
      });
  };

  const saveSpecialBusinessRow = (tenantId: string) => {
      const amountRaw = String(specialBizAmountDraft[tenantId] ?? '').replace(/,/g, '').trim();
      const amount = roundMoney2(Number(amountRaw));
      if (!Number.isFinite(amount) || amount < 0) {
          alert('请输入有效金额');
          return;
      }
      const remark = String(specialBizRemarkDraft[tenantId] ?? '').trim();
      let next: SpecialBusinessReceivable[];
      if (amount <= 0.005) {
          next = removeSpecialBusinessReceivable(specialBusinessReceivablesAll, tenantId, receivableMonth);
      } else {
          next = upsertSpecialBusinessReceivable(specialBusinessReceivablesAll, {
              tenantId,
              periodYYYYMM: receivableMonth,
              amount,
              remark: remark || undefined,
              updatedAt: new Date().toISOString(),
          });
      }
      persistSpecialBusinessReceivables(next);
  };

  const saveAllSpecialBusinessRows = () => {
      let next = specialBusinessReceivablesAll;
      let saved = 0;
      let cleared = 0;
      let invalid = 0;
      for (const t of specialBusinessTenants) {
          const raw = String(specialBizAmountDraft[t.id] ?? '').replace(/,/g, '').trim();
          if (raw === '') {
              // 空白：维持原值（不视为清除）
              continue;
          }
          const amount = roundMoney2(Number(raw));
          if (!Number.isFinite(amount) || amount < 0) {
              invalid += 1;
              continue;
          }
          const remark = String(specialBizRemarkDraft[t.id] ?? '').trim();
          if (amount <= 0.005) {
              next = removeSpecialBusinessReceivable(next, t.id, receivableMonth);
              cleared += 1;
          } else {
              next = upsertSpecialBusinessReceivable(next, {
                  tenantId: t.id,
                  periodYYYYMM: receivableMonth,
                  amount,
                  remark: remark || undefined,
                  updatedAt: new Date().toISOString(),
              });
              saved += 1;
          }
      }
      persistSpecialBusinessReceivables(next);
      const tail: string[] = [];
      if (saved) tail.push(`保存 ${saved} 条`);
      if (cleared) tail.push(`清除 ${cleared} 条`);
      if (invalid) tail.push(`忽略无效 ${invalid} 条`);
      if (tail.length === 0) alert('没有可保存的修改');
      else alert(`本月（${receivableMonth}）特殊业态应收录入：${tail.join('，')}`);
  };

  const filteredSpecialBusinessTenants = useMemo(() => {
      const kw = specialBizKeyword.trim().toLowerCase();
      if (!kw) return specialBusinessTenants;
      return specialBusinessTenants.filter((t) => (t.name || '').toLowerCase().includes(kw));
  }, [specialBusinessTenants, specialBizKeyword]);

  const specialBusinessMonthTotal = useMemo(() => {
      let total = 0;
      for (const r of specialBusinessReceivablesAll) {
          if (r.periodYYYYMM === receivableMonth) total += r.amount;
      }
      return roundMoney2(total);
  }, [specialBusinessReceivablesAll, receivableMonth]);

  /**
   * 把指定客户标记 / 取消标记为「特殊业态」。
   * - 立即更新 tenants（合同中心同步生效）；
   * - 取消标注时不会动已录入的应收数据，方便撤回；
   * - 标注后会立刻清空 batch 选择避免选中已不该出现的行。
   */
  const toggleTenantSpecialBusiness = (tenantId: string, next: boolean) => {
      const target = tenants.find((t) => t.id === tenantId);
      if (!target) {
          alert('未找到该客户合同（可能为手工应收行，请使用清除按钮）');
          return;
      }
      if (next === !!target.isSpecialBusiness) return;
      const updated = tenants.map((t) => (t.id === tenantId ? { ...t, isSpecialBusiness: next } : t));
      onUpdateTenants(updated);
      setBatchSelectedIds(new Set());
  };

  /**
   * 智能识别「公区配套」类候选客户：名字含停车/公区/物业/配套/广告/充电桩等关键词，
   * 且未被标注为特殊业态。这些客户**通常**也是按经营/分成结算，
   * 用户在标特殊业态时往往会漏标其中一两条（如示例中的「停车场」与「停车收费」）。
   */
  const SPECIAL_BUSINESS_NAME_HINT_RE = /(停车|公区|公共区域|配套|广告|展位|展柜|充电桩|租赁费|物业管理|物业费|代收|场地费|场租|经营分成|分成)/;
  const specialBusinessCandidatesUnmarked = useMemo(() => {
      const list: Tenant[] = [];
      for (const t of tenants) {
          if (t.isSpecialBusiness) continue;
          if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) continue;
          if (!SPECIAL_BUSINESS_NAME_HINT_RE.test(t.name || '')) continue;
          list.push(t);
      }
      return list;
  }, [tenants]);

  // 2. Monthly Stats based on Receivable Month Selection（含手工应收行）
  const currentReceivables = useMemo(() => {
      if (!receivableMonth) return [];
      const parts = receivableMonth.split('-');
      if (parts.length !== 2) return [];
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const base = getBillingDetails(year, month);
      const manualForMonth = manualReceivableLinesAll.filter((l) => l.periodYYYYMM === receivableMonth);
      const manualRows: BillingDetail[] = manualForMonth.map((line) => {
          const tenantId = `manual_ar_${line.id}`;
          const label = line.customerLabel || line.title || '手工应收';
          const amountDue = roundMoney2(line.amount);
          const paid = payments
              .filter((p) => p.tenantId === tenantId && (p.type === 'Rent' || p.type === 'DepositToRent'))
              .reduce((s, p) => {
                  const periods = (p.period || '')
                      .split(/[,\n;，；\s]+/)
                      .map((s) => s.trim())
                      .filter(Boolean)
                      .filter((x) => /^\d{4}-\d{2}$/.test(x));
                  if (periods.length > 0) return s + (periods.includes(receivableMonth) ? p.amount : 0);
                  return s + (p.date.startsWith(receivableMonth) ? p.amount : 0);
              }, 0);
          let status: BillingDetail['status'] = billingStatusFromAmounts(amountDue, paid);
          return {
              tenantId,
              tenantName: label,
              unitIds: [],
              amountDue,
              amountPaid: roundMoney2(paid),
              status,
          };
      });
      return [...base, ...manualRows];
  }, [receivableMonth, payments, tenants, getBillingDetails, manualReceivableLinesAll]);

  const receivableFiltered = useMemo(() => {
      const kw = receivableKeyword.trim().toLowerCase();
      const feeKind = receivableFeeTab === 'management_fee' ? 'management_fee' : 'rent';
      return currentReceivables.filter((r) => {
          const rowKind = r.feeKind || 'rent';
          if (rowKind !== feeKind) return false;
          return !kw || r.tenantName.toLowerCase().includes(kw);
      });
  }, [currentReceivables, receivableKeyword, receivableFeeTab]);

  const receivableRowKey = (item: BillingDetail) => `${item.feeKind || 'rent'}|${item.tenantId}`;

  const canCollectCurrentFeeTab = canWriteReceivableScope(
      authUser,
      receivableFeeTab === 'management_fee' ? 'management_fee' : 'rent',
  );

  const paymentAmountForPeriod = (tenantId: string, periodYYYYMM: string): number => {
      return payments
          .filter((p) => {
              if (p.type !== 'Rent' && p.type !== 'DepositToRent') return false;
              if (!paymentTenantMatchesBillingTenant(p.tenantId, tenantId, tenants, p.tenantName)) return false;
              const periodList = parseBillingPeriods(p.period);
              if (periodList.length > 0) return periodList.includes(periodYYYYMM);
              return p.date.startsWith(periodYYYYMM);
          })
          .reduce((sum, p) => sum + p.amount, 0);
  };

  const getDeferredTargetCollection = (detail: BillingDetail): number => {
      const deferredAmount = detail.deferredAmount ?? 0;
      const targetPeriod = detail.deferredToPeriod;
      if (deferredAmount <= 0.005 || !targetPeriod) return 0;
      return Math.min(deferredAmount, paymentAmountForPeriod(detail.tenantId, targetPeriod));
  };

  const getEffectivePaidAmount = (detail: BillingDetail) =>
      roundMoney2(detail.amountPaid + getDeferredTargetCollection(detail));

  const getRemainingReceivable = (detail: BillingDetail) =>
      normalizeReceivableRemaining(receivableBudgetDisplay(detail) - getEffectivePaidAmount(detail));

  const isReceivableSettled = (detail: BillingDetail) =>
      isReceivableTailSettled(receivableBudgetDisplay(detail), getEffectivePaidAmount(detail));

  const receivableSections = useMemo(() => {
      const unsettled: { item: BillingDetail; i: number }[] = [];
      const settledThisMonth: { item: BillingDetail; i: number }[] = [];
      const prepaid: { item: BillingDetail; i: number }[] = [];
      const deferred: { item: BillingDetail; i: number }[] = [];
      receivableFiltered.forEach((item, i) => {
          const entry = { item, i };
          if ((item.deferredAmount ?? 0) > 0.005 && item.deferredToPeriod && isReceivableSettled(item)) {
              settledThisMonth.push(entry);
              return;
          }
          const bucket = classifyReceivableRow(item, receivableMonth, payments, tenants);
          if (bucket === 'unsettled') unsettled.push(entry);
          else if (bucket === 'deferred') deferred.push(entry);
          else if (bucket === 'prepaid') prepaid.push(entry);
          else settledThisMonth.push(entry);
      });
      return { unsettled, settledThisMonth, prepaid, deferred };
  }, [receivableFiltered, receivableMonth, payments, tenants]);

  const displayReceivableSections = useMemo(() => {
      const base = receivableSections;
      if (receivableBucketFilter === 'all') return base;
      const filterBucket = (rows: { item: BillingDetail; i: number }[]) =>
          rows.filter(({ item }) => {
              if ((item.deferredAmount ?? 0) > 0.005 && item.deferredToPeriod && isReceivableSettled(item)) {
                  return receivableBucketFilter === 'settled';
              }
              const b = classifyReceivableRow(item, receivableMonth, payments, tenants);
              if (receivableBucketFilter === 'pending') return b === 'unsettled';
              if (receivableBucketFilter === 'deferred') return b === 'deferred';
              return b === 'settled_this_month' || b === 'prepaid';
          });
      return {
          unsettled: filterBucket(base.unsettled),
          deferred: filterBucket(base.deferred),
          settledThisMonth: filterBucket(base.settledThisMonth),
          prepaid: filterBucket(base.prepaid),
      };
  }, [receivableSections, receivableBucketFilter, receivableMonth, payments, tenants]);

  const receivableResetImpact = useMemo(
      () => countReceivableTabResetImpact(billingPeriodNotes, payments),
      [billingPeriodNotes, payments],
  );

  const monthStats = useMemo(() => {
      // 顶部「本月应收/实收/待收」基于「本月全量」统计，不跟随关键词过滤。
      // 待收 = 各行「待收余额」之和（与表格一致，含缓缴目标账期已收款抵扣）；实收与应收、待收在同一口径下可加总核对。
      const systemReceivable = sumSystemBudgetReceivable(currentReceivables);
      const manualReceivable = sumManualArReceivable(currentReceivables);
      const budgetReceivable = sumBudgetReceivableForFinance(currentReceivables); // 含手工
      const pendingCollection = currentReceivables.reduce((sum, r) => sum + getRemainingReceivable(r), 0);
      const actualReceived = roundMoney2(Math.max(0, budgetReceivable - pendingCollection));
      // 「合同应收」口径汇总：仅取每行 contractAmountDue（合成行如缓缴调入/手工应收/特殊业态 fallback 0），
      // 与工作台 contractReceivable 同源，方便用户在财务页面一眼看到两个口径的差额来源。
      const contractReceivableTotal = roundMoney2(
          currentReceivables.reduce((sum, r) => sum + (r.contractAmountDue ?? 0), 0)
      );
      /** 系统账单行的合同滚动合计（不含手工应收行），与 systemReceivable 对账可得缓缴等结算侧调整 */
      const systemContractReceivableTotal = roundMoney2(
          currentReceivables
              .filter((r) => !isManualArTenantId(r.tenantId))
              .reduce((sum, r) => sum + (r.contractAmountDue ?? 0), 0)
      );
      const workbenchSettlementDelta = roundMoney2(systemReceivable - systemContractReceivableTotal);

      return {
          budgetReceivable,
          contractReceivableTotal,
          systemReceivable,
          systemContractReceivableTotal,
          workbenchSettlementDelta,
          manualReceivable,
          actualReceived,
          pendingCollection,
      };
  }, [currentReceivables]);

  const receivableSystemFootSums = useMemo(() => {
      let paid = 0;
      let pending = 0;
      for (const r of currentReceivables) {
          if (isManualArTenantId(r.tenantId)) continue;
          paid += getEffectivePaidAmount(r);
          pending += getRemainingReceivable(r);
      }
      return { paid: roundMoney2(paid), pending: roundMoney2(pending) };
  }, [currentReceivables, payments, tenants, receivableMonth]);

  const receivableManualFootSums = useMemo(() => {
      let paid = 0;
      let pending = 0;
      let bill = 0;
      for (const r of currentReceivables) {
          if (!isManualArTenantId(r.tenantId)) continue;
          bill += receivableBudgetDisplay(r);
          paid += getEffectivePaidAmount(r);
          pending += getRemainingReceivable(r);
      }
      return { bill: roundMoney2(bill), paid: roundMoney2(paid), pending: roundMoney2(pending) };
  }, [currentReceivables, payments, tenants, receivableMonth]);

  const totalSettlementDeltaFoot = useMemo(
      () => roundMoney2(monthStats.budgetReceivable - monthStats.contractReceivableTotal),
      [monthStats.budgetReceivable, monthStats.contractReceivableTotal],
  );

  const availableYears = useMemo(() => {
      const years = new Set<number>();
      years.add(currentYear);
      payments.forEach(p => {
          if (p.date && p.date.length >= 4) {
              const year = parseInt(p.date.substring(0, 4), 10);
              if (!isNaN(year)) years.add(year);
          }
      });
      return Array.from(years).sort((a,b) => b - a);
  }, [payments, currentYear]);

  const groupedPayments = useMemo(() => {
      const filtered = payments.filter((p) => {
          if (!p.date || !p.date.startsWith(selectedYear.toString())) return false;
          const kw = paymentKeyword.trim().toLowerCase();
          if (kw && !(p.tenantName || '').toLowerCase().includes(kw)) return false;
          if (paymentTypeFilter !== 'all' && p.type !== paymentTypeFilter) return false;
          return true;
      });
      const groups: Record<string, PaymentRecord[]> = {};
      filtered.forEach((p) => {
          const monthKey = p.date.substring(0, 7);
          if (!groups[monthKey]) groups[monthKey] = [];
          groups[monthKey].push(p);
      });
      return groups;
  }, [payments, selectedYear, paymentKeyword, paymentTypeFilter]);

  const sortedMonths = Object.keys(groupedPayments).sort((a,b) => b.localeCompare(a));

  useEffect(() => {
      if (!showForm) return;
      const base = currentPayment.date || new Date().toISOString().split('T')[0];
      const y = Number(base.slice(0, 4));
      if (!Number.isNaN(y) && y > 1900) {
          setPeriodPickerYear(y);
      }
  }, [showForm, currentPayment.date]);

  const selectedPeriods = useMemo(() => parseBillingPeriods(currentPayment.period), [currentPayment.period]);
  const selectedPeriodSet = useMemo(() => new Set(selectedPeriods), [selectedPeriods]);
  const toggleBillingPeriod = (yyyyMm: string) => {
      const next = new Set(selectedPeriodSet);
      if (next.has(yyyyMm)) next.delete(yyyyMm);
      else next.add(yyyyMm);
      const arr = Array.from(next).sort();
      setCurrentPayment({ ...currentPayment, period: arr.join(',') || undefined });
  };

  useEffect(() => {
      if (typeof window === 'undefined') return;
      const viewport = desktopViewportRef.current;
      const content = desktopContentRef.current;
      if (!viewport || !content) {
          setDesktopScale(1);
          setDesktopScaledHeight(null);
          return;
      }

      const recalc = () => {
          const viewportWidth = viewport.clientWidth;
          const contentWidth = content.scrollWidth;
          const contentHeight = content.scrollHeight;
          if (!viewportWidth || !contentWidth || !contentHeight) {
              setDesktopScale(1);
              setDesktopScaledHeight(null);
              return;
          }
          // 自动缩放：默认不放大，仅在空间不足时缩小，最低 78%
          const nextScale = Math.max(0.78, Math.min(1, viewportWidth / contentWidth));
          setDesktopScale(nextScale);
          setDesktopScaledHeight(contentHeight * nextScale);
      };

      recalc();
      const ro = new ResizeObserver(() => recalc());
      ro.observe(viewport);
      ro.observe(content);
      window.addEventListener('resize', recalc);
      return () => {
          ro.disconnect();
          window.removeEventListener('resize', recalc);
      };
  }, [activeView, receivableMonth, selectedYear, currentReceivables.length, sortedMonths.length]);

  const handlePrevMonth = () => {
      const parts = receivableMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      let newYear = year; let newMonth = month - 1;
      if (newMonth < 1) { newMonth = 12; newYear -= 1; }
      setReceivableMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const handleNextMonth = () => {
      const parts = receivableMonth.split('-');
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10);
      let newYear = year; let newMonth = month + 1;
      if (newMonth > 12) { newMonth = 1; newYear += 1; }
      setReceivableMonth(`${newYear}-${String(newMonth).padStart(2, '0')}`);
  };

  const receivableDeferCollectHint = (it: BillingDetail) =>
      isFullDeferOutSourceRow(it) ? `请于 ${it.deferredToPeriod} 账期核销缓入金额` : null;

  const openCollectModal = (detail: BillingDetail) => {
      const scope = detail.feeKind === 'management_fee' ? 'management_fee' : 'rent';
      if (!canWriteReceivableScope(authUser, scope)) {
          alert(scope === 'rent' ? '当前账号无租金核销权限' : '当前账号无物业费核销权限');
          return;
      }
      const remaining = getRemainingReceivable(detail);
      if (remaining <= 0) return;
      if (isFullDeferOutSourceRow(detail)) {
          alert(`该笔已全部缓出至 ${detail.deferredToPeriod}，请切换到该账期进行收款/核销。`);
          return;
      }
      setCollectModalDetail(detail);
      setCollectModalAmount(String(remaining));
  };

  /** 与 openBatchPartialModal 指向同一弹窗入口（兼容外部引用） */
  const openBatchPartialModal = () => setBatchPartialOpen(true);

  const submitCollectModal = () => {
      if (!collectModalDetail) return;
      const remaining = getRemainingReceivable(collectModalDetail);
      const raw = String(collectModalAmount).replace(/,/g, '').trim();
      const amt = roundMoney2(Number(raw));
      if (!Number.isFinite(amt) || amt <= 0) {
          alert('请输入有效实收金额');
          return;
      }
      if (!isCollectAmountAcceptable(remaining, amt)) {
          alert(`实收金额不能超过待收 ${formatCurrency(remaining)} 超过 ${RECEIVABLE_TAIL_TOLERANCE} 元`);
          return;
      }
      const tailWaived = receivableTailWaivedAmount(remaining, amt);
      const paymentDate = new Date().toISOString().split('T')[0];
      const { period: paymentPeriod, error: periodErr } = resolveRentWriteOffPaymentPeriod(
          collectModalDetail,
          receivableMonth,
          amt,
      );
      if (periodErr) {
          alert(periodErr);
          return;
      }
      const payTenantId = realTenantIdFromDeferInDisplayTenantId(collectModalDetail.tenantId) ?? collectModalDetail.tenantId;
      const isMgmt = collectModalDetail.feeKind === 'management_fee';
      const newPayment: PaymentRecord = {
          id: `p${Date.now()}_col_${payTenantId}`,
          tenantId: payTenantId,
          tenantName: collectModalDetail.tenantName,
          amount: amt,
          type: isMgmt ? 'ManagementFee' : 'Rent',
          date: paymentDate,
          period: paymentPeriod,
          status: 'Received',
          remarks: isMgmt
              ? `[${paymentPeriod}] 物业费月度账单${tailWaived > 0 ? `（尾差${tailWaived.toFixed(2)}元自动核销）` : ''}`
              : `[${paymentPeriod}] 月度账单${tailWaived > 0 ? `（尾差${tailWaived.toFixed(2)}元自动核销）` : ''}`,
          invoiceStatus: 'Pending',
      };
      try {
          assertCanMutatePayment(authUser, newPayment);
      } catch (err: unknown) {
          alert(err instanceof Error ? err.message : '无核销权限');
          return;
      }
      if (onBatchUpdate) onBatchUpdate({ payments: [...payments, newPayment] });
      else onUpdatePayments([...payments, newPayment]);
      setCollectModalDetail(null);
  };

  const handleBatchConfirmCollection = () => {
      const ids = Array.from(batchSelectedIds);
      if (ids.length === 0) {
          alert('请先勾选应收行');
          return;
      }
      const paymentDate = new Date().toISOString().split('T')[0];
      const nextPayments = [...payments];
      for (const tid of ids) {
          const detail = receivableFiltered.find((r) => receivableRowKey(r) === tid);
          if (!detail) continue;
          const scope = detail.feeKind === 'management_fee' ? 'management_fee' : 'rent';
          if (!canWriteReceivableScope(authUser, scope)) {
              alert(scope === 'rent' ? '当前账号无租金核销权限' : '当前账号无物业费核销权限');
              return;
          }
          if (isFullDeferOutSourceRow(detail)) {
              alert(`${detail.tenantName} 已全部缓出至 ${detail.deferredToPeriod}，请取消勾选并在该账期核销。`);
              return;
          }
          const remaining = getRemainingReceivable(detail);
          const raw = (batchAmountInputs[tid] ?? String(remaining)).replace(/,/g, '').trim();
          const amt = roundMoney2(Number(raw));
          if (!Number.isFinite(amt) || amt <= 0) continue;
          if (!isCollectAmountAcceptable(remaining, amt)) {
              alert(`${detail.tenantName}: 实收不能超过待收 ${formatCurrency(remaining)} 超过 ${RECEIVABLE_TAIL_TOLERANCE} 元`);
              return;
          }
          const tailWaived = receivableTailWaivedAmount(remaining, amt);
          const { period: payPeriod, error: periodErr } = resolveRentWriteOffPaymentPeriod(detail, receivableMonth, amt);
          if (periodErr) {
              alert(`${detail.tenantName}: ${periodErr}`);
              return;
          }
          const payTid = realTenantIdFromDeferInDisplayTenantId(tid) ?? tid;
          const isMgmt = detail.feeKind === 'management_fee';
          nextPayments.push({
              id: `p${Date.now()}_col_${payTid}_${Math.random().toString(36).slice(2, 8)}`,
              tenantId: payTid,
              tenantName: detail.tenantName,
              amount: amt,
              type: isMgmt ? 'ManagementFee' : 'Rent',
              date: paymentDate,
              period: payPeriod,
              status: 'Received',
              remarks: isMgmt
                  ? `[${payPeriod}] 物业费批量核销${tailWaived > 0 ? `（尾差${tailWaived.toFixed(2)}元自动核销）` : ''}`
                  : `[${payPeriod}] 批量核销${tailWaived > 0 ? `（尾差${tailWaived.toFixed(2)}元自动核销）` : ''}`,
              invoiceStatus: 'Pending',
          });
      }
      if (onBatchUpdate) onBatchUpdate({ payments: nextPayments });
      else onUpdatePayments(nextPayments);
      setBatchPartialOpen(false);
      setBatchSelectedIds(new Set());
      setBatchAmountInputs({});
  };

  const openDeferModal = (detail: BillingDetail) => {
      setDeferModalTenant(detail);
      setDeferTargetMonth(nextReceivableMonthLabel(receivableMonth));
  };

  const confirmDeferFromModal = () => {
      if (!deferModalTenant) return;
      const fromParts = receivableMonth.split('-');
      if (fromParts.length !== 2) return;
      const fromYear = parseInt(fromParts[0], 10);
      const fromMonth = parseInt(fromParts[1], 10) - 1;
      const toParts = deferTargetMonth.trim().split('-');
      if (toParts.length !== 2 || toParts[0].length !== 4 || toParts[1].length !== 2) {
          alert('请选择有效的目标账期（年月）');
          return;
      }
      const toYear = parseInt(toParts[0], 10);
      const toMonth = parseInt(toParts[1], 10) - 1;
      if (Number.isNaN(fromYear) || Number.isNaN(fromMonth) || Number.isNaN(toYear) || Number.isNaN(toMonth)) {
          alert('账期格式无效');
          return;
      }
      const deferSourceId = realTenantIdFromDeferInDisplayTenantId(deferModalTenant.tenantId) ?? deferModalTenant.tenantId;
      onDeferPayment(deferSourceId, fromYear, fromMonth, toYear, toMonth);
      setDeferModalTenant(null);
  };

  const handleRevokeCollection = (detail: BillingDetail) => {
      const scope = detail.feeKind === 'management_fee' ? 'management_fee' : 'rent';
      if (!canWriteReceivableScope(authUser, scope)) {
          alert(scope === 'rent' ? '当前账号无租金核销权限' : '当前账号无物业费核销权限');
          return;
      }
      const relevantPayments = payments.filter((p) => {
          if (!paymentTenantMatchesBillingTenant(p.tenantId, detail.tenantId, tenants, p.tenantName)) return false;
          const periodList = parseBillingPeriods(p.period);
          const relatedPeriods = [receivableMonth];
          if (detail.deferredToPeriod && (detail.deferredAmount ?? 0) > 0.005) relatedPeriods.push(detail.deferredToPeriod);
          if (periodList.length > 0) return periodList.some((period) => relatedPeriods.includes(period));
          return p.date.startsWith(receivableMonth);
      });
      if (relevantPayments.length === 0) { alert("未找到关联收款记录"); return; }
      if (confirm(`撤销 ${relevantPayments.length} 笔关联流水?`)) {
          const idsToRemove = new Set(relevantPayments.map(p => p.id));
          const newPayments = payments.filter(p => !idsToRemove.has(p.id));
          if (onBatchUpdate) onBatchUpdate({ payments: newPayments });
          else onUpdatePayments(newPayments);
      }
  };

  const handleSavePayment = () => {
    if (!currentPayment.tenantId || !currentPayment.amount || !currentPayment.type) { alert("请填写完整信息"); return; }
    const tenant = tenants.find(t => t.id === currentPayment.tenantId);
    let amount = Number(currentPayment.amount);
    if (currentPayment.type === 'DepositRefund' && amount > 0) amount = -amount;
    const record: PaymentRecord = {
      id: currentPayment.id || `p${Date.now()}`, tenantId: currentPayment.tenantId, tenantName: tenant?.name || currentPayment.tenantName || 'Unknown',
      amount: amount, type: currentPayment.type as any, date: currentPayment.date!, status: 'Received', remarks: currentPayment.remarks,
      invoiceStatus: currentPayment.invoiceStatus || 'Pending',
      period: (currentPayment.type === 'Rent' || currentPayment.type === 'DepositToRent') ? normalizeBillingPeriods(currentPayment.period) : undefined
    };
    try {
        assertCanMutatePayment(authUser, record);
    } catch (err: unknown) {
        alert(err instanceof Error ? err.message : '无核销权限');
        return;
    }
    let updatedTenants = undefined;
    if (tenant && !isEditing) {
        let newStatus = tenant.depositStatus;
        if (record.type === 'DepositRefund') newStatus = DepositStatus.Refunded;
        else if (record.type === 'DepositToRent') newStatus = DepositStatus.Deducted;
        if (newStatus !== tenant.depositStatus) updatedTenants = tenants.map(t => t.id === tenant.id ? { ...t, depositStatus: newStatus } : t);
    }
    if (onBatchUpdate) {
        const newPayments = isEditing ? payments.map(p => p.id === record.id ? record : p) : [record, ...payments];
        const updates: any = { payments: newPayments };
        if (updatedTenants) updates.tenants = updatedTenants;
        onBatchUpdate(updates);
    } else {
        if (isEditing) onUpdatePayments(payments.map(p => p.id === record.id ? record : p));
        else onUpdatePayments([record, ...payments]);
        if (updatedTenants) onUpdateTenants(updatedTenants);
    }
    setShowForm(false); setIsEditing(false); setCurrentPayment({ date: new Date().toISOString().split('T')[0], period: new Date().toISOString().slice(0, 7) });
  };

  const handleEditPayment = (payment: PaymentRecord) => {
      setCurrentPayment({ ...payment, amount: payment.type === 'DepositRefund' ? Math.abs(payment.amount) : payment.amount });
      setIsEditing(true); setShowForm(true); setShowDepositTransfer(false);
  };
  const handleDeletePayment = (id: string) => { if(window.confirm("确定删除?")) onUpdatePayments(payments.filter(p => p.id !== id)); };
  
  const handleDepositTransfer = () => {
      if(!transferData.tenantId || !transferData.amount) return;
      const tenant = tenants.find(t => t.id === transferData.tenantId);
      if (!tenant) return;
      const rentRecord: PaymentRecord = {
          id: `p${Date.now()}_rent`, tenantId: transferData.tenantId, tenantName: tenant.name || 'Unknown', amount: Number(transferData.amount),
          type: 'DepositToRent', date: transferData.date, status: 'Received', remarks: '押金转租金', invoiceStatus: 'Pending'
      };
      try {
          assertCanMutatePayment(authUser, rentRecord);
      } catch (err: unknown) {
          alert(err instanceof Error ? err.message : '无核销权限');
          return;
      }
      const newTenant = { ...tenant, depositStatus: DepositStatus.Deducted };
      if (onBatchUpdate) onBatchUpdate({ payments: [rentRecord, ...payments], tenants: tenants.map(t => t.id === tenant.id ? newTenant : t) });
      else { onUpdatePayments([rentRecord, ...payments]); onUpdateTenants(tenants.map(t => t.id === tenant.id ? newTenant : t)); }
      setShowDepositTransfer(false); setTransferData({ tenantId: '', amount: 0, date: new Date().toISOString().split('T')[0] });
  };

  const toggleBatchSelect = (tenantId: string) => {
      setBatchSelectedIds((prev) => {
          const n = new Set(prev);
          if (n.has(tenantId)) n.delete(tenantId);
          else n.add(tenantId);
          return n;
      });
  };

  const deferRevokeClickForItem = (item: BillingDetail): (() => void) | undefined => {
      if (!onRevokeDeferBillingNote || !isDeferInDisplayTenantId(item.tenantId)) return undefined;
      const k = deferBillingNoteKeyFromDeferInDisplayTenantId(item.tenantId);
      if (!k) return undefined;
      return () => onRevokeDeferBillingNote(k);
  };

  const renderReceivableTableRow = (item: BillingDetail) => {
      const remaining = getRemainingReceivable(item);
      const paidAmount = getEffectivePaidAmount(item);
      const isPaid = isReceivableSettled(item);
      const remarkTenantId = realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? item.tenantId;
      const remark = getRentCollectionRemark(billingPeriodNotes, remarkTenantId, receivableMonth);
      const deferShell = deferReceivableShellClass(item);
      const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
      const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
      const fullDeferOutBlock = isFullDeferOutSourceRow(item);
      const deferRevokeKey =
          onRevokeDeferBillingNote && isDeferInDisplayTenantId(item.tenantId)
              ? deferBillingNoteKeyFromDeferInDisplayTenantId(item.tenantId)
              : null;

      return (
          <tr key={receivableRowKey(item)} className={`hover:bg-slate-50 transition-colors ${isPaid ? 'opacity-75' : ''} ${deferShell}`}>
              <td className="px-2 py-3 text-center w-12 align-middle">
                  {!isPaid && remaining > 0 && !fullDeferOutBlock ? (
                      <input
                          type="checkbox"
                          className="rounded border-slate-300"
                          checked={batchSelectedIds.has(receivableRowKey(item))}
                          onChange={() => toggleBatchSelect(receivableRowKey(item))}
                          title="批量核销"
                      />
                  ) : (
                      <span className="text-slate-300">—</span>
                  )}
              </td>
              <td className="px-4 py-3 text-slate-700">
                  <div className="font-medium flex items-center gap-1.5 flex-wrap">
                      {isManualArTenantId(item.tenantId) ? (
                          <span>{item.tenantName}</span>
                      ) : (
                          <span
                              role="button"
                              tabIndex={0}
                              className="cursor-pointer hover:text-blue-700 underline-offset-2 hover:underline decoration-blue-400/70 text-left"
                              title="点击查看合同概要"
                              onClick={(e) => {
                                  e.stopPropagation();
                                  openReceivableContractSummary(item);
                              }}
                              onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      openReceivableContractSummary(item);
                                  }
                              }}
                          >
                              {item.tenantName}
                          </span>
                      )}
                      {isSpecialBusinessArTenantId(item.tenantId) ? (
                          <span className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 font-bold inline-flex items-center gap-0.5">
                              <Sparkles size={10} /> 特殊业态
                          </span>
                      ) : isManualArTenantId(item.tenantId) ? (
                          <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200 font-medium">手工应收</span>
                      ) : (
                          <>
                              <span className="text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded border border-blue-100 font-medium">合同账单</span>
                              {SPECIAL_BUSINESS_NAME_HINT_RE.test(item.tenantName || '') && (
                                  <button
                                      type="button"
                                      onClick={() => {
                                          if (confirm(`将「${item.tenantName}」标记为特殊业态？\n标注后将不再按合同自动产生应收，\n金额需在「特殊业态收入录入」按月手工录入。`)) {
                                              toggleTenantSpecialBusiness(realTenantIdFromSpecialBusinessAr(item.tenantId), true);
                                          }
                                      }}
                                      className="text-[10px] bg-amber-50 text-amber-700 px-1.5 py-0.5 rounded border border-amber-200 hover:bg-amber-100 inline-flex items-center gap-0.5"
                                  >
                                      <Sparkles size={10} /> 标为特殊业态
                                  </button>
                              )}
                          </>
                      )}
                  </div>
                  {hasDeferOut && (
                      <div className="mt-1 text-[10px] font-semibold text-orange-800">缓出 → {item.deferredToPeriod}（{formatCurrency(item.deferredAmount ?? 0)}）</div>
                  )}
                  {hasDeferIn && (
                      <div className="mt-1 text-[10px] font-semibold text-sky-800">缓入 ← {item.deferredInFromSummary}（{formatCurrency(item.deferredInAmount ?? 0)}）</div>
                  )}
                  {item.budgetAlignmentNote && (
                      <div className="mt-1.5 text-[10px] text-rose-800 leading-snug bg-rose-50/90 border border-rose-100 rounded px-1.5 py-1">
                          {item.budgetAlignmentNote}
                      </div>
                  )}
              </td>
              <td className="px-4 py-3 align-middle text-center whitespace-nowrap text-slate-600">
                  {isManualArTenantId(item.tenantId) || isSpecialBusinessArTenantId(item.tenantId) || isDeferInDisplayTenantId(item.tenantId)
                      ? <span className="text-slate-300">—</span>
                      : formatCurrency(item.contractAmountDue ?? 0)}
              </td>
              <td
                  className={`px-3 py-3 align-middle text-center whitespace-nowrap border-l-2 border-amber-300 bg-amber-50/40 ${
                      Math.abs(receivableRowSettlementDelta(item)) > 0.005
                          ? 'bg-amber-100/70 font-semibold text-amber-950'
                          : 'text-slate-600'
                  }`}
                  title={
                      '本列不可单独删除：值为「实际核销展示 − 合同滚动」的差额。\n' +
                      '若认为异常，请按来源处理——\n' +
                      '· 缓缴录错：本行「缓缴撤销」或上方「撤回核销与缓缴」批量清理后重算；\n' +
                      '· 导入预算/表外覆盖：回「预算管理」或导入存档改正；\n' +
                      '· 特殊业态/手工行：在对应录入或手工应收行改金额；\n' +
                      '· 合同条款与推算不一致：在「合同录入」保存触发重算；\n' +
                      '· 看行内红字 budgetAlignmentNote 提示对账。'
                  }
              >
                  {(() => {
                      const d = receivableRowSettlementDelta(item);
                      return (
                          <>
                              {d > 0.005 ? '+' : ''}
                              {formatCurrency(d)}
                          </>
                      );
                  })()}
              </td>
              <td className="px-4 py-3 align-middle text-center whitespace-nowrap">
                  <div className="text-slate-800 font-semibold">{formatCurrency(receivableBudgetDisplay(item))}</div>
                  {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                      <div className="text-[10px] text-slate-400 mt-0.5">原账面应收已全部缓出</div>
                  )}
              </td>
              <td className="px-4 py-3 text-slate-500 text-center whitespace-nowrap">{formatCurrency(paidAmount)}</td>
              <td className="px-4 py-3 font-bold text-blue-600 text-center whitespace-nowrap">{remaining > 0 ? formatCurrency(remaining) : '-'}</td>
              <td className="px-4 py-2 align-top max-w-[220px]">
                  <textarea
                      className="w-full min-h-[52px] text-xs border border-slate-200 rounded-lg p-2 text-slate-700 resize-y"
                      placeholder="预期收款日、沟通情况等"
                      value={remark}
                      onChange={(e) => onUpdateRentRemark?.(remarkTenantId, receivableMonth, e.target.value)}
                      disabled={!onUpdateRentRemark}
                  />
              </td>
              <td className="px-4 py-3 text-right">
                  {fullDeferOutBlock && !isPaid ? (
                      <div className="text-xs text-slate-500 text-right leading-snug max-w-[200px] ml-auto">
                          请于 <span className="font-mono font-semibold text-slate-700">{item.deferredToPeriod}</span> 账期核销缓入金额
                      </div>
                  ) : !isPaid && remaining > 0 ? (
                      <div className="flex justify-end gap-2 flex-wrap">
                          {canCollectCurrentFeeTab && (
                          <button onClick={() => openCollectModal(item)} className="px-2 py-1 bg-white border border-blue-200 text-blue-600 rounded hover:bg-blue-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><Receipt size={14} /> 收款</button>
                          )}
                          {!isManualArTenantId(item.tenantId) && !isDeferInDisplayTenantId(item.tenantId) && (
                              <button onClick={() => openDeferModal(item)} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><Clock size={14} /> 缓缴</button>
                          )}
                          {deferRevokeKey != null && onRevokeDeferBillingNote ? (
                              <button
                                  type="button"
                                  onClick={() => onRevokeDeferBillingNote(deferRevokeKey)}
                                  className="px-2 py-1 bg-white border border-amber-200 text-amber-800 rounded hover:bg-amber-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[72px] justify-center font-medium"
                                  title="撤销该笔缓缴，金额回到原账期"
                              >
                                  缓缴撤销
                              </button>
                          ) : null}
                      </div>
                  ) : !isPaid && deferRevokeKey != null && onRevokeDeferBillingNote ? (
                      <div className="flex justify-end gap-2 flex-wrap">
                          <button
                              type="button"
                              onClick={() => onRevokeDeferBillingNote(deferRevokeKey)}
                              className="px-2 py-1 bg-white border border-amber-200 text-amber-800 rounded hover:bg-amber-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[72px] justify-center font-medium"
                              title="撤销该笔缓缴，金额回到原账期"
                          >
                              缓缴撤销
                          </button>
                      </div>
                  ) : isPaid ? (
                      <div className="flex justify-end gap-2 flex-wrap">
                          {deferRevokeKey != null && onRevokeDeferBillingNote ? (
                              <button
                                  type="button"
                                  onClick={() => onRevokeDeferBillingNote(deferRevokeKey)}
                                  className="px-2 py-1 bg-white border border-amber-200 text-amber-800 rounded hover:bg-amber-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[72px] justify-center font-medium"
                                  title="撤销该笔缓缴（不影响已记账流水，请核对收款明细）"
                              >
                                  缓缴撤销
                              </button>
                          ) : null}
                          <button onClick={() => handleRevokeCollection(item)} className="px-2 py-1 bg-white border border-rose-200 text-rose-600 rounded hover:bg-rose-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><RotateCcw size={14} /> 撤销</button>
                      </div>
                  ) : (
                      <span className="text-xs text-slate-400">—</span>
                  )}
              </td>
          </tr>
      );
  };

  const receivableSectionExportTitle = (section: 'pending' | 'deferred' | 'settled'): string => {
      if (section === 'pending') return WRITEOFF_LABELS.pending;
      if (section === 'deferred') return `${WRITEOFF_LABELS.deferred}（原账期调出）`;
      return WRITEOFF_LABELS.settled;
  };

  const handleExportReceivables = () => {
      const rows: Record<string, unknown>[] = [];
      const appendSection = (section: 'pending' | 'deferred' | 'settled', entries: { item: BillingDetail }[]) => {
          const title = receivableSectionExportTitle(section);
          for (const { item } of entries) {
              const remarkTid = realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? item.tenantId;
              const remark = getRentCollectionRemark(billingPeriodNotes, remarkTid, receivableMonth);
              const paid = getEffectivePaidAmount(item);
              const remaining = getRemainingReceivable(item);
              let lineType = '合同账单';
              if (isSpecialBusinessArTenantId(item.tenantId)) lineType = '特殊业态';
              else if (isManualArTenantId(item.tenantId)) lineType = '手工应收';
              const deferOut = (item.deferredAmount ?? 0) > 0.005 && !!item.deferredToPeriod;
              const isSynthetic = isManualArTenantId(item.tenantId) || isSpecialBusinessArTenantId(item.tenantId) || isDeferInDisplayTenantId(item.tenantId);
              const settlementAdj = receivableRowSettlementDelta(item);
              rows.push({
                  账期: receivableMonth,
                  核销分组: title,
                  行类型: lineType,
                  客户名称: item.tenantName,
                  合同应收: isSynthetic ? '' : roundMoney2(item.contractAmountDue ?? 0),
                  结算调整: roundMoney2(settlementAdj),
                  实际核销金额: roundMoney2(receivableBudgetDisplay(item)),
                  已收金额: roundMoney2(paid),
                  待收余额: remaining > 0.005 ? roundMoney2(remaining) : 0,
                  缓出至账期: deferOut ? item.deferredToPeriod : '',
                  缓出金额元: deferOut ? roundMoney2(item.deferredAmount ?? 0) : '',
                  备注: remark,
              });
          }
      };
      appendSection('pending', displayReceivableSections.unsettled);
      appendSection('deferred', displayReceivableSections.deferred);
      appendSection('settled', [...displayReceivableSections.settledThisMonth, ...displayReceivableSections.prepaid]);
      if (rows.length === 0) {
          alert('当前无应收数据可导出（请调整月份或筛选条件）');
          return;
      }
      downloadFinanceXlsx(`应收核销_${receivableMonth}.xlsx`, rows, '应收核销');
  };

  const handleExportPayments = () => {
      const flat: PaymentRecord[] = [];
      for (const mk of sortedMonths) {
          flat.push(...(groupedPayments[mk] ?? []));
      }
      if (flat.length === 0) {
          alert('当前筛选条件下无收款记录可导出');
          return;
      }
      const rows = flat.map((p) => ({
          入账月份: p.date.slice(0, 7),
          流水号: p.id,
          付款方: p.tenantName,
          款项类型: paymentRecordTypeLabel(p.type),
          金额: roundMoney2(p.amount),
          收款日期: p.date,
          关联账期: p.period || '',
          备注: p.remarks ?? '',
      }));
      downloadFinanceXlsx(`收款明细_${selectedYear}年度.xlsx`, rows, '收款明细');
  };

  const listView = mobileReceivableOnly ? 'Receivables' : activeView;

  const showWorkbenchSettlementCard = Math.abs(monthStats.workbenchSettlementDelta) > 0.005;

  return (
    <div className="space-y-4 md:space-y-6">
      
      {/* Revised Financial Overview Cards */}
      <div
          className={`grid grid-cols-2 gap-3 md:gap-4 ${
              showWorkbenchSettlementCard ? 'md:grid-cols-3 xl:grid-cols-5' : 'md:grid-cols-4'
          }`}
      >
              <div className="bg-white p-3 rounded-xl border border-blue-100 shadow-sm flex flex-col justify-between items-center text-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-10"><Wallet size={32} className="text-blue-600"/></div>
                  <div className="text-xs text-slate-500 font-bold mb-1 uppercase tracking-wider whitespace-nowrap">本年累计租金收款</div>
                  <div className="text-lg md:text-xl font-bold text-blue-700 whitespace-nowrap" title={formatCurrency(annualRentCollection)}>{formatCurrency(annualRentCollection)}</div>
                  <div className="text-[10px] text-blue-400 mt-1 whitespace-nowrap">{selectedYear}年度</div>
              </div>
              <div
                  className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center min-w-0"
                  title={
                      `本月系统账单应收 ¥${monthStats.systemReceivable.toLocaleString()}（与「工作台 当月应收总额」一致，未计入手工应收行）` +
                      (monthStats.manualReceivable > 0.005
                          ? `\n财务报表应收合计（含手工行）¥${monthStats.budgetReceivable.toLocaleString()}（手工 ¥${monthStats.manualReceivable.toLocaleString()}）`
                          : '') +
                      (showWorkbenchSettlementCard
                          ? `\n合同滚动（系统账单行）¥${monthStats.systemContractReceivableTotal.toLocaleString()}；结算侧调整见旁卡。`
                          : `\n合同滚动（全量行）¥${monthStats.contractReceivableTotal.toLocaleString()}。`)
                  }
              >
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月应收租金</div>
                  <div className="text-base md:text-lg font-bold text-slate-800 whitespace-nowrap tabular-nums">
                      {formatCurrency(monthStats.systemReceivable)}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5 text-center leading-snug px-0.5">
                      系统账单（与工作台一致）
                      {showWorkbenchSettlementCard && (
                          <span className="block text-slate-400 mt-0.5">
                              合同滚动 + 旁卡「结算侧调整」≈ 本项（系统账单）
                          </span>
                      )}
                  </div>
                  {monthStats.manualReceivable > 0.005 && (
                      <div className="text-[10px] text-amber-600 mt-1 inline-flex items-center gap-1 justify-center flex-wrap">
                          <Info size={10} className="shrink-0" />
                          <span>
                              财务报表另含手工{' '}
                              <span className="font-semibold tabular-nums">{formatCurrency(monthStats.manualReceivable)}</span>
                          </span>
                      </div>
                  )}
              </div>
              {showWorkbenchSettlementCard && (
                  <div
                      className="bg-white p-3 rounded-xl border border-amber-100 shadow-sm flex flex-col justify-between items-center text-center min-w-0"
                      title={
                          `「结算侧调整」= 本月系统账单应收 − 合同滚动（系统行），用于解释差额来源。\n` +
                          '该金额已包含在左侧「本月应收租金」的系统账单内，不是在其基础上再加一笔；勿与「待收」相加。'
                      }
                  >
                      <div className="text-xs text-amber-800/90 font-medium mb-1 flex items-center gap-1 whitespace-nowrap">
                          <Clock size={12} className="shrink-0" />
                          结算侧调整
                      </div>
                      <div
                          className={`text-base md:text-lg font-bold whitespace-nowrap tabular-nums ${
                              monthStats.workbenchSettlementDelta >= 0 ? 'text-amber-700' : 'text-sky-700'
                          }`}
                      >
                          {monthStats.workbenchSettlementDelta > 0.005 ? '+' : ''}
                          {formatCurrency(monthStats.workbenchSettlementDelta)}
                      </div>
                      <div className="text-[10px] text-amber-700/90 mt-0.5 leading-snug px-0.5">
                          相对合同滚动 · 已计入系统账单
                      </div>
                  </div>
              )}
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月实收租金</div>
                  <div className="text-base md:text-lg font-bold text-emerald-600 whitespace-nowrap">{formatCurrency(monthStats.actualReceived)}</div>
                  <div className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">Actual</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月待收租金</div>
                  <div className="text-base md:text-lg font-bold text-amber-600 whitespace-nowrap tabular-nums">
                      {formatCurrency(Math.max(0, monthStats.pendingCollection))}
                  </div>
                  <div className="text-[10px] text-amber-400 font-medium whitespace-nowrap">Pending</div>
                  <div className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] leading-snug">
                      与「实收」加总 = 核销口径应收
                  </div>
              </div>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-600 leading-relaxed">
          <span className="font-semibold text-slate-700">加总核对：</span>
          本月实收{' '}
          <span className="tabular-nums font-medium text-slate-800">{formatCurrency(monthStats.actualReceived)}</span>
          {' + '}
          本月待收{' '}
          <span className="tabular-nums font-medium text-slate-800">{formatCurrency(Math.max(0, monthStats.pendingCollection))}</span>
          {' = '}
          <span className="tabular-nums font-semibold text-slate-900">{formatCurrency(monthStats.budgetReceivable)}</span>
          （核销各行「展示应收」合计，与表格一致
          {monthStats.manualReceivable > 0.005 ? `；含手工应收 ${formatCurrency(monthStats.manualReceivable)}` : '；无手工应收时与左侧系统账单相同'}）。
          <span className="block mt-1 text-slate-500">
              「结算侧调整」仅说明<strong className="text-slate-700">系统账单与合同滚动</strong>的差额，<strong className="text-amber-800">已包含在「本月应收」内</strong>，勿再与待收、实收相加。
          </span>
      </div>

      {/* Main View Toggle & Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-2 gap-4">
        {!mobileReceivableOnly && viewRentPricing && (
        <div className="flex gap-4 w-full md:w-auto overflow-x-auto">
             <button type="button" onClick={() => setActiveView('Receivables')} className={`pb-2 px-2 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'Receivables' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><ListChecks size={18} /> 应收核销</button>
             <button type="button" onClick={() => setActiveView('Payments')} className={`pb-2 px-2 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'Payments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><BadgeCheck size={18} /> 收款明细</button>
             <button type="button" onClick={() => setActiveView('SpecialBusiness')} className={`pb-2 px-2 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'SpecialBusiness' ? 'text-amber-600 border-b-2 border-amber-600' : 'text-slate-500 hover:text-slate-700'}`}><Sparkles size={18} /> 特殊业态收入录入</button>
        </div>
        )}
        {!mobileReceivableOnly && !viewRentPricing && (
        <div className="flex gap-4 w-full md:w-auto overflow-x-auto">
             <button type="button" onClick={() => setActiveView('Receivables')} className="pb-2 px-2 text-sm font-bold flex items-center gap-2 text-blue-600 border-b-2 border-blue-600 whitespace-nowrap"><ListChecks size={18} /> 物业费应收核销</button>
        </div>
        )}

        {!mobileReceivableOnly && activeView === 'Payments' ? (
             <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                 <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg px-2 py-1.5 focus:outline-none flex-1 md:flex-none cursor-pointer">{availableYears.map(y => <option key={y} value={y}>{y}年</option>)}</select>
                 <input type="search" placeholder="关键词" value={paymentKeyword} onChange={(e) => setPaymentKeyword(e.target.value)} className="min-w-[120px] border border-slate-200 rounded-lg px-2 py-1.5 text-sm flex-1 md:flex-none max-w-[200px]" />
                 <select value={paymentTypeFilter} onChange={(e) => setPaymentTypeFilter(e.target.value as any)} className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white">
                     <option value="all">全部类型</option>
                     <option value="Rent">租金</option>
                     <option value="Deposit">押金</option>
                     <option value="DepositToRent">押金转租金</option>
                     <option value="DepositRefund">押金退还</option>
                     <option value="ManagementFee">物业费</option>
                     <option value="Other">其他</option>
                 </select>
                 <button onClick={() => { setShowDepositTransfer(true); setShowForm(false); setIsEditing(false); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-1 flex-1 md:flex-none justify-center whitespace-nowrap"><ArrowRightLeft size={14} /> 转租金</button>
                 <button onClick={() => { const now = new Date().toISOString().split('T')[0]; setShowForm(true); setShowDepositTransfer(false); setIsEditing(false); setCurrentPayment({ date: now, type: 'Rent', period: now.slice(0, 7) }); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-1 shadow-sm flex-1 md:flex-none justify-center whitespace-nowrap"><Plus size={14} /> 记账</button>
                 <button
                     type="button"
                     onClick={handleExportPayments}
                     className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-1 flex-1 md:flex-none justify-center whitespace-nowrap"
                     title="导出当前年度与筛选条件下的收款明细（Excel）"
                 >
                     <Download size={14} /> 导出
                 </button>
             </div>
        ) : !mobileReceivableOnly && activeView === 'SpecialBusiness' ? (
             <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center w-full md:w-auto justify-end">
                 <input
                     type="search"
                     placeholder="搜索特殊业态客户"
                     value={specialBizKeyword}
                     onChange={(e) => setSpecialBizKeyword(e.target.value)}
                     className="min-w-[140px] flex-1 sm:flex-none border border-amber-200 rounded-lg px-3 py-1.5 text-sm bg-white"
                 />
                 <div className="flex flex-wrap gap-2 items-center justify-end">
                     <div
                         className="flex items-center gap-1 bg-white border border-amber-200 rounded-lg p-1 whitespace-nowrap"
                         title="录入账期与「应收核销」一致（自然月 YYYY-MM）"
                     >
                         <button type="button" onClick={handlePrevMonth} className="p-1 hover:bg-amber-50 rounded text-slate-500"><ChevronLeft size={16}/></button>
                         <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 w-24 justify-center whitespace-nowrap"><Calendar size={14} className="text-amber-500"/><span className="text-center whitespace-nowrap leading-none">{receivableMonth}</span></div>
                         <button type="button" onClick={handleNextMonth} className="p-1 hover:bg-amber-50 rounded text-slate-500"><ChevronRight size={16}/></button>
                     </div>
                     <button
                         type="button"
                         onClick={saveAllSpecialBusinessRows}
                         disabled={!onBatchUpdate}
                         className="px-3 py-1.5 text-sm font-medium rounded-lg border border-amber-400 bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap inline-flex items-center gap-1"
                     >
                         <Save size={14} /> 保存本月已填金额
                     </button>
                 </div>
             </div>
        ) : (
             <div className="flex flex-col sm:flex-row flex-wrap gap-2 items-stretch sm:items-center w-full md:w-auto justify-end">
                 {mgmtFeeParkEnabled && viewRentPricing && (
                     <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-semibold shrink-0">
                         <button type="button" onClick={() => { setReceivableFeeTab('rent'); setBatchSelectedIds(new Set()); }} className={`px-3 py-1.5 ${receivableFeeTab === 'rent' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600'}`}>租金应收</button>
                         <button type="button" onClick={() => { setReceivableFeeTab('management_fee'); setBatchSelectedIds(new Set()); }} className={`px-3 py-1.5 ${receivableFeeTab === 'management_fee' ? 'bg-teal-600 text-white' : 'bg-white text-slate-600'}`}>物业费应收</button>
                     </div>
                 )}
                 {mgmtFeeParkEnabled && !viewRentPricing && (
                     <span className="text-xs font-semibold text-teal-700 px-2 py-1 bg-teal-50 border border-teal-100 rounded-lg">物业费应收</span>
                 )}
                 <div className="flex flex-wrap gap-2 items-center">
                     <input
                         type="search"
                         placeholder="关键词（客户）"
                         value={receivableKeyword}
                         onChange={(e) => setReceivableKeyword(e.target.value)}
                         className="min-w-[140px] flex-1 sm:flex-none border border-slate-200 rounded-lg px-3 py-1.5 text-sm"
                     />
                     <select
                         value={receivableBucketFilter}
                         onChange={(e) => setReceivableBucketFilter(e.target.value as typeof receivableBucketFilter)}
                         className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white"
                     >
                         <option value="all">全部核销状态</option>
                         <option value="pending">待核销</option>
                         <option value="deferred">已缓缴</option>
                         <option value="settled">已核销</option>
                     </select>
                 </div>
                 <div className="flex flex-wrap gap-2 items-center justify-end">
                     <button
                         type="button"
                         onClick={() => onResetReceivableApplications?.()}
                         disabled={
                             !onResetReceivableApplications ||
                             (receivableResetImpact.deferNotes === 0 &&
                                 receivableResetImpact.autoWriteOffPayments === 0)
                         }
                         title={
                             onResetReceivableApplications
                                 ? `将清除全部缓缴记录 ${receivableResetImpact.deferNotes} 条，并删除应收核销自动生成的流水 ${receivableResetImpact.autoWriteOffPayments} 笔（收款明细手工记账保留）`
                                 : undefined
                         }
                         className="px-3 py-1.5 text-sm font-medium rounded-lg border border-rose-200 bg-white text-rose-700 hover:bg-rose-50 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap inline-flex items-center gap-1"
                     >
                         <Undo2 size={14} /> 撤回核销与缓缴
                     </button>
                     <button
                         type="button"
                         onClick={openBatchPartialModal}
                         disabled={batchSelectedIds.size === 0}
                         className="px-3 py-1.5 text-sm font-medium rounded-lg border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 disabled:opacity-40 disabled:pointer-events-none whitespace-nowrap"
                     >
                         批量核销 ({batchSelectedIds.size})
                     </button>
                     <button
                         type="button"
                         onClick={handleExportReceivables}
                         className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap inline-flex items-center gap-1"
                         title="导出当前账期与筛选条件下的应收核销列表（Excel）"
                     >
                         <Download size={14} /> 导出
                     </button>
                     <div
                         className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 whitespace-nowrap"
                         title="当月应收按合同生成账单的「收款日期」所在自然月汇总；与合同中「覆盖周期」跨多个月时，同一笔金额只记在收款月（季付等常见）。对照覆盖周期请以合同中心预览为准。"
                     >
                         <button type="button" onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronLeft size={16}/></button>
                         <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 w-24 justify-center whitespace-nowrap"><Calendar size={14} className="text-slate-400"/><span className="text-center whitespace-nowrap leading-none">{receivableMonth}</span></div>
                         <button type="button" onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronRight size={16}/></button>
                     </div>
                 </div>
             </div>
        )}
      </div>

      {/* Forms Overlay */}
      {showForm && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl mb-6 flex flex-col items-start gap-4 animate-in fade-in slide-in-from-top-2">
           <div className="w-full grid grid-cols-1 md:grid-cols-5 gap-4">
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">付款客户</label>
                    <SearchableTenantSelect
                        tenants={tenants}
                        buildings={buildings}
                        value={currentPayment.tenantId || ''}
                        onChange={(tenantId) => setCurrentPayment({ ...currentPayment, tenantId })}
                        theme="emerald"
                    /></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">款项类型</label><select className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.type} onChange={e => setCurrentPayment({...currentPayment, type: e.target.value as any})}><option value="Rent">租金收入</option><option value="Deposit">押金收取</option><option value="DepositRefund">押金退还 (支出)</option><option value="ManagementFee">物业费</option><option value="Other">其他</option><option value="DepositToRent">押金转租金</option></select></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">金额 (元)</label><input type="number" className="w-full p-2 rounded border border-emerald-200 text-sm" placeholder="0.00" value={currentPayment.amount || ''} onChange={e => setCurrentPayment({...currentPayment, amount: Number(e.target.value)})}/></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">入账日期</label><input type="date" className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.date} onChange={e => setCurrentPayment({...currentPayment, date: e.target.value})}/></div>
                <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">关联账期（多选）</label>
                    <div className="border border-emerald-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center justify-between mb-2">
                    {specialBusinessCandidatesUnmarked.length > 0 && (
                        <div className="bg-amber-50/70 border-b border-amber-200 px-3 py-2.5 text-xs text-amber-900">
                            <div className="flex flex-wrap items-center gap-2">
                                <Sparkles size={14} className="text-amber-600 shrink-0" />
                                <span className="font-bold">疑似公区/配套类客户未标注特殊业态：</span>
                                {specialBusinessCandidatesUnmarked.slice(0, 12).map((t) => (
                                    <button
                                        key={t.id}
                                        type="button"
                                        onClick={() => {
                                            if (confirm(`将「${t.name}」标记为特殊业态？\n标注后将不再按合同自动产生应收，\n金额需在「特殊业态收入录入」按月手工录入。`)) {
                                                toggleTenantSpecialBusiness(t.id, true);
                                            }
                                        }}
                                        className="px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-800 hover:bg-amber-100 inline-flex items-center gap-1 whitespace-nowrap"
                                        title="点击一键标为特殊业态"
                                    >
                                        {t.name} <Sparkles size={10} />
                                    </button>
                                ))}
                                {specialBusinessCandidatesUnmarked.length > 12 && (
                                    <span className="text-amber-700/80">…等共 {specialBusinessCandidatesUnmarked.length} 个</span>
                                )}
                                <span className="ml-auto text-[10px] text-amber-700/70 whitespace-nowrap">
                                    名称含「停车/公区/配套/广告/充电桩/物业」等关键字时自动识别。如不需要此提示请直接忽略。
                                </span>
                            </div>
                        </div>
                    )}
                            <div className="text-xs text-slate-600 font-medium">已选：{selectedPeriods.length > 0 ? selectedPeriods.join('、') : '未选择（默认按入账月份）'}</div>
                            <div className="flex items-center gap-1">
                                <button type="button" className="px-2 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50" onClick={() => setPeriodPickerYear((y) => y - 1)}>‹</button>
                                <span className="text-xs font-semibold text-slate-700 min-w-[52px] text-center">{periodPickerYear}年</span>
                                <button type="button" className="px-2 py-0.5 text-xs border border-slate-200 rounded hover:bg-slate-50" onClick={() => setPeriodPickerYear((y) => y + 1)}>›</button>
                            </div>
                        </div>
                        <div className="grid grid-cols-4 gap-1">
                            {Array.from({ length: 12 }, (_, idx) => {
                                const mm = String(idx + 1).padStart(2, '0');
                                const key = `${periodPickerYear}-${mm}`;
                                const checked = selectedPeriodSet.has(key);
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        onClick={() => toggleBillingPeriod(key)}
                                        className={`text-xs px-2 py-1 rounded border whitespace-nowrap ${checked ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                    >
                                        {mm}月
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-1">可跨年选择，多个月份收款将按所选账期均分核销</div>
                </div>
           </div>
           <div className="flex gap-2 w-full md:w-auto"><button onClick={handleSavePayment} className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 text-white rounded hover:bg-emerald-700 flex items-center justify-center gap-1"><Check size={18}/> 确认</button><button onClick={() => { setShowForm(false); setIsEditing(false); }} className="flex-1 md:flex-none px-4 py-2 bg-white text-slate-500 border border-emerald-200 rounded hover:bg-slate-50 flex items-center justify-center gap-1"><X size={18}/> 取消</button></div>
        </div>
      )}

      {showDepositTransfer && (
        <div className="bg-indigo-50 border border-indigo-100 p-4 rounded-xl mb-6 flex flex-col items-start gap-4 animate-in fade-in slide-in-from-top-2">
           <div className="w-full grid grid-cols-1 md:grid-cols-3 gap-4">
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">选择客户</label>
                    <SearchableTenantSelect
                        tenants={tenants}
                        buildings={buildings}
                        value={transferData.tenantId}
                        onChange={(tenantId) => setTransferData({ ...transferData, tenantId })}
                        theme="indigo"
                        filterTenant={(t) => t.depositStatus !== 'Refunded'}
                        getOptionSuffix={(t) => `押金 ${formatCurrency(t.depositAmount)}`}
                    /></div>
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">抵扣金额</label><input type="number" className="w-full p-2 rounded border border-indigo-200 text-sm" placeholder="0.00" onChange={e => setTransferData({...transferData, amount: Number(e.target.value)})}/></div>
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">日期</label><input type="date" className="w-full p-2 rounded border border-indigo-200 text-sm" value={transferData.date} onChange={e => setTransferData({...transferData, date: e.target.value})}/></div>
           </div>
           <div className="flex gap-2 w-full md:w-auto"><button onClick={handleDepositTransfer} className="flex-1 md:flex-none px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center justify-center gap-1"><Check size={18}/> 确认</button><button onClick={() => setShowDepositTransfer(false)} className="flex-1 md:flex-none px-4 py-2 bg-white text-slate-500 border border-indigo-200 rounded hover:bg-slate-50 flex items-center justify-center gap-1"><X size={18}/> 取消</button></div>
        </div>
      )}

      {/* Main Lists */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {listView === 'Payments' ? (
            <>
                <div className="hidden md:block">
                    <div ref={desktopViewportRef} className="w-full overflow-hidden">
                        <div style={{ height: desktopScaledHeight ? `${desktopScaledHeight}px` : 'auto' }}>
                            <div
                                ref={desktopContentRef}
                                style={{
                                    transform: desktopScale < 0.999 ? `scale(${desktopScale})` : 'none',
                                    transformOrigin: 'top left',
                                }}
                            >
                    <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4">流水号</th>
                            <th className="px-6 py-4">付款方</th>
                            <th className="px-6 py-4">款项类型</th>
                            <th className="px-6 py-4">金额</th>
                            <th className="px-6 py-4">收款日期</th>
                            <th className="px-6 py-4">关联账期</th>
                            <th className="px-6 py-4 text-right">操作</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {sortedMonths.length > 0 ? (
                            sortedMonths.map(monthKey => {
                                const monthPayments = groupedPayments[monthKey];
                                const monthTotal = monthPayments.reduce((sum, p) => sum + p.amount, 0);
                                return (
                                    <React.Fragment key={monthKey}>
                                        <tr className="bg-slate-50/80 border-y border-slate-100"><td colSpan={7} className="px-6 py-2"><div className="flex items-center justify-between"><div className="font-bold text-slate-700 flex items-center gap-2 text-xs"><Calendar size={14} />{monthKey} ({monthPayments.length}笔)</div><div className="font-bold text-slate-700 text-xs">月度合计: <span className={monthTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{formatCurrency(monthTotal)}</span></div></div></td></tr>
                                        {monthPayments.map(p => (
                                            <tr key={p.id} className="hover:bg-slate-50 group">
                                                <td className="px-6 py-4 font-mono text-xs text-slate-400">#{p.id.split('_')[0]}</td>
                                                <td className="px-6 py-4 font-medium text-slate-800">{p.tenantName}</td>
                                                <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs ${p.type === 'DepositToRent' ? 'bg-indigo-100 text-indigo-700' : p.type === 'DepositRefund' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{p.type === 'Rent' ? '租金' : p.type === 'Deposit' ? '押金收取' : p.type === 'DepositRefund' ? '押金退还' : p.type === 'DepositToRent' ? '押金转租金' : '其他'}</span></td>
                                                <td className={`px-6 py-4 font-medium ${p.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{p.amount > 0 ? '+' : ''}{formatCurrency(p.amount)}</td>
                                                <td className="px-6 py-4 text-slate-600">{p.date}</td>
                                                <td className="px-6 py-4 text-slate-600">{p.period || '-'}</td>
                                                <td className="px-6 py-4 text-right"><div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => handleEditPayment(p)} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title="修改"><Edit2 size={14} /></button><button onClick={() => handleDeletePayment(p.id)} className="p-1 text-red-600 hover:bg-red-50 rounded" title="删除"><Trash2 size={14} /></button></div></td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })
                        ) : (<tr><td colSpan={7} className="p-8 text-center text-slate-400">该年度无收款记录</td></tr>)}
                    </tbody>
                    </table>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Mobile List View */}
                <div className="md:hidden">
                    {sortedMonths.length > 0 ? (
                        sortedMonths.map(monthKey => {
                            const monthPayments = groupedPayments[monthKey];
                            return (
                                <div key={monthKey}>
                                    <div className="bg-slate-50 px-4 py-2 border-y border-slate-100 font-bold text-xs text-slate-600">{monthKey}</div>
                                    {monthPayments.map(p => (
                                        <PaymentCard 
                                            key={p.id} 
                                            p={p} 
                                            onEdit={() => handleEditPayment(p)} 
                                            onDelete={() => handleDeletePayment(p.id)} 
                                        />
                                    ))}
                                </div>
                            );
                        })
                    ) : (<div className="p-8 text-center text-slate-400 text-sm">暂无记录</div>)}
                </div>
            </>
        ) : listView === 'SpecialBusiness' ? (
            <>
                <div className="border-b border-amber-100 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 flex flex-wrap items-center gap-2">
                    <Sparkles size={16} className="text-amber-600 shrink-0" />
                    <span>
                        以下为履约中的「特殊业态」客户。录入金额写入当前账期{' '}
                        <span className="font-mono font-semibold">{receivableMonth}</span>，并参与「应收核销」汇总。本月已保存合计：
                        <strong className="font-mono ml-1">{formatCurrency(specialBusinessMonthTotal)}</strong>
                    </span>
                </div>
                {filteredSpecialBusinessTenants.length === 0 ? (
                    <div className="p-12 text-center text-slate-500 text-sm space-y-2">
                        <p>
                            {specialBusinessTenants.length === 0
                                ? '暂无特殊业态客户。请在「应收核销」列表中点击「标为特殊业态」，或在合同档案中勾选对应标注后再录入。'
                                : '没有匹配搜索条件的客户。'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="hidden md:block overflow-x-auto">
                            <table className="w-full text-sm text-left">
                                <thead className="bg-amber-50/90 text-amber-950 font-medium border-b border-amber-100">
                                    <tr>
                                        <th className="px-4 py-3">客户</th>
                                        <th className="px-4 py-3 hidden lg:table-cell text-slate-600 font-normal">房源概要</th>
                                        <th className="px-4 py-3 text-center whitespace-nowrap w-36">本月应收（元）</th>
                                        <th className="px-4 py-3 min-w-[160px]">备注</th>
                                        <th className="px-4 py-3 text-right whitespace-nowrap w-28">操作</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {filteredSpecialBusinessTenants.map((t) => {
                                        const { buildingLabel, unitNamesLabel } = resolveTenantAssetLabels(t, buildings);
                                        const assetHint = [buildingLabel, unitNamesLabel].filter(Boolean).join(' · ') || '—';
                                        return (
                                            <tr key={t.id} className="hover:bg-amber-50/30">
                                                <td className="px-4 py-3 font-medium text-slate-800">{t.name}</td>
                                                <td className="px-4 py-3 hidden lg:table-cell text-xs text-slate-500">{assetHint}</td>
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-sm text-right"
                                                        placeholder="0"
                                                        value={specialBizAmountDraft[t.id] ?? ''}
                                                        onChange={(e) =>
                                                            setSpecialBizAmountDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                                                        }
                                                    />
                                                </td>
                                                <td className="px-4 py-3">
                                                    <input
                                                        type="text"
                                                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                                                        placeholder="选填"
                                                        value={specialBizRemarkDraft[t.id] ?? ''}
                                                        onChange={(e) =>
                                                            setSpecialBizRemarkDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                                                        }
                                                    />
                                                </td>
                                                <td className="px-4 py-3 text-right">
                                                    <button
                                                        type="button"
                                                        onClick={() => saveSpecialBusinessRow(t.id)}
                                                        disabled={!onBatchUpdate}
                                                        className="px-2.5 py-1 rounded-lg border border-amber-300 bg-white text-amber-900 text-xs font-medium hover:bg-amber-50 disabled:opacity-40"
                                                    >
                                                        保存
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        <div className="md:hidden divide-y divide-slate-100">
                            {filteredSpecialBusinessTenants.map((t) => {
                                const { buildingLabel, unitNamesLabel } = resolveTenantAssetLabels(t, buildings);
                                const assetHint = [buildingLabel, unitNamesLabel].filter(Boolean).join(' · ') || '—';
                                return (
                                    <div key={t.id} className="p-4 space-y-3 bg-white">
                                        <div className="font-semibold text-slate-800">{t.name}</div>
                                        <div className="text-[11px] text-slate-500">{assetHint}</div>
                                        <div>
                                            <label className="text-[11px] text-slate-500 font-medium">本月应收（元）</label>
                                            <input
                                                type="number"
                                                step="0.01"
                                                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 font-mono text-sm"
                                                value={specialBizAmountDraft[t.id] ?? ''}
                                                onChange={(e) =>
                                                    setSpecialBizAmountDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[11px] text-slate-500 font-medium">备注</label>
                                            <input
                                                type="text"
                                                className="mt-0.5 w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm"
                                                value={specialBizRemarkDraft[t.id] ?? ''}
                                                onChange={(e) =>
                                                    setSpecialBizRemarkDraft((prev) => ({ ...prev, [t.id]: e.target.value }))
                                                }
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => saveSpecialBusinessRow(t.id)}
                                            disabled={!onBatchUpdate}
                                            className="w-full py-2 rounded-lg border border-amber-400 bg-amber-500 text-white text-sm font-medium hover:bg-amber-600 disabled:opacity-40"
                                        >
                                            保存本行
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </>
        ) : (
            <>
                <div className="hidden md:block">
                    <div ref={desktopViewportRef} className="w-full overflow-hidden">
                        <div style={{ height: desktopScaledHeight ? `${desktopScaledHeight}px` : 'auto' }}>
                            <div
                                ref={desktopContentRef}
                                style={{
                                    transform: desktopScale < 0.999 ? `scale(${desktopScale})` : 'none',
                                    transformOrigin: 'top left',
                                }}
                            >
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex flex-wrap items-center gap-2 text-sm text-blue-700">
                        <AlertCircle size={16} className="shrink-0" />
                        <span>
                            三列金额口径 ·「合同应收」= 应收款专用方案合同滚动。「结算调整」= 实际核销 − 合同滚动（与顶部「结算侧调整」卡片一致，整列琥珀底提示）。「实际核销金额」= 合同 + 结算调整（核销/收款依据）。两值不同说明有挪账。
                        </span>
                    </div>
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-2 py-3 w-10 text-center">选</th>
                                <th className="px-4 py-3">客户名称</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap" title="按合同条款滚动推算的本月应收（与工作台/预算口径一致）">合同应收</th>
                                <th
                                    className="px-3 py-3 text-center whitespace-nowrap bg-amber-50 text-amber-950 border-l-2 border-amber-400 font-semibold"
                                    title="本列不可单独删除。差额来自缓缴/导入预算/特殊业态等；悬停数据格查看清理路径。"
                                >
                                    结算调整
                                </th>
                                <th className="px-4 py-3 text-center whitespace-nowrap" title="含缓缴 / 导入预算 / 特殊业态 / 手工应收行 等结算侧调整">实际核销金额</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">已收金额</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">待收余额</th>
                                <th className="px-4 py-3 min-w-[200px]">备注</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {receivableFiltered.length > 0 ? (
                                <>
                                    {displayReceivableSections.unsettled.length > 0 && (
                                        <>
                                            <tr className="bg-amber-50/60">
                                                <td colSpan={9} className="px-4 py-2 text-xs font-bold text-amber-900/90 border-t border-amber-100/80">
                                                    {WRITEOFF_LABELS.pending}
                                                </td>
                                            </tr>
                                            {displayReceivableSections.unsettled.map(({ item }) => renderReceivableTableRow(item))}
                                        </>
                                    )}
                                    {displayReceivableSections.deferred.length > 0 && (
                                        <>
                                            <tr className="bg-indigo-50/60">
                                                <td colSpan={9} className="px-4 py-2 text-xs font-bold text-indigo-900/90 border-t border-indigo-100/80">
                                                    {WRITEOFF_LABELS.deferred}（原账期挂账已调至其他月份）
                                                </td>
                                            </tr>
                                            {displayReceivableSections.deferred.map(({ item }) => renderReceivableTableRow(item))}
                                        </>
                                    )}
                                    {(displayReceivableSections.settledThisMonth.length + displayReceivableSections.prepaid.length) > 0 && (
                                        <>
                                            <tr className="bg-emerald-50/50">
                                                <td colSpan={9} className="px-4 py-2 text-xs font-bold text-emerald-900/90 border-t border-emerald-100/80">
                                                    {WRITEOFF_LABELS.settled}
                                                </td>
                                            </tr>
                                            {displayReceivableSections.settledThisMonth.map(({ item }) => renderReceivableTableRow(item))}
                                            {displayReceivableSections.prepaid.map(({ item }) => renderReceivableTableRow(item))}
                                        </>
                                    )}
                                </>
                            ) : (
                                <tr><td colSpan={9} className="p-8 text-center text-slate-400">该月份暂无应收账单</td></tr>
                            )}
                        </tbody>
                        {receivableFiltered.length > 0 && (
                            <tfoot className="border-t-2 border-slate-300">
                                <tr className="bg-sky-50/90 text-sm">
                                    <td colSpan={2} className="px-4 py-2.5 text-right text-xs font-bold text-slate-800">
                                        系统账单小计（与「本月应收」·工作台）
                                    </td>
                                    <td className="px-4 py-2.5 text-center font-semibold tabular-nums text-slate-700 whitespace-nowrap">
                                        {formatCurrency(monthStats.systemContractReceivableTotal)}
                                    </td>
                                    <td className="border-l-2 border-amber-400 bg-amber-100/85 px-3 py-2.5 text-center text-xs font-bold tabular-nums text-amber-950 whitespace-nowrap">
                                        {monthStats.workbenchSettlementDelta > 0.005 ? '+' : ''}
                                        {formatCurrency(monthStats.workbenchSettlementDelta)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-sm font-bold tabular-nums text-slate-900 whitespace-nowrap">
                                        {formatCurrency(monthStats.systemReceivable)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-600 whitespace-nowrap">
                                        {formatCurrency(receivableSystemFootSums.paid)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-600 whitespace-nowrap">
                                        {formatCurrency(receivableSystemFootSums.pending)}
                                    </td>
                                    <td colSpan={2} className="px-2 py-2.5 text-[10px] leading-snug text-slate-500">
                                        不含手工应收行；「结算调整」小计与顶部卡片一致
                                    </td>
                                </tr>
                                {monthStats.manualReceivable > 0.005 && (
                                    <tr className="bg-amber-50/60 text-sm border-t border-amber-200">
                                        <td colSpan={2} className="px-4 py-2.5 text-right text-xs font-bold text-amber-950">
                                            手工应收等小计
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-slate-400 whitespace-nowrap">—</td>
                                        <td className="border-l-2 border-amber-300 bg-amber-50/90 px-3 py-2.5 text-center text-xs font-semibold tabular-nums text-amber-950 whitespace-nowrap">
                                            {formatCurrency(receivableManualFootSums.bill)}
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-sm font-semibold tabular-nums text-amber-950 whitespace-nowrap">
                                            {formatCurrency(receivableManualFootSums.bill)}
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-600 whitespace-nowrap">
                                            {formatCurrency(receivableManualFootSums.paid)}
                                        </td>
                                        <td className="px-4 py-2.5 text-center text-xs tabular-nums text-slate-600 whitespace-nowrap">
                                            {formatCurrency(receivableManualFootSums.pending)}
                                        </td>
                                        <td colSpan={2} className="px-2 py-2.5 text-[10px] text-amber-900/80">
                                            合同列无合同滚动口径
                                        </td>
                                    </tr>
                                )}
                                <tr className="bg-slate-200/95 text-sm font-bold text-slate-900 border-t border-slate-400">
                                    <td colSpan={2} className="px-4 py-2.5 text-right text-xs">全表合计</td>
                                    <td className="px-4 py-2.5 text-center tabular-nums whitespace-nowrap">
                                        {formatCurrency(monthStats.contractReceivableTotal)}
                                    </td>
                                    <td className="border-l-2 border-amber-400 bg-amber-100/70 px-3 py-2.5 text-center text-xs tabular-nums text-amber-950 whitespace-nowrap">
                                        {totalSettlementDeltaFoot > 0.005 ? '+' : ''}
                                        {formatCurrency(totalSettlementDeltaFoot)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center tabular-nums whitespace-nowrap">
                                        {formatCurrency(monthStats.budgetReceivable)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center tabular-nums text-emerald-800 whitespace-nowrap">
                                        {formatCurrency(monthStats.actualReceived)}
                                    </td>
                                    <td className="px-4 py-2.5 text-center tabular-nums text-amber-800 whitespace-nowrap">
                                        {formatCurrency(Math.max(0, monthStats.pendingCollection))}
                                    </td>
                                    <td colSpan={2} className="px-2 py-2.5 text-[10px] font-normal text-slate-600 leading-snug">
                                        实收+待收=核销合计；与顶部卡片核对
                                    </td>
                                </tr>
                            </tfoot>
                        )}
                    </table>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Mobile Receivable View */}
                <div className="md:hidden">
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700 mb-2"><AlertCircle size={14} /> 数据来源: 应收款专用方案（含账期/金额调整）</div>
                    {receivableFiltered.length > 0 ? (
                        <>
                            {displayReceivableSections.unsettled.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-amber-50/60 text-amber-900 border-b border-amber-100">{WRITEOFF_LABELS.pending}</div>
                                    {displayReceivableSections.unsettled.map(({ item }) => {
                                        const remaining = getRemainingReceivable(item);
                                        const isPaid = isReceivableSettled(item);
                                        const paidAmount = getEffectivePaidAmount(item);
                                        const remarkTid = realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? item.tenantId;
                                        return (
                                            <ReceivableCard
                                                key={item.tenantId}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                paidAmount={paidAmount}
                                                remark={getRentCollectionRemark(billingPeriodNotes, remarkTid, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(remarkTid, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => openCollectModal(item)}
                                                onDefer={
                                                    isManualArTenantId(item.tenantId) || isDeferInDisplayTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openDeferModal(item)
                                                }
                                                onRevokeDefer={deferRevokeClickForItem(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                collectBlockedHint={receivableDeferCollectHint(item)}
                                                onOpenContractSummary={
                                                    isManualArTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openReceivableContractSummary(item)
                                                }
                                            />
                                        );
                                    })}
                                </>
                            )}
                            {displayReceivableSections.deferred.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-indigo-50/70 text-indigo-900 border-b border-indigo-100">{WRITEOFF_LABELS.deferred}（原账期已调至他月）</div>
                                    {displayReceivableSections.deferred.map(({ item }) => {
                                        const remaining = getRemainingReceivable(item);
                                        const isPaid = isReceivableSettled(item);
                                        const paidAmount = getEffectivePaidAmount(item);
                                        const remarkTid = realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? item.tenantId;
                                        return (
                                            <ReceivableCard
                                                key={`${item.tenantId}-def`}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                paidAmount={paidAmount}
                                                remark={getRentCollectionRemark(billingPeriodNotes, remarkTid, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(remarkTid, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => openCollectModal(item)}
                                                onDefer={
                                                    isManualArTenantId(item.tenantId) || isDeferInDisplayTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openDeferModal(item)
                                                }
                                                onRevokeDefer={deferRevokeClickForItem(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                collectBlockedHint={receivableDeferCollectHint(item)}
                                                onOpenContractSummary={
                                                    isManualArTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openReceivableContractSummary(item)
                                                }
                                            />
                                        );
                                    })}
                                </>
                            )}
                            {(displayReceivableSections.settledThisMonth.length + displayReceivableSections.prepaid.length) > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-emerald-50/50 text-emerald-900 border-b border-emerald-100">{WRITEOFF_LABELS.settled}</div>
                                    {[...displayReceivableSections.settledThisMonth, ...displayReceivableSections.prepaid].map(({ item }) => {
                                        const remaining = getRemainingReceivable(item);
                                        const isPaid = isReceivableSettled(item);
                                        const paidAmount = getEffectivePaidAmount(item);
                                        const remarkTid = realTenantIdFromDeferInDisplayTenantId(item.tenantId) ?? item.tenantId;
                                        return (
                                            <ReceivableCard
                                                key={item.tenantId}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                paidAmount={paidAmount}
                                                remark={getRentCollectionRemark(billingPeriodNotes, remarkTid, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(remarkTid, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => openCollectModal(item)}
                                                onDefer={
                                                    isManualArTenantId(item.tenantId) || isDeferInDisplayTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openDeferModal(item)
                                                }
                                                onRevokeDefer={deferRevokeClickForItem(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                collectBlockedHint={receivableDeferCollectHint(item)}
                                                onOpenContractSummary={
                                                    isManualArTenantId(item.tenantId)
                                                        ? undefined
                                                        : () => openReceivableContractSummary(item)
                                                }
                                            />
                                        );
                                    })}
                                </>
                            )}
                        </>
                    ) : (<div className="p-8 text-center text-slate-400 text-sm">暂无应收账单</div>)}
                </div>
            </>
        )}
      </div>

      {collectModalDetail && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-50 duration-200">
                  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Receipt size={20} className="text-blue-600" /> 收款核销</h3>
                      <button type="button" onClick={() => setCollectModalDetail(null)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"><X size={22} /></button>
                  </div>
                  <div className="p-5 space-y-3 text-sm text-slate-700">
                      <p><span className="text-slate-500">客户</span> <span className="font-semibold text-slate-900">{collectModalDetail.tenantName}</span></p>
                      <p>
                          <span className="text-slate-500">查看账期</span>{' '}
                          <span className="font-mono font-semibold">{receivableMonth}</span>
                      </p>
                      <p>
                          <span className="text-slate-500">核销记入账期</span>{' '}
                          <span className="font-mono font-semibold text-blue-800">
                              {resolveRentWriteOffPaymentPeriod(
                                  collectModalDetail,
                                  receivableMonth,
                                  (() => {
                                      const raw = String(collectModalAmount).replace(/,/g, '').trim();
                                      const n = roundMoney2(Number(raw));
                                      const rem = getRemainingReceivable(collectModalDetail);
                                      return Number.isFinite(n) && n > 0 ? n : rem;
                                  })(),
                              ).period}
                          </span>
                      </p>
                      <p>
                          <span className="text-slate-500">待收余额</span>{' '}
                          <span className="font-mono font-bold text-amber-700">{formatCurrency(getRemainingReceivable(collectModalDetail))}</span>
                      </p>
                      <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                          可分次核销；最后一笔若与待收相差 ≤ {RECEIVABLE_TAIL_TOLERANCE} 元，自动视为结清（备注会标注自动核销尾差）。
                      </p>
                      <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">本次实收金额（可分次核销）</label>
                          <input
                              type="number"
                              step="0.01"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono"
                              value={collectModalAmount}
                              onChange={(e) => setCollectModalAmount(e.target.value)}
                          />
                      </div>
                  </div>
                  <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                      <button type="button" onClick={() => setCollectModalDetail(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-sm">取消</button>
                      <button type="button" onClick={submitCollectModal} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium">确认收款</button>
                  </div>
              </div>
          </div>
      )}

      {batchPartialOpen && (
          <div className="fixed inset-0 z-[75] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] overflow-hidden flex flex-col animate-in zoom-in-50 duration-200">
                  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80 shrink-0">
                      <h3 className="text-lg font-bold text-slate-800">批量核销</h3>
                      <button type="button" onClick={() => setBatchPartialOpen(false)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"><X size={22} /></button>
                  </div>
                  <div className="p-5 overflow-y-auto flex-1 space-y-3 text-sm">
                      <p className="text-slate-500 text-xs">账期 <span className="font-mono font-semibold text-slate-800">{receivableMonth}</span>，请确认每笔实收金额（默认可改）。可分次核销；最后一笔尾差 ≤ {RECEIVABLE_TAIL_TOLERANCE} 元视为结清。</p>
                      {Array.from(batchSelectedIds).map((tid) => {
                          const row = receivableFiltered.find((r) => receivableRowKey(r) === tid);
                          if (!row) return null;
                          const maxAmt = getRemainingReceivable(row);
                          return (
                              <div key={tid} className="border border-slate-100 rounded-lg p-3 space-y-2">
                                  <div className="font-medium text-slate-800">{row.tenantName}</div>
                                  <div className="flex justify-between text-xs text-slate-500">
                                      <span>待收 {formatCurrency(maxAmt)}</span>
                                  </div>
                                  <input
                                      type="number"
                                      step="0.01"
                                      className="w-full border rounded px-2 py-1.5 font-mono text-sm"
                                      value={batchAmountInputs[tid] ?? String(maxAmt)}
                                      onChange={(e) => setBatchAmountInputs((prev) => ({ ...prev, [tid]: e.target.value }))}
                                  />
                              </div>
                          );
                      })}
                  </div>
                  <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50 shrink-0">
                      <button type="button" onClick={() => setBatchPartialOpen(false)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm">取消</button>
                      <button type="button" onClick={handleBatchConfirmCollection} disabled={!canCollectCurrentFeeTab} className="px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed">确认批量核销</button>
                  </div>
              </div>
          </div>
      )}

      <ContractSummaryModal
          open={contractSummaryContent !== null}
          onClose={() => setContractSummaryContent(null)}
          detailYear={receivableYear}
          subtitle={`当前核销账期 ${receivableMonth} · 推算账单与列表应收使用相同租户条款及预算调整（含应收专用方案快照合并）`}
          billsSectionSuffix="与应收核销列表口径一致"
          budgetAssumptions={budgetAssumptions}
          budgetAdjustments={budgetAdjustments}
          content={contractSummaryContent ?? { kind: 'missing' }}
          highlightReceivableYYYYMM={receivableMonth}
      />

      {deferModalTenant && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
              <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-50 duration-200">
                  <div className="px-5 py-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/80">
                      <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Clock size={20} className="text-amber-600" /> 申请缓缴</h3>
                      <button type="button" onClick={() => setDeferModalTenant(null)} className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-500"><X size={22} /></button>
                  </div>
                  <div className="p-5 space-y-4 text-sm text-slate-700">
                      <p><span className="text-slate-500">客户</span> <span className="font-semibold text-slate-900">{deferModalTenant.tenantName}</span></p>
                      <p><span className="text-slate-500">原账期</span> <span className="font-mono font-semibold">{receivableMonth}</span></p>
                      <p>
                          <span className="text-slate-500">待缓缴金额</span>{' '}
                          <span className="font-mono font-bold text-amber-700">
                              {formatCurrency(Math.max(0, deferModalTenant.amountDue - deferModalTenant.amountPaid))}
                          </span>
                      </p>
                      <div>
                          <label className="block text-xs font-medium text-slate-600 mb-1">目标账期（可提前或延后）</label>
                          <input
                              type="month"
                              className="w-full border border-slate-200 rounded-lg px-3 py-2 font-mono"
                              value={deferTargetMonth}
                              onChange={(e) => setDeferTargetMonth(e.target.value)}
                          />
                          <p className="text-[11px] text-slate-400 mt-1.5">将上述待收金额从原账期移至所选月份，在「原账期」与「目标账期」列表中都会醒目标注。</p>
                      </div>
                  </div>
                  <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2 bg-slate-50/50">
                      <button type="button" onClick={() => setDeferModalTenant(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-white text-sm">取消</button>
                      <button type="button" onClick={confirmDeferFromModal} className="px-4 py-2 rounded-lg bg-amber-600 text-white hover:bg-amber-700 text-sm font-medium">确认缓缴</button>
                  </div>
              </div>
          </div>
      )}
    </div>
  );
};
