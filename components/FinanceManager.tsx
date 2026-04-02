
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { PaymentRecord, Tenant, ContractStatus, DepositStatus, BillingDetail, InvoiceRecord } from '../types';
import { BadgeCheck, Plus, ArrowRightLeft, Check, X, AlertCircle, Banknote, Wallet, TrendingUp, ArrowDownRight, CreditCard, Trash2, Edit2, Download, Upload, FileSpreadsheet, Calendar, CheckSquare, Square, ListChecks, Clock, Receipt, RefreshCcw, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, CheckCircle } from 'lucide-react';
import { buildReceivableSections, getRentCollectionRemark, deferReceivableShellClass, receivableBudgetDisplay } from '../services/receivableListHelpers';

/** 核销展示：待核销 → 已缓缴（原账期调出）→ 已核销和收款 */
const WRITEOFF_LABELS = {
  pending: '待核销',
  settled: '已核销和收款',
  deferred: '已缓缴',
} as const;

function writeOffBadgeClass(label: string) {
  if (label === WRITEOFF_LABELS.pending) return 'bg-amber-100 text-amber-800';
  if (label === WRITEOFF_LABELS.settled) return 'bg-emerald-100 text-emerald-800';
  if (label === WRITEOFF_LABELS.deferred) return 'bg-indigo-100 text-indigo-900';
  return 'bg-slate-100 text-slate-600';
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

interface FinanceManagerProps {
  payments: PaymentRecord[];
  tenants: Tenant[];
  invoices: InvoiceRecord[];
  billingPeriodNotes?: Record<string, string>;
  onUpdatePayments: (payments: PaymentRecord[]) => void;
  onUpdateTenants: (tenants: Tenant[]) => void;
  onUpdateInvoices: (invoices: InvoiceRecord[]) => void;
  onBatchUpdate?: (updates: { tenants?: Tenant[], payments?: PaymentRecord[] }) => void;
  getBillingDetails: (year: number, month: number) => BillingDetail[];
  onDeferPayment: (tenantId: string, fromYear: number, fromMonth: number, toYear: number, toMonth: number) => void;
  onUpdateRentRemark?: (tenantId: string, periodYYYYMM: string, remark: string) => void;
}

// Mobile Payment Card
const PaymentCard: React.FC<{ p: PaymentRecord, onEdit: () => void, onDelete: () => void }> = ({ p, onEdit, onDelete }) => (
    <div className="bg-white p-4 border-b border-slate-100 last:border-0 relative">
        <div className="flex justify-between items-start mb-2 pr-6">
            <div className="font-medium text-slate-800">{p.tenantName}</div>
            <div className={`font-bold ${p.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>
                 {p.amount > 0 ? '+' : ''}¥{p.amount.toLocaleString()}
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
    writeOffLabel: string,
    invoiceStatus: 'Pending' | 'Invoiced',
    remark: string,
    onRemarkChange: (text: string) => void,
    remarkDisabled?: boolean,
    onConfirm: () => void, 
    onDefer: () => void,
    onRevoke: () => void,
    onToggleInvoice: () => void
}> = ({ item, remaining, isPaid, writeOffLabel, invoiceStatus, remark, onRemarkChange, remarkDisabled, onConfirm, onDefer, onRevoke, onToggleInvoice }) => {
    const deferShell = deferReceivableShellClass(item);
    const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
    const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
    return (
    <div className={`bg-white p-4 border-b border-slate-100 last:border-0 ${isPaid ? 'opacity-60' : ''} ${deferShell}`}>
        <div className="flex justify-between items-start mb-2">
            <div>
                <div className="font-medium text-slate-800">{item.tenantName}</div>
                {hasDeferOut && (
                    <div className="mt-1 text-[10px] font-semibold text-orange-800 leading-snug">缓出 → {item.deferredToPeriod}（¥{(item.deferredAmount ?? 0).toLocaleString()}）</div>
                )}
                {hasDeferIn && (
                    <div className="mt-1 text-[10px] font-semibold text-sky-800 leading-snug">缓入 ← {item.deferredInFromSummary}（¥{(item.deferredInAmount ?? 0).toLocaleString()}）</div>
                )}
            </div>
            <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${writeOffBadgeClass(writeOffLabel)}`}>
                    {writeOffLabel}
                </span>
            </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-center bg-slate-50 p-2 rounded mb-3">
            <div>
                <div className="text-slate-400">应收</div>
                <div className="font-semibold text-slate-700">¥{receivableBudgetDisplay(item).toLocaleString()}</div>
                {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                    <div className="text-[9px] text-slate-400 font-normal mt-0.5">原账面已全部缓出</div>
                )}
            </div>
            <div>
                <div className="text-slate-400">已收</div>
                <div className="font-semibold text-blue-600">¥{item.amountPaid.toLocaleString()}</div>
            </div>
            <div>
                <div className="text-slate-400">待收</div>
                <div className="font-semibold text-amber-600">{remaining > 0 ? `¥${remaining.toLocaleString()}` : '-'}</div>
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
        <div className="flex justify-between items-center">
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleInvoice(); }}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors flex items-center gap-1 ${invoiceStatus === 'Invoiced' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'}`}
            >
                {invoiceStatus === 'Invoiced' ? <CheckSquare size={12}/> : <Square size={12}/>}
                {invoiceStatus === 'Invoiced' ? '已开票' : '待开票'}
            </button>
            <div className="flex justify-end gap-2">
                {!isPaid && remaining > 0 ? (
                    <>
                        <button onClick={onDefer} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs">缓缴</button>
                        <button onClick={onConfirm} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">收款</button>
                    </>
                ) : isPaid ? (
                    <button onClick={onRevoke} className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded text-xs">撤销</button>
                ) : (
                    <span className="text-xs text-slate-400">—</span>
                )}
            </div>
        </div>
    </div>
    );
};

export const FinanceManager: React.FC<FinanceManagerProps> = ({ payments, tenants, invoices, billingPeriodNotes = {}, onUpdatePayments, onUpdateTenants, onUpdateInvoices, onBatchUpdate, getBillingDetails, onDeferPayment, onUpdateRentRemark }) => {
  const [showForm, setShowForm] = useState(false);
  const [showDepositTransfer, setShowDepositTransfer] = useState(false);
  const [activeView, setActiveView] = useState<'Payments' | 'Receivables'>('Receivables'); // Default to Receivables
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [receivableMonth, setReceivableMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const today = new Date().toISOString().split('T')[0];
  const [currentPayment, setCurrentPayment] = useState<Partial<PaymentRecord>>({ date: today, period: today.slice(0, 7) });
  const [isEditing, setIsEditing] = useState(false);
  const [transferData, setTransferData] = useState({ tenantId: '', amount: 0, date: new Date().toISOString().split('T')[0] });
  const [deferModalTenant, setDeferModalTenant] = useState<BillingDetail | null>(null);
  const [deferTargetMonth, setDeferTargetMonth] = useState('');
  const [periodPickerYear, setPeriodPickerYear] = useState<number>(new Date().getFullYear());
  const desktopViewportRef = useRef<HTMLDivElement | null>(null);
  const desktopContentRef = useRef<HTMLDivElement | null>(null);
  const [desktopScale, setDesktopScale] = useState(1);
  const [desktopScaledHeight, setDesktopScaledHeight] = useState<number | null>(null);

  const getInvoiceId = (tenantId: string, month: string) => `inv_${tenantId}_${month}-01`;

  // --- Statistics Calculation ---
  // 1. Annual Cumulative Rent (Actual Received in selected Year)
  const annualRentCollection = useMemo(() => {
      return payments
        .filter(p => p.date.startsWith(selectedYear.toString()) && (p.type === 'Rent' || p.type === 'DepositToRent'))
        .reduce((sum, p) => sum + p.amount, 0);
  }, [payments, selectedYear]);

  // 2. Monthly Stats based on Receivable Month Selection
  const currentReceivables = useMemo(() => {
      if (!receivableMonth) return [];
      const parts = receivableMonth.split('-');
      if (parts.length !== 2) return [];
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1; 
      return getBillingDetails(year, month);
  }, [receivableMonth, payments, tenants, getBillingDetails]);

  const receivableSections = useMemo(
      () => buildReceivableSections(currentReceivables, receivableMonth, payments, tenants),
      [currentReceivables, receivableMonth, payments, tenants]
  );

  const monthStats = useMemo(() => {
      const budgetReceivable = currentReceivables.reduce((sum, r) => sum + receivableBudgetDisplay(r), 0);
      const actualReceived = currentReceivables.reduce((sum, r) => sum + r.amountPaid, 0);
      const pendingCollection = budgetReceivable - actualReceived;

      // Invoice Stats based on Receivable List
      // Target: Total Budget Receivable for this month
      const totalInvoiceTarget = budgetReceivable;
      
      // Invoiced: Sum of amountDue for items marked as invoiced
      let totalInvoiced = 0;
      currentReceivables.forEach(item => {
          const invId = getInvoiceId(item.tenantId, receivableMonth);
          const isMarked = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');
          if (isMarked) {
              totalInvoiced += receivableBudgetDisplay(item);
          }
      });

      const totalPendingInvoice = totalInvoiceTarget - totalInvoiced;

      return { 
          budgetReceivable, 
          actualReceived, 
          pendingCollection, 
          totalInvoiceTarget, 
          totalInvoiced, 
          totalPendingInvoice 
      };
  }, [currentReceivables, invoices, receivableMonth]);

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
      const filtered = payments.filter(p => p.date && p.date.startsWith(selectedYear.toString()));
      const groups: Record<string, PaymentRecord[]> = {};
      filtered.forEach(p => {
          const monthKey = p.date.substring(0, 7);
          if (!groups[monthKey]) groups[monthKey] = [];
          groups[monthKey].push(p);
      });
      return groups;
  }, [payments, selectedYear]);

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

  const handleConfirmCollection = (detail: BillingDetail) => {
      const amountToPay = detail.amountDue - detail.amountPaid;
      if (amountToPay <= 0) return;
      const paymentDate = new Date().toISOString().split('T')[0];
      const newPayment: PaymentRecord = {
          id: `p${Date.now()}_col_${detail.tenantId}`, tenantId: detail.tenantId, tenantName: detail.tenantName,
          amount: amountToPay, type: 'Rent', date: paymentDate, period: receivableMonth, status: 'Received', remarks: `[${receivableMonth}] 月度账单`, invoiceStatus: 'Pending'
      };
      if (onBatchUpdate) onBatchUpdate({ payments: [...payments, newPayment] });
      else onUpdatePayments([...payments, newPayment]);
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
      onDeferPayment(deferModalTenant.tenantId, fromYear, fromMonth, toYear, toMonth);
      setDeferModalTenant(null);
  };

  const handleRevokeCollection = (detail: BillingDetail) => {
      const relevantPayments = payments.filter((p) => {
          if (p.tenantId !== detail.tenantId) return false;
          if (p.type !== 'Rent' && p.type !== 'DepositToRent') return false;
          const periodList = parseBillingPeriods(p.period);
          if (periodList.length > 0) return periodList.includes(receivableMonth);
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
      const newTenant = { ...tenant, depositStatus: DepositStatus.Deducted };
      if (onBatchUpdate) onBatchUpdate({ payments: [rentRecord, ...payments], tenants: tenants.map(t => t.id === tenant.id ? newTenant : t) });
      else { onUpdatePayments([rentRecord, ...payments]); onUpdateTenants(tenants.map(t => t.id === tenant.id ? newTenant : t)); }
      setShowDepositTransfer(false); setTransferData({ tenantId: '', amount: 0, date: new Date().toISOString().split('T')[0] });
  };

  const toggleInvoiceStatus = (item: BillingDetail) => {
      const invId = getInvoiceId(item.tenantId, receivableMonth);
      const existingInv = invoices.find(inv => inv.id === invId);
      
      let newInvoices = [...invoices];
      if (existingInv && existingInv.status === 'Invoiced') {
          // Revert to Pending (remove record or update status)
          // Removing is cleaner for "no zombie data" if we treat non-existence as Pending
          newInvoices = newInvoices.filter(inv => inv.id !== invId);
      } else {
          // Mark as Invoiced
          const newRecord: InvoiceRecord = {
              id: invId,
              tenantId: item.tenantId,
              billDate: `${receivableMonth}-01`,
              targetInvoiceDate: `${receivableMonth}-01`,
              amount: receivableBudgetDisplay(item),
              status: 'Invoiced',
              invoicedAt: new Date().toISOString()
          };
          // Remove potential old pending/duplicates
          newInvoices = newInvoices.filter(inv => inv.id !== invId);
          newInvoices.push(newRecord);
      }
      onUpdateInvoices(newInvoices);
  };

  const renderReceivableTableRow = (item: BillingDetail, writeOffLabel: string) => {
      const remaining = item.amountDue - item.amountPaid;
      const isPaid = item.status === 'Paid';
      const invId = getInvoiceId(item.tenantId, receivableMonth);
      const isInvoiceDone = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');
      const remark = getRentCollectionRemark(billingPeriodNotes, item.tenantId, receivableMonth);
      const deferShell = deferReceivableShellClass(item);
      const hasDeferOut = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
      const hasDeferIn = !!(item.deferredInAmount && item.deferredInAmount > 0);
      return (
          <tr key={item.tenantId} className={`hover:bg-slate-50 transition-colors ${isPaid ? 'opacity-75' : ''} ${deferShell}`}>
              <td className="px-4 py-3 text-slate-700">
                  <div className="font-medium">{item.tenantName}</div>
                  {hasDeferOut && (
                      <div className="mt-1 text-[10px] font-semibold text-orange-800">缓出 → {item.deferredToPeriod}（¥{(item.deferredAmount ?? 0).toLocaleString()}）</div>
                  )}
                  {hasDeferIn && (
                      <div className="mt-1 text-[10px] font-semibold text-sky-800">缓入 ← {item.deferredInFromSummary}（¥{(item.deferredInAmount ?? 0).toLocaleString()}）</div>
                  )}
              </td>
              <td className="px-4 py-3 align-middle text-center whitespace-nowrap">
                  <div className="text-slate-800">¥{receivableBudgetDisplay(item).toLocaleString()}</div>
                  {hasDeferOut && (item.amountDue ?? 0) < 0.005 && (
                      <div className="text-[10px] text-slate-400 mt-0.5">原账面应收已全部缓出</div>
                  )}
              </td>
              <td className="px-4 py-3 text-slate-500 text-center whitespace-nowrap">¥{item.amountPaid.toLocaleString()}</td>
              <td className="px-4 py-3 font-bold text-blue-600 text-center whitespace-nowrap">{remaining > 0 ? `¥${remaining.toLocaleString()}` : '-'}</td>
              <td className="px-4 py-3 text-center whitespace-nowrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${writeOffBadgeClass(writeOffLabel)}`}>{writeOffLabel}</span>
              </td>
              <td className="px-4 py-3 text-center">
                  <button
                      onClick={() => toggleInvoiceStatus(item)}
                      className={`px-3 py-1 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1 whitespace-nowrap min-w-[68px] justify-center ${isInvoiceDone ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                  >
                      {isInvoiceDone ? <CheckSquare size={12}/> : <Square size={12}/>}
                      {isInvoiceDone ? '已开票' : '待开票'}
                  </button>
              </td>
              <td className="px-4 py-2 align-top max-w-[220px]">
                  <textarea
                      className="w-full min-h-[52px] text-xs border border-slate-200 rounded-lg p-2 text-slate-700 resize-y"
                      placeholder="预期收款日、沟通情况等"
                      value={remark}
                      onChange={(e) => onUpdateRentRemark?.(item.tenantId, receivableMonth, e.target.value)}
                      disabled={!onUpdateRentRemark}
                  />
              </td>
              <td className="px-4 py-3 text-right">
                  {!isPaid && remaining > 0 ? (
                      <div className="flex justify-end gap-2">
                          <button onClick={() => handleConfirmCollection(item)} className="px-2 py-1 bg-white border border-blue-200 text-blue-600 rounded hover:bg-blue-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><Receipt size={14} /> 收款</button>
                          <button onClick={() => openDeferModal(item)} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><Clock size={14} /> 缓缴</button>
                      </div>
                  ) : isPaid ? (
                      <div className="flex justify-end gap-2">
                          <button onClick={() => handleRevokeCollection(item)} className="px-2 py-1 bg-white border border-rose-200 text-rose-600 rounded hover:bg-rose-50 text-xs inline-flex items-center gap-1 shadow-sm whitespace-nowrap min-w-[64px] justify-center"><RotateCcw size={14} /> 撤销</button>
                      </div>
                  ) : (
                      <span className="text-xs text-slate-400">—</span>
                  )}
              </td>
          </tr>
      );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      
      {/* Revised Financial Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3 md:gap-4">
          {/* Main Financials - Row 1 equivalent (Span 4) */}
          <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="bg-white p-3 rounded-xl border border-blue-100 shadow-sm flex flex-col justify-between items-center text-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-10"><Wallet size={32} className="text-blue-600"/></div>
                  <div className="text-xs text-slate-500 font-bold mb-1 uppercase tracking-wider whitespace-nowrap">本年累计租金收款</div>
                  <div className="text-lg md:text-xl font-bold text-blue-700 whitespace-nowrap" title={`¥${annualRentCollection.toLocaleString()}`}>¥{annualRentCollection.toLocaleString()}</div>
                  <div className="text-[10px] text-blue-400 mt-1 whitespace-nowrap">{selectedYear}年度</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月应收租金</div>
                  <div className="text-base md:text-lg font-bold text-slate-800 whitespace-nowrap">¥{monthStats.budgetReceivable.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400 whitespace-nowrap">预算口径</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月实收租金</div>
                  <div className="text-base md:text-lg font-bold text-emerald-600 whitespace-nowrap">¥{monthStats.actualReceived.toLocaleString()}</div>
                  <div className="text-[10px] text-emerald-400 font-medium whitespace-nowrap">Actual</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月待收租金</div>
                  <div className="text-base md:text-lg font-bold text-amber-600 whitespace-nowrap">¥{Math.max(0, monthStats.pendingCollection).toLocaleString()}</div>
                  <div className="text-[10px] text-amber-400 font-medium whitespace-nowrap">Pending</div>
              </div>
          </div>

          {/* Invoice Stats - Row 2 equivalent (Span 3) */}
          <div className="md:col-span-3 grid grid-cols-3 gap-3">
              <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 flex flex-col justify-between items-center text-center">
                  <div className="text-xs text-indigo-500 font-bold mb-1 whitespace-nowrap">本月应开票</div>
                  <div className="text-sm md:text-base font-bold text-indigo-700 whitespace-nowrap">¥{monthStats.totalInvoiceTarget.toLocaleString()}</div>
                  <div className="text-[10px] text-indigo-400 whitespace-nowrap">应收额</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 flex flex-col justify-between items-center text-center relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-1 bg-indigo-50 text-indigo-600 rounded-bl-lg"><Check size={10}/></div>
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月已开票</div>
                  <div className="text-sm md:text-base font-bold text-slate-800 whitespace-nowrap">¥{monthStats.totalInvoiced.toLocaleString()}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 flex flex-col justify-between items-center text-center relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-1 bg-slate-50 text-slate-400 rounded-bl-lg"><Clock size={10}/></div>
                  <div className="text-xs text-slate-500 font-medium mb-1 whitespace-nowrap">本月未开票</div>
                  <div className="text-sm md:text-base font-bold text-slate-800 whitespace-nowrap">¥{monthStats.totalPendingInvoice.toLocaleString()}</div>
              </div>
          </div>
      </div>

      {/* Main View Toggle & Toolbar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-slate-200 pb-2 gap-4">
        <div className="flex gap-4 w-full md:w-auto overflow-x-auto">
             <button onClick={() => setActiveView('Receivables')} className={`pb-2 px-2 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'Receivables' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><ListChecks size={18} /> 应收核销</button>
             <button onClick={() => setActiveView('Payments')} className={`pb-2 px-2 text-sm font-bold flex items-center gap-2 transition-colors whitespace-nowrap ${activeView === 'Payments' ? 'text-blue-600 border-b-2 border-blue-600' : 'text-slate-500 hover:text-slate-700'}`}><BadgeCheck size={18} /> 收款明细</button>
        </div>

        {activeView === 'Payments' ? (
             <div className="flex flex-wrap gap-2 items-center w-full md:w-auto">
                 <select value={selectedYear} onChange={e => setSelectedYear(Number(e.target.value))} className="bg-white border border-slate-200 text-slate-700 text-sm rounded-lg px-2 py-1.5 focus:outline-none flex-1 md:flex-none cursor-pointer">{availableYears.map(y => <option key={y} value={y}>{y}年</option>)}</select>
                 <button onClick={() => { setShowDepositTransfer(true); setShowForm(false); setIsEditing(false); }} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg hover:bg-slate-50 text-sm flex items-center gap-1 flex-1 md:flex-none justify-center whitespace-nowrap"><ArrowRightLeft size={14} /> 转租金</button>
                 <button onClick={() => { const now = new Date().toISOString().split('T')[0]; setShowForm(true); setShowDepositTransfer(false); setIsEditing(false); setCurrentPayment({ date: now, type: 'Rent', period: now.slice(0, 7) }); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-1 shadow-sm flex-1 md:flex-none justify-center whitespace-nowrap"><Plus size={14} /> 记账</button>
             </div>
        ) : (
             <div className="flex gap-2 items-center w-full md:w-auto justify-end">
                 <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1 whitespace-nowrap">
                     <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronLeft size={16}/></button>
                     <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 w-24 justify-center whitespace-nowrap"><Calendar size={14} className="text-slate-400"/><span className="text-center whitespace-nowrap leading-none">{receivableMonth}</span></div>
                     <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronRight size={16}/></button>
                 </div>
             </div>
        )}
      </div>

      {/* Forms Overlay */}
      {showForm && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl mb-6 flex flex-col items-start gap-4 animate-in fade-in slide-in-from-top-2">
           <div className="w-full grid grid-cols-1 md:grid-cols-5 gap-4">
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">付款客户</label><select className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.tenantId} onChange={e => setCurrentPayment({...currentPayment, tenantId: e.target.value})}><option value="">选择客户...</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">款项类型</label><select className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.type} onChange={e => setCurrentPayment({...currentPayment, type: e.target.value as any})}><option value="Rent">租金收入</option><option value="Deposit">押金收取</option><option value="DepositRefund">押金退还 (支出)</option><option value="ManagementFee">物业费</option><option value="Other">其他</option><option value="DepositToRent">押金转租金</option></select></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">金额 (元)</label><input type="number" className="w-full p-2 rounded border border-emerald-200 text-sm" placeholder="0.00" value={currentPayment.amount || ''} onChange={e => setCurrentPayment({...currentPayment, amount: Number(e.target.value)})}/></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">入账日期</label><input type="date" className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.date} onChange={e => setCurrentPayment({...currentPayment, date: e.target.value})}/></div>
                <div>
                    <label className="block text-xs font-medium text-emerald-700 mb-1">关联账期（多选）</label>
                    <div className="border border-emerald-200 rounded-lg p-2 bg-white">
                        <div className="flex items-center justify-between mb-2">
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
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">选择客户</label><select className="w-full p-2 rounded border border-indigo-200 text-sm" onChange={e => setTransferData({...transferData, tenantId: e.target.value})}><option value="">选择客户...</option>{tenants.filter(t => t.depositStatus !== 'Refunded').map(t => <option key={t.id} value={t.id}>{t.name} (押金: ¥{t.depositAmount})</option>)}</select></div>
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">抵扣金额</label><input type="number" className="w-full p-2 rounded border border-indigo-200 text-sm" placeholder="0.00" onChange={e => setTransferData({...transferData, amount: Number(e.target.value)})}/></div>
               <div><label className="block text-xs font-medium text-indigo-700 mb-1">日期</label><input type="date" className="w-full p-2 rounded border border-indigo-200 text-sm" value={transferData.date} onChange={e => setTransferData({...transferData, date: e.target.value})}/></div>
           </div>
           <div className="flex gap-2 w-full md:w-auto"><button onClick={handleDepositTransfer} className="flex-1 md:flex-none px-4 py-2 bg-indigo-600 text-white rounded hover:bg-indigo-700 flex items-center justify-center gap-1"><Check size={18}/> 确认</button><button onClick={() => setShowDepositTransfer(false)} className="flex-1 md:flex-none px-4 py-2 bg-white text-slate-500 border border-indigo-200 rounded hover:bg-slate-50 flex items-center justify-center gap-1"><X size={18}/> 取消</button></div>
        </div>
      )}

      {/* Main Lists */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        {activeView === 'Payments' ? (
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
                                        <tr className="bg-slate-50/80 border-y border-slate-100"><td colSpan={7} className="px-6 py-2"><div className="flex items-center justify-between"><div className="font-bold text-slate-700 flex items-center gap-2 text-xs"><Calendar size={14} />{monthKey} ({monthPayments.length}笔)</div><div className="font-bold text-slate-700 text-xs">月度合计: <span className={monthTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}>¥{monthTotal.toLocaleString()}</span></div></div></td></tr>
                                        {monthPayments.map(p => (
                                            <tr key={p.id} className="hover:bg-slate-50 group">
                                                <td className="px-6 py-4 font-mono text-xs text-slate-400">#{p.id.split('_')[0]}</td>
                                                <td className="px-6 py-4 font-medium text-slate-800">{p.tenantName}</td>
                                                <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs ${p.type === 'DepositToRent' ? 'bg-indigo-100 text-indigo-700' : p.type === 'DepositRefund' ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>{p.type === 'Rent' ? '租金' : p.type === 'Deposit' ? '押金收取' : p.type === 'DepositRefund' ? '押金退还' : p.type === 'DepositToRent' ? '押金转租金' : '其他'}</span></td>
                                                <td className={`px-6 py-4 font-medium ${p.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{p.amount > 0 ? '+' : ''}¥{p.amount.toLocaleString()}</td>
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
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex items-center gap-2 text-sm text-blue-700"><AlertCircle size={16} /> 此界面按“应收款专用方案”生成应收账单（存量含账期/金额调整，续租新签按实际合同）。点击"收款"生成流水，点击"待开票"切换发票状态。</div>
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3">客户名称</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">应收租金 (预算)</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">已收金额</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">待收余额</th>
                                <th className="px-4 py-3 text-center whitespace-nowrap">应收核销情况</th>
                                <th className="px-4 py-3 text-center">开票状态</th>
                                <th className="px-4 py-3 min-w-[200px]">备注</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {currentReceivables.length > 0 ? (
                                <>
                                    {receivableSections.unsettled.length > 0 && (
                                        <>
                                            <tr className="bg-amber-50/60">
                                                <td colSpan={8} className="px-4 py-2 text-xs font-bold text-amber-900/90 border-t border-amber-100/80">
                                                    {WRITEOFF_LABELS.pending}
                                                </td>
                                            </tr>
                                            {receivableSections.unsettled.map(({ item }) => renderReceivableTableRow(item, WRITEOFF_LABELS.pending))}
                                        </>
                                    )}
                                    {receivableSections.deferred.length > 0 && (
                                        <>
                                            <tr className="bg-indigo-50/60">
                                                <td colSpan={8} className="px-4 py-2 text-xs font-bold text-indigo-900/90 border-t border-indigo-100/80">
                                                    {WRITEOFF_LABELS.deferred}（原账期挂账已调至其他月份）
                                                </td>
                                            </tr>
                                            {receivableSections.deferred.map(({ item }) => renderReceivableTableRow(item, WRITEOFF_LABELS.deferred))}
                                        </>
                                    )}
                                    {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                                        <>
                                            <tr className="bg-emerald-50/50">
                                                <td colSpan={8} className="px-4 py-2 text-xs font-bold text-emerald-900/90 border-t border-emerald-100/80">
                                                    {WRITEOFF_LABELS.settled}
                                                </td>
                                            </tr>
                                            {receivableSections.settledThisMonth.map(({ item }) => renderReceivableTableRow(item, WRITEOFF_LABELS.settled))}
                                            {receivableSections.prepaid.map(({ item }) => renderReceivableTableRow(item, WRITEOFF_LABELS.settled))}
                                        </>
                                    )}
                                </>
                            ) : (
                                <tr><td colSpan={8} className="p-8 text-center text-slate-400">该月份暂无应收账单</td></tr>
                            )}
                        </tbody>
                    </table>
                            </div>
                        </div>
                    </div>
                </div>
                {/* Mobile Receivable View */}
                <div className="md:hidden">
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700 mb-2"><AlertCircle size={14} /> 数据来源: 应收款专用方案（含账期/金额调整）</div>
                    {currentReceivables.length > 0 ? (
                        <>
                            {receivableSections.unsettled.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-amber-50/60 text-amber-900 border-b border-amber-100">{WRITEOFF_LABELS.pending}</div>
                                    {receivableSections.unsettled.map(({ item }) => {
                                        const remaining = item.amountDue - item.amountPaid;
                                        const isPaid = item.status === 'Paid';
                                        const invId = getInvoiceId(item.tenantId, receivableMonth);
                                        const isInvoiceDone = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');
                                        return (
                                            <ReceivableCard
                                                key={item.tenantId}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                writeOffLabel={WRITEOFF_LABELS.pending}
                                                invoiceStatus={isInvoiceDone ? 'Invoiced' : 'Pending'}
                                                remark={getRentCollectionRemark(billingPeriodNotes, item.tenantId, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => handleConfirmCollection(item)}
                                                onDefer={() => openDeferModal(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                onToggleInvoice={() => toggleInvoiceStatus(item)}
                                            />
                                        );
                                    })}
                                </>
                            )}
                            {receivableSections.deferred.length > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-indigo-50/70 text-indigo-900 border-b border-indigo-100">{WRITEOFF_LABELS.deferred}（原账期已调至他月）</div>
                                    {receivableSections.deferred.map(({ item }) => {
                                        const remaining = item.amountDue - item.amountPaid;
                                        const isPaid = item.status === 'Paid';
                                        const invId = getInvoiceId(item.tenantId, receivableMonth);
                                        const isInvoiceDone = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');
                                        return (
                                            <ReceivableCard
                                                key={`${item.tenantId}-def`}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                writeOffLabel={WRITEOFF_LABELS.deferred}
                                                invoiceStatus={isInvoiceDone ? 'Invoiced' : 'Pending'}
                                                remark={getRentCollectionRemark(billingPeriodNotes, item.tenantId, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => handleConfirmCollection(item)}
                                                onDefer={() => openDeferModal(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                onToggleInvoice={() => toggleInvoiceStatus(item)}
                                            />
                                        );
                                    })}
                                </>
                            )}
                            {(receivableSections.settledThisMonth.length + receivableSections.prepaid.length) > 0 && (
                                <>
                                    <div className="px-3 py-2 text-xs font-bold bg-emerald-50/50 text-emerald-900 border-b border-emerald-100">{WRITEOFF_LABELS.settled}</div>
                                    {[...receivableSections.settledThisMonth, ...receivableSections.prepaid].map(({ item }) => {
                                        const remaining = item.amountDue - item.amountPaid;
                                        const isPaid = item.status === 'Paid';
                                        const invId = getInvoiceId(item.tenantId, receivableMonth);
                                        const isInvoiceDone = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');
                                        return (
                                            <ReceivableCard
                                                key={item.tenantId}
                                                item={item}
                                                remaining={remaining}
                                                isPaid={isPaid}
                                                writeOffLabel={WRITEOFF_LABELS.settled}
                                                invoiceStatus={isInvoiceDone ? 'Invoiced' : 'Pending'}
                                                remark={getRentCollectionRemark(billingPeriodNotes, item.tenantId, receivableMonth)}
                                                onRemarkChange={(text) => onUpdateRentRemark?.(item.tenantId, receivableMonth, text)}
                                                remarkDisabled={!onUpdateRentRemark}
                                                onConfirm={() => handleConfirmCollection(item)}
                                                onDefer={() => openDeferModal(item)}
                                                onRevoke={() => handleRevokeCollection(item)}
                                                onToggleInvoice={() => toggleInvoiceStatus(item)}
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
                              ¥{Math.max(0, deferModalTenant.amountDue - deferModalTenant.amountPaid).toLocaleString()}
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
