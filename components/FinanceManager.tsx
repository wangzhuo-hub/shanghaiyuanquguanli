
import React, { useState, useMemo } from 'react';
import { PaymentRecord, Tenant, ContractStatus, DepositStatus, BillingDetail, InvoiceRecord } from '../types';
import { BadgeCheck, Plus, ArrowRightLeft, Check, X, AlertCircle, Banknote, Wallet, TrendingUp, ArrowDownRight, CreditCard, Trash2, Edit2, Download, Upload, FileSpreadsheet, Calendar, CheckSquare, Square, ListChecks, Clock, Receipt, RefreshCcw, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, FileText, CheckCircle } from 'lucide-react';

interface FinanceManagerProps {
  payments: PaymentRecord[];
  tenants: Tenant[];
  invoices: InvoiceRecord[];
  onUpdatePayments: (payments: PaymentRecord[]) => void;
  onUpdateTenants: (tenants: Tenant[]) => void;
  onUpdateInvoices: (invoices: InvoiceRecord[]) => void;
  onBatchUpdate?: (updates: { tenants?: Tenant[], payments?: PaymentRecord[] }) => void;
  getBillingDetails: (year: number, month: number) => BillingDetail[];
  onDeferPayment: (tenantId: string, year?: number, month?: number) => void;
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
                : p.type === 'ParkingFee' ? 'bg-orange-100 text-orange-700'
                : 'bg-slate-100 text-slate-600'}`}>
                {p.type === 'Rent' ? '租金' : p.type === 'Deposit' ? '押金' : p.type === 'DepositToRent' ? '押金转租' : p.type === 'ParkingFee' ? '车位费' : p.type}
            </span>
            <span className="text-slate-400">{p.date}</span>
        </div>
        <div className="text-xs text-slate-400 italic mb-2">{p.remarks || '无备注'}</div>
        
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
    invoiceStatus: 'Pending' | 'Invoiced',
    onConfirm: () => void, 
    onDefer: () => void,
    onRevoke: () => void,
    onToggleInvoice: () => void
}> = ({ item, remaining, isPaid, invoiceStatus, onConfirm, onDefer, onRevoke, onToggleInvoice }) => (
    <div className={`bg-white p-4 border-b border-slate-100 last:border-0 ${isPaid ? 'opacity-60' : ''}`}>
        <div className="flex justify-between items-start mb-2">
            <div className="font-medium text-slate-800">{item.tenantName}</div>
            <div className="flex gap-2">
                <span className={`px-2 py-0.5 rounded text-xs ${isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                    {isPaid ? '已结清' : item.status === 'Partial' ? '部分' : '待缴纳'}
                </span>
            </div>
        </div>
        <div className="grid grid-cols-3 gap-2 text-xs text-center bg-slate-50 p-2 rounded mb-3">
            <div>
                <div className="text-slate-400">应收</div>
                <div className="font-semibold text-slate-700">¥{item.amountDue.toLocaleString()}</div>
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
        <div className="flex justify-between items-center">
            <button 
                onClick={(e) => { e.stopPropagation(); onToggleInvoice(); }}
                className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors flex items-center gap-1 ${invoiceStatus === 'Invoiced' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-200'}`}
            >
                {invoiceStatus === 'Invoiced' ? <CheckSquare size={12}/> : <Square size={12}/>}
                {invoiceStatus === 'Invoiced' ? '已开票' : '待开票'}
            </button>
            <div className="flex justify-end gap-2">
                {!isPaid ? (
                    <>
                        <button onClick={onDefer} className="px-3 py-1.5 border border-slate-200 text-slate-600 rounded text-xs">缓缴</button>
                        <button onClick={onConfirm} className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs">收款</button>
                    </>
                ) : (
                    <button onClick={onRevoke} className="px-3 py-1.5 border border-rose-200 text-rose-600 rounded text-xs">撤销</button>
                )}
            </div>
        </div>
    </div>
);

export const FinanceManager: React.FC<FinanceManagerProps> = ({ payments, tenants, invoices, onUpdatePayments, onUpdateTenants, onUpdateInvoices, onBatchUpdate, getBillingDetails, onDeferPayment }) => {
  const [showForm, setShowForm] = useState(false);
  const [showDepositTransfer, setShowDepositTransfer] = useState(false);
  const [activeView, setActiveView] = useState<'Payments' | 'Receivables'>('Receivables'); // Default to Receivables
  
  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState<number>(currentYear);
  const [receivableMonth, setReceivableMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
  const [currentPayment, setCurrentPayment] = useState<Partial<PaymentRecord>>({ date: new Date().toISOString().split('T')[0] });
  const [isEditing, setIsEditing] = useState(false);
  const [transferData, setTransferData] = useState({ tenantId: '', amount: 0, date: new Date().toISOString().split('T')[0] });

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

  const monthStats = useMemo(() => {
      const budgetReceivable = currentReceivables.reduce((sum, r) => sum + r.amountDue, 0);
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
              totalInvoiced += item.amountDue;
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
      const paymentDate = `${receivableMonth}-15`; 
      const newPayment: PaymentRecord = {
          id: `p${Date.now()}_col_${detail.tenantId}`, tenantId: detail.tenantId, tenantName: detail.tenantName,
          amount: amountToPay, type: 'Rent', date: paymentDate, status: 'Received', remarks: `[${receivableMonth}] 月度账单`, invoiceStatus: 'Pending'
      };
      if (onBatchUpdate) onBatchUpdate({ payments: [...payments, newPayment] });
      else onUpdatePayments([...payments, newPayment]);
  };

  const handleDeferCollection = (detail: BillingDetail) => {
      if (confirm(`确定要为 ${detail.tenantName} 申请缓缴吗？`)) {
          const parts = receivableMonth.split('-');
          onDeferPayment(detail.tenantId, parseInt(parts[0]), parseInt(parts[1]) - 1);
      }
  };

  const handleRevokeCollection = (detail: BillingDetail) => {
      const relevantPayments = payments.filter(p => p.tenantId === detail.tenantId && (p.type === 'Rent' || p.type === 'DepositToRent') && p.date.startsWith(receivableMonth));
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
      invoiceStatus: currentPayment.invoiceStatus || 'Pending'
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
    setShowForm(false); setIsEditing(false); setCurrentPayment({ date: new Date().toISOString().split('T')[0] });
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
              amount: item.amountDue,
              status: 'Invoiced',
              invoicedAt: new Date().toISOString()
          };
          // Remove potential old pending/duplicates
          newInvoices = newInvoices.filter(inv => inv.id !== invId);
          newInvoices.push(newRecord);
      }
      onUpdateInvoices(newInvoices);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      
      {/* Revised Financial Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-7 gap-3 md:gap-4">
          {/* Main Financials - Row 1 equivalent (Span 4) */}
          <div className="md:col-span-4 grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
              <div className="bg-white p-3 rounded-xl border border-blue-100 shadow-sm flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-10"><Wallet size={32} className="text-blue-600"/></div>
                  <div className="text-xs text-slate-500 font-bold mb-1 uppercase tracking-wider">本年累计租金收款</div>
                  <div className="text-lg md:text-xl font-bold text-blue-700 truncate" title={`¥${annualRentCollection.toLocaleString()}`}>¥{annualRentCollection.toLocaleString()}</div>
                  <div className="text-[10px] text-blue-400 mt-1">{selectedYear}年度</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="text-xs text-slate-500 font-medium mb-1">本月应收租金</div>
                  <div className="text-base md:text-lg font-bold text-slate-800">¥{monthStats.budgetReceivable.toLocaleString()}</div>
                  <div className="text-[10px] text-slate-400">预算口径</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="text-xs text-slate-500 font-medium mb-1">本月实收租金</div>
                  <div className="text-base md:text-lg font-bold text-emerald-600">¥{monthStats.actualReceived.toLocaleString()}</div>
                  <div className="text-[10px] text-emerald-400 font-medium">Actual</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
                  <div className="text-xs text-slate-500 font-medium mb-1">本月待收租金</div>
                  <div className="text-base md:text-lg font-bold text-amber-600">¥{Math.max(0, monthStats.pendingCollection).toLocaleString()}</div>
                  <div className="text-[10px] text-amber-400 font-medium">Pending</div>
              </div>
          </div>

          {/* Invoice Stats - Row 2 equivalent (Span 3) */}
          <div className="md:col-span-3 grid grid-cols-3 gap-3">
              <div className="bg-indigo-50/50 p-3 rounded-xl border border-indigo-100 flex flex-col justify-between">
                  <div className="text-xs text-indigo-500 font-bold mb-1">本月应开票</div>
                  <div className="text-sm md:text-base font-bold text-indigo-700">¥{monthStats.totalInvoiceTarget.toLocaleString()}</div>
                  <div className="text-[10px] text-indigo-400">应收额</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-1 bg-indigo-50 text-indigo-600 rounded-bl-lg"><Check size={10}/></div>
                  <div className="text-xs text-slate-500 font-medium mb-1">本月已开票</div>
                  <div className="text-sm md:text-base font-bold text-slate-800">¥{monthStats.totalInvoiced.toLocaleString()}</div>
              </div>
              <div className="bg-white p-3 rounded-xl border border-indigo-100 flex flex-col justify-between relative overflow-hidden">
                  <div className="absolute right-0 top-0 p-1 bg-slate-50 text-slate-400 rounded-bl-lg"><Clock size={10}/></div>
                  <div className="text-xs text-slate-500 font-medium mb-1">本月未开票</div>
                  <div className="text-sm md:text-base font-bold text-slate-800">¥{monthStats.totalPendingInvoice.toLocaleString()}</div>
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
                 <button onClick={() => { setShowForm(true); setShowDepositTransfer(false); setIsEditing(false); setCurrentPayment({ date: new Date().toISOString().split('T')[0], type: 'Rent' }); }} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm flex items-center gap-1 shadow-sm flex-1 md:flex-none justify-center whitespace-nowrap"><Plus size={14} /> 记账</button>
             </div>
        ) : (
             <div className="flex gap-2 items-center w-full md:w-auto justify-end">
                 <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
                     <button onClick={handlePrevMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronLeft size={16}/></button>
                     <div className="flex items-center gap-2 px-2 text-sm font-medium text-slate-700 w-24 justify-center"><Calendar size={14} className="text-slate-400"/><span className="text-center">{receivableMonth}</span></div>
                     <button onClick={handleNextMonth} className="p-1 hover:bg-slate-100 rounded text-slate-500"><ChevronRight size={16}/></button>
                 </div>
             </div>
        )}
      </div>

      {/* Forms Overlay */}
      {showForm && (
        <div className="bg-emerald-50 border border-emerald-100 p-4 rounded-xl mb-6 flex flex-col items-start gap-4 animate-in fade-in slide-in-from-top-2">
           <div className="w-full grid grid-cols-1 md:grid-cols-4 gap-4">
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">付款客户</label><select className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.tenantId} onChange={e => setCurrentPayment({...currentPayment, tenantId: e.target.value})}><option value="">选择客户...</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">款项类型</label><select className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.type} onChange={e => setCurrentPayment({...currentPayment, type: e.target.value as any})}><option value="Rent">租金收入</option><option value="ParkingFee">月卡车位费</option><option value="Deposit">押金收取</option><option value="DepositRefund">押金退还 (支出)</option><option value="ManagementFee">物业费</option><option value="Other">其他</option><option value="DepositToRent">押金转租金</option></select></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">金额 (元)</label><input type="number" className="w-full p-2 rounded border border-emerald-200 text-sm" placeholder="0.00" value={currentPayment.amount || ''} onChange={e => setCurrentPayment({...currentPayment, amount: Number(e.target.value)})}/></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">入账日期</label><input type="date" className="w-full p-2 rounded border border-emerald-200 text-sm" value={currentPayment.date} onChange={e => setCurrentPayment({...currentPayment, date: e.target.value})}/></div>
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
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                        <tr>
                            <th className="px-6 py-4">流水号</th>
                            <th className="px-6 py-4">付款方</th>
                            <th className="px-6 py-4">款项类型</th>
                            <th className="px-6 py-4">金额</th>
                            <th className="px-6 py-4">收款日期</th>
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
                                        <tr className="bg-slate-50/80 border-y border-slate-100"><td colSpan={6} className="px-6 py-2"><div className="flex items-center justify-between"><div className="font-bold text-slate-700 flex items-center gap-2 text-xs"><Calendar size={14} />{monthKey} ({monthPayments.length}笔)</div><div className="font-bold text-slate-700 text-xs">月度合计: <span className={monthTotal >= 0 ? 'text-emerald-600' : 'text-rose-600'}>¥{monthTotal.toLocaleString()}</span></div></div></td></tr>
                                        {monthPayments.map(p => (
                                            <tr key={p.id} className="hover:bg-slate-50 group">
                                                <td className="px-6 py-4 font-mono text-xs text-slate-400">#{p.id.split('_')[0]}</td>
                                                <td className="px-6 py-4 font-medium text-slate-800">{p.tenantName}</td>
                                                <td className="px-6 py-4"><span className={`px-2 py-1 rounded text-xs ${p.type === 'DepositToRent' ? 'bg-indigo-100 text-indigo-700' : p.type === 'DepositRefund' ? 'bg-rose-100 text-rose-700' : p.type === 'ParkingFee' ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-600'}`}>{p.type === 'Rent' ? '租金' : p.type === 'Deposit' ? '押金收取' : p.type === 'DepositRefund' ? '押金退还' : p.type === 'DepositToRent' ? '押金转租金' : p.type === 'ParkingFee' ? '月卡车位费' : '其他'}</span></td>
                                                <td className={`px-6 py-4 font-medium ${p.amount < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{p.amount > 0 ? '+' : ''}¥{p.amount.toLocaleString()}</td>
                                                <td className="px-6 py-4 text-slate-600">{p.date}</td>
                                                <td className="px-6 py-4 text-right"><div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={() => handleEditPayment(p)} className="p-1 text-blue-600 hover:bg-blue-50 rounded" title="修改"><Edit2 size={14} /></button><button onClick={() => handleDeletePayment(p.id)} className="p-1 text-red-600 hover:bg-red-50 rounded" title="删除"><Trash2 size={14} /></button></div></td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })
                        ) : (<tr><td colSpan={6} className="p-8 text-center text-slate-400">该年度无收款记录</td></tr>)}
                    </tbody>
                    </table>
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
                <div className="hidden md:block overflow-x-auto">
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex items-center gap-2 text-sm text-blue-700"><AlertCircle size={16} /> 此界面根据招商预算管理数据自动生成应收账单。点击"收款"生成流水，点击"待开票"切换发票状态。</div>
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium border-b border-slate-200">
                            <tr>
                                <th className="px-4 py-3">客户名称</th>
                                <th className="px-4 py-3">应收租金 (预算)</th>
                                <th className="px-4 py-3">已收金额</th>
                                <th className="px-4 py-3">待收余额</th>
                                <th className="px-4 py-3">状态</th>
                                <th className="px-4 py-3 text-center">开票状态</th>
                                <th className="px-4 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {currentReceivables.length > 0 ? (currentReceivables.map(item => { 
                                const remaining = item.amountDue - item.amountPaid; 
                                const isPaid = item.status === 'Paid';
                                const invId = getInvoiceId(item.tenantId, receivableMonth);
                                const isInvoiceDone = invoices.some(inv => inv.id === invId && inv.status === 'Invoiced');

                                return (
                                    <tr key={item.tenantId} className={`hover:bg-slate-50 transition-colors ${isPaid ? 'opacity-75' : ''}`}>
                                        <td className="px-4 py-3 font-medium text-slate-700">{item.tenantName}</td>
                                        <td className="px-4 py-3">¥{item.amountDue.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-slate-500">¥{item.amountPaid.toLocaleString()}</td>
                                        <td className="px-4 py-3 font-bold text-blue-600">{remaining > 0 ? `¥${remaining.toLocaleString()}` : '-'}</td>
                                        <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded text-xs ${isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>{isPaid ? '已结清' : item.status === 'Partial' ? '部分缴纳' : '待缴纳'}</span></td>
                                        <td className="px-4 py-3 text-center">
                                            <button 
                                                onClick={() => toggleInvoiceStatus(item)}
                                                className={`px-3 py-1 rounded text-xs font-medium border transition-colors inline-flex items-center gap-1 ${isInvoiceDone ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}
                                            >
                                                {isInvoiceDone ? <CheckSquare size={12}/> : <Square size={12}/>}
                                                {isInvoiceDone ? '已开票' : '待开票'}
                                            </button>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            {!isPaid ? (
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => handleConfirmCollection(item)} className="px-2 py-1 bg-white border border-blue-200 text-blue-600 rounded hover:bg-blue-50 text-xs flex items-center gap-1 shadow-sm"><Receipt size={14} /> 收款</button>
                                                    <button onClick={() => handleDeferCollection(item)} className="px-2 py-1 bg-white border border-slate-200 text-slate-600 rounded hover:bg-slate-50 text-xs flex items-center gap-1 shadow-sm"><Clock size={14} /> 缓缴</button>
                                                </div>
                                            ) : (
                                                <div className="flex justify-end gap-2">
                                                    <button onClick={() => handleRevokeCollection(item)} className="px-2 py-1 bg-white border border-rose-200 text-rose-600 rounded hover:bg-rose-50 text-xs flex items-center gap-1 shadow-sm"><RotateCcw size={14} /> 撤销</button>
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                ); 
                            })) : (
                                <tr><td colSpan={7} className="p-8 text-center text-slate-400">该月份暂无应收账单</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
                {/* Mobile Receivable View */}
                <div className="md:hidden">
                    <div className="bg-blue-50/50 p-3 border-b border-blue-100 flex items-center gap-2 text-xs text-blue-700 mb-2"><AlertCircle size={14} /> 数据来源: 预算表 (含手动调整)</div>
                    {currentReceivables.length > 0 ? (
                        currentReceivables.map(item => {
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
                                    invoiceStatus={isInvoiceDone ? 'Invoiced' : 'Pending'}
                                    onConfirm={() => handleConfirmCollection(item)}
                                    onDefer={() => handleDeferCollection(item)}
                                    onRevoke={() => handleRevokeCollection(item)}
                                    onToggleInvoice={() => toggleInvoiceStatus(item)}
                                />
                            );
                        })
                    ) : (<div className="p-8 text-center text-slate-400 text-sm">暂无应收账单</div>)}
                </div>
            </>
        )}
      </div>
    </div>
  );
};
