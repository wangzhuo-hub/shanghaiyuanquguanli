
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Tenant, BudgetAssumption, BudgetAdjustment, InvoiceRecord, Building, CloudConfig } from '../types';
import type { BudgetedBill } from '../services/billingService';
import { fetchCloudBudgetedBillsPreviewBatch } from '../services/cloudComputeClient';
import { resolveBudgetedBillPreviewBatchItems } from '../services/budgetedBillPreviewBatch';
import { shouldRunLocalBudgetedBillPreviewFallback } from '../services/computeFallbackPolicy';
import { getVirtualTenants } from '../services/virtualTenants';
import { Calendar, CheckCircle2, Clock, AlertCircle, ChevronLeft, ChevronRight, RefreshCw, FileText, Info, Layers, ArrowRight, HelpCircle, Lightbulb, Sparkles, X } from 'lucide-react';
import { formatCurrency, formatPercent } from '../services/numberFormat';

const InvoiceEmptyState: React.FC<{
    title: string;
    detail: string;
}> = ({ title, detail }) => (
    <div className="liquid-mobile-empty-state flex h-full min-h-[300px] flex-col items-center justify-center rounded-[24px] px-6 text-center">
        <div className="liquid-icon-well flex h-14 w-14 items-center justify-center rounded-[22px] text-blue-700">
            <FileText size={28} />
        </div>
        <p className="mt-4 text-base font-black text-slate-950">{title}</p>
        <p className="mt-2 max-w-md text-sm font-semibold leading-5 text-slate-500">{detail}</p>
    </div>
);

interface InvoiceManagerProps {
    tenants: Tenant[];
    buildings: Building[];
    budgetAssumptions: BudgetAssumption[];
    budgetAdjustments: BudgetAdjustment[];
    invoices: InvoiceRecord[];
    onUpdateInvoices: (invoices: InvoiceRecord[]) => void;
    cloudConfig?: CloudConfig;
    serverComputeEnabled?: boolean;
}

export const InvoiceManager: React.FC<InvoiceManagerProps> = ({
    tenants,
    buildings,
    budgetAssumptions,
    budgetAdjustments,
    invoices,
    onUpdateInvoices,
    cloudConfig,
    serverComputeEnabled = false,
}) => {
    const currentYear = new Date().getFullYear();
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM
    const [isDeferModalOpen, setIsDeferModalOpen] = useState(false);
    const [deferTarget, setDeferTarget] = useState<InvoiceRecord | null>(null);
    const [deferDate, setDeferDate] = useState('');
    const [showLogicPanel, setShowLogicPanel] = useState(true);
    const [tabletPreviewInvoiceId, setTabletPreviewInvoiceId] = useState<string | null>(null);
    const [serverBills, setServerBills] = useState<{
        loading: boolean;
        error?: string;
        items: Array<{ id: string; bills: BudgetedBill[] }> | null;
    }>({ loading: false, items: null });

    // Helper to calculate next month for Budget comparison
    const getBudgetMonth = (invMonth: string) => {
        const parts = invMonth.split('-');
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1 + 1, 1); // +1 Month
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    };

    const virtualTenants = useMemo(
        () => getVirtualTenants(tenants, buildings, budgetAssumptions),
        [tenants, buildings, budgetAssumptions],
    );
    const allTenantById = useMemo(() => {
        const map = new Map<string, Tenant>();
        [...tenants, ...virtualTenants].forEach((tenant) => map.set(tenant.id, tenant));
        return map;
    }, [tenants, virtualTenants]);
    const buildingById = useMemo(() => new Map(buildings.map((building) => [building.id, building] as const)), [buildings]);
    const invoiceById = useMemo(() => new Map(invoices.map(inv => [inv.id, inv])), [invoices]);
    const previewRange = useMemo(() => ({
        startDate: new Date(currentYear - 1, 0, 1),
        endDate: new Date(currentYear + 1, 11, 31),
    }), [currentYear]);

    const billableTenants = useMemo(() => {
        const selfUseUnitIds = new Set<string>();
        buildings.forEach(b => b.units.forEach(u => { if (u.isSelfUse) selfUseUnitIds.add(u.id); }));
        return [...tenants, ...virtualTenants].filter((tenant) => {
            if (tenant.status === 'Terminated' && !tenant.id.startsWith('virt_')) return false;
            if (tenant.unitIds.some(uid => selfUseUnitIds.has(uid))) return false;
            return !tenant.isSpecialBusiness;
        });
    }, [tenants, virtualTenants, buildings]);

    const buildPotentialInvoices = useCallback((billItems: Array<{ id: string; bills: BudgetedBill[] }>): InvoiceRecord[] => {
        const potentialInvoices: InvoiceRecord[] = [];
        billItems.forEach(({ id, bills }) => {
            const tenant = allTenantById.get(id);
            if (!tenant) return;
            bills.forEach(bill => {
                const targetInvoiceDateObj = new Date(bill.date);
                targetInvoiceDateObj.setMonth(targetInvoiceDateObj.getMonth() - 1);
                const defaultTargetDateStr = targetInvoiceDateObj.toISOString().split('T')[0];
                const billDateStr = bill.date.toISOString().split('T')[0];
                const invoiceId = `inv_${tenant.id}_${billDateStr}`;
                const existingRecord = invoiceById.get(invoiceId);

                if (existingRecord) {
                    potentialInvoices.push({
                        ...existingRecord,
                        billDate: billDateStr // Ensure billDate is always fresh from calculation
                    });
                } else {
                    // Create a potential record
                    potentialInvoices.push({
                        id: invoiceId,
                        tenantId: tenant.id,
                        billDate: billDateStr,
                        targetInvoiceDate: defaultTargetDateStr,
                        amount: bill.amount,
                        status: 'Pending'
                    });
                }
            });
        });
        return potentialInvoices;
    }, [allTenantById, invoiceById]);

    useEffect(() => {
        if (billableTenants.length === 0) {
            setServerBills({ loading: false, items: [] });
            return;
        }
        const canUseServer = serverComputeEnabled && !!cloudConfig?.projectId;
        let cancelled = false;
        if (!canUseServer || !cloudConfig) {
            if (!shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: false })) {
                setServerBills({
                    loading: false,
                    items: null,
                    error: '后台批量账单预览计算不可用，未执行前端本地批量计算',
                });
                return;
            }
            setServerBills({ loading: true, items: null });
            import('../services/billingService')
                .then(({ generateBudgetedBills }) => {
                    if (cancelled) return;
                    const items = billableTenants.map((tenant) => ({
                        id: tenant.id,
                        bills: generateBudgetedBills(
                            tenant,
                            budgetAssumptions,
                            budgetAdjustments,
                            previewRange.startDate,
                            previewRange.endDate,
                        ),
                    }));
                    setServerBills({ loading: false, items });
                })
                .catch((error: unknown) => {
                    if (!cancelled) {
                        setServerBills({
                            loading: false,
                            items: null,
                            error: error instanceof Error ? error.message : '本地账单生成模块加载失败',
                        });
                    }
                });
            return () => {
                cancelled = true;
            };
        }

        setServerBills({ loading: true, items: null });
        const requestItems = billableTenants.map((tenant) => ({
            id: tenant.id,
            tenant,
            assumptions: budgetAssumptions,
            adjustments: budgetAdjustments,
            startDate: previewRange.startDate,
            endDate: previewRange.endDate,
        }));
        fetchCloudBudgetedBillsPreviewBatch(cloudConfig, {
            items: requestItems,
        }).then((result) => {
            if (cancelled) return;
            const previewItems = resolveBudgetedBillPreviewBatchItems(
                result,
                requestItems.map((item) => item.id),
            );
            if (previewItems.ok) {
                setServerBills({
                    loading: false,
                    items: previewItems.items,
                });
                return;
            }
            setServerBills({ loading: false, items: null, error: previewItems.message || '后台批量账单预览计算失败，未执行前端本地批量计算' });
        }).catch((error: unknown) => {
            if (!cancelled) {
                setServerBills({
                    loading: false,
                    items: null,
                    error: error instanceof Error ? error.message : '后台批量账单预览计算失败，未执行前端本地批量计算',
                });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        billableTenants,
        budgetAdjustments,
        budgetAssumptions,
        cloudConfig,
        previewRange,
        serverComputeEnabled,
    ]);

    // 1. Calculate Combined Invoices (Budgeted Potential + Existing Records)
    const combinedInvoices = useMemo(() => {
        if (serverBills.loading) return [];
        if (serverBills.items) return buildPotentialInvoices(serverBills.items);
        return [];
    }, [buildPotentialInvoices, serverBills]);

    // 2. Filter by Selected Month
    const filteredInvoices = useMemo(() => {
        return combinedInvoices.filter(inv => inv.targetInvoiceDate.startsWith(selectedMonth));
    }, [combinedInvoices, selectedMonth]);
    const tabletPreviewInvoice = useMemo(() => {
        if (filteredInvoices.length === 0) return null;
        return filteredInvoices.find(inv => inv.id === tabletPreviewInvoiceId) || filteredInvoices[0];
    }, [filteredInvoices, tabletPreviewInvoiceId]);

    useEffect(() => {
        if (filteredInvoices.length === 0) {
            if (tabletPreviewInvoiceId !== null) setTabletPreviewInvoiceId(null);
            return;
        }
        if (!tabletPreviewInvoiceId || !filteredInvoices.some(inv => inv.id === tabletPreviewInvoiceId)) {
            setTabletPreviewInvoiceId(filteredInvoices[0].id);
        }
    }, [filteredInvoices, tabletPreviewInvoiceId]);

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

    const closeDeferModal = useCallback(() => {
        setIsDeferModalOpen(false);
        setDeferTarget(null);
    }, []);

    useEffect(() => {
        if (!isDeferModalOpen) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') closeDeferModal();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [closeDeferModal, isDeferModalOpen]);

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
        closeDeferModal();
    };

    const handleMonthChange = (offset: number) => {
        const parts = selectedMonth.split('-');
        const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1 + offset, 1);
        setSelectedMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    };

    // Helper to identify virtual tenants
    const isVirtual = (id: string) => id.startsWith('virt_');

    const renderInvoiceTabletPreview = () => {
        const invoice = tabletPreviewInvoice;
        if (!invoice) {
            return (
                <aside className="liquid-invoice-tablet-preview rounded-[26px] p-5 text-center">
                    <div className="liquid-icon-well mx-auto flex h-12 w-12 items-center justify-center rounded-[20px] text-blue-700">
                        <FileText size={22} />
                    </div>
                    <div className="mt-3 text-sm font-black text-slate-800">选择一笔开票计划</div>
                    <p className="mx-auto mt-1 max-w-[14rem] text-xs font-semibold leading-5 text-slate-500">
                        平板下可在左侧浏览计划，右侧快速核对金额、日期和状态。
                    </p>
                </aside>
            );
        }

        const tenant = allTenantById.get(invoice.tenantId);
        const building = tenant ? buildingById.get(tenant.buildingId) : undefined;
        const isPlan = isVirtual(invoice.tenantId);
        const isPending = invoice.status === 'Pending';
        return (
            <aside className="liquid-invoice-tablet-preview rounded-[26px] p-4">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="text-xs font-black text-slate-500">开票计划预览 · {selectedMonth}</div>
                        <h3 className="mt-1 break-anywhere text-lg font-black leading-tight text-slate-950">
                            {tenant?.name || '未知客户'}
                        </h3>
                        <p className="mt-1 text-xs font-semibold text-slate-500">{building?.name || '未关联楼宇'}</p>
                    </div>
                    <span className={`liquid-invoice-tablet-status inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${isPending ? 'text-amber-700' : 'text-blue-700'}`}>
                        {isPending ? <AlertCircle size={12} /> : <CheckCircle2 size={12} />}
                        {isPending ? '待开票' : '已开票'}
                    </span>
                </div>

                {isPlan && (
                    <div className="liquid-invoice-tablet-row mt-3 rounded-2xl px-3 py-2 text-xs font-semibold text-slate-600">
                        <Sparkles size={13} className="shrink-0 text-amber-600" />
                        <span>预测收入源，签约前不可确认或延期。</span>
                    </div>
                )}

                <div className="mt-4 text-3xl font-black tabular-nums text-slate-950">
                    {formatCurrency(invoice.amount)}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2">
                    <div className="liquid-invoice-tablet-metric rounded-2xl px-3 py-2">
                        <div className="text-xs font-black text-slate-500">原计划应收日</div>
                        <div className="mt-1 text-sm font-black tabular-nums text-blue-700">{invoice.billDate}</div>
                    </div>
                    <div className="liquid-invoice-tablet-metric rounded-2xl px-3 py-2">
                        <div className="text-xs font-black text-slate-500">计划开票日</div>
                        <div className="mt-1 text-sm font-black tabular-nums text-cyan-700">{invoice.targetInvoiceDate}</div>
                    </div>
                    <div className="liquid-invoice-tablet-metric rounded-2xl px-3 py-2">
                        <div className="text-xs font-black text-slate-500">发票视图</div>
                        <div className="mt-1 text-sm font-black tabular-nums text-slate-950">{selectedMonth}</div>
                    </div>
                    <div className="liquid-invoice-tablet-metric rounded-2xl px-3 py-2">
                        <div className="text-xs font-black text-slate-500">预算归属月</div>
                        <div className="mt-1 text-sm font-black tabular-nums text-cyan-700">{getBudgetMonth(selectedMonth)}</div>
                    </div>
                </div>

                {!isPending && invoice.invoicedAt && (
                    <div className="liquid-invoice-tablet-row mt-3 rounded-2xl px-3 py-2 text-xs font-semibold text-slate-600">
                        <CheckCircle2 size={13} className="shrink-0 text-blue-700" />
                        <span>开票时间</span>
                        <span className="ml-auto font-black tabular-nums text-slate-900">{invoice.invoicedAt.slice(0, 10)}</span>
                    </div>
                )}

                {invoice.deferReason && (
                    <div className="liquid-invoice-tablet-row mt-3 rounded-2xl px-3 py-2 text-xs font-semibold text-slate-600">
                        <Clock size={13} className="shrink-0 text-amber-600" />
                        <span>已调整计划日</span>
                    </div>
                )}

                <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                        type="button"
                        onClick={() => handleToggleStatus(invoice)}
                        disabled={isPlan}
                        className={`liquid-pressable min-h-10 rounded-full px-3 text-sm font-black ${
                            isPlan
                                ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                : isPending
                                    ? 'liquid-invoice-row-action-strong'
                                    : 'liquid-invoice-row-action'
                        }`}
                    >
                        {isPending ? '确认开票' : '恢复待开'}
                    </button>
                    <button
                        type="button"
                        onClick={() => handleOpenDefer(invoice)}
                        disabled={isPlan}
                        className={`liquid-pressable min-h-10 rounded-full px-3 text-sm font-black ${
                            isPlan
                                ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                : 'liquid-invoice-row-action'
                        }`}
                    >
                        延期
                    </button>
                </div>
            </aside>
        );
    };

    return (
        <div className="liquid-invoice-shell flex h-full flex-col overflow-hidden rounded-[30px] animate-in fade-in zoom-in-50 duration-300">
            <div className="flex flex-col gap-4 border-b border-white/65 px-4 py-4 md:flex-row md:items-center md:justify-between md:px-6">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="liquid-action-strong inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                        <FileText size={21} />
                    </div>
                    <div className="min-w-0">
                        <h3 className="truncate text-xl font-black tracking-normal text-slate-950">租金发票管理</h3>
                        <p className="mt-1 text-xs font-semibold text-slate-500">
                            基于发票专用方案生成，预测数据与预算方案保持同源。
                        </p>
                    </div>
                </div>

                <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center md:w-auto">
                    <button
                        type="button"
                        onClick={() => setShowLogicPanel(!showLogicPanel)}
                        className={`liquid-glass-control liquid-pressable inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-xs font-bold transition ${
                            showLogicPanel ? 'text-blue-700 ring-1 ring-blue-200/80' : 'text-slate-600'
                        }`}
                    >
                        <Lightbulb size={14} className={showLogicPanel ? 'fill-blue-100 text-blue-600' : 'text-slate-500'} />
                        数据逻辑
                    </button>
                    <div className="liquid-glass-readable flex items-center justify-between rounded-full p-1">
                        <button
                            type="button"
                            onClick={() => handleMonthChange(-1)}
                            className="liquid-pressable rounded-full p-2 text-slate-500 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                            aria-label="上一月"
                        >
                            <ChevronLeft size={16}/>
                        </button>
                        <div className="flex min-w-[116px] items-center justify-center gap-1.5 px-3 text-sm font-black tabular-nums text-slate-900">
                            <Calendar size={14} className="text-blue-600" />
                            {selectedMonth}
                        </div>
                        <button
                            type="button"
                            onClick={() => handleMonthChange(1)}
                            className="liquid-pressable rounded-full p-2 text-slate-500 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                            aria-label="下一月"
                        >
                            <ChevronRight size={16}/>
                        </button>
                    </div>
                </div>
            </div>

            {showLogicPanel && (
                <div className="px-4 pt-4 md:px-6">
                    <div className="liquid-invoice-logic rounded-[24px] px-4 py-4 animate-in slide-in-from-top-2">
                        <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
                            <div className="min-w-0">
                                <h4 className="flex items-center gap-2 text-sm font-black text-slate-900">
                                    <HelpCircle size={16} className="text-blue-600"/>
                                    为什么发票金额与预算表不同？
                                </h4>
                                <div className="mt-2 grid gap-2 text-xs font-semibold leading-5 text-slate-600 sm:grid-cols-3">
                                    <div className="liquid-invoice-soft-cell rounded-2xl px-3 py-2">
                                        <span className="font-black text-blue-700">提前 1 个月</span>
                                        <span className="block">应收日自动前推为开票计划日。</span>
                                    </div>
                                    <div className="liquid-invoice-soft-cell rounded-2xl px-3 py-2">
                                        <span className="font-black text-cyan-700">全量方案</span>
                                        <span className="block">含待租去化、续签计划等预算预测。</span>
                                    </div>
                                    <div className="liquid-invoice-soft-cell rounded-2xl px-3 py-2">
                                        <span className="font-black text-slate-800">预测标记</span>
                                        <span className="block">未正式签约的虚拟收入源不可操作。</span>
                                    </div>
                                </div>
                            </div>
                            <div className="liquid-glass-readable rounded-[20px] px-4 py-3">
                                <div className="mb-2 flex items-center gap-1.5 text-xs font-black text-slate-500">
                                    <Info size={13} className="text-blue-600" />
                                    当前对账关系
                                </div>
                                <div className="flex items-center justify-between gap-3">
                                    <div className="text-center">
                                        <div className="text-xs font-bold uppercase text-slate-500">发票视图</div>
                                        <div className="mt-0.5 text-lg font-black tabular-nums text-blue-700">{selectedMonth}</div>
                                    </div>
                                    <ArrowRight size={18} className="text-slate-300" />
                                    <div className="text-center">
                                        <div className="text-xs font-bold uppercase text-slate-500">预算归属月</div>
                                        <div className="mt-0.5 text-lg font-black tabular-nums text-cyan-700">{getBudgetMonth(selectedMonth)}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="grid gap-3 px-4 py-4 md:grid-cols-3 md:px-6">
                <div className="liquid-invoice-card relative overflow-hidden rounded-[22px] px-4 py-4">
                    <Layers size={52} className="pointer-events-none absolute -right-2 -top-2 text-blue-200/55" />
                    <p className="text-xs font-black text-slate-500">本月计划开票</p>
                    <div className="mt-2 text-2xl font-black tabular-nums text-slate-950">{formatCurrency(stats.totalAmt)}</div>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold">
                        <span className="liquid-invoice-pill rounded-full px-2.5 py-1 text-blue-700">{stats.totalCount} 笔账单</span>
                        <span className="text-slate-400">100%</span>
                    </div>
                </div>

                <div className="liquid-invoice-card relative overflow-hidden rounded-[22px] px-4 py-4">
                    <CheckCircle2 size={52} className="pointer-events-none absolute -right-2 -top-2 text-cyan-200/65" />
                    <p className="text-xs font-black text-slate-500">已开票</p>
                    <div className="mt-2 text-2xl font-black tabular-nums text-blue-700">{formatCurrency(stats.paidAmt)}</div>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold">
                        <span className="liquid-invoice-pill rounded-full px-2.5 py-1 text-cyan-700">{stats.paidCount} 笔已开</span>
                        <span className="text-blue-700">
                            {formatPercent(stats.totalAmt > 0 ? (stats.paidAmt / stats.totalAmt) * 100 : 0)} 进度
                        </span>
                    </div>
                </div>

                <div className="liquid-invoice-card relative overflow-hidden rounded-[22px] px-4 py-4">
                    <Clock size={52} className="pointer-events-none absolute -right-2 -top-2 text-amber-200/75" />
                    <p className="text-xs font-black text-slate-500">待开票</p>
                    <div className="mt-2 text-2xl font-black tabular-nums text-amber-700">{formatCurrency(stats.pendingAmt)}</div>
                    <div className="mt-3 flex items-center justify-between text-xs font-bold">
                        <span className="liquid-invoice-pill rounded-full px-2.5 py-1 text-amber-700">{stats.pendingCount} 笔待处理</span>
                        <span className="text-amber-600">剩余任务</span>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-auto px-4 pb-4 md:px-6 md:pb-6">
                {serverBills.loading ? (
                    <div className="liquid-glass-readable flex h-full min-h-[300px] flex-col items-center justify-center rounded-[24px] text-slate-500">
                        <RefreshCw size={36} className="mb-4 animate-spin text-blue-500/60" />
                        <p className="font-bold">后台正在计算开票计划...</p>
                    </div>
                ) : serverBills.error ? (
                    <div className="liquid-glass-readable flex h-full min-h-[300px] flex-col items-center justify-center rounded-[24px] px-6 text-center text-slate-500">
                        <AlertCircle size={36} className="mb-4 text-amber-500" />
                        <p className="font-black text-slate-800">开票计划暂不可用</p>
                        <p className="mt-2 max-w-md text-xs font-semibold leading-5">{serverBills.error}</p>
                    </div>
                ) : filteredInvoices.length > 0 ? (
                    <>
                        <div className="liquid-invoice-table hidden overflow-hidden rounded-[24px] lg:block">
                            <table className="w-full min-w-[940px] border-separate border-spacing-0 text-left text-sm">
                                <thead className="text-xs font-black text-slate-600">
                                    <tr>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5">客户名称</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5">关联楼宇</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5 text-right">预计开票金额</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5 text-blue-700">原计划应收日</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5 text-cyan-700">当前计划开票日</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5">状态</th>
                                        <th className="liquid-invoice-sticky sticky top-0 z-10 px-6 py-3.5 text-right">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {filteredInvoices.map(inv => {
                                        const isVirt = isVirtual(inv.tenantId);
                                        const tenant = allTenantById.get(inv.tenantId);
                                        const isPlan = isVirt;
                                        const building = tenant ? buildingById.get(tenant.buildingId) : undefined;
                                        const isPending = inv.status === 'Pending';

                                        return (
                                            <tr key={inv.id} className="liquid-invoice-table-row group transition-colors">
                                                <td className="liquid-invoice-table-cell px-6 py-4 font-bold text-slate-800">
                                                    <div className="flex min-w-0 items-center gap-2">
                                                        <span className="truncate">{tenant?.name || '未知客户'}</span>
                                                        {isPlan && (
                                                            <span className="liquid-invoice-plan-pill inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-black">
                                                                <Sparkles size={10}/> 预测
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="liquid-invoice-table-cell px-6 py-4 font-semibold text-slate-500">{building?.name || '-'}</td>
                                                <td className="liquid-invoice-table-cell px-6 py-4 text-right font-mono font-black text-slate-900">{formatCurrency(inv.amount)}</td>
                                                <td className="liquid-invoice-table-cell px-6 py-4 text-xs font-black tabular-nums text-blue-700">{inv.billDate}</td>
                                                <td className="liquid-invoice-table-cell px-6 py-4 font-black tabular-nums text-cyan-700">{inv.targetInvoiceDate}</td>
                                                <td className="liquid-invoice-table-cell px-6 py-4">
                                                    <span className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${isPending ? 'liquid-invoice-status-pending' : 'liquid-invoice-status-done'}`}>
                                                        {isPending ? <AlertCircle size={12}/> : <CheckCircle2 size={12}/>}
                                                        {isPending ? '待开票' : '已开票'}
                                                    </span>
                                                    {!isPending && inv.invoicedAt && <div className="mt-1 text-xs font-semibold text-slate-500">{inv.invoicedAt.slice(0,10)}</div>}
                                                </td>
                                                <td className="liquid-invoice-table-cell px-6 py-4 text-right">
                                                    <div className="flex justify-end gap-2">
                                                        <button
                                                            type="button"
                                                            onClick={() => handleToggleStatus(inv)}
                                                            disabled={isPlan}
                                                            title={isPlan ? '预测数据不可操作，请先签约' : ''}
                                                            className={`liquid-pressable rounded-full px-3 py-1.5 text-xs font-bold transition ${
                                                                isPlan
                                                                    ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                                                : isPending
                                                                        ? 'liquid-invoice-row-action-strong'
                                                                        : 'liquid-invoice-row-action'
                                                            }`}
                                                        >
                                                            {isPending ? '确认开票' : '恢复待开'}
                                                        </button>
                                                        <button
                                                            type="button"
                                                            onClick={() => handleOpenDefer(inv)}
                                                            disabled={isPlan}
                                                            className={`liquid-pressable rounded-full px-3 py-1.5 text-xs font-bold transition ${
                                                                isPlan
                                                                    ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                                                    : 'liquid-invoice-row-action'
                                                            }`}
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
                        </div>

                        <div className="liquid-invoice-mobile-list liquid-invoice-mobile-list--master-detail lg:hidden">
                            <div className="liquid-invoice-tablet-master-detail">
                                <div className="liquid-invoice-tablet-list min-w-0 space-y-3">
                            {filteredInvoices.map(inv => {
                                const isVirt = isVirtual(inv.tenantId);
                                const tenant = allTenantById.get(inv.tenantId);
                                const isPlan = isVirt;
                                const building = tenant ? buildingById.get(tenant.buildingId) : undefined;
                                const isPending = inv.status === 'Pending';

                                return (
                                    <article
                                        key={inv.id}
                                        data-selected={tabletPreviewInvoice?.id === inv.id ? 'true' : 'false'}
                                        onClick={(event) => {
                                            const target = event.target as HTMLElement;
                                            if (target.closest('button, a, input, select, textarea')) return;
                                            setTabletPreviewInvoiceId(inv.id);
                                        }}
                                        className="liquid-invoice-mobile-card mobile-card-enter rounded-[22px] p-4"
                                    >
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <h4 className="truncate text-sm font-black text-slate-950">{tenant?.name || '未知客户'}</h4>
                                                    {isPlan && (
                                                        <span className="liquid-invoice-plan-pill inline-flex shrink-0 items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-black">
                                                            <Sparkles size={10}/> 预测
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="mt-1 text-xs font-semibold text-slate-500">{building?.name || '未关联楼宇'}</p>
                                            </div>
                                            <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-black ${isPending ? 'liquid-invoice-status-pending' : 'liquid-invoice-status-done'}`}>
                                                {isPending ? <AlertCircle size={12}/> : <CheckCircle2 size={12}/>}
                                                {isPending ? '待开' : '已开'}
                                            </span>
                                        </div>
                                        <div className="mt-4 text-2xl font-black tabular-nums text-slate-950">{formatCurrency(inv.amount)}</div>
                                        <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                                            <div className="liquid-invoice-mobile-date rounded-2xl px-3 py-2">
                                                <div className="font-black text-slate-500">原计划应收日</div>
                                                <div className="mt-1 font-black tabular-nums text-blue-700">{inv.billDate}</div>
                                            </div>
                                            <div className="liquid-invoice-mobile-date rounded-2xl px-3 py-2">
                                                <div className="font-black text-slate-500">计划开票日</div>
                                                <div className="mt-1 font-black tabular-nums text-cyan-700">{inv.targetInvoiceDate}</div>
                                            </div>
                                        </div>
                                        {!isPending && inv.invoicedAt && (
                                            <div className="mt-2 text-xs font-semibold text-slate-500">开票时间：{inv.invoicedAt.slice(0,10)}</div>
                                        )}
                                        <div className="mt-4 grid grid-cols-2 gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setTabletPreviewInvoiceId(inv.id)}
                                                className="liquid-pressable hidden rounded-full px-3 py-2 text-xs font-black text-slate-600 hover:bg-white/80 sm:inline-flex lg:hidden"
                                            >
                                                预览
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleToggleStatus(inv)}
                                                disabled={isPlan}
                                                className={`liquid-pressable rounded-full px-3 py-2 text-xs font-black ${
                                                    isPlan
                                                        ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                                        : isPending
                                                            ? 'liquid-invoice-row-action-strong'
                                                            : 'liquid-invoice-row-action'
                                                }`}
                                            >
                                                {isPending ? '确认开票' : '恢复待开'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleOpenDefer(inv)}
                                                disabled={isPlan}
                                                className={`liquid-pressable rounded-full px-3 py-2 text-xs font-black ${
                                                    isPlan
                                                        ? 'liquid-invoice-disabled-action cursor-not-allowed'
                                                        : 'liquid-invoice-row-action'
                                                }`}
                                            >
                                                延期
                                            </button>
                                        </div>
                                    </article>
                                );
                            })}
                                </div>
                                <div className="hidden sm:block lg:hidden">
                                    {renderInvoiceTabletPreview()}
                                </div>
                            </div>
                        </div>
                    </>
                ) : (
                    <InvoiceEmptyState
                        title="该月份无待开票计划"
                        detail={`${selectedMonth} 没有匹配的待开票或已开票记录，切换月份后会重新按同一开票口径展示。`}
                    />
                )}
            </div>

            {isDeferModalOpen && (
                <div className="liquid-elevated-backdrop fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" onClick={closeDeferModal}>
                    <section
                        role="dialog"
                        aria-modal="true"
                        aria-labelledby="invoice-defer-modal-title"
                        className="liquid-invoice-defer-panel w-full max-w-sm overflow-hidden rounded-t-[28px] animate-in slide-in-from-bottom-4 zoom-in-95 duration-200 sm:rounded-[26px] sm:slide-in-from-bottom-0"
                        onClick={(event) => event.stopPropagation()}
                    >
                        <div className="liquid-elevated-header flex items-center justify-between gap-3 px-5 py-4">
                            <h3 id="invoice-defer-modal-title" className="flex items-center gap-2 text-lg font-black text-slate-950">
                                <Clock size={20} className="text-blue-600"/> 延期开票
                            </h3>
                            <button
                                type="button"
                                aria-label="关闭延期开票弹层"
                                onClick={closeDeferModal}
                                className="liquid-invoice-row-action liquid-pressable flex h-9 w-9 items-center justify-center rounded-full text-slate-500 hover:text-slate-900"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-4 px-5 py-5">
                            <div className="liquid-invoice-defer-note rounded-[18px] px-4 py-3 text-sm font-semibold text-slate-600">
                                当前计划日：<span className="font-black text-slate-900">{deferTarget?.targetInvoiceDate}</span>
                                <br/>
                                将该笔开票计划移动至：
                            </div>
                            <input
                                type="date"
                                className="liquid-invoice-defer-field w-full rounded-2xl px-3 py-2.5 text-sm font-semibold text-slate-900 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80"
                                value={deferDate}
                                onChange={e => setDeferDate(e.target.value)}
                            />
                        </div>
                        <div className="liquid-elevated-footer grid grid-cols-2 gap-2 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:flex sm:justify-end sm:pb-4">
                            <button
                                type="button"
                                onClick={closeDeferModal}
                                className="liquid-invoice-row-action liquid-pressable rounded-full px-4 py-2 text-sm font-bold"
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmDefer}
                                className="liquid-invoice-row-action-strong liquid-pressable rounded-full px-4 py-2 text-sm font-black"
                            >
                                确认延期
                            </button>
                        </div>
                    </section>
                </div>
            )}
        </div>
    );
};
