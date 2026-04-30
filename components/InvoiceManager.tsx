
import React, { useState, useMemo } from 'react';
import { Tenant, BudgetAssumption, BudgetAdjustment, InvoiceRecord, Building } from '../types';
import { generateBudgetedBills, getVirtualTenants } from '../services/billingService';
import { Calendar, CheckCircle2, Clock, AlertCircle, ChevronLeft, ChevronRight, RefreshCw, FileText, Info, Layers, ArrowRight, HelpCircle, Lightbulb, Sparkles } from 'lucide-react';
import { formatCurrency, formatPercent } from '../services/numberFormat';

interface InvoiceManagerProps {
    tenants: Tenant[];
    buildings: Building[];
    budgetAssumptions: BudgetAssumption[];
    budgetAdjustments: BudgetAdjustment[];
    invoices: InvoiceRecord[];
    onUpdateInvoices: (invoices: InvoiceRecord[]) => void;
}

export const InvoiceManager: React.FC<InvoiceManagerProps> = ({
    tenants,
    buildings,
    budgetAssumptions,
    budgetAdjustments,
    invoices,
    onUpdateInvoices
}) => {
    const currentYear = new Date().getFullYear();
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isDeferModalOpen, setIsDeferModalOpen] = useState(false);
    const [deferTarget, setDeferTarget] = useState<InvoiceRecord | null>(null);
    const [deferDate, setDeferDate] = useState('');
    const [showLogicPanel, setShowLogicPanel] = useState(true);

    // Helper to calculate next month for Budget comparison
    const getBudgetMonth = (invMonth: string) => {
        const parts = invMonth.split('-');
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1 + 1, 1); // +1 Month
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    // 1. Calculate Combined Invoices (Budgeted Potential + Existing Records)
    const combinedInvoices = useMemo(() => {
        // LOGIC UPDATE: Use ALL passed assumptions to generate virtual tenants (Renewals/Vacancy)
        // This ensures Invoice Manager aligns with the Budget Scenario provided.
        
        // Generate Virtual Tenants (e.g. Renewals, Vacancy Fills from Budget)
        const virtualTenants = getVirtualTenants(tenants, buildings, budgetAssumptions);
        const allTenants = [...tenants, ...virtualTenants];
        
        // Use a wide range to catch everything
        const startDate = new Date(currentYear - 1, 0, 1);
        const endDate = new Date(currentYear + 1, 11, 31);

        let potentialInvoices: InvoiceRecord[] = [];

        // Pre-calculate Self-Use Units to exclude them
        const selfUseUnitIds = new Set<string>();
        buildings.forEach(b => b.units.forEach(u => { if (u.isSelfUse) selfUseUnitIds.add(u.id); }));

        allTenants.forEach(t => {
            // Filter Terminated (unless it's a virtual plan)
            if (t.status === 'Terminated' && !t.id.startsWith('virt_')) return;
            
            // Filter Self-Use (Consistency Fix)
            const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
            if (isSelfUse) return;

            // Use all assumptions for billing generation
            const bills = generateBudgetedBills(t, budgetAssumptions, budgetAdjustments, startDate, endDate);
            
            bills.forEach(bill => {
                // Logic: Target Invoice Date is 1 month BEFORE the Bill Due Date
                // e.g., Bill Due 2024-04-01 -> Invoice Date 2024-03-01
                const targetInvoiceDateObj = new Date(bill.date);
                targetInvoiceDateObj.setMonth(targetInvoiceDateObj.getMonth() - 1);
                const defaultTargetDateStr = targetInvoiceDateObj.toISOString().split('T')[0];
                const billDateStr = bill.date.toISOString().split('T')[0];
                const invoiceId = `inv_${t.id}_${billDateStr}`;

                // Check if we already have a record for this specific bill
                const existingRecord = invoices.find(inv => inv.id === invoiceId);

                if (existingRecord) {
                    potentialInvoices.push({
                        ...existingRecord,
                        billDate: billDateStr // Ensure billDate is always fresh from calculation
                    });
                } else {
                    // Create a potential record
                    potentialInvoices.push({
                        id: invoiceId,
                        tenantId: t.id,
                        billDate: billDateStr,
                        targetInvoiceDate: defaultTargetDateStr,
                        amount: bill.amount,
                        status: 'Pending'
                    });
                }
            });
        });
        
        return potentialInvoices;
    }, [tenants, buildings, budgetAssumptions, budgetAdjustments, invoices, currentYear]);

    // 2. Filter by Selected Month
    const filteredInvoices = useMemo(() => {
        return combinedInvoices.filter(inv => inv.targetInvoiceDate.startsWith(selectedMonth));
    }, [combinedInvoices, selectedMonth]);

    // 3. Calculate Summary Stats
    const stats = useMemo(() => {
        let totalAmt = 0, totalCount = 0;
        let paidAmt = 0, paidCount = 0;
        let pendingAmt = 0, pendingCount = 0;

        filteredInvoices.forEach(inv => {
            totalAmt += inv.amount;
            totalCount++;
            if (inv.status === 'Invoiced') {
                paidAmt += inv.amount;
                paidCount++;
            } else {
                pendingAmt += inv.amount;
                pendingCount++;
            }
        });

        return { totalAmt, totalCount, paidAmt, paidCount, pendingAmt, pendingCount };
    }, [filteredInvoices]);

    // Handlers
    const handleToggleStatus = (invoice: InvoiceRecord) => {
        const newStatus = invoice.status === 'Pending' ? 'Invoiced' : 'Pending';
        const timestamp = newStatus === 'Invoiced' ? new Date().toISOString() : undefined;
        
        const updatedRecord: InvoiceRecord = {
            ...invoice,
            status: newStatus,
            invoicedAt: timestamp
        };

        // Update list: Remove old version if exists, add new
        const otherInvoices = invoices.filter(i => i.id !== invoice.id);
        onUpdateInvoices([...otherInvoices, updatedRecord]);
    };

    const handleOpenDefer = (invoice: InvoiceRecord) => {
        setDeferTarget(invoice);
        setDeferDate(invoice.targetInvoiceDate);
        setIsDeferModalOpen(true);
    };

    const handleConfirmDefer = () => {
        if (!deferTarget || !deferDate) return;
        
        const updatedRecord: InvoiceRecord = {
            ...deferTarget,
            targetInvoiceDate: deferDate,
            status: 'Pending', // Reset status on defer
            deferReason: 'User deferred'
        };

        const otherInvoices = invoices.filter(i => i.id !== deferTarget.id);
        onUpdateInvoices([...otherInvoices, updatedRecord]);
        setIsDeferModalOpen(false);
        setDeferTarget(null);
    };

    const handleMonthChange = (offset: number) => {
        const parts = selectedMonth.split('-');
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1 + offset, 1);
        setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    // Helper to identify virtual tenants
    const isVirtual = (id: string) => id.startsWith('virt_');

    return (
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 h-full flex flex-col animate-in fade-in zoom-in-50 duration-300">
            {/* Header / Toolbar */}
            <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row justify-between items-center gap-4 bg-slate-50 rounded-t-xl">
                <div className="flex items-center gap-2">
                    <div className="bg-purple-100 p-2 rounded-lg text-purple-600"><FileText size={20} /></div>
                    <div>
                        <h3 className="text-lg font-bold text-slate-800">租金发票管理</h3>
                        <p className="text-xs text-slate-500">基于“发票专用方案”生成 (已自动同步预算预测数据)</p>
                    </div>
                </div>

                <div className="flex items-center gap-4">
                    <button onClick={() => setShowLogicPanel(!showLogicPanel)} className={`hidden md:flex items-center gap-1 text-xs px-3 py-1.5 rounded border transition-colors ${showLogicPanel ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-white text-slate-500 border-slate-200'}`}>
                        <Lightbulb size={14} className={showLogicPanel ? "fill-blue-100 text-blue-600" : ""} />
                        <span>数据逻辑分析</span>
                    </button>
                    <div className="flex items-center bg-white border border-slate-300 rounded-lg p-1 shadow-sm">
                        <button onClick={() => handleMonthChange(-1)} className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronLeft size={16}/></button>
                        <div className="px-4 font-bold text-slate-700 min-w-[100px] text-center">{selectedMonth}</div>
                        <button onClick={() => handleMonthChange(1)} className="p-1.5 hover:bg-slate-100 rounded text-slate-600"><ChevronRight size={16}/></button>
                    </div>
                </div>
            </div>

            {/* Logic Analysis Panel */}
            {showLogicPanel && (
                <div className="bg-blue-50/50 border-b border-blue-100 p-4 animate-in slide-in-from-top-2">
                    <div className="flex flex-col md:flex-row gap-6 text-sm">
                        <div className="flex-1 space-y-2">
                            <h4 className="font-bold text-blue-800 flex items-center gap-2"><HelpCircle size={16}/> 为什么发票金额与预算表不同？</h4>
                            <ul className="list-disc list-inside text-blue-700/80 space-y-1 text-xs">
                                <li><strong>预开票机制 (Pre-billing):</strong> 系统默认“提前1个月”开具发票。</li>
                                <li><strong>全量对齐:</strong> 当前视图已包含“预算方案”中的所有预测数据（如：待租去化、续签计划），以确保与预算表金额一致。</li>
                                <li>若记录显示 <span className="inline-flex items-center gap-0.5 bg-indigo-50 text-indigo-600 px-1 rounded font-bold"><Sparkles size={10}/> 预测</span> 标签，代表该笔收入源自预算假设（尚未正式签约）。</li>
                            </ul>
                        </div>
                        <div className="flex-shrink-0 bg-white border border-blue-200 rounded-xl p-3 shadow-sm min-w-[280px]">
                            <div className="text-xs text-slate-500 mb-2 font-medium text-center">当前数据对账关系</div>
                            <div className="flex items-center justify-between gap-2">
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-400 uppercase">发票视图</div>
                                    <div className="font-bold text-indigo-600 text-lg">{selectedMonth}</div>
                                </div>
                                <div className="flex flex-col items-center">
                                    <div className="text-[10px] text-slate-400">对应</div>
                                    <ArrowRight size={16} className="text-slate-300" />
                                </div>
                                <div className="text-center">
                                    <div className="text-[10px] text-slate-400 uppercase">预算/实收归属月</div>
                                    <div className="font-bold text-emerald-600 text-lg">{getBudgetMonth(selectedMonth)}</div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Dashboard Cards Section */}
            <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-4 bg-white border-b border-slate-100">
                {/* Card 1: Total Plan */}
                <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Layers size={48} className="text-indigo-600"/>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-indigo-500 uppercase tracking-wider mb-1">本月计划开票 (总计)</p>
                        <div className="flex items-baseline gap-2">
                            <h3 className="text-2xl font-bold text-slate-800">{formatCurrency(stats.totalAmt)}</h3>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="bg-white/60 px-2 py-1 rounded text-indigo-700 font-medium">{stats.totalCount} 笔账单</span>
                        <span className="text-indigo-400 font-medium">100%</span>
                    </div>
                </div>

                {/* Card 2: Invoiced */}
                <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <CheckCircle2 size={48} className="text-emerald-600"/>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider mb-1">已开票 (Completed)</p>
                        <div className="flex items-baseline gap-2">
                            <h3 className="text-2xl font-bold text-slate-800">{formatCurrency(stats.paidAmt)}</h3>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="bg-white/60 px-2 py-1 rounded text-emerald-700 font-medium">{stats.paidCount} 笔已开</span>
                        <span className="text-emerald-600 font-bold">
                            {formatPercent(stats.totalAmt > 0 ? (stats.paidAmt / stats.totalAmt) * 100 : 0)} 进度
                        </span>
                    </div>
                </div>

                {/* Card 3: Pending */}
                <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 flex flex-col justify-between shadow-sm relative overflow-hidden group">
                    <div className="absolute right-0 top-0 p-3 opacity-10 group-hover:opacity-20 transition-opacity">
                        <Clock size={48} className="text-amber-600"/>
                    </div>
                    <div>
                        <p className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-1">待开票 (Pending)</p>
                        <div className="flex items-baseline gap-2">
                            <h3 className="text-2xl font-bold text-amber-700">{formatCurrency(stats.pendingAmt)}</h3>
                        </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs">
                        <span className="bg-white/60 px-2 py-1 rounded text-amber-700 font-medium">{stats.pendingCount} 笔待处理</span>
                        <span className="text-amber-600/80 font-medium">剩余任务</span>
                    </div>
                </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-auto">
                {filteredInvoices.length > 0 ? (
                    <table className="w-full text-sm text-left">
                        <thead className="bg-slate-50 text-slate-500 font-medium sticky top-0 z-10 shadow-sm">
                            <tr>
                                <th className="px-6 py-3">客户名称</th>
                                <th className="px-6 py-3">关联楼宇</th>
                                <th className="px-6 py-3">预计开票金额</th>
                                <th className="px-6 py-3 text-blue-600 bg-blue-50/50">原计划应收日 (Budget)</th>
                                <th className="px-6 py-3 text-indigo-600 bg-indigo-50/50">当前计划开票日 (Invoice)</th>
                                <th className="px-6 py-3">状态</th>
                                <th className="px-6 py-3 text-right">操作</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {filteredInvoices.map(inv => {
                                // Fallback logic for finding tenant info since virtuals are merged
                                // Note: combinedInvoices logic generated 'potentialInvoices' which are derived from allTenants (including virtuals)
                                // We need to find the tenant object again to display Name/Building
                                const isVirt = isVirtual(inv.tenantId);
                                // For virtuals, we can find them in the virtual list generated inside useMemo, but we don't have access to it here.
                                // We can re-derive it or just search in 'tenants' (won't find virtuals)
                                // Better approach: InvoiceRecord only stores ID. 
                                // Let's use getVirtualTenants again or find from a memoized list if performance allows. 
                                // For simplicity and performance, we'll search 'tenants' first. If not found, it's virtual.
                                let tenant = tenants.find(t => t.id === inv.tenantId);
                                let isPlan = false;
                                
                                if (!tenant) {
                                    // It's a virtual tenant. We need to regenerate it to get the name/building
                                    // Re-calling getVirtualTenants here is a bit expensive but safe for now given small dataset
                                    const vts = getVirtualTenants(tenants, buildings, budgetAssumptions);
                                    tenant = vts.find(t => t.id === inv.tenantId);
                                    isPlan = true;
                                }

                                const building = buildings.find(b => b.id === tenant?.buildingId);
                                const isPending = inv.status === 'Pending';

                                return (
                                    <tr key={inv.id} className="hover:bg-slate-50 transition-colors group">
                                        <td className="px-6 py-4 font-medium text-slate-700">
                                            <div className="flex items-center gap-2">
                                                {tenant?.name || '未知客户'}
                                                {isPlan && <span className="bg-indigo-100 text-indigo-600 text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 border border-indigo-200"><Sparkles size={10}/> 预测</span>}
                                            </div>
                                        </td>
                                        <td className="px-6 py-4 text-slate-500">{building?.name || '-'}</td>
                                        <td className="px-6 py-4 font-mono font-bold text-slate-700">{formatCurrency(inv.amount)}</td>
                                        <td className="px-6 py-4 text-blue-600 font-medium text-xs bg-blue-50/30">{inv.billDate}</td>
                                        <td className="px-6 py-4 text-indigo-700 font-bold bg-indigo-50/30">{inv.targetInvoiceDate}</td>
                                        <td className="px-6 py-4">
                                            <span className={`px-2 py-1 rounded text-xs font-bold flex items-center gap-1 w-fit ${isPending ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                                                {isPending ? <AlertCircle size={12}/> : <CheckCircle2 size={12}/>}
                                                {isPending ? '待开票' : '已开票'}
                                            </span>
                                            {!isPending && inv.invoicedAt && <div className="text-[10px] text-slate-400 mt-1">{inv.invoicedAt.slice(0,10)}</div>}
                                        </td>
                                        <td className="px-6 py-4 text-right">
                                            <div className="flex justify-end gap-2">
                                                <button 
                                                    onClick={() => handleToggleStatus(inv)}
                                                    disabled={isPlan} // Disable confirming forecast items
                                                    title={isPlan ? "预测数据不可操作，请先签约" : ""}
                                                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                                                        isPlan 
                                                            ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' 
                                                            : isPending 
                                                                ? 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700' 
                                                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    {isPending ? '确认开票' : '恢复待开'}
                                                </button>
                                                <button 
                                                    onClick={() => handleOpenDefer(inv)}
                                                    disabled={isPlan}
                                                    className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${isPlan ? 'bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                                >
                                                    延期
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                        <FileText size={48} className="opacity-20 mb-4" />
                        <p>该月份无待开票计划</p>
                    </div>
                )}
            </div>

            {/* Defer Modal */}
            {isDeferModalOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6 animate-in zoom-in-50 duration-200">
                        <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2"><Clock size={20}/> 延期开票</h3>
                        <div className="space-y-4">
                            <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded">
                                当前计划日: {deferTarget?.targetInvoiceDate} <br/>
                                将该笔开票计划移动至：
                            </p>
                            <input 
                                type="date" 
                                className="w-full border p-2 rounded-lg"
                                value={deferDate}
                                onChange={e => setDeferDate(e.target.value)}
                            />
                            <div className="flex justify-end gap-2 pt-2">
                                <button onClick={() => setIsDeferModalOpen(false)} className="px-4 py-2 border rounded text-slate-600 hover:bg-slate-50">取消</button>
                                <button onClick={handleConfirmDefer} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">确认延期</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
