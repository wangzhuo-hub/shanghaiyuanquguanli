
import React, { useRef, useState, useMemo, useEffect } from 'react';
import { Building, Tenant, Unit, BudgetAssumption, ContractStatus, UnitStatus, DepositStatus, BudgetAdjustment, BudgetAnalysisData, PaymentRecord, BudgetScenario, RentFreePeriod, MonthlyInitData, DashboardData, CloudConfig } from '../types';
import { Calculator, DollarSign, TrendingUp, Save, Table, LayoutList, ChevronRight, ChevronDown, ChevronLeft, Download, Upload, ShieldAlert, ArrowRight, Maximize2, Minimize2, LineChart as LineChartIcon, Lightbulb, Edit3, X, Sparkles, PieChart, Activity, RotateCcw, TrendingDown, ArrowUpRight, ArrowDownRight, ArrowLeftRight, History, FileText, Info, FileWarning, Layers, Building as BuildingIcon, CheckCircle2, Copy, CloudUpload, Play, Trash2, Plus, Check, FileSpreadsheet, ArrowUpDown, List, AlertCircle, User, Briefcase, CheckCircle } from 'lucide-react';
import { createBudgetedBillCache, type BillGenerationCache } from '../services/billGenerationCache';
import type { BudgetedBill } from '../services/billingService';
import { fetchCloudBudgetedBillsPreviewBatch, fetchCloudContractReceivableMonthly } from '../services/cloudComputeClient';
import { formatArea, formatCurrency, formatNumber, formatPercent, formatWan } from '../services/numberFormat';
import {
    mergeBudgetTotalsIntoInitData,
    readImportedBudgetTable,
    writeImportedBudgetTable,
    clearImportedBudgetTable,
    updateImportedBudgetTableRowMonth,
    importedBudgetRowKey,
    normalizeBudgetRowKeyPart,
    readBudgetCustomerNameLinks,
    type BudgetTableSnapshot,
} from '../services/budgetTableImport';
import type { ParsedBudgetTable } from '../services/budgetTableExcelParser';
import { receivableBudgetMonthForBill } from '../services/receivableListHelpers';
import {
    buildBudgetActualRentCollectionIndex,
    sumBudgetActualRentCollectionForTenantPeriod,
} from '../services/budgetActualRentCollection';
import {
    buildReceivableContextForScenario,
    normalizeScenarioForReceivable,
} from '../services/dashboardMetricHelpers';
import { collectionIdentityKey, objectIdentityKey } from '../services/requestIdentityKey';
import { cloneBudgetScenarioSnapshot } from '../services/budgetScenarioSnapshot';
import { createBudgetAmountDeltaAdjustment } from '../services/budgetMobileAdjustment';
import {
    resolveBudgetMonthlyBillsForKey,
    shouldBuildBudgetMonthlyComputeRequest,
    shouldBuildBudgetMonthlyDetailRows,
    shouldRunBudgetMonthlyLocalFallback,
    validateBudgetMonthlyServerPayload,
    type BudgetMonthlyServerData,
} from '../services/budgetMonthlyServerHelpers';
import {
    monthOverlapsRentFree,
    formatYearRentFreeSummary,
    compareUnitNameNumeric,
    tenantUnitsResolved,
    tenantMergedRoomLabels,
    paymentCycleLabelMap,
    paymentCycleLabel,
} from '../services/sharedUtils';

const ContractSummaryModal = React.lazy(() =>
    import('./ContractSummaryModal').then((m) => ({ default: m.ContractSummaryModal }))
);

const budgetInputClass = 'liquid-glass-readable w-full rounded-xl px-3 py-2 text-sm font-semibold outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80';
const budgetCompactInputClass = 'liquid-budget-field w-full rounded-xl px-2 py-1 text-sm outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80';
const budgetGhostButtonClass = 'liquid-glass-control liquid-pressable inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold text-slate-700 disabled:cursor-not-allowed disabled:opacity-45';
const budgetSegmentActiveClass = 'liquid-nav-active text-blue-800';
const budgetSegmentIdleClass = 'text-slate-500 hover:text-blue-700';

type BudgetPromptTone = 'blue' | 'cyan' | 'amber' | 'rose' | 'slate';

type BudgetPromptState = {
    kind: 'notice' | 'confirm';
    title: string;
    message?: string;
    tone?: BudgetPromptTone;
    confirmText?: string;
    cancelText?: string;
    resolve?: (result?: boolean) => void;
};

type MobileBudgetAmountAdjustTarget = {
    row: any;
    monthIndex: number;
    currentBudget: number;
    mode: 'amount_delta' | 'imported_month';
};

const budgetPromptToneClass = (tone: BudgetPromptTone = 'blue'): string => {
    switch (tone) {
        case 'cyan':
            return 'border-cyan-200/80 bg-cyan-50/78 text-cyan-800';
        case 'amber':
            return 'border-amber-200/80 bg-amber-50/82 text-amber-900';
        case 'rose':
            return 'border-rose-200/80 bg-rose-50/82 text-rose-800';
        case 'slate':
            return 'border-slate-200/80 bg-white/82 text-slate-700';
        default:
            return 'border-blue-200/80 bg-blue-50/78 text-blue-800';
    }
};

const BudgetPromptOverlay: React.FC<{
    prompt: BudgetPromptState;
    onClose: (result?: boolean) => void;
}> = ({ prompt, onClose }) => {
    const toneClass = budgetPromptToneClass(prompt.tone || 'blue');
    return (
        <div className="monthly-detail-backdrop fixed inset-0 z-[90] flex items-end justify-center p-0 md:items-center md:p-4">
            <section
                role="dialog"
                aria-modal="true"
                aria-label={prompt.title}
                className="monthly-detail-panel liquid-glass-panel flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
            >
                <div className="flex items-start justify-between gap-3 border-b border-white/70 px-5 py-4">
                    <div className="flex min-w-0 items-start gap-3">
                        <span className={`liquid-glass-readable inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border ${toneClass}`}>
                            <AlertCircle size={18} />
                        </span>
                        <div className="min-w-0">
                            <h3 className="text-base font-black text-slate-950">{prompt.title}</h3>
                            <p className="mt-0.5 text-xs font-semibold text-slate-500">
                                {prompt.kind === 'confirm' ? '请确认后继续' : '系统提示'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => onClose(prompt.kind === 'confirm' ? false : true)}
                        className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:bg-white/75 hover:text-slate-900"
                        aria-label="关闭提示"
                    >
                        <X size={18} />
                    </button>
                </div>
                {prompt.message ? (
                    <div className="px-5 py-4">
                        <div className={`liquid-glass-readable max-h-[52vh] overflow-auto whitespace-pre-line rounded-2xl border px-4 py-3 text-sm font-semibold leading-relaxed ${toneClass}`}>
                            {prompt.message}
                        </div>
                    </div>
                ) : null}
                <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:flex md:justify-end md:pb-4">
                    {prompt.kind === 'confirm' ? (
                        <button type="button" onClick={() => onClose(false)} className={budgetGhostButtonClass}>
                            {prompt.cancelText || '取消'}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        onClick={() => onClose(true)}
                        className={`${prompt.kind === 'confirm' ? '' : 'col-span-2 '}liquid-action-strong liquid-pressable rounded-full px-5 py-2.5 text-sm font-black text-white`}
                    >
                        {prompt.confirmText || (prompt.kind === 'confirm' ? '确认' : '知道了')}
                    </button>
                </div>
            </section>
        </div>
    );
};

const BudgetRowDetailSheet: React.FC<{
    row: any;
    detailYear: number;
    viewMode: 'Monthly' | 'Execution';
    canEditAmount?: boolean;
    editMode?: 'amount_delta' | 'imported_month';
    editDisabledReason?: string;
    onClose: () => void;
    onOpenContractSummary: () => void;
    onEditMonth?: (monthIndex: number, currentBudget: number) => void;
}> = ({ row, detailYear, viewMode, canEditAmount = false, editMode = 'amount_delta', editDisabledReason, onClose, onOpenContractSummary, onEditMonth }) => {
    const isExec = viewMode === 'Execution';
    const rowTotalBudget = (row.monthlyValues || []).reduce((acc: number, curr: any) => acc + (curr.amount || 0), 0);
    const rowTotalActual = (row.monthlyValues || []).reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
    const completionRate = rowTotalBudget > 0 ? (rowTotalActual / rowTotalBudget) * 100 : 0;
    const lastReceivableMonth = row.isTerminatingInYear
        ? (row.monthlyValues || []).reduce((last: number | null, value: any, index: number) => (value.amount > 0 ? index : last), null)
        : null;
    const monthRows = Array.from({ length: 12 }, (_, index) => {
        const value = row.monthlyValues?.[index] || {};
        const budget = value.isAdjustedOut ? 0 : value.amount || 0;
        const actual = value.actual || 0;
        const delta = actual - budget;
        const tags = [
            value.isAdjustedOut ? '调出' : '',
            value.isAdjustedIn ? '调入' : '',
            row.rentFreeMonthFlags?.[index] ? '免租月' : '',
            row.leaseStartMonthInYear === index ? '起租月' : '',
            lastReceivableMonth === index ? '最后一期' : '',
        ].filter(Boolean);
        return {
            month: index + 1,
            budget,
            actual,
            delta,
            adjustmentDetail: String(value.adjustmentDetail || '').trim(),
            tags,
        };
    });

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="monthly-detail-backdrop fixed inset-0 z-[88] flex items-end justify-center p-0 md:items-center md:p-4">
            <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭预算行详情" onClick={onClose} />
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="budget-row-detail-sheet-title"
                className="monthly-detail-panel liquid-glass-panel relative flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[30px] md:rounded-[30px]"
            >
                <div className="border-b border-white/70 px-4 py-4 pb-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">{detailYear} 年</span>
                                <span className="liquid-mobile-chip-cyan rounded-full px-2.5 py-1 text-xs font-black">{row.category || '预算明细'}</span>
                                {row.isTerminatingInYear && <span className="liquid-mobile-chip-rose rounded-full px-2.5 py-1 text-xs font-black">退租</span>}
                                {row.isNewSigningInYear && <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">新签</span>}
                            </div>
                            <h3 id="budget-row-detail-sheet-title" className="mt-2 truncate text-lg font-black text-slate-950">{row.name || '预算明细'}</h3>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
                                <span>{row.building || '未关联楼栋'}</span>
                                <span>·</span>
                                <span>{row.unitNames?.trim() || '未分配房号'}</span>
                                {row.paymentCycleLabel && (
                                    <>
                                        <span>·</span>
                                        <span>{row.paymentCycleLabel}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500"
                            aria-label="关闭预算行详情"
                        >
                            <X size={18} />
                        </button>
                    </div>

                    <div className="mt-4 grid grid-cols-3 gap-2">
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                            <div className="text-xs font-bold text-slate-500">年度预算</div>
                            <div className="mt-0.5 text-base font-black text-blue-700">{formatWan(rowTotalBudget, 1)}</div>
                        </div>
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                            <div className="text-xs font-bold text-slate-500">累计实收</div>
                            <div className="mt-0.5 text-base font-black text-cyan-700">{formatWan(rowTotalActual, 1)}</div>
                        </div>
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                            <div className="text-xs font-bold text-slate-500">达成率</div>
                            <div className={`mt-0.5 text-base font-black ${completionRate >= 100 ? 'text-cyan-700' : completionRate > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                                {rowTotalBudget > 0 ? formatPercent(completionRate, 0) : '-'}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                            <div className="font-bold text-slate-500">面积</div>
                            <div className="mt-0.5 font-black text-slate-900">{formatArea(row.area || 0, 1)}</div>
                        </div>
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                            <div className="font-bold text-slate-500">签约单价</div>
                            <div className="mt-0.5 font-black text-slate-900">
                                {row.unitPrice != null && row.unitPrice > 0 ? `${Number(row.unitPrice.toFixed(2))} 元/㎡·天` : '—'}
                            </div>
                        </div>
                        <div className="liquid-budget-mobile-metric col-span-2 rounded-2xl px-3 py-2">
                            <div className="font-bold text-slate-500">本年免租</div>
                            <div className="mt-0.5 font-black text-slate-900">{row.rentFreeYearSummary || '—'}</div>
                        </div>
                    </div>
                    {!canEditAmount && editDisabledReason ? (
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600">
                            {editDisabledReason}
                        </div>
                    ) : null}
                    {canEditAmount && editMode === 'imported_month' ? (
                        <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-blue-700">
                            当前行来自导入预算表。可逐月编辑导入月额，保存后同步重算预算执行月度目标；填 0 表示该月回落合同滚动口径。
                        </div>
                    ) : null}

                    <div className="space-y-2">
                        {monthRows.map((item) => {
                            const active = item.budget > 0.005 || item.actual > 0.005 || item.tags.length > 0 || item.adjustmentDetail;
                            return (
                                <div key={item.month} className={`liquid-budget-mobile-card rounded-[20px] px-3 py-3 ${active ? '' : 'opacity-70'}`}>
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <div className="text-sm font-black text-slate-950">{item.month} 月</div>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {item.tags.length > 0 ? item.tags.map((tag) => (
                                                    <span key={tag} className="rounded-full bg-white/72 px-2 py-0.5 text-xs font-black text-slate-600">
                                                        {tag}
                                                    </span>
                                                )) : (
                                                    <span className="text-xs font-bold text-slate-500">无特殊标记</span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="shrink-0 text-right">
                                            <div className={`text-sm font-black tabular-nums ${isExec ? 'text-cyan-700' : 'text-blue-700'}`}>
                                                {formatWan(isExec ? item.actual : item.budget, 1)}
                                            </div>
                                            <div className="mt-0.5 text-xs font-bold text-slate-500">
                                                {isExec ? `预算 ${formatWan(item.budget, 1)}` : `实收 ${formatWan(item.actual, 1)}`}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                        <div>
                                            <div className="font-black text-slate-500">预算</div>
                                            <div className="font-black text-slate-900">{formatWan(item.budget, 1)}</div>
                                        </div>
                                        <div>
                                            <div className="font-black text-slate-500">实收</div>
                                            <div className="font-black text-cyan-700">{formatWan(item.actual, 1)}</div>
                                        </div>
                                        <div>
                                            <div className="font-black text-slate-500">差额</div>
                                            <div className={`font-black ${item.delta >= 0 ? 'text-cyan-700' : 'text-rose-600'}`}>{formatWan(item.delta, 1)}</div>
                                        </div>
                                    </div>
                                    {item.adjustmentDetail && (
                                        <div className="mt-2 rounded-2xl bg-white/66 px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600">
                                            {item.adjustmentDetail}
                                        </div>
                                    )}
                                    {canEditAmount ? (
                                        <div className="mt-2 flex justify-end">
                                            <button
                                                type="button"
                                                onClick={() => onEditMonth?.(item.month - 1, item.budget)}
                                                className="liquid-mobile-inline-action mobile-pressable inline-flex min-h-9 items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black"
                                            >
                                                <Edit3 size={13} />
                                                {editMode === 'imported_month' ? '编辑导入月额' : '调整预算'}
                                            </button>
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.875rem)]">
                    <button type="button" onClick={onClose} className={budgetGhostButtonClass}>
                        关闭
                    </button>
                    <button
                        type="button"
                        onClick={onOpenContractSummary}
                        className="liquid-action-strong liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-white"
                    >
                        合同概要
                    </button>
                </div>
            </section>
        </div>
    );
};

const BudgetAmountAdjustSheet: React.FC<{
    target: MobileBudgetAmountAdjustTarget;
    detailYear: number;
    amountValue: string;
    reasonValue: string;
    error?: string;
    onAmountChange: (value: string) => void;
    onReasonChange: (value: string) => void;
    onClose: () => void;
    onSave: () => void;
}> = ({
    target,
    detailYear,
    amountValue,
    reasonValue,
    error,
    onAmountChange,
    onReasonChange,
    onClose,
    onSave,
}) => {
    const row = target.row;
    const isImportedMonthEdit = target.mode === 'imported_month';
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    return (
        <div className="monthly-detail-backdrop fixed inset-0 z-[92] flex items-end justify-center p-0 md:items-center md:p-4">
            <button type="button" className="absolute inset-0 cursor-default" aria-label="关闭预算金额调整" onClick={onClose} />
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="budget-amount-adjust-sheet-title"
                className="monthly-detail-panel liquid-glass-panel relative flex max-h-[86vh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] md:rounded-[28px]"
            >
                <div className="border-b border-white/70 px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">
                                    {detailYear} 年 {target.monthIndex + 1} 月
                                </span>
                                <span className="liquid-mobile-chip-cyan rounded-full px-2.5 py-1 text-xs font-black">
                                    {isImportedMonthEdit ? '导入月额' : '单月增减'}
                                </span>
                            </div>
                            <h3 id="budget-amount-adjust-sheet-title" className="mt-2 truncate text-lg font-black text-slate-950">{row.name || '预算行'}</h3>
                            <p className="mt-1 truncate text-xs font-semibold text-slate-500">
                                当前预算 {formatWan(target.currentBudget || 0, 1)} · {isImportedMonthEdit ? '保存后更新导入预算表快照' : '保存后作为人工金额调整叠加'}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500"
                            aria-label="关闭预算金额调整"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                    <label className="block">
                        <span className="mb-1.5 block text-xs font-black text-slate-500">
                            {isImportedMonthEdit ? '本月预算金额（元）' : '增减金额（元）'}
                        </span>
                        <input
                            type="text"
                            inputMode="decimal"
                            value={amountValue}
                            onChange={(event) => onAmountChange(event.target.value)}
                            className={budgetInputClass}
                            placeholder={isImportedMonthEdit ? '例如 128000' : '例如 1000 或 -1000'}
                            autoFocus
                        />
                    </label>
                    {!isImportedMonthEdit ? (
                        <label className="block">
                            <span className="mb-1.5 block text-xs font-black text-slate-500">调整原因</span>
                            <textarea
                                value={reasonValue}
                                onChange={(event) => onReasonChange(event.target.value)}
                                className={`${budgetInputClass} min-h-[88px] resize-none`}
                                placeholder="例如：补录招商预算、修正账期金额"
                            />
                        </label>
                    ) : null}
                    <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-slate-600">
                        {isImportedMonthEdit
                            ? '本操作直接更新已导入预算表快照，并同步重算预算执行月度目标。填 0 表示清空该格导入覆盖，预算明细会回落到合同滚动口径。'
                            : '本操作只新增一条可追溯的金额调整，不修改合同租金、收款周期、免租期或导入预算表。'}
                    </div>
                    {error ? (
                        <div className="rounded-2xl border border-rose-200/80 bg-rose-50/82 px-3 py-2 text-xs font-bold text-rose-700">
                            {error}
                        </div>
                    ) : null}
                </div>

                <div className="grid grid-cols-2 gap-2 border-t border-white/70 px-5 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
                    <button type="button" onClick={onClose} className={budgetGhostButtonClass}>
                        取消
                    </button>
                    <button
                        type="button"
                        onClick={onSave}
                        className="liquid-action-strong liquid-pressable rounded-full px-4 py-2.5 text-sm font-black text-white"
                    >
                        {isImportedMonthEdit ? '保存月额' : '保存调整'}
                    </button>
                </div>
            </section>
        </div>
    );
};

function yearRentFreeMonthFlags(year: number, periods: RentFreePeriod[] | undefined): boolean[] {
    return Array.from({ length: 12 }, (_, m) => monthOverlapsRentFree(year, m, periods || []));
}

function leaseEndCalendarQuarter(date: Date): 1 | 2 | 3 | 4 {
    const m = date.getMonth();
    return (Math.floor(m / 3) + 1) as 1 | 2 | 3 | 4;
}

function quarterLabelCn(q: 1 | 2 | 3 | 4): string {
    const ranges: Record<number, string> = { 1: '1–3 月', 2: '4–6 月', 3: '7–9 月', 4: '10–12 月' };
    return `第 ${q} 季度（${ranges[q]}）`;
}

function tenantSortRoomKey(t: Tenant, building: Building | undefined): string {
    const units = tenantUnitsResolved(t, building);
    if (!units.length) return '';
    const sorted = [...units].sort((a, b) => {
        if (a.floor !== b.floor) return a.floor - b.floor;
        return compareUnitNameNumeric(a.name, b.name);
    });
    return sorted[0]?.name || '';
}

const paymentCycleOrderMap: Record<Tenant['paymentCycle'], number> = {
    HalfMonthly: 0,
    Monthly: 1,
    BiMonthly: 2,
    Quarterly: 3,
    SemiAnnual: 4,
    Annual: 5,
    Custom: 6,
};

function paymentCycleOrder(cycle: Tenant['paymentCycle'] | undefined): number {
    return paymentCycleOrderMap[cycle || 'Quarterly'] ?? 3;
}

/** 有人工预算调整记录的单元格：底色 + 小字颜色 */
function budgetAdjustmentCellStyle(val: {
    isAdjustedIn?: boolean;
    isAdjustedOut?: boolean;
    adjustmentDetail?: string;
}): { shell: string; noteClass: string } {
    const detail = (val.adjustmentDetail || '').trim();
    const touched = !!(detail || val.isAdjustedOut || val.isAdjustedIn);
    if (!touched) return { shell: '', noteClass: '' };
    if (val.isAdjustedOut) {
        return {
            shell: 'liquid-budget-adjusted-out',
            noteClass: 'text-orange-900/90',
        };
    }
    if (val.isAdjustedIn) {
        return {
            shell: 'liquid-budget-adjusted-in',
            noteClass: 'text-blue-900/90',
        };
    }
    return {
        shell: 'liquid-budget-adjusted-note',
        noteClass: 'text-cyan-900/90',
    };
}

interface BudgetManagerProps {
  buildings: Building[];
  tenants: Tenant[];
  budgetAssumptions: BudgetAssumption[];
  budgetAdjustments: BudgetAdjustment[];
  budgetAnalysis: BudgetAnalysisData;
  onUpdateAssumptions: (assumptions: BudgetAssumption[]) => void;
  onUpdateAdjustments: (adjustments: BudgetAdjustment[]) => void;
  onUpdateAnalysis: (analysis: BudgetAnalysisData) => void;
  payments: PaymentRecord[];
  
  scenarios: BudgetScenario[];
  onUpdateScenarios: (scenarios: BudgetScenario[]) => void;
  onActivateScenario: (scenario: BudgetScenario) => void;
  onSaveBudgetToCloud: (name: string, operator: string) => void;
  onRenameScenario: (id: string, newName: string) => void;
  initializationData?: MonthlyInitData[];
  /** 用于持久化已导入预算表（`__budget_table_<year>__` 键） */
  billingPeriodNotes?: Record<string, string>;
  /** 预算表 Excel 导入后批量更新（至少包含 initializationData） */
  onBatchUpdate?: (updates: Partial<DashboardData>) => void;
  cloudConfig?: CloudConfig;
  serverComputeEnabled?: boolean;
}

type ContractOnlyReceivableCtx = {
    tenants: Tenant[];
    buildings: Building[];
    payments?: PaymentRecord[];
    initializationData?: MonthlyInitData[];
    budgetAssumptions?: BudgetAssumption[];
    budgetAdjustments?: BudgetAdjustment[];
    budgetScenarios?: BudgetScenario[];
};

type BuildContractOnlyReceivableForPeriodFn = (
    year: number,
    month: number,
    ctx: ContractOnlyReceivableCtx,
) => { totalAmountDue: number; byTenantId: Map<string, number> };

type BudgetMonthlyServerState = BudgetMonthlyServerData & {
    key: string;
    loading: boolean;
    error?: string;
    useLocalFallback?: boolean;
};

export const BudgetManager: React.FC<BudgetManagerProps> = ({ 
    buildings: propBuildings, 
    tenants: propTenants, 
    budgetAssumptions: propAssumptions, 
    onUpdateAssumptions, 
    budgetAdjustments: propAdjustments, 
    onUpdateAdjustments, 
    budgetAnalysis, 
    onUpdateAnalysis, 
    payments,
    scenarios,
    onUpdateScenarios,
    onActivateScenario,
    onSaveBudgetToCloud,
    onRenameScenario,
    initializationData,
    billingPeriodNotes,
    onBatchUpdate,
    cloudConfig,
    serverComputeEnabled = false,
}) => {
  const currentYear = new Date().getFullYear();
  const nextYear = currentYear + 1;
  const [budgetPrompt, setBudgetPrompt] = useState<BudgetPromptState | null>(null);
  const showBudgetNotice = React.useCallback((prompt: Omit<BudgetPromptState, 'kind' | 'resolve'>) => (
      new Promise<void>((resolve) => {
          setBudgetPrompt({
              kind: 'notice',
              confirmText: '知道了',
              tone: 'blue',
              ...prompt,
              resolve: () => resolve(),
          });
      })
  ), []);
  const showBudgetConfirm = React.useCallback((prompt: Omit<BudgetPromptState, 'kind' | 'resolve'>) => (
      new Promise<boolean>((resolve) => {
          setBudgetPrompt({
              kind: 'confirm',
              confirmText: '确认',
              cancelText: '取消',
              tone: 'amber',
              ...prompt,
              resolve: (result) => resolve(result === true),
          });
      })
  ), []);
  const closeBudgetPrompt = React.useCallback((result?: boolean) => {
      setBudgetPrompt((current) => {
          current?.resolve?.(result);
          return null;
      });
  }, []);
  
  const [activeScenarioId, setActiveScenarioId] = useState<string>('current');
  const [showScenarioModal, setShowScenarioModal] = useState(false);
  const [newScenarioName, setNewScenarioName] = useState('');
  const [newScenarioDesc, setNewScenarioDesc] = useState('');
  const [newScenarioYear, setNewScenarioYear] = useState(currentYear);
  const [scenarioYearFilter, setScenarioYearFilter] = useState(currentYear);
  const [useSnapshot, setUseSnapshot] = useState(true);
  
  const [isRenaming, setIsRenaming] = useState(false);
  const [tempScenarioName, setTempScenarioName] = useState('');

  const [showCloudModal, setShowCloudModal] = useState(false);
  const [operatorName, setOperatorName] = useState('');

  const [activeTab, setActiveTab] = useState<'Vacancy' | 'Renewal' | 'Risk' | 'Existing'>('Vacancy');
  const [viewMode, setViewMode] = useState<'Settings' | 'Monthly' | 'Execution'>('Settings');
  const [detailYear, setDetailYear] = useState<number>(currentYear);
  const [isFullScreen, setIsFullScreen] = useState(false);
  
  const [sortMethod, setSortMethod] = useState<'Category' | 'Building' | 'PaymentCycle'>('Category');
  
  /** 预算表明细行：点击客户名查看合同概要 */
  const [contractSummaryRow, setContractSummaryRow] = useState<any | null>(null);
  const [selectedMobileBudgetRow, setSelectedMobileBudgetRow] = useState<any | null>(null);
  const [mobileBudgetAdjustTarget, setMobileBudgetAdjustTarget] = useState<MobileBudgetAmountAdjustTarget | null>(null);
  const [mobileBudgetAdjustValue, setMobileBudgetAdjustValue] = useState('');
  const [mobileBudgetAdjustReason, setMobileBudgetAdjustReason] = useState('');
  const [mobileBudgetAdjustError, setMobileBudgetAdjustError] = useState('');

  /** 预算表分组折叠（按类别 / 楼宇 / 账期）；切换年份或排序时清空 */
  const [collapsedBudgetGroups, setCollapsedBudgetGroups] = useState<Set<string>>(() => new Set());

  // 预算表 Excel 导入
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [importPreview, setImportPreview] = useState<ParsedBudgetTable | null>(null);
  const [isImporting, setIsImporting] = useState(false);

  const handlePickBudgetExcel = async () => {
      if (!onBatchUpdate) {
          await showBudgetNotice({
              title: '无法导入预算表',
              message: '当前页面不支持写入预算数据，请联系管理员。',
              tone: 'rose',
          });
          return;
      }
      importInputRef.current?.click();
  };

  const handleBudgetExcelChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setIsImporting(true);
      try {
          const buffer = await file.arrayBuffer();
          const { parseBudgetTableExcel } = await import('../services/budgetTableExcelParser');
          const parsed = await parseBudgetTableExcel(buffer);
          setImportPreview(parsed);
      } catch (err: any) {
          await showBudgetNotice({
              title: '解析预算表失败',
              message: err?.message || '未知错误',
              tone: 'rose',
          });
      } finally {
          setIsImporting(false);
      }
  };

  const confirmApplyImportedBudget = async () => {
      if (!importPreview || !onBatchUpdate) return;
      const merged = mergeBudgetTotalsIntoInitData(
          initializationData,
          importPreview.year,
          importPreview.monthlyTotals,
          tenants[0]?.projectId
      );
      const snapshot: BudgetTableSnapshot = {
          importedAt: new Date().toISOString(),
          sourceSheet: importPreview.sheetName,
          rows: importPreview.rows,
          monthlyTotals: importPreview.monthlyTotals,
          annualTotal: importPreview.annualTotal,
      };
      const nextNotes = writeImportedBudgetTable(billingPeriodNotes, importPreview.year, snapshot);
      onBatchUpdate({
          initializationData: merged,
          billingPeriodNotes: nextNotes,
      });
      const sumWan = (importPreview.annualTotal / 10000).toFixed(2);
      await showBudgetNotice({
          title: '预算表已导入',
          message:
              `已导入 ${importPreview.year} 年度预算（共 ${importPreview.rows.length} 行明细，合计 ${sumWan} 万元）。\n\n` +
              `月度合计已写入「预算执行」目标列。\n` +
              `完整明细已写入存档（pb_billing_period_notes）。\n\n` +
              `请点击右上角「保存」按钮写入后端。`,
          tone: 'blue',
      });
      setImportPreview(null);
  };

  /** 清除指定年份的导入预算表（同时移除月度目标值） */
  const handleClearImportedBudget = async (year: number) => {
      if (!onBatchUpdate) return;
      const confirmed = await showBudgetConfirm({
          title: '清除导入预算表',
          message: `确认清除 ${year} 年的导入预算表？\n\n这将同时移除「预算执行」中本年度月度目标的导入值（其他字段如累计实收、在租率不受影响）。`,
          tone: 'amber',
          confirmText: '清除',
      });
      if (!confirmed) {
          return;
      }
      const nextNotes = clearImportedBudgetTable(billingPeriodNotes, year);
      // 月度目标置零（保留 month/year/其他字段），与导入前对称
      const merged = mergeBudgetTotalsIntoInitData(initializationData, year, new Array(12).fill(0), tenants[0]?.projectId);
      onBatchUpdate({
          initializationData: merged,
          billingPeriodNotes: nextNotes,
      });
      await showBudgetNotice({
          title: '预算表已清除',
          message: `已清除 ${year} 年导入预算表。请点击右上角「保存」写入后端。`,
          tone: 'blue',
      });
  };

  /** 当前 detailYear 是否存在已导入预算表 */
  const importedBudgetForDetailYear = useMemo<BudgetTableSnapshot | null>(() => {
      return readImportedBudgetTable(billingPeriodNotes, detailYear);
  }, [billingPeriodNotes, detailYear]);

  // 仅在切换年份时自动定位到生效方案；编辑假设内容时不跳转
  const prevYearFilter = React.useRef(scenarioYearFilter);
  useEffect(() => {
      if (prevYearFilter.current === scenarioYearFilter) return;
      prevYearFilter.current = scenarioYearFilter;
      const active = scenarios.find(s => s.isActive && (s.budgetYear || currentYear) === scenarioYearFilter);
      if (active) {
          setActiveScenarioId(active.id);
      } else {
          setActiveScenarioId('current');
      }
  }, [scenarioYearFilter]); // 不依赖 scenarios，避免每次编辑都触发跳转

  useEffect(() => {
      if (String(activeScenarioId).startsWith('invoice_dedicated_')) {
          setActiveScenarioId('current');
      }
  }, [activeScenarioId]);

  useEffect(() => {
      setCollapsedBudgetGroups(new Set());
  }, [detailYear, sortMethod]);

  const toggleBudgetGroupCollapse = (groupName: string) => {
      setCollapsedBudgetGroups((prev) => {
          const next = new Set(prev);
          if (next.has(groupName)) next.delete(groupName);
          else next.add(groupName);
          return next;
      });
  };

  const effectiveData = useMemo(() => {
      if (activeScenarioId === 'current') {
          return {
              buildings: propBuildings,
              tenants: propTenants,
              assumptions: propAssumptions,
              adjustments: propAdjustments
          };
      }

      const scenario = scenarios.find(s => s.id === activeScenarioId);
      if (!scenario) return {
          buildings: propBuildings,
          tenants: propTenants,
          assumptions: propAssumptions,
          adjustments: propAdjustments
      };

      // 与「财务报表 → 应收明细」、工作台「合同应收」共用同一套合并逻辑：
      //  · 假设：以方案为底，根级 Existing/Vacancy 按同 target 覆盖（live wins）
      //  · 调整：以方案为底，根级按同 id 覆盖
      //  · 租户/楼宇：优先方案快照，避免快照外的实时变更影响纯方案视图
      // 这样「实际合同口径」预算表 = 工作台「合同应收」 = 财务报表「应收租金」三处口径一致。
      const merged = buildReceivableContextForScenario(
          scenario,
          propTenants,
          propBuildings,
          propAssumptions,
          propAdjustments,
      );
      // 为兼容 BudgetManager 的「续签/高风险退租」扩展账单展示，保留方案中非 Existing/Vacancy 的假设
      // （Renewal / RiskTermination — 这些只影响虚拟续签账单，不会进入 buildBillingDetailsForPeriod 的 realOnlyDetails，
      // 所以不会破坏与工作台/财务报表的对账，只让设定页/详情表能继续显示）。
      const extraAssumptions = (scenario.assumptions || []).filter(
          (a) => a.targetType === 'Renewal' || a.targetType === 'RiskTermination',
      );
      return {
          buildings: merged.buildings,
          tenants: merged.tenants,
          assumptions: [...merged.assumptions, ...extraAssumptions],
          adjustments: merged.adjustments,
      };
  }, [activeScenarioId, scenarios, propBuildings, propTenants, propAssumptions, propAdjustments]);

  const { buildings, tenants, assumptions: budgetAssumptions, adjustments: budgetAdjustments } = effectiveData;
  const billCacheRef = useRef<BillGenerationCache | null>(null);
  const contractReceivableBuilderRef = useRef<BuildContractOnlyReceivableForPeriodFn | null>(null);
  const [localBudgetEngineState, setLocalBudgetEngineState] = useState<{
      loading: boolean;
      ready: boolean;
      error?: string;
  }>({ loading: false, ready: false });

  const generateBudgetedBillsCached = (
      tenant: Tenant,
      assumptions: BudgetAssumption[],
      adjustments: BudgetAdjustment[],
      start: Date,
      end: Date,
      scopeHint: string,
  ) => {
      if (!billCacheRef.current) return [];
      return billCacheRef.current.get({ tenant, assumptions, adjustments, start, end, scopeHint });
  };

  const contractSummaryModalPayload = useMemo(() => {
      if (!contractSummaryRow) return null;
      if (contractSummaryRow.name === '待租单元') {
          return {
              detailYear,
              content: {
                  kind: 'vacant' as const,
                  building: contractSummaryRow.building,
                  unitNames: contractSummaryRow.unitNames,
                  leaseStart: contractSummaryRow.leaseStart,
                  area: contractSummaryRow.area,
                  unitPrice: contractSummaryRow.unitPrice,
                  rentFreeYearSummary: contractSummaryRow.rentFreeYearSummary,
                  paymentCycleLabel: contractSummaryRow.paymentCycleLabel,
              },
          };
      }
      const t = tenants.find((x) => x.id === contractSummaryRow.id);
      if (!t) return { detailYear, content: { kind: 'missing' as const } };
      return {
          detailYear,
          content: {
              kind: 'tenant' as const,
              tenant: t,
              buildingLabel: contractSummaryRow.building,
              unitNamesLabel: contractSummaryRow.unitNames,
          },
      };
  }, [contractSummaryRow, tenants, detailYear]);

  const handleUpdateAssumptions = (newAssumptions: BudgetAssumption[]) => {
      if (activeScenarioId === 'current') {
          onUpdateAssumptions(newAssumptions);
      } else {
          const updatedScenarios = scenarios.map(s => 
              s.id === activeScenarioId ? { ...s, assumptions: newAssumptions } : s
          );
          onUpdateScenarios(updatedScenarios);
      }
  };

  const handleUpdateAdjustments = (newAdjustments: BudgetAdjustment[]) => {
      if (activeScenarioId === 'current') {
          onUpdateAdjustments(newAdjustments);
      } else {
          const updatedScenarios = scenarios.map(s => 
              s.id === activeScenarioId ? { ...s, adjustments: newAdjustments } : s
          );
          onUpdateScenarios(updatedScenarios);
      }
  };

  const closeMobileBudgetAmountAdjust = () => {
      setMobileBudgetAdjustTarget(null);
      setMobileBudgetAdjustValue('');
      setMobileBudgetAdjustReason('');
      setMobileBudgetAdjustError('');
  };

  const startMobileBudgetAmountAdjust = (row: any, monthIndex: number, currentBudget: number) => {
      if (importedBudgetForDetailYear) {
          if (!row.importedBudgetKey) {
              setMobileBudgetAdjustError('');
              void showBudgetNotice({
                  title: '未匹配到导入预算行',
                  message: '当前年份存在导入预算表，但此行未能匹配到导入明细。请先在预算名称关联工具或导入模板中完成客户 / 房号 / 楼宇匹配。',
                  tone: 'amber',
              });
              return;
          }
          if (!onBatchUpdate) {
              setMobileBudgetAdjustError('');
              void showBudgetNotice({
                  title: '当前页面不支持写入',
                  message: '无法更新导入预算表快照，请联系管理员确认当前账号是否具备预算写入权限。',
                  tone: 'rose',
              });
              return;
          }
          setMobileBudgetAdjustTarget({ row, monthIndex, currentBudget, mode: 'imported_month' });
          setMobileBudgetAdjustValue(String(Math.round(Number(currentBudget || 0))));
          setMobileBudgetAdjustReason('');
          setMobileBudgetAdjustError('');
          return;
      }
      const tenant = tenants.find((item) => item.id === row.id);
      if (!tenant) {
          void showBudgetNotice({
              title: '当前行暂不支持移动端调整',
              message: '移动端单月金额调整仅支持已登记合同客户。空置去化、导入孤立行等预算项请在桌面端或预算模板中维护。',
              tone: 'amber',
          });
          return;
      }
      setMobileBudgetAdjustTarget({ row, monthIndex, currentBudget, mode: 'amount_delta' });
      setMobileBudgetAdjustValue('');
      setMobileBudgetAdjustReason('');
      setMobileBudgetAdjustError('');
  };

  const handleSaveMobileBudgetAmountAdjust = async () => {
      if (!mobileBudgetAdjustTarget) return;
      const row = mobileBudgetAdjustTarget.row;
      if (mobileBudgetAdjustTarget.mode === 'imported_month') {
          if (!importedBudgetForDetailYear || !onBatchUpdate) {
              setMobileBudgetAdjustError('当前导入预算表不可写入，请刷新后重试。');
              return;
          }
          const importKey = String(row.importedBudgetKey || '').trim();
          if (!importKey) {
              setMobileBudgetAdjustError('当前行缺少导入预算表匹配键，无法保存。');
              return;
          }
          const nextAmount = Number(String(mobileBudgetAdjustValue).replace(/,/g, '').trim());
          try {
              const nextSnapshot = updateImportedBudgetTableRowMonth(
                  importedBudgetForDetailYear,
                  importKey,
                  mobileBudgetAdjustTarget.monthIndex,
                  nextAmount,
              );
              const nextNotes = writeImportedBudgetTable(billingPeriodNotes, detailYear, nextSnapshot);
              const mergedInitData = mergeBudgetTotalsIntoInitData(
                  initializationData,
                  detailYear,
                  nextSnapshot.monthlyTotals,
                  tenants[0]?.projectId,
              );
              onBatchUpdate({
                  initializationData: mergedInitData,
                  billingPeriodNotes: nextNotes,
              });
              closeMobileBudgetAmountAdjust();
              await showBudgetNotice({
                  title: '导入预算月额已更新',
                  message: `${row.name || '预算行'} · ${detailYear} 年 ${mobileBudgetAdjustTarget.monthIndex + 1} 月导入预算已更新为 ${formatCurrency(nextAmount)}。\n\n月度目标合计已同步重算，请点击右上角「保存」同步至云端。`,
                  tone: 'blue',
              });
          } catch (error) {
              setMobileBudgetAdjustError(error instanceof Error ? error.message : '请输入大于等于 0 的有效金额。');
          }
          return;
      }
      if (importedBudgetForDetailYear) {
          setMobileBudgetAdjustError('当前年份使用导入预算表，金额调整会被导入模板覆盖。');
          return;
      }
      const tenant = tenants.find((item) => item.id === row.id);
      if (!tenant) {
          setMobileBudgetAdjustError('当前行不是已登记合同客户，不能新增单月金额调整。');
          return;
      }

      const amountDelta = Number(String(mobileBudgetAdjustValue).replace(/,/g, '').trim());
      try {
          const adjustment = createBudgetAmountDeltaAdjustment({
              tenantId: tenant.id,
              tenantName: tenant.name || row.name,
              adjustedYear: detailYear,
              adjustedMonth: mobileBudgetAdjustTarget.monthIndex,
              amountDelta,
              reason: mobileBudgetAdjustReason,
          });
          handleUpdateAdjustments([...budgetAdjustments, adjustment]);
          closeMobileBudgetAmountAdjust();
          await showBudgetNotice({
              title: '预算金额调整已添加',
              message: `${tenant.name || row.name} · ${detailYear} 年 ${mobileBudgetAdjustTarget.monthIndex + 1} 月已新增 ${formatCurrency(adjustment.amount)} 的单月预算增减。请点击右上角「保存」同步至云端。`,
              tone: adjustment.amount >= 0 ? 'blue' : 'amber',
          });
      } catch (error) {
          setMobileBudgetAdjustError(error instanceof Error ? error.message : '请输入有效的增减金额。');
      }
  };

  const handleCreateScenario = async () => {
      const trimmedName = newScenarioName.trim();
      if (!trimmedName) {
          await showBudgetNotice({
              title: '请输入方案名称',
              message: '创建预算方案前需要先填写方案名称。',
              tone: 'amber',
          });
          return;
      }
      // 防止与「应收专用方案」前缀冲突
      if (/^invoice_dedicated_/i.test(trimmedName)) {
          await showBudgetNotice({
              title: '方案名称不可用',
              message: '方案名称不能以 invoice_dedicated_ 开头，这是系统保留前缀。',
              tone: 'amber',
          });
          return;
      }
      // 同年度方案名称去重，避免下拉混淆
      const dupName = scenarios.some(
          (s) => (s.budgetYear || currentYear) === newScenarioYear && s.name.trim() === trimmedName,
      );
      if (dupName) {
          await showBudgetNotice({
              title: '方案名称重复',
              message: `${newScenarioYear} 年度已存在同名方案“${trimmedName}”，请换一个名字。`,
              tone: 'amber',
          });
          return;
      }

      // 新方案默认基于「实际履约合同」推算账单（含免租期、收款周期、账期调整等设置）：
      //  · Existing/Renewal/RiskTermination 的合同级假设（单价调整、付款转移、续签策略等）继承
      //  · 全部 budgetAdjustments（账期调整、金额调整）继承
      //  · Vacancy（空置去化）不继承——空置预测是「年初预算 (Live)」的前瞻测算，新方案默认不计入
      const inheritedAssumptions: BudgetAssumption[] = (propAssumptions || [])
          .filter((a) => a.targetType !== 'Vacancy')
          .map((a) => ({ ...a, id: a.id || `${a.targetType}_${a.targetId}` }));
      const inheritedAdjustments: BudgetAdjustment[] = (propAdjustments || []).map((a) => ({ ...a }));

      const newScenario: BudgetScenario = {
          id: `scenario_${Date.now()}`,
          name: trimmedName,
          budgetYear: newScenarioYear,
          description: newScenarioDesc,
          createdAt: new Date().toISOString(),
          isActive: false,
          assumptions: inheritedAssumptions,
          adjustments: inheritedAdjustments,
          baseDataSnapshot: useSnapshot ? cloneBudgetScenarioSnapshot(propTenants, propBuildings) : undefined,
      };
      onUpdateScenarios([...scenarios, newScenario]);
      setScenarioYearFilter(newScenarioYear);
      setActiveScenarioId(newScenario.id);
      setShowScenarioModal(false);
      setNewScenarioName('');
      setNewScenarioDesc('');
  };
  const handleDeleteScenario = async (id: string) => {
      if (String(id).startsWith('invoice_dedicated_')) {
          await showBudgetNotice({
              title: '无法删除系统方案',
              message: '系统常驻的应收专用方案不支持删除。',
              tone: 'slate',
          });
          return;
      }
      const confirmed = await showBudgetConfirm({
          title: '删除预算方案',
          message: '确定删除此预算方案吗？删除后将无法在当前页面恢复。',
          tone: 'rose',
          confirmText: '删除',
      });
      if(confirmed) {
          const newScenarios = scenarios.filter(s => s.id !== id);
          onUpdateScenarios(newScenarios);
          if (activeScenarioId === id) setActiveScenarioId('current');
      }
  };
  const startRenaming = () => { const scenario = scenarios.find(s => s.id === activeScenarioId); if (scenario) { setTempScenarioName(scenario.name); setIsRenaming(true); } };
  const saveRenaming = () => { if (tempScenarioName.trim()) { onRenameScenario(activeScenarioId, tempScenarioName); } setIsRenaming(false); };
  const handleActivateCurrentScenario = async () => {
    const scenario = scenarios.find(s => s.id === activeScenarioId);
    if (!scenario) return;
    const assumptionCount = Array.isArray(scenario.assumptions) ? scenario.assumptions.length : 0;
    const adjustmentCount = Array.isArray(scenario.adjustments) ? scenario.adjustments.length : 0;
    if (assumptionCount === 0 && adjustmentCount === 0) {
      await showBudgetNotice({
          title: '方案暂无预算数据',
          message: `方案「${scenario.name || scenario.id}」没有任何预算假设与调整数据，激活后预算将全部为空。\n请先在该方案下补充假设/调整数据。`,
          tone: 'amber',
      });
      return;
    }
    onActivateScenario(scenario);
  };
  const handleSetReceivableScenario = () => {
      const scenario = scenarios.find((s) => s.id === activeScenarioId);
      if (!scenario) return;
      const updated = scenarios.map((s) => {
          if ((s.budgetYear || currentYear) !== (scenario.budgetYear || currentYear)) return s;
          return { ...s, isReceivableActive: s.id === scenario.id };
      });
      onUpdateScenarios(updated);
  };
  /**
   * 用当前实时合同/楼宇重建方案快照（P0-4 修复）。
   * - 不修改任何 assumptions / adjustments / isActive，仅同步 baseDataSnapshot
   * - 方案创建后新签的合同因此会进入预算可见集合
   * 提示：刷新后无法恢复创建时刻的"历史合同"列表，请在用户明确确认后再执行。
   */
  const handleRefreshScenarioSnapshot = async () => {
      const scenario = scenarios.find((s) => s.id === activeScenarioId);
      if (!scenario) return;
      const oldCount = scenario.baseDataSnapshot?.tenants?.length ?? 0;
      const newCount = propTenants.length;
      const confirmMsg = `将用当前 ${newCount} 个合同重建方案「${scenario.name || scenario.id}」的快照（旧快照含 ${oldCount} 个合同，将被覆盖）。\n\n` +
          '该操作只刷新合同/楼宇快照，不会修改预算假设、调整或激活状态。是否继续？';
      const confirmed = await showBudgetConfirm({
          title: '刷新方案快照',
          message: confirmMsg,
          tone: 'amber',
          confirmText: '刷新快照',
      });
      if (!confirmed) return;
      const updated = scenarios.map((s) =>
          s.id === scenario.id
              ? {
                    ...s,
                    baseDataSnapshot: cloneBudgetScenarioSnapshot(propTenants, propBuildings),
                }
              : s,
      );
      onUpdateScenarios(updated);
  };
  const confirmCloudSave = async () => {
    if (!operatorName) return;
    const scenario = scenarios.find(s => s.id === activeScenarioId);
    // 允许「仅含合同快照」方案上云：snapshot 本身已构成可对照的预算基线，
    // 假设/调整为空只代表「按合同实滚」，仍是有效预算口径。
    if (
        scenario &&
        !scenario.assumptions?.length &&
        !scenario.adjustments?.length &&
        !scenario.baseDataSnapshot?.tenants?.length
    ) {
      await showBudgetNotice({
          title: '无法上传空方案',
          message: '当前方案没有预算假设、调整或合同快照，无法上传。请至少勾选「保存当前快照」或编辑预算假设。',
          tone: 'amber',
      });
      return;
    }
    const scenarioName = activeScenarioId === 'current' ? '当前合同履约预算' : scenario?.name || '未命名方案';
    onSaveBudgetToCloud(scenarioName, operatorName); setShowCloudModal(false);
  };

  const expiringTenants = useMemo(
      () => {
          if (viewMode !== 'Settings') return [];
          return tenants.filter((t) => {
              const endYear = new Date(t.leaseEnd).getFullYear();
              return (endYear === currentYear || endYear === nextYear) && t.status !== ContractStatus.Terminated && t.status !== ContractStatus.Expired;
          });
      },
      [viewMode, tenants, currentYear, nextYear]
  );

  const renewalGroupedByYearQuarter = useMemo(() => {
      if (viewMode !== 'Settings' || activeTab !== 'Renewal') return [];
      const byYear = new Map<number, Map<number, Tenant[]>>();
      for (const t of expiringTenants) {
          const d = new Date(t.leaseEnd);
          if (Number.isNaN(d.getTime())) continue;
          const y = d.getFullYear();
          const q = leaseEndCalendarQuarter(d);
          if (!byYear.has(y)) byYear.set(y, new Map());
          const byQ = byYear.get(y)!;
          if (!byQ.has(q)) byQ.set(q, []);
          byQ.get(q)!.push(t);
      }
      const years = Array.from(byYear.keys()).sort((a, b) => a - b);
      return years
          .map((year) => {
              const quarterMap = byYear.get(year)!;
              const quarters = ([1, 2, 3, 4] as const)
                  .map((q) => ({
                      quarter: q,
                      label: quarterLabelCn(q),
                      tenants: (quarterMap.get(q) || []).slice().sort((a, b) => new Date(a.leaseEnd).getTime() - new Date(b.leaseEnd).getTime()),
                  }))
                  .filter((block) => block.tenants.length > 0);
              return { year, quarters };
          })
          .filter((yBlock) => yBlock.quarters.length > 0);
  }, [viewMode, activeTab, expiringTenants]);

  const vacantUnits = useMemo(() => {
    const occupiedUnitIds = new Set<string>();
    for (const tenant of tenants) {
      if (
        tenant.status === ContractStatus.Active ||
        tenant.status === ContractStatus.Expiring ||
        tenant.status === ContractStatus.Pending
      ) {
        for (const unitId of tenant.unitIds || []) occupiedUnitIds.add(unitId);
      }
    }
    const list: { unitId: string; unitName: string; buildingName: string; buildingId: string; floor: number; area: number }[] = [];
    buildings.forEach(b => {
      b.units.forEach(u => {
        const isOccupied = occupiedUnitIds.has(u.id);
        if (!isOccupied && u.status !== UnitStatus.Occupied && !u.isSelfUse) {
          list.push({ unitId: u.id, unitName: u.name, buildingName: b.name, buildingId: b.id, floor: u.floor, area: u.area });
        }
      });
    });
    return list;
  }, [buildings, tenants]);

  const vacantUnitsGrouped = useMemo(() => {
      if (viewMode !== 'Settings' || activeTab !== 'Vacancy') return [];
      const byBuilding = new Map<string, typeof vacantUnits>();
      vacantUnits.forEach((u) => {
          if (!byBuilding.has(u.buildingId)) byBuilding.set(u.buildingId, []);
          byBuilding.get(u.buildingId)!.push(u);
      });
      return [...buildings]
          .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
          .map((b) => {
              const units = (byBuilding.get(b.id) || []).slice();
              if (!units.length) return null;
              const byFloor = new Map<number, typeof vacantUnits>();
              units.forEach((u) => {
                  if (!byFloor.has(u.floor)) byFloor.set(u.floor, []);
                  byFloor.get(u.floor)!.push(u);
              });
              const floors = Array.from(byFloor.keys()).sort((a, b) => a - b);
              return {
                  building: b,
                  count: units.length,
                  floors: floors.map((fl) => ({
                      floor: fl,
                      units: (byFloor.get(fl) || []).slice().sort((a, b) => compareUnitNameNumeric(a.unitName, b.unitName)),
                  })),
              };
          })
          .filter((g): g is NonNullable<typeof g> => g != null);
  }, [viewMode, activeTab, vacantUnits, buildings]);
  
  const riskTenants = useMemo(
      () => (viewMode === 'Settings' ? tenants.filter(t => t.isRisk && t.status === ContractStatus.Active) : []),
      [viewMode, tenants]
  );

  const getAssumption = (targetId: string, type: 'Vacancy' | 'Renewal' | 'RiskTermination' | 'Existing', targetName: string) => {
    const existing = budgetAssumptions.find(a => a.targetId === targetId && a.targetType === type);
    if (existing) return existing;
    return {
      id: `budget_${targetId}_${type}`, targetType: type, targetId: targetId, targetName: targetName,
      strategy: 'Renewal', projectedSignDate: `${nextYear}-01-01`, projectedUnitPrice: 2.5, projectedRentFreeMonths: 0, vacancyGapMonths: 2,
    } as BudgetAssumption;
  };
  
  const updateAssumption = (updated: BudgetAssumption) => { 
      const others = budgetAssumptions.filter(a => a.targetId !== updated.targetId || a.targetType !== updated.targetType); 
      handleUpdateAssumptions([...others, updated]); 
  };

	  const budgetMonthlyComputeRequest = useMemo(() => {
	      if (!shouldBuildBudgetMonthlyComputeRequest(viewMode)) {
	          return {
	              key: `budget-monthly:inactive:${viewMode}:${detailYear}:${activeScenarioId}`,
	              billItems: [],
	              contractInput: {
	                  year: detailYear,
	                  tenants: [],
	                  buildings: [],
	                  payments: [],
	                  initializationData: [] as MonthlyInitData[],
	                  budgetAssumptions: [],
	                  budgetAdjustments: [],
	                  budgetScenarios: [],
	              },
	          };
	      }
	      const billingGenStart = new Date(detailYear - 2, 0, 1);
	      const billingGenEnd = new Date(detailYear, 11, 31);
      const addMonths = (dateStr: string, months: number): string => {
          const d = new Date(dateStr);
          d.setMonth(d.getMonth() + months);
          return d.toISOString().split('T')[0];
      };
	      const selfUseUnitIds = new Set<string>();
	      buildings.forEach(b => b.units.forEach(u => { if (u.isSelfUse) selfUseUnitIds.add(u.id); }));
	      const assumptionByTarget = new Map<string, BudgetAssumption>();
	      budgetAssumptions.forEach((assumption) => {
	          assumptionByTarget.set(`${assumption.targetType}:${assumption.targetId}`, assumption);
	      });
	      const adjustmentsByTenantId = new Map<string, BudgetAdjustment[]>();
	      budgetAdjustments.forEach((adjustment) => {
	          const list = adjustmentsByTenantId.get(adjustment.tenantId);
	          if (list) list.push(adjustment);
	          else adjustmentsByTenantId.set(adjustment.tenantId, [adjustment]);
	      });
	      const findAssumption = (
	          targetId: string,
	          targetType: BudgetAssumption['targetType'],
	      ): BudgetAssumption | undefined => assumptionByTarget.get(`${targetType}:${targetId}`);

      const billItems: Array<{
          id: string;
          tenant: Tenant;
          assumptions: BudgetAssumption[];
          adjustments: BudgetAdjustment[];
          startDate: Date;
          endDate: Date;
      }> = [];
      const addBillItem = (
          id: string,
          tenant: Tenant,
          assumptions: BudgetAssumption[],
          adjustments: BudgetAdjustment[],
      ) => {
          billItems.push({
              id,
              tenant,
              assumptions,
              adjustments,
              startDate: billingGenStart,
              endDate: billingGenEnd,
          });
      };

      tenants.forEach((t) => {
          if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) return;
          if (t.unitIds.some(uid => selfUseUnitIds.has(uid))) return;
          if (t.isSpecialBusiness) return;

          const leaseEndYear = new Date(t.leaseEnd).getFullYear();
          const isExpiringThisYear = leaseEndYear === detailYear;
          const riskAsm = findAssumption(t.id, 'RiskTermination');
          const renewAsm = findAssumption(t.id, 'Renewal');
          let assumptionType: 'Renewal' | 'RiskTermination' | 'Existing' | null = null;
          if (t.isRisk && riskAsm) assumptionType = 'RiskTermination';
          else if (isExpiringThisYear && renewAsm) assumptionType = 'Renewal';
          else assumptionType = 'Existing';

          addBillItem(`tenant:${t.id}:budget`, t, budgetAssumptions, budgetAdjustments);

	          const existingAsm = findAssumption(t.id, 'Existing');
	          const tenantAdjustments = adjustmentsByTenantId.get(t.id) || [];
          const hasBudgetMods =
              !!existingAsm?.priceAdjustment?.startDate ||
              !!existingAsm?.paymentShift?.isActive ||
              !!t.paymentPeriodShiftMonths ||
              (t.paymentPeriodAdjustments || []).length > 0 ||
              tenantAdjustments.length > 0;
          if (hasBudgetMods) {
              addBillItem(`tenant:${t.id}:pure`, t, [], []);
          }

          const assumption = assumptionType ? findAssumption(t.id, assumptionType) : undefined;
          if (assumption && assumptionType !== 'Existing') {
              let newStart: Date | null = null;
              if (assumption.targetType === 'Renewal' && assumption.strategy !== 'ReLease') {
                  const le = new Date(t.leaseEnd);
                  le.setDate(le.getDate() + 1);
                  newStart = le;
              } else if (assumption.strategy === 'ReLease' || assumption.targetType === 'RiskTermination') {
                  const baseDate = assumption.targetType === 'RiskTermination' && assumption.projectedTerminationDate
                      ? new Date(assumption.projectedTerminationDate)
                      : new Date(t.leaseEnd);
                  const gap = assumption.vacancyGapMonths || 0;
                  newStart = new Date(baseDate);
                  newStart.setMonth(newStart.getMonth() + gap);
                  newStart.setDate(newStart.getDate() + 1);
              }
              if (newStart) {
                  const newStartStr = newStart.toISOString().split('T')[0];
                  const newEnd = new Date(newStart);
                  newEnd.setFullYear(newEnd.getFullYear() + 3);
                  const firstPayDate = addMonths(newStartStr, assumption.projectedRentFreeMonths || 0);
                  const virtualTenant: Tenant = {
                      ...t,
                      id: `virtual_${t.id}`,
                      leaseStart: newStartStr,
                      leaseEnd: newEnd.toISOString().split('T')[0],
                      unitPrice: assumption.projectedUnitPrice,
                      monthlyRent: 0,
                      rentFreePeriods: assumption.projectedRentFreeMonths > 0
                          ? [{
                              start: newStartStr,
                              end: new Date(new Date(newStart).setMonth(newStart.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0],
                              description: 'Assumption Rent Free',
                          }]
                          : [],
                      firstPaymentDate: firstPayDate,
                      freeRentHandling: 'Defer',
                  };
                  addBillItem(`tenant:${t.id}:virtual-extension`, virtualTenant, [], []);
              }
          }
      });

      if (activeScenarioId === 'current') {
          vacantUnits.forEach((u) => {
              const assumption = findAssumption(u.unitId, 'Vacancy');
              if (!assumption?.projectedSignDate) return;
              const start = new Date(assumption.projectedSignDate);
              const end = new Date(start);
              end.setFullYear(end.getFullYear() + 5);
              const firstPayDate = addMonths(assumption.projectedSignDate, assumption.projectedRentFreeMonths || 0);
              const virtualTenant: Tenant = {
                  id: u.unitId,
                  name: '待租单元',
                  buildingId: '',
                  unitIds: [u.unitId],
                  totalArea: u.area,
                  leaseStart: assumption.projectedSignDate,
                  leaseEnd: end.toISOString().split('T')[0],
                  unitPrice: assumption.projectedUnitPrice,
                  monthlyRent: 0,
                  paymentCycle: 'Quarterly',
                  paymentCycleMonths: 3,
                  firstPaymentMonths: 3,
                  firstPaymentDate: firstPayDate,
                  depositAmount: 0,
                  depositStatus: DepositStatus.Unpaid,
                  status: ContractStatus.Active,
                  rentFreePeriods: assumption.projectedRentFreeMonths > 0
                      ? [{
                          start: assumption.projectedSignDate,
                          end: new Date(new Date(start).setMonth(start.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0],
                          description: 'Vacancy Rent Free',
                      }]
                      : [],
                  freeRentHandling: 'Defer',
              };
              addBillItem(`vacancy:${u.unitId}`, virtualTenant, [], budgetAdjustments);
          });
      }

      const contractOnlyBudgetScenarios =
          activeScenarioId === 'current' ? normalizeScenarioForReceivable(scenarios, propTenants, propBuildings) : [];
      const contractInput = {
          year: detailYear,
          tenants,
          buildings,
          payments,
          initializationData: [] as MonthlyInitData[],
          budgetAssumptions,
          budgetAdjustments,
          budgetScenarios: contractOnlyBudgetScenarios,
      };
      const key = [
          'budget-monthly',
          detailYear,
	      activeScenarioId,
          collectionIdentityKey(tenants),
          collectionIdentityKey(buildings),
          collectionIdentityKey(payments),
          collectionIdentityKey(budgetAssumptions),
          collectionIdentityKey(budgetAdjustments),
          collectionIdentityKey(contractOnlyBudgetScenarios),
          billItems.map((item) => [
              item.id,
              objectIdentityKey(item.tenant),
              collectionIdentityKey(item.assumptions),
              collectionIdentityKey(item.adjustments),
              item.startDate.toISOString(),
              item.endDate.toISOString(),
          ].join(':')).join('|'),
      ].join('::');
      return { key, billItems, contractInput };
  }, [
      activeScenarioId,
      buildings,
      budgetAdjustments,
      budgetAssumptions,
      detailYear,
      payments,
      propBuildings,
      propTenants,
      scenarios,
      tenants,
	      vacantUnits,
	      viewMode,
	  ]);

	  const shouldUseBudgetMonthlyServer =
	      serverComputeEnabled &&
	      !!cloudConfig?.projectId &&
	      shouldBuildBudgetMonthlyComputeRequest(viewMode);
	  const [budgetMonthlyServerState, setBudgetMonthlyServerState] = useState<BudgetMonthlyServerState>({
	      key: '',
	      loading: false,
	  });
	  const shouldAllowBudgetMonthlyLocalComputeWithoutServer = shouldRunBudgetMonthlyLocalFallback({
	      shouldUseServer: shouldUseBudgetMonthlyServer,
	      serverAttempted: false,
	  });
	  const shouldUseBudgetMonthlyLocalCompute =
	      shouldBuildBudgetMonthlyComputeRequest(viewMode) &&
	      (
	          (!shouldUseBudgetMonthlyServer && shouldAllowBudgetMonthlyLocalComputeWithoutServer) ||
	          !!budgetMonthlyServerState.useLocalFallback
	      );
	  const shouldBuildBudgetDetailRows = shouldBuildBudgetMonthlyDetailRows(viewMode);

  useEffect(() => {
      if (!shouldUseBudgetMonthlyLocalCompute) return;
      if (billCacheRef.current && contractReceivableBuilderRef.current) {
          setLocalBudgetEngineState((prev) =>
              prev.ready && !prev.loading && !prev.error ? prev : { loading: false, ready: true }
          );
          return;
      }
      let cancelled = false;
      setLocalBudgetEngineState({ loading: true, ready: false });
      Promise.all([
          import('../services/billingService'),
          import('../services/dashboardMetrics'),
      ])
          .then(([billingModule, metricsModule]) => {
              if (cancelled) return;
              billCacheRef.current = createBudgetedBillCache({
                  maxEntries: 240,
                  generateBudgetedBills: billingModule.generateBudgetedBills,
              });
              contractReceivableBuilderRef.current = metricsModule.buildContractOnlyReceivableForPeriod;
              setLocalBudgetEngineState({ loading: false, ready: true });
          })
          .catch((error: unknown) => {
              if (cancelled) return;
              setLocalBudgetEngineState({
                  loading: false,
                  ready: false,
                  error: error instanceof Error ? error.message : '本地预算账单引擎加载失败',
              });
          });
      return () => {
          cancelled = true;
      };
  }, [shouldUseBudgetMonthlyLocalCompute]);

  useEffect(() => {
	      if (!shouldUseBudgetMonthlyServer || !cloudConfig) {
	          setBudgetMonthlyServerState({
	              key: budgetMonthlyComputeRequest.key,
	              loading: false,
	              error: shouldAllowBudgetMonthlyLocalComputeWithoutServer
	                  ? undefined
	                  : '后台预算明细计算不可用，未执行前端本地批量计算',
	              useLocalFallback: shouldAllowBudgetMonthlyLocalComputeWithoutServer,
	          });
	          return;
	      }
      let cancelled = false;
      const request = budgetMonthlyComputeRequest;
      setBudgetMonthlyServerState((prev) => ({
          key: request.key,
          loading: true,
          billsByKey: prev.key === request.key ? prev.billsByKey : undefined,
          contractOnlyByMonth: prev.key === request.key ? prev.contractOnlyByMonth : undefined,
      }));

      const billsPromise = request.billItems.length > 0
          ? fetchCloudBudgetedBillsPreviewBatch(cloudConfig, { items: request.billItems })
          : Promise.resolve({
              success: true,
              items: [] as Array<{ id: string; bills: BudgetedBill[]; count: number }>,
              count: 0,
              message: '无需账单预览计算',
          });
      const contractPromise = fetchCloudContractReceivableMonthly(cloudConfig, request.contractInput);

      Promise.all([billsPromise, contractPromise])
          .then(([billResult, contractResult]) => {
              if (cancelled) return;
	              if (!billResult.success || !billResult.items || !contractResult.success || !contractResult.months) {
	                  setBudgetMonthlyServerState({
	                      key: request.key,
	                      loading: false,
	                      error: billResult.message || contractResult.message || '后台预算明细计算失败',
	                      useLocalFallback: shouldRunBudgetMonthlyLocalFallback({
	                          shouldUseServer: shouldUseBudgetMonthlyServer,
	                          serverAttempted: true,
	                      }),
	                  });
	                  return;
	              }
              const billsByKey = new Map<string, BudgetedBill[]>();
              billResult.items.forEach((item) => {
                  billsByKey.set(item.id, item.bills);
              });
              const contractOnlyByMonth: Array<Map<string, number>> = Array.from({ length: 12 }, () => new Map<string, number>());
              const receivedContractMonths = new Set<number>();
              contractResult.months.forEach((month) => {
                  const idx = month.month - 1;
                  if (idx < 0 || idx >= 12) return;
                  receivedContractMonths.add(month.month);
                  contractOnlyByMonth[idx] = new Map(month.byTenantId.map((row) => [row.tenantId, row.amount] as const));
              });
              const serverPayloadError = validateBudgetMonthlyServerPayload(
                  request.billItems.map((item) => item.id),
                  billsByKey,
                  receivedContractMonths,
              );
	              if (serverPayloadError) {
	                  setBudgetMonthlyServerState({
	                      key: request.key,
	                      loading: false,
	                      error: serverPayloadError,
	                      useLocalFallback: shouldRunBudgetMonthlyLocalFallback({
	                          shouldUseServer: shouldUseBudgetMonthlyServer,
	                          serverAttempted: true,
	                      }),
	                  });
	                  return;
	              }
              setBudgetMonthlyServerState({
                  key: request.key,
                  loading: false,
                  billsByKey,
                  contractOnlyByMonth,
              });
          })
	          .catch((error: unknown) => {
	              if (cancelled) return;
	              setBudgetMonthlyServerState({
	                  key: request.key,
	                  loading: false,
	                  error: error instanceof Error ? error.message : '后台预算明细计算失败',
	                  useLocalFallback: shouldRunBudgetMonthlyLocalFallback({
	                      shouldUseServer: shouldUseBudgetMonthlyServer,
	                      serverAttempted: true,
	                  }),
	              });
	          });

      return () => {
          cancelled = true;
      };
  }, [
      budgetMonthlyComputeRequest,
      cloudConfig,
      shouldAllowBudgetMonthlyLocalComputeWithoutServer,
      shouldUseBudgetMonthlyServer,
  ]);

  const budgetMonthlyServerData: BudgetMonthlyServerData | undefined = useMemo(() => {
      if (!shouldUseBudgetMonthlyServer) return undefined;
      if (budgetMonthlyServerState.key !== budgetMonthlyComputeRequest.key) return undefined;
      if (!budgetMonthlyServerState.billsByKey || !budgetMonthlyServerState.contractOnlyByMonth) return undefined;
      return {
          billsByKey: budgetMonthlyServerState.billsByKey,
          contractOnlyByMonth: budgetMonthlyServerState.contractOnlyByMonth,
      };
  }, [budgetMonthlyComputeRequest.key, budgetMonthlyServerState, shouldUseBudgetMonthlyServer]);

	  const isBudgetMonthlyServerLoading =
	      shouldUseBudgetMonthlyServer &&
	      !budgetMonthlyServerState.useLocalFallback &&
	      (budgetMonthlyServerState.loading || budgetMonthlyServerState.key !== budgetMonthlyComputeRequest.key);
	  const isBudgetMonthlyServerBlocked =
	      shouldUseBudgetMonthlyServer &&
	      !budgetMonthlyServerState.useLocalFallback &&
	      !budgetMonthlyServerState.loading &&
	      budgetMonthlyServerState.key === budgetMonthlyComputeRequest.key &&
	      !!budgetMonthlyServerState.error;
      const isBudgetMonthlyLocalEngineLoading =
          shouldUseBudgetMonthlyLocalCompute && localBudgetEngineState.loading && !billCacheRef.current;
      const isBudgetMonthlyLocalEngineBlocked =
          shouldUseBudgetMonthlyLocalCompute && !!localBudgetEngineState.error && !billCacheRef.current;
      const isBudgetMonthlyLocalFallbackDisabled =
          shouldBuildBudgetMonthlyComputeRequest(viewMode) &&
          !shouldUseBudgetMonthlyServer &&
          !shouldUseBudgetMonthlyLocalCompute;
	  const isBudgetMonthlyServerUnavailable =
          isBudgetMonthlyServerLoading ||
          isBudgetMonthlyServerBlocked ||
          isBudgetMonthlyLocalEngineLoading ||
          isBudgetMonthlyLocalEngineBlocked ||
          isBudgetMonthlyLocalFallbackDisabled;

  const generateMonthlyDetail = (year: number, serverData?: BudgetMonthlyServerData): any[] => {
      const rows: any[] = [];
      const billingGenStart = new Date(year - 2, 0, 1);
      const billingGenEnd = new Date(year, 11, 31);
	      const resolveBudgetedBills = (
	          key: string,
	          tenant: Tenant,
	          assumptions: BudgetAssumption[],
	          adjustments: BudgetAdjustment[],
	      ): BudgetedBill[] => {
	          return resolveBudgetMonthlyBillsForKey(key, serverData, () =>
	              generateBudgetedBillsCached(tenant, assumptions, adjustments, billingGenStart, billingGenEnd, key),
	          );
	      };
      const addMonths = (dateStr: string, months: number): string => { const d = new Date(dateStr); d.setMonth(d.getMonth() + months); return d.toISOString().split('T')[0]; };
      const formatFloorSummary = (floors: number[]): string => {
          const uniq = Array.from(new Set(floors)).sort((a, b) => a - b);
          if (uniq.length === 0) return '—';
          return uniq.map(f => `${f}F`).join(' / ');
      };

      const buildingById = new Map(buildings.map((b) => [b.id, b] as const));
      const buildingByName = new Map(buildings.map((b) => [b.name, b] as const));
      const unitById = new Map<string, Unit>();
      buildings.forEach((building) => {
          building.units.forEach((unit) => unitById.set(unit.id, unit));
      });
	      const assumptionByTarget = new Map<string, BudgetAssumption>();
	      budgetAssumptions.forEach((assumption) => {
	          assumptionByTarget.set(`${assumption.targetType}:${assumption.targetId}`, assumption);
	      });
	      const adjustmentsByTenantId = new Map<string, BudgetAdjustment[]>();
	      budgetAdjustments.forEach((adjustment) => {
	          const list = adjustmentsByTenantId.get(adjustment.tenantId);
	          if (list) list.push(adjustment);
	          else adjustmentsByTenantId.set(adjustment.tenantId, [adjustment]);
	      });
	      const findAssumption = (
	          targetId: string,
	          targetType: BudgetAssumption['targetType'],
      ): BudgetAssumption | undefined => assumptionByTarget.get(`${targetType}:${targetId}`);

      const selfUseUnitIds = new Set<string>();
      buildings.forEach(b => b.units.forEach(u => { if (u.isSelfUse) selfUseUnitIds.add(u.id); }));

      // 合同应收单源入口：与工作台 calculateTrends.contractReceivable / 财务报表 contractAmountDue
      // 共用 buildContractOnlyReceivableForPeriod。Live 下必须传入与工作台相同的规范化方案列表，
      // 才能命中「应收专用方案」+ 根级假设合并（与 `calculateDashboardMetrics` 一致）；切到具体编制方案时
      // 仍传空数组，避免误用应收专用快照覆盖当前正在编辑的方案视图。
      const contractOnlyBudgetScenarios =
          activeScenarioId === 'current' ? normalizeScenarioForReceivable(scenarios, propTenants, propBuildings) : [];
      const contractOnlyCtx: ContractOnlyReceivableCtx = {
          tenants,
          buildings,
          payments,
          initializationData: [],
          budgetAssumptions: budgetAssumptions,
          budgetAdjustments: budgetAdjustments,
          budgetScenarios: contractOnlyBudgetScenarios,
      };
      const contractOnlyByMonth: Array<Map<string, number>> =
          serverData?.contractOnlyByMonth ||
          Array.from({ length: 12 }, (_, m) => {
              const builder = contractReceivableBuilderRef.current;
              return builder ? builder(year, m, contractOnlyCtx).byTenantId : new Map<string, number>();
          });
      const actualRentCollectionIndex = buildBudgetActualRentCollectionIndex(payments, propTenants);

      tenants.forEach(t => {
          if (t.status === ContractStatus.Terminated || t.status === ContractStatus.Expired) {
              return;
          }
          const isSelfUse = t.unitIds.some(uid => selfUseUnitIds.has(uid));
          if (isSelfUse) {
              return;
          }
          // 特殊业态：合同不滚动账单，应收金额由「财务报表 → 特殊业态收入录入」按月手工录入；
          // 预算明细同理不再按合同自动列入。
          if (t.isSpecialBusiness) {
              return;
          }

          const leaseEndYear = new Date(t.leaseEnd).getFullYear();
          const isExpiringThisYear = leaseEndYear === year;
          let category = '存量客户';
          let assumptionType: 'Renewal' | 'RiskTermination' | 'Existing' | null = null;
          
          const riskAsm = findAssumption(t.id, 'RiskTermination');
          const renewAsm = findAssumption(t.id, 'Renewal');

          if (t.isRisk && riskAsm) { assumptionType = 'RiskTermination'; category = '高风险退租'; }
          else if (isExpiringThisYear && renewAsm) { 
              assumptionType = 'Renewal'; 
              if (renewAsm.strategy === 'ReLease') category = '到期退租招商'; else category = '续签客户'; 
          }
          else assumptionType = 'Existing';

          const building = buildingById.get(t.buildingId);
          const unitNames = t.unitIds.map(uid => unitById.get(uid)?.name || uid).join(', ');
          const tenantFloors = t.unitIds
              .map(uid => unitById.get(uid)?.floor)
              .filter((f): f is number => typeof f === 'number');
          const floorSummary = formatFloorSummary(tenantFloors);
          const tenantBills = resolveBudgetedBills(`tenant:${t.id}:budget`, t, budgetAssumptions, budgetAdjustments);
          
          // amount and area tracking
          let monthlyValues = Array(12).fill(null).map(() => ({ amount: 0, actual: 0, isAdjustedIn: false, isAdjustedOut: false, adjustmentDetail: '' }));
          let monthlyLeasedArea = Array(12).fill(0);

          // 1. Existing Lease Area & Rent
          for (let m = 0; m < 12; m++) {
              const monthStart = new Date(year, m, 1);
              const monthEnd = new Date(year, m + 1, 0);
              const leaseStart = new Date(t.leaseStart);
              const leaseEnd = t.terminationDate ? new Date(t.terminationDate) : new Date(t.leaseEnd);
              
              if (leaseStart <= monthEnd && leaseEnd >= monthStart) {
                  monthlyLeasedArea[m] = t.totalArea;
              }
          }

          // 合同应收：直接读单源入口结果，确保与工作台 / 财务报表完全一致；
          // tenantBills 仍然保留供下面「续签 / 高风险退租」假设扩展和复核字段使用。
          for (let m = 0; m < 12; m++) {
              monthlyValues[m].amount = contractOnlyByMonth[m].get(t.id) ?? 0;
          }

          // ACTUAL DATA CALCULATION FOR TENANT
          // 与财务报表「收款明细」一致：优先按关联账期 period 归属，未填账期才按入账月份归属。
          for (let m = 0; m < 12; m++) {
              const periodYYYYMM = `${year}-${String(m + 1).padStart(2, '0')}`;
              monthlyValues[m].actual += sumBudgetActualRentCollectionForTenantPeriod(
                  actualRentCollectionIndex,
                  t,
                  periodYYYYMM,
              );
          }

          // 2. Assumptions Extension
          const assumption = assumptionType ? findAssumption(t.id, assumptionType) : undefined;
          if (assumption && assumptionType !== 'Existing') {
             let newStart: Date | null = null;
             if (assumption.targetType === 'Renewal' && assumption.strategy !== 'ReLease') { const le = new Date(t.leaseEnd); le.setDate(le.getDate() + 1); newStart = le; } 
             else if (assumption.strategy === 'ReLease' || assumption.targetType === 'RiskTermination') { const baseDate = assumption.targetType === 'RiskTermination' && assumption.projectedTerminationDate ? new Date(assumption.projectedTerminationDate) : new Date(t.leaseEnd); const gap = assumption.vacancyGapMonths || 0; newStart = new Date(baseDate); newStart.setMonth(newStart.getMonth() + gap); newStart.setDate(newStart.getDate() + 1); }

             if (newStart) {
                 const newStartStr = newStart.toISOString().split('T')[0];
                 const newEnd = new Date(newStart); newEnd.setFullYear(newEnd.getFullYear() + 3); 
                 const firstPayDate = addMonths(newStartStr, assumption.projectedRentFreeMonths || 0);
                 
                 // Extension Area contribution
                 for (let m = 0; m < 12; m++) {
                    const monthStart = new Date(year, m, 1);
                    const monthEnd = new Date(year, m + 1, 0);
                    if (newStart <= monthEnd && newEnd >= monthStart) {
                        monthlyLeasedArea[m] = t.totalArea; 
                    }
                 }

                 const virtualTenant: Tenant = {
                     ...t, id: `virtual_${t.id}`, leaseStart: newStartStr, leaseEnd: newEnd.toISOString().split('T')[0], unitPrice: assumption.projectedUnitPrice, monthlyRent: 0,
                     rentFreePeriods: assumption.projectedRentFreeMonths > 0 ? [{ start: newStartStr, end: new Date(new Date(newStart).setMonth(newStart.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0], description: 'Assumption Rent Free' }] : [],
                     firstPaymentDate: firstPayDate, freeRentHandling: 'Defer'
                 };
                 const virtualBills = resolveBudgetedBills(`tenant:${t.id}:virtual-extension`, virtualTenant, [], []);
                 virtualBills.forEach((bill) => {
                     const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, virtualTenant);
                     if (y === year && m >= 0 && m < 12) monthlyValues[m].amount += bill.amount;
                 });
             }
          }

          budgetAdjustments.forEach((adj) => {
              if (adj.tenantId !== t.id) return;
              const isAmt = adj.adjustmentKind === 'amount_delta' || (adj.originalYear === -1 && adj.originalMonth === -1);
              if (isAmt) {
                  if (adj.adjustedYear === year) {
                      const m = adj.adjustedMonth;
                      if (m >= 0 && m < 12) {
                          const tag = `金额 Δ ${adj.amount >= 0 ? '+' : ''}${formatCurrency(adj.amount)}`;
                          monthlyValues[m].adjustmentDetail = monthlyValues[m].adjustmentDetail
                              ? `${monthlyValues[m].adjustmentDetail} | ${tag}`
                              : tag;
                      }
                  }
                  return;
              }
              if (adj.originalYear === year) {
                  const m = adj.originalMonth;
                  if (m >= 0 && m < 12) {
                      // 账期调出后，原账期预算额应清零，避免继续参与合计
                      monthlyValues[m].amount = 0;
                      monthlyValues[m].isAdjustedOut = true;
                      monthlyValues[m].adjustmentDetail = `调出 -> ${adj.adjustedYear}年${adj.adjustedMonth + 1}月`;
                  }
              }
              if (adj.adjustedYear === year) {
                  const m = adj.adjustedMonth;
                  if (m >= 0 && m < 12) {
                      monthlyValues[m].isAdjustedIn = true;
                      monthlyValues[m].adjustmentDetail = `调入 <- ${adj.originalYear}年${adj.originalMonth + 1}月 (${adj.reason})`;
                  }
              }
          });

          // 复核：检查预算假设/调整对合同应收的偏离
          const existingAsm = findAssumption(t.id, 'Existing');
	          const tenantAdjustments = adjustmentsByTenantId.get(t.id) || [];
          const verificationReasons: string[] = [];
          // 整体偏移已迁移到合同，仅检查预算级调价/付款转移
          if (existingAsm?.priceAdjustment?.startDate) verificationReasons.push(`单价调整(${existingAsm.priceAdjustment.newUnitPrice}元/㎡·天)`);
          if (existingAsm?.paymentShift?.isActive) verificationReasons.push(`付款转移 ${existingAsm.paymentShift.fromYear}/${existingAsm.paymentShift.fromMonth+1}→${existingAsm.paymentShift.toYear}/${existingAsm.paymentShift.toMonth+1}`);
          if (t.paymentPeriodShiftMonths) verificationReasons.push(`合同整体偏移 ${t.paymentPeriodShiftMonths > 0 ? '后移' : '前移'}${Math.abs(t.paymentPeriodShiftMonths)}月`);
          if ((t.paymentPeriodAdjustments || []).length > 0) verificationReasons.push(`${t.paymentPeriodAdjustments!.length}笔合同账期调整`);
          if (tenantAdjustments.length > 0) verificationReasons.push(`${tenantAdjustments.length}笔调账`);
          const hasBudgetMods = verificationReasons.length > 0;
          const pureBills = hasBudgetMods
              ? resolveBudgetedBills(`tenant:${t.id}:pure`, t, [], [])
              : tenantBills;
          const pureTotal = pureBills.reduce((s, b) => {
              if (b.date.getFullYear() === year) s += b.amount;
              return s;
          }, 0);
          const budgetTotal = tenantBills.reduce((s, b) => {
              if (b.date.getFullYear() === year) s += b.amount;
              return s;
          }, 0);
          const contractDiff = budgetTotal - pureTotal;

          rows.push({
              id: t.id,
              name: t.name,
              building: building?.name || '未知楼宇',
              unitNames,
              floorSummary,
              area: t.totalArea,
              category,
              signingDate: t.signingDate,
              leaseStart: t.leaseStart,
              isNewSigningInYear: !!t.signingDate && new Date(t.signingDate).getFullYear() === year,
              leaseStartMonthInYear: t.leaseStart && new Date(t.leaseStart).getFullYear() === year ? new Date(t.leaseStart).getMonth() : null,
              terminationDate: t.terminationDate,
              isTerminatingInYear: !!t.terminationDate && new Date(t.terminationDate).getFullYear() === year,
              paymentCycle: t.paymentCycle || 'Quarterly',
              paymentCycleLabel: paymentCycleLabel(t.paymentCycle),
              paymentCycleOrder: paymentCycleOrder(t.paymentCycle),
              buildingSort: building?.name || '未知楼宇',
              floorSort: tenantFloors.length > 0 ? Math.min(...tenantFloors) : 9999,
              roomSort: tenantSortRoomKey(t, building) || unitNames,
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: t.unitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, t.rentFreePeriods || []),
              rentFreeMonthFlags: yearRentFreeMonthFlags(year, t.rentFreePeriods || []),
              // 复核字段
              hasBudgetMods,
              isVirtual: false,
              verificationReasons,
              contractDiff,
          });
      });

      // 主循环跳过了已退租/已到期客户，但工作台与核销仍会把其「合同滚动尾款」计入当月 contractReceivable；
      // 这里按 contractOnlyByMonth 补行，避免表内逐行合计低于引擎全量合计。
      const rowIds = new Set(rows.map((r) => r.id));
      for (const t of propTenants) {
          if (rowIds.has(t.id)) continue;
          if (t.status !== ContractStatus.Terminated && t.status !== ContractStatus.Expired) continue;
          const isSelfUseOr = t.unitIds.some((uid) => selfUseUnitIds.has(uid));
          if (isSelfUseOr || t.isSpecialBusiness) continue;
          const monthlyValuesOrphan = Array(12).fill(null).map((_, m) => {
              const amount = contractOnlyByMonth[m].get(t.id) ?? 0;
              return { amount, actual: 0, isAdjustedIn: false, isAdjustedOut: false, adjustmentDetail: '' };
          });
          if (!monthlyValuesOrphan.some((v) => v.amount > 0.005)) continue;
          const buildingOr = buildingById.get(t.buildingId);
          const unitNamesOr = t.unitIds
              .map((uid) => unitById.get(uid)?.name || uid)
              .join(', ');
          const tenantFloorsOr = t.unitIds
              .map((uid) => unitById.get(uid)?.floor)
              .filter((f): f is number => typeof f === 'number');
          rows.push({
              id: t.id,
              name: t.name,
              building: buildingOr?.name || '未知楼宇',
              unitNames: unitNamesOr,
              floorSummary: formatFloorSummary(tenantFloorsOr),
              area: t.totalArea,
              category: '已退租·合同应收',
              signingDate: t.signingDate,
              leaseStart: t.leaseStart,
              isNewSigningInYear: !!t.signingDate && new Date(t.signingDate).getFullYear() === year,
              leaseStartMonthInYear:
                  t.leaseStart && new Date(t.leaseStart).getFullYear() === year ? new Date(t.leaseStart).getMonth() : null,
              terminationDate: t.terminationDate,
              isTerminatingInYear: !!t.terminationDate && new Date(t.terminationDate).getFullYear() === year,
              paymentCycle: t.paymentCycle || 'Quarterly',
              paymentCycleLabel: paymentCycleLabel(t.paymentCycle),
              paymentCycleOrder: paymentCycleOrder(t.paymentCycle),
              buildingSort: buildingOr?.name || '未知楼宇',
              floorSort: tenantFloorsOr.length > 0 ? Math.min(...tenantFloorsOr) : 9999,
              roomSort: tenantSortRoomKey(t, buildingOr) || unitNamesOr,
              monthlyValues: monthlyValuesOrphan,
              monthlyLeasedArea: Array(12).fill(0),
              unitPrice: t.unitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, t.rentFreePeriods || []),
              rentFreeMonthFlags: yearRentFreeMonthFlags(year, t.rentFreePeriods || []),
              hasBudgetMods: false,
              isVirtual: false,
              verificationReasons: ['已退租/到期：本行金额仅含与工作台一致的合同滚动应收'],
              contractDiff: 0,
          });
      }

      // 「年初预算 (Live)」要展示空置去化的预测（含 projectedSignDate 等假设），其他新建预算方案默认仅基于
      // 「实际履约合同」推算账单（含免租、收款周期、账期调整），所以跳过空置去化整段，确保
      // 全年预算总额 = 实际合同应收，与工作台「合同应收」/财务报表口径完全一致。
      const includeVacancyProjections = activeScenarioId === 'current';
      if (includeVacancyProjections) vacantUnits.forEach(u => {
          const assumption = findAssumption(u.unitId, 'Vacancy');
          let monthlyValues = Array(12).fill(null).map(() => ({ amount: 0, actual: 0, isAdjustedIn:false, isAdjustedOut:false, adjustmentDetail:'' }));
          let monthlyLeasedArea = Array(12).fill(0);
          let vacantUnitPrice: number | undefined;
          let vacantRentPeriods: RentFreePeriod[] = [];

          if (assumption && assumption.projectedSignDate) {
             const start = new Date(assumption.projectedSignDate);
             const end = new Date(start); end.setFullYear(end.getFullYear() + 5);
             
             // Vacancy Area contribution
             for (let m = 0; m < 12; m++) {
                const monthStart = new Date(year, m, 1);
                const monthEnd = new Date(year, m + 1, 0);
                if (start <= monthEnd && end >= monthStart) {
                    monthlyLeasedArea[m] = u.area;
                }
             }

             const firstPayDate = addMonths(assumption.projectedSignDate, assumption.projectedRentFreeMonths || 0);
             const virtualTenant: Tenant = {
                 id: u.unitId, name: '待租单元', buildingId: '', unitIds: [u.unitId], totalArea: u.area, leaseStart: assumption.projectedSignDate, leaseEnd: end.toISOString().split('T')[0], unitPrice: assumption.projectedUnitPrice, monthlyRent: 0, paymentCycle: 'Quarterly', paymentCycleMonths: 3, firstPaymentMonths: 3, firstPaymentDate: firstPayDate, depositAmount: 0, depositStatus: DepositStatus.Unpaid, status: ContractStatus.Active,
                 rentFreePeriods: assumption.projectedRentFreeMonths > 0 ? [{ start: assumption.projectedSignDate, end: new Date(new Date(start).setMonth(start.getMonth() + assumption.projectedRentFreeMonths)).toISOString().split('T')[0], description: 'Vacancy Rent Free' }] : [], 
                 freeRentHandling: 'Defer'
             };
             const virtualBills = resolveBudgetedBills(`vacancy:${u.unitId}`, virtualTenant, [], budgetAdjustments);
             virtualBills.forEach((bill) => {
                 const { year: y, monthIndex: m } = receivableBudgetMonthForBill(bill, virtualTenant);
                 if (y === year && m >= 0 && m < 12) monthlyValues[m].amount += bill.amount;
             });
             vacantUnitPrice = assumption.projectedUnitPrice;
             vacantRentPeriods = virtualTenant.rentFreePeriods || [];
          }
          const vacantBuilding = buildingByName.get(u.buildingName);
          const vacantFloor = unitById.get(u.unitId)?.floor ?? vacantBuilding?.units.find(x => x.id === u.unitId)?.floor;
          rows.push({
              id: u.unitId,
              name: '待租单元',
              building: u.buildingName,
              unitNames: u.unitName,
              floorSummary: formatFloorSummary([vacantFloor].filter((f): f is number => typeof f === 'number')),
              area: u.area,
              category: '空置去化',
              signingDate: assumption?.projectedSignDate,
              leaseStart: assumption?.projectedSignDate,
              isNewSigningInYear: !!assumption?.projectedSignDate && new Date(assumption.projectedSignDate).getFullYear() === year,
              leaseStartMonthInYear: assumption?.projectedSignDate && new Date(assumption.projectedSignDate).getFullYear() === year ? new Date(assumption.projectedSignDate).getMonth() : null,
              paymentCycle: 'Quarterly',
              paymentCycleLabel: paymentCycleLabel('Quarterly'),
              paymentCycleOrder: paymentCycleOrder('Quarterly'),
              buildingSort: u.buildingName,
              floorSort: typeof vacantFloor === 'number' ? vacantFloor : 9999,
              roomSort: u.unitName,
              monthlyValues,
              monthlyLeasedArea,
              unitPrice: vacantUnitPrice,
              rentFreeYearSummary: formatYearRentFreeSummary(year, vacantRentPeriods),
              rentFreeMonthFlags: yearRentFreeMonthFlags(year, vacantRentPeriods),
          });
      });

      // 若该年度存在已导入预算表，则预算金额优先采用导入明细（客户+房号+楼宇精确匹配）。
      // 这样可避免合同账单口径（账期/免租/调账）与财务预算表口径不一致导致的显示偏差。
      const imported = readImportedBudgetTable(billingPeriodNotes, year);
      if (!imported?.rows?.length) return rows;

      const importedByKey = new Map(
          imported.rows.map((r) => [importedBudgetRowKey(r.customer, r.unit, r.building), r] as const)
      );
      const links = readBudgetCustomerNameLinks(billingPeriodNotes, year);
      const linkImportKeyByTenantId = new Map(links.map((l) => [l.tenantId, l.importKey] as const));

      return rows.map((row) => {
          const directKey = importedBudgetRowKey(row.name, row.unitNames, row.building);
          let importedRow = importedByKey.get(directKey);
          let matchedImportKey = importedRow ? directKey : '';
          if (!importedRow) {
              const lk = linkImportKeyByTenantId.get(row.id);
              if (lk) {
                  importedRow = importedByKey.get(lk);
                  if (importedRow) matchedImportKey = lk;
              }
          }
          if (!importedRow) return row;
          // 与财务报表 applyImportedBudgetRowsToBillingDetails 一致：导入格为 0/空视为「未覆盖」，保留合同滚动推算额
          const nextMonthlyValues = row.monthlyValues.map((mv: any, idx: number) => {
              const importedCell = Math.round(Number(importedRow.months[idx] ?? 0));
              const amount = importedCell > 0.005 ? importedCell : mv.amount;
              return { ...mv, amount };
          });
          return {
              ...row,
              monthlyValues: nextMonthlyValues,
              // 导入明细里的单价/面积更贴近预算模板，存在时用于展示
              unitPrice: importedRow.unitPrice != null ? importedRow.unitPrice : row.unitPrice,
              area: importedRow.area != null ? importedRow.area : row.area,
              importedBudgetKey: matchedImportKey,
              importedBudgetSource: {
                  customer: importedRow.customer,
                  unit: importedRow.unit,
                  building: importedRow.building,
              },
          };
      });
  };

  const exportToExcel = async () => {
    if (isBudgetMonthlyServerUnavailable) {
        if (isBudgetMonthlyServerBlocked) {
            await showBudgetNotice({
                title: '预算明细计算失败',
                message: '后台预算明细计算失败，未执行前端本地批量计算。请检查后台服务后重试。',
                tone: 'rose',
            });
        } else if (isBudgetMonthlyLocalFallbackDisabled) {
            await showBudgetNotice({
                title: '预算明细计算不可用',
                message: '后台预算明细计算不可用，未执行前端本地批量计算。请检查后台服务后重试。',
                tone: 'rose',
            });
        } else if (isBudgetMonthlyLocalEngineBlocked) {
            await showBudgetNotice({
                title: '本地预算账单引擎加载失败',
                message: `无法生成离线预算明细：${localBudgetEngineState.error || '未知错误'}`,
                tone: 'rose',
            });
        } else if (isBudgetMonthlyLocalEngineLoading) {
            await showBudgetNotice({
                title: '预算账单引擎加载中',
                message: '本地预算账单引擎正在按需加载，请稍后再导出。',
                tone: 'amber',
            });
        } else {
            await showBudgetNotice({
                title: '预算明细计算中',
                message: '后台正在计算预算明细，请稍后再导出。',
                tone: 'amber',
            });
        }
        return;
    }

    const scenarioLabel =
        activeScenarioId === 'current'
            ? '当前合同履约预算情况 (Live)'
            : (scenarios.find((s) => s.id === activeScenarioId)?.name || activeScenarioId);

    try {
        const { exportBudgetMonthlyExcel } = await import('../services/budgetMonthlyExcelExport');
        await exportBudgetMonthlyExcel({
            detailYear,
            viewMode,
            groups: groupData(detailMonthlyData),
            scenarioLabel,
        });
    } catch (e) {
        console.error(e);
        await showBudgetNotice({
            title: '导出失败',
            message: '导出失败，请重试或更新浏览器。',
            tone: 'rose',
        });
    }
  };

  const groupData = (data: any[]) => {
      const rowCompare = (a: any, b: any) => {
          const building = String(a.buildingSort || a.building || '').localeCompare(String(b.buildingSort || b.building || ''), 'zh-CN', { numeric: true });
          if (building !== 0) return building;
          const floor = (a.floorSort ?? 9999) - (b.floorSort ?? 9999);
          if (floor !== 0) return floor;
          const room = compareUnitNameNumeric(String(a.roomSort || a.unitNames || ''), String(b.roomSort || b.unitNames || ''));
          if (room !== 0) return room;
          return String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN');
      };
      const groupOrder = (name: string, rows: any[]) => {
          if (sortMethod === 'PaymentCycle') return rows[0]?.paymentCycleOrder ?? 99;
          if (sortMethod === 'Building') return String(name);
          const categoryIndex = ['存量客户', '续签客户', '到期退租招商', '高风险退租', '空置去化', '已退租·合同应收'].indexOf(
              name,
          );
          return categoryIndex >= 0 ? categoryIndex : 99;
      };
      const groups = new Map<string, any[]>();
      data.forEach(r => {
          const key = sortMethod === 'Category' ? r.category : sortMethod === 'Building' ? r.building : r.paymentCycleLabel;
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key)!.push(r);
      });
      const entries = Array.from(groups.entries()).map(([key, rows]) => [key, rows.sort(rowCompare)] as const);
      entries.sort((a, b) => {
          const oa = groupOrder(a[0], a[1]);
          const ob = groupOrder(b[0], b[1]);
          if (typeof oa === 'number' && typeof ob === 'number' && oa !== ob) return oa - ob;
          return String(a[0]).localeCompare(String(b[0]), 'zh-CN', { numeric: true });
      });
      return Object.fromEntries(entries);
  };

	  const detailMonthlyData = useMemo(
	      () => {
	          if (!shouldBuildBudgetDetailRows || isBudgetMonthlyServerUnavailable) return [];
	          return generateMonthlyDetail(detailYear, budgetMonthlyServerData);
	      },
	      [
	          shouldBuildBudgetDetailRows,
	          detailYear,
	          activeScenarioId,
          buildings,
          tenants,
          propTenants,
          propBuildings,
          budgetAssumptions,
          budgetAdjustments,
          payments,
          vacantUnits,
          scenarios,
          billingPeriodNotes,
          budgetMonthlyServerData,
          isBudgetMonthlyServerUnavailable,
      ],
  );

  const detailGroups = useMemo(
      () => (shouldBuildBudgetDetailRows ? groupData(detailMonthlyData) : {}),
      [detailMonthlyData, shouldBuildBudgetDetailRows, sortMethod],
  );

  useEffect(() => {
      if (!selectedMobileBudgetRow || detailMonthlyData.length === 0) return;
      const freshRow = detailMonthlyData.find((row: any) =>
          row.id === selectedMobileBudgetRow.id && row.category === selectedMobileBudgetRow.category
      );
      if (freshRow && freshRow !== selectedMobileBudgetRow) {
          setSelectedMobileBudgetRow(freshRow);
      }
  }, [
      detailMonthlyData,
      selectedMobileBudgetRow?.id,
      selectedMobileBudgetRow?.category,
  ]);

  const selectedMobileBudgetRowTenant = selectedMobileBudgetRow
      ? tenants.find((tenant) => tenant.id === selectedMobileBudgetRow.id)
      : undefined;
  const selectedMobileBudgetEditMode: 'amount_delta' | 'imported_month' =
      selectedMobileBudgetRow?.importedBudgetKey ? 'imported_month' : 'amount_delta';
  const selectedMobileBudgetEditDisabledReason = selectedMobileBudgetRow
      ? importedBudgetForDetailYear
          ? selectedMobileBudgetRow.importedBudgetKey
              ? undefined
              : '当前年份使用导入预算表，但此行未匹配到导入明细，暂不能在手机端编辑。请先在预算名称关联工具或导入模板中完成客户 / 房号 / 楼宇匹配。'
          : !selectedMobileBudgetRowTenant
            ? '当前行不是已登记合同客户，移动端暂不新增人工金额调整。'
            : undefined
      : undefined;

  const groupAdjustmentsByTenant = (list: BudgetAdjustment[]) => {
      const groups: Record<string, BudgetAdjustment[]> = {};
      list.forEach((adj) => {
          if (!groups[adj.tenantName]) groups[adj.tenantName] = [];
          groups[adj.tenantName].push(adj);
      });
      return groups;
  };

  const isAmountDeltaAdj = (a: BudgetAdjustment) => a.originalYear === -1 && a.originalMonth === -1;

  const periodAdjustmentsList = useMemo(
      () => budgetAdjustments.filter((a) => !isAmountDeltaAdj(a)),
      [budgetAdjustments]
  );
  const amountAdjustmentsList = useMemo(
      () => budgetAdjustments.filter((a) => isAmountDeltaAdj(a)),
      [budgetAdjustments]
  );

  const groupedPeriodAdjustments = useMemo(
      () => groupAdjustmentsByTenant(periodAdjustmentsList),
      [periodAdjustmentsList]
  );
  const groupedAmountAdjustments = useMemo(
      () => groupAdjustmentsByTenant(amountAdjustmentsList),
      [amountAdjustmentsList]
  );

  const impactStats = useMemo(() => {
    let currentYearNet = 0;
    let nextYearNet = 0;
    budgetAdjustments.forEach(adj => {
        if (adj.originalYear === detailYear) currentYearNet -= adj.amount;
        if (adj.adjustedYear === detailYear) currentYearNet += adj.amount;
        if (adj.originalYear === detailYear + 1) nextYearNet -= adj.amount;
        if (adj.adjustedYear === detailYear + 1) nextYearNet += adj.amount;
    });
    return { currentYearNet, nextYearNet };
  }, [budgetAdjustments, detailYear]);

  /** 按客户汇总：与本页「本年度/次年度预算影响」同一套口径（逐条加减） */
  const tenantAdjustmentSummary = useMemo(() => {
    const byTenant = new Map<string, { tenantId: string; tenantName: string; adjs: BudgetAdjustment[]; currentYearNet: number; nextYearNet: number }>();
    for (const adj of budgetAdjustments) {
      let row = byTenant.get(adj.tenantId);
      if (!row) {
        row = { tenantId: adj.tenantId, tenantName: adj.tenantName, adjs: [], currentYearNet: 0, nextYearNet: 0 };
        byTenant.set(adj.tenantId, row);
      }
      row.adjs.push(adj);
      if (adj.originalYear === detailYear) row.currentYearNet -= adj.amount;
      if (adj.adjustedYear === detailYear) row.currentYearNet += adj.amount;
      if (adj.originalYear === detailYear + 1) row.nextYearNet -= adj.amount;
      if (adj.adjustedYear === detailYear + 1) row.nextYearNet += adj.amount;
    }
    for (const row of byTenant.values()) {
      row.adjs.sort((a, b) => {
        const ay = a.adjustmentKind === 'amount_delta' ? a.adjustedYear : a.originalYear;
        const am = a.adjustmentKind === 'amount_delta' ? a.adjustedMonth : a.originalMonth;
        const by = b.adjustmentKind === 'amount_delta' ? b.adjustedYear : b.originalYear;
        const bm = b.adjustmentKind === 'amount_delta' ? b.adjustedMonth : b.originalMonth;
        if (ay !== by) return ay - by;
        return am - bm;
      });
    }
    return Array.from(byTenant.values()).sort((a, b) => a.tenantName.localeCompare(b.tenantName, 'zh-CN'));
  }, [budgetAdjustments, detailYear]);

	  const renderRenewalCard = (tenant: Tenant) => {
	      const asm = getAssumption(tenant.id, 'Renewal', tenant.name);
	      return (
	          <div key={tenant.id} className="liquid-glass-readable liquid-pressable rounded-[20px] p-4">
	              <div className="flex justify-between items-start mb-3">
	                  <div>
	                      <h4 className="font-bold text-slate-700 truncate max-w-[10rem]" title={tenant.name}>
                          {tenant.name}
                      </h4>
                      <p className="text-xs text-rose-500 font-medium">到期日: {tenant.leaseEnd}</p>
	                  </div>
	                  <select
	                      className={`rounded-full border px-2 py-1 text-xs font-bold outline-none ${asm.strategy === 'Renewal' ? 'bg-blue-50/90 text-blue-700 border-blue-200' : 'bg-amber-50/90 text-amber-700 border-amber-200'}`}
	                      value={asm.strategy}
	                      onChange={(e) => updateAssumption({ ...asm, strategy: e.target.value as 'Renewal' | 'ReLease' })}
	                  >
                      <option value="Renewal">续签</option>
                      <option value="ReLease">到期退租招商</option>
                  </select>
	              </div>
	              {asm.strategy === 'ReLease' ? (
	                  <div className="space-y-3 rounded-2xl bg-amber-50/72 p-3">
	                      <div className="grid grid-cols-2 gap-2">
	                          <div>
	                              <label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label>
	                              <input type="number" inputMode="decimal" enterKeyHint="done" className={budgetCompactInputClass} value={asm.vacancyGapMonths} onChange={(e) => updateAssumption({ ...asm, vacancyGapMonths: Number(e.target.value) })} />
	                          </div>
	                          <div>
	                              <label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label>
	                              <input type="number" inputMode="decimal" enterKeyHint="done" step="0.1" className={budgetCompactInputClass} value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
	                          </div>
	                      </div>
	                      <div>
	                          <label className="text-xs font-medium text-slate-500 block mb-1">新租免租期(月)</label>
	                          <input type="number" inputMode="decimal" enterKeyHint="done" className={budgetCompactInputClass} value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
	                      </div>
	                  </div>
	              ) : (
	                  <div className="space-y-3 rounded-2xl bg-blue-50/70 p-3">
	                      <div className="grid grid-cols-2 gap-2">
	                          <div>
	                              <label className="text-xs font-medium text-slate-500 block mb-1">续签单价</label>
	                              <input type="number" inputMode="decimal" enterKeyHint="done" step="0.1" className={budgetCompactInputClass} value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
	                          </div>
	                          <div>
	                              <label className="text-xs font-medium text-slate-500 block mb-1">免租激励(月)</label>
	                              <input type="number" inputMode="decimal" enterKeyHint="done" className={budgetCompactInputClass} value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
	                          </div>
	                      </div>
	                  </div>
              )}
          </div>
      );
  };

	  const renderSettingsView = () => {
	    return (
	        <div className="grid grid-cols-1 gap-6 p-1">
	            <div className="liquid-glass-control col-span-full flex flex-wrap gap-1 rounded-[20px] p-1">
		                <button onClick={() => setActiveTab('Vacancy')} className={`liquid-pressable rounded-2xl px-4 py-2 text-sm font-bold transition-colors ${activeTab === 'Vacancy' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>空置去化 ({vacantUnits.length})</button>
		                <button onClick={() => setActiveTab('Renewal')} className={`liquid-pressable rounded-2xl px-4 py-2 text-sm font-bold transition-colors ${activeTab === 'Renewal' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>到期续约 ({expiringTenants.length})</button>
		                <button onClick={() => setActiveTab('Risk')} className={`liquid-pressable rounded-2xl px-4 py-2 text-sm font-bold transition-colors ${activeTab === 'Risk' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>风险应对 ({riskTenants.length})</button>
	            </div>

            <div className="col-span-full min-w-0 animate-in fade-in slide-in-from-bottom-2">
                {activeTab === 'Vacancy' && (
                    <div className="space-y-8">
                        {vacantUnitsGrouped.map(({ building, count, floors }) => (
                            <section key={building.id} className="space-y-4">
                                <h3 className="text-sm font-bold text-slate-800 border-l-4 border-blue-500 pl-2">
                                    {building.name}
                                    <span className="font-normal text-slate-500 text-xs ml-2">本楼待去化 {count} 间</span>
                                </h3>
                                {floors.map(({ floor, units }) => (
                                    <div key={`${building.id}-${floor}`} className="space-y-2">
                                        <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                            {building.id === '__unknown__' && floor === 0 ? '未关联资产' : `第 ${floor} 层`}
                                        </h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {units.map((unit) => {
                                                const asm = getAssumption(unit.unitId, 'Vacancy', `${unit.unitName} (Vacancy)`);
                                                return (
	                                                    <div key={unit.unitId} className="liquid-glass-readable liquid-pressable rounded-[20px] p-4">
	                                                        <div className="flex justify-between items-start mb-3">
	                                                            <div>
	                                                                <h4 className="font-bold text-slate-700">{unit.unitName}</h4>
	                                                                <p className="text-xs text-slate-500">{formatArea(unit.area)}</p>
	                                                            </div>
	                                                            <span className="liquid-glass-control rounded-full px-2 py-1 text-xs font-bold text-slate-500">空置</span>
	                                                        </div>
	                                                        <div className="space-y-3">
	                                                            <div>
	                                                                <label className="text-xs font-medium text-slate-500 block mb-1">预计签约日</label>
	                                                                <input type="date" className={budgetCompactInputClass} value={asm.projectedSignDate} onChange={(e) => updateAssumption({ ...asm, projectedSignDate: e.target.value })} />
	                                                            </div>
	                                                            <div className="grid grid-cols-2 gap-2">
	                                                                <div>
	                                                                    <label className="text-xs font-medium text-slate-500 block mb-1">预估单价</label>
	                                                                    <input type="number" inputMode="decimal" enterKeyHint="done" step="0.1" className={budgetCompactInputClass} value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
	                                                                </div>
	                                                                <div>
	                                                                    <label className="text-xs font-medium text-slate-500 block mb-1">免租月数</label>
	                                                                    <input type="number" inputMode="decimal" enterKeyHint="done" className={budgetCompactInputClass} value={asm.projectedRentFreeMonths} onChange={(e) => updateAssumption({ ...asm, projectedRentFreeMonths: Number(e.target.value) })} />
	                                                                </div>
	                                                            </div>
	                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                )}

                {activeTab === 'Renewal' && (
                    <div className="space-y-10">
                        {renewalGroupedByYearQuarter.map(({ year, quarters }) => (
                            <section key={year} className="space-y-5">
                                <h3 className="text-base font-bold text-slate-800 border-l-4 border-rose-400 pl-2">{year} 年到期</h3>
                                {quarters.map(({ quarter, label, tenants: qTenants }) => (
                                    <div key={`${year}-Q${quarter}`} className="space-y-3">
                                        <h4 className="text-xs font-semibold text-slate-600">{label}</h4>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">{qTenants.map((tenant) => renderRenewalCard(tenant))}</div>
                                    </div>
                                ))}
                            </section>
                        ))}
                    </div>
                )}

                {activeTab === 'Risk' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {riskTenants.map((tenant) => {
                            const asm = getAssumption(tenant.id, 'RiskTermination', tenant.name);
                            return (
	                                <div key={tenant.id} className="liquid-glass-readable liquid-pressable relative overflow-hidden rounded-[20px] p-4">
	                                    <div className="absolute top-0 left-0 w-1 h-full bg-rose-400"></div>
                                    <div className="flex justify-between items-start mb-3">
                                        <div>
                                            <h4 className="font-bold text-slate-700 truncate max-w-[10rem]" title={tenant.name}>
                                                {tenant.name}
                                            </h4>
                                            <p className="text-xs font-semibold text-slate-500">原到期: {tenant.leaseEnd}</p>
                                        </div>
                                        <ShieldAlert size={16} className="text-red-500" />
                                    </div>
                                    <div className="space-y-3">
                                        <div>
                                            <label className="text-xs font-medium text-red-600 block mb-1">预计提前退租日</label>
	                                            <input type="date" className={`${budgetCompactInputClass} bg-rose-50/80`} value={asm.projectedTerminationDate || ''} onChange={(e) => updateAssumption({ ...asm, projectedTerminationDate: e.target.value })} />
	                                        </div>
	                                        <div className="grid grid-cols-2 gap-2">
	                                            <div>
	                                                <label className="text-xs font-medium text-slate-500 block mb-1">空置期(月)</label>
	                                                <input type="number" inputMode="decimal" enterKeyHint="done" className={budgetCompactInputClass} value={asm.vacancyGapMonths} onChange={(e) => updateAssumption({ ...asm, vacancyGapMonths: Number(e.target.value) })} />
	                                            </div>
	                                            <div>
	                                                <label className="text-xs font-medium text-slate-500 block mb-1">新租单价</label>
	                                                <input type="number" inputMode="decimal" enterKeyHint="done" step="0.1" className={budgetCompactInputClass} value={asm.projectedUnitPrice} onChange={(e) => updateAssumption({ ...asm, projectedUnitPrice: Number(e.target.value) })} />
	                                            </div>
	                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

            </div>
        </div>
    );
  };

  const renderDetailTable = () => {
      const monthlyData = detailMonthlyData;
      const groups = detailGroups;
      const isExec = viewMode === 'Execution';
      const now = new Date();
      const currentYearM = now.getFullYear();
      const currentMonthM = now.getMonth();
      
      const monthlyBudgetTotals = Array(12).fill(0);
      const monthlyActualTotals = Array(12).fill(0);
      const monthlyOccupiedArea = Array(12).fill(0);
      // 拆分「实际履约合同应收」与「空置去化预测」用于头部小计展示，便于与
      // 工作台/财务报表的「合同应收」对账（合同应收 = 全年预算总额 - 空置去化预测）
      let realContractTotal = 0;
      let vacancyForecastTotal = 0;

      monthlyData.forEach(row => {
          let rowSum = 0;
          row.monthlyValues.forEach((val: any, idx: number) => {
              monthlyBudgetTotals[idx] += val.amount;
              monthlyActualTotals[idx] += val.actual || 0;
              rowSum += val.amount;
          });
          row.monthlyLeasedArea.forEach((area: number, idx: number) => {
              monthlyOccupiedArea[idx] += area;
          });
          if (row.category === '空置去化') vacancyForecastTotal += rowSum;
          else realContractTotal += rowSum;
      });
      const grandBudgetTotal = monthlyBudgetTotals.reduce((a, b) => a + b, 0);
      const grandActualTotal = monthlyActualTotals.reduce((a, b) => a + b, 0);
      const isLiveScenario = activeScenarioId === 'current';

      // Total leasable area calculation
      const totalLeasableArea = buildings.reduce((total, b) => 
          total + b.units.reduce((sum, u) => sum + (u.isSelfUse ? 0 : u.area), 0), 0);
      const mobileMonthSummaries = monthlyBudgetTotals.map((budget, idx) => ({
          month: idx + 1,
          budget,
          actual: monthlyActualTotals[idx],
          occupancyArea: monthlyOccupiedArea[idx],
      }));
      const mobileGroupEntries = Object.entries(groups as Record<string, any[]>);
      const mobileGroupTotals = (rows: any[]) => rows.reduce(
          (acc, row) => {
              const budget = row.monthlyValues.reduce((sum: number, val: any) => sum + (val.amount || 0), 0);
              const actual = row.monthlyValues.reduce((sum: number, val: any) => sum + (val.actual || 0), 0);
              return {
                  budget: acc.budget + budget,
                  actual: acc.actual + actual,
              };
          },
          { budget: 0, actual: 0 },
      );
      const renderMobileBudgetRowCard = (row: any) => {
          const rowTotalBudget = row.monthlyValues.reduce((acc: number, curr: any) => acc + (curr.amount || 0), 0);
          const rowTotalActual = row.monthlyValues.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
          const focusMonths = row.monthlyValues
              .map((val: any, idx: number) => ({
                  month: idx + 1,
                  budget: val.amount || 0,
                  actual: val.actual || 0,
                  adjusted: !!val.adjustmentDetail || !!val.isAdjustedOut,
              }))
              .filter((item: { budget: number; actual: number; adjusted: boolean }) => item.budget > 0.005 || item.actual > 0.005 || item.adjusted)
              .slice(0, 3);
          const completionRate = rowTotalBudget > 0 ? (rowTotalActual / rowTotalBudget) * 100 : 0;
          const rowBudgetCardLabel = `${row.name}，${row.building || '未分配楼宇'} ${row.unitNames?.trim() || '未分配房号'}，年度预算 ${formatWan(rowTotalBudget, 1)}，累计实收 ${formatWan(rowTotalActual, 1)}，达成 ${rowTotalBudget > 0 ? formatPercent(completionRate, 0) : '暂无预算'}，点击查看预算行月度明细`;

          return (
              <button
                  key={row.id}
                  type="button"
                  onClick={() => setSelectedMobileBudgetRow(row)}
                  className={`liquid-budget-mobile-card liquid-pressable w-full rounded-[24px] p-4 text-left transition ${
                      row.isTerminatingInYear ? 'liquid-budget-mobile-card-risk' : row.isNewSigningInYear ? 'liquid-budget-mobile-card-new' : ''
                  }`}
                  title={rowBudgetCardLabel}
                  aria-label={rowBudgetCardLabel}
              >
                  <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                          <div className="flex min-w-0 items-center gap-1.5">
                              {!row.isVirtual && (
                                  <span
                                      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-xs font-black ${
                                          row.hasBudgetMods ? 'bg-amber-100 text-amber-700' : 'bg-cyan-100 text-cyan-700'
                                      }`}
                                  >
                                      {row.hasBudgetMods ? '!' : '✓'}
                                  </span>
                              )}
                              <span className="truncate text-base font-black text-slate-950">{row.name}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-semibold text-slate-500">
                              <span>{row.building}</span>
                              <span>·</span>
                              <span>{row.unitNames?.trim() || '未分配房号'}</span>
                              {row.paymentCycleLabel && (
                                  <>
                                      <span>·</span>
                                      <span>{row.paymentCycleLabel}</span>
                                  </>
                              )}
                          </div>
                      </div>
                      <div className="shrink-0 text-right">
                          <div className="text-xs font-black text-slate-500">{isExec ? '累计实收' : '年度预算'}</div>
                          <div className={`mt-0.5 text-lg font-black ${isExec ? 'text-cyan-700' : 'text-blue-700'}`}>
                              {formatWan(isExec ? rowTotalActual : rowTotalBudget, 1)}
                          </div>
                      </div>
                  </div>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                      <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                          <div className="text-xs font-bold text-slate-500">预算</div>
                          <div className="mt-0.5 text-sm font-black text-slate-900">{formatWan(rowTotalBudget, 1)}</div>
                      </div>
                      <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                          <div className="text-xs font-bold text-slate-500">实收</div>
                          <div className="mt-0.5 text-sm font-black text-cyan-700">{formatWan(rowTotalActual, 1)}</div>
                      </div>
                      <div className="liquid-budget-mobile-metric rounded-2xl px-3 py-2">
                          <div className="text-xs font-bold text-slate-500">达成</div>
                          <div className={`mt-0.5 text-sm font-black ${completionRate >= 100 ? 'text-cyan-700' : completionRate > 0 ? 'text-amber-700' : 'text-slate-500'}`}>
                              {rowTotalBudget > 0 ? formatPercent(completionRate, 0) : '-'}
                          </div>
                      </div>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-1.5">
                      {row.isTerminatingInYear && (
                          <span className="liquid-mobile-chip-rose rounded-full px-2.5 py-1 text-xs font-black">退租</span>
                      )}
                      {row.isNewSigningInYear && (
                          <span className="liquid-mobile-chip-blue rounded-full px-2.5 py-1 text-xs font-black">新签</span>
                      )}
                      <span className="liquid-mobile-chip-cyan rounded-full px-2.5 py-1 text-xs font-black">{formatArea(row.area, 0)}</span>
                      {row.rentFreeYearSummary && (
                          <span className="liquid-mobile-chip-amber rounded-full px-2.5 py-1 text-xs font-black">{row.rentFreeYearSummary}</span>
                      )}
                  </div>

                  <div className="mt-3 border-t border-white/70 pt-3">
                      {focusMonths.length > 0 ? (
                          <div className="grid gap-2">
                              {focusMonths.map((item: { month: number; budget: number; actual: number; adjusted: boolean }) => (
                                  <div key={item.month} className="flex items-center justify-between gap-2 text-xs font-bold">
                                      <span className="text-slate-500">{item.month}月{item.adjusted ? ' · 调整' : ''}</span>
                                      <span className="tabular-nums text-slate-700">
                                          {isExec ? `${formatWan(item.actual, 1)} / ${formatWan(item.budget, 1)}` : formatWan(item.budget, 1)}
                                      </span>
                                  </div>
                              ))}
                          </div>
                      ) : (
                          <div className="text-xs font-semibold text-slate-500">本年暂无预算月份</div>
                      )}
                  </div>
              </button>
          );
      };

      return (
	          <div className="liquid-budget-shell overflow-hidden rounded-[28px] flex flex-col h-full">
	               <div className="flex-shrink-0 border-b border-white/70 p-3">
	                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
	                    <div className="flex flex-wrap items-center gap-3">
	                        <div className="liquid-glass-control flex items-center rounded-full p-0.5">
		                            <button onClick={() => setDetailYear(detailYear - 1)} className="liquid-pressable rounded-full p-1 text-slate-500 hover:text-blue-700"><ChevronLeft size={16}/></button>
		                            <span className="px-3 py-1 font-bold text-slate-700 text-sm">{detailYear}年</span>
		                            <button onClick={() => setDetailYear(detailYear + 1)} className="liquid-pressable rounded-full p-1 text-slate-500 hover:text-blue-700"><ChevronRight size={16}/></button>
		                        </div>
		                        <div className="liquid-glass-control flex rounded-full p-0.5">
		                            <button onClick={() => setSortMethod('Category')} className={`liquid-pressable rounded-full px-3 py-1 text-xs font-bold ${sortMethod === 'Category' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>按类别</button>
		                            <button onClick={() => setSortMethod('Building')} className={`liquid-pressable rounded-full px-3 py-1 text-xs font-bold ${sortMethod === 'Building' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>按楼宇</button>
		                            <button onClick={() => setSortMethod('PaymentCycle')} className={`liquid-pressable rounded-full px-3 py-1 text-xs font-bold ${sortMethod === 'PaymentCycle' ? budgetSegmentActiveClass : budgetSegmentIdleClass}`}>按账期</button>
	                        </div>
	                    </div>
	                    <div className="flex flex-wrap items-center gap-3">
	                        <div className="liquid-glass-readable hidden rounded-2xl px-3 py-2 text-right md:block">
                            <span className="text-xs text-slate-500 block">
                                {isLiveScenario ? '全年预算总额' : '全年合同应收（实际履约）'}
                            </span>
                            <span
                                className="text-lg font-bold text-slate-800"
                                title={
                                    isLiveScenario
                                        ? `年初预算 (Live) = 实际履约合同应收 ${formatCurrency(realContractTotal)} + 空置去化预测 ${formatCurrency(vacancyForecastTotal)}`
                                        : '新建预算方案默认仅按实际履约合同推算（含免租期、收款周期、账期调整），与工作台「合同应收」/财务报表「应收租金」口径完全一致；如需查看空置去化预测，请切换到「年初预算方案 (Live)」。'
                                }
                            >
                                {formatCurrency(grandBudgetTotal)}
                            </span>
                            {isLiveScenario && vacancyForecastTotal > 0.005 && (
                                <span className="mt-0.5 block text-xs font-semibold tabular-nums text-slate-500">
                                    含空置去化预测 {formatCurrency(vacancyForecastTotal)}
                                </span>
                            )}
                            {!isLiveScenario && (() => {
                                const cur = scenarios.find((s) => s.id === activeScenarioId);
                                const isReceivableActive = !!cur?.isReceivableActive;
                                return isReceivableActive ? (
                                    <span className="mt-0.5 block text-xs font-bold text-sky-600">
                                        🧾 应收专用 · 工作台/财务报表均按本方案口径计算
                                    </span>
                                ) : (
	                                    <span className="mt-0.5 block text-xs font-semibold text-blue-600">
	                                        与工作台「合同应收」一致 · 点「设为应收专用」让本方案接管
	                                    </span>
                                );
                            })()}
                        </div>
                        {isExec && (
	                             <div className="liquid-glass-readable hidden rounded-2xl px-3 py-2 text-right md:block">
		                                <span className="text-xs text-cyan-700 block">累计实收总额</span>
		                                <span className="text-lg font-bold text-cyan-700">{formatCurrency(grandActualTotal)}</span>
	                             </div>
                        )}
                        <div className="flex gap-2">
	                             <button
	                                 onClick={handlePickBudgetExcel}
	                                 className="liquid-glass-control liquid-pressable rounded-full p-2 text-blue-700 disabled:opacity-50"
	                                 title="从 Excel 导入预算表（按月汇总写入「预算执行」目标列）"
	                                 disabled={isImporting || !onBatchUpdate}
                             >
                                 {isImporting ? <RotateCcw size={16} className="animate-spin"/> : <Upload size={16}/>}
                             </button>
                             <input
                                 ref={importInputRef}
                                 type="file"
                                 accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                                 className="hidden"
                                 onChange={handleBudgetExcelChosen}
                             />
		                             <button
		                                 onClick={exportToExcel}
		                                 className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-600 disabled:opacity-40 disabled:cursor-not-allowed"
	                                 title={
                                         isBudgetMonthlyServerBlocked
                                             ? '后台计算失败，未执行前端本地批量计算'
                                             : isBudgetMonthlyLocalFallbackDisabled
                                             ? '后台计算不可用，未执行前端本地批量计算'
                                             : isBudgetMonthlyLocalEngineBlocked
                                             ? '本地预算账单引擎加载失败'
                                             : isBudgetMonthlyLocalEngineLoading
                                             ? '本地预算账单引擎正在按需加载'
                                             : isBudgetMonthlyServerLoading
                                             ? '后台正在计算预算明细'
                                             : '导出Excel'
                                     }
	                                 disabled={isBudgetMonthlyServerUnavailable}
	                             >
	                                 <Download size={16}/>
	                             </button>
	                             <button onClick={() => setIsFullScreen(!isFullScreen)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-600" title={isFullScreen ? "退出全屏" : "全屏模式"}>{isFullScreen ? <Minimize2 size={16}/> : <Maximize2 size={16}/>}</button>
	                        </div>
	                    </div>
	                    </div>
	               </div>
               {isBudgetMonthlyServerLoading && (
                   <div className="border-b border-blue-100/70 bg-blue-50/82 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                       <RotateCcw size={14} className="animate-spin" />
                       <span>后台正在计算预算明细，前端暂不执行批量账单推算...</span>
                   </div>
               )}
	               {isBudgetMonthlyServerBlocked && (
	                   <div className="border-b border-red-100/70 bg-red-50/82 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
	                       <AlertCircle size={14} />
	                       <span>后台预算明细计算失败，未执行前端本地批量计算：{budgetMonthlyServerState.error}</span>
	                   </div>
	               )}
               {isBudgetMonthlyLocalFallbackDisabled && (
                   <div className="border-b border-amber-100/70 bg-amber-50/82 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
                       <AlertCircle size={14} />
                       <span>{budgetMonthlyServerState.error || '后台预算明细计算不可用，未执行前端本地批量计算。'}</span>
                   </div>
               )}
               {isBudgetMonthlyLocalEngineLoading && (
                   <div className="border-b border-blue-100/70 bg-blue-50/82 px-3 py-2 text-xs text-blue-700 flex items-center gap-2">
                       <RotateCcw size={14} className="animate-spin" />
                       <span>正在按需加载本地预算账单引擎...</span>
                   </div>
               )}
               {isBudgetMonthlyLocalEngineBlocked && (
                   <div className="border-b border-red-100/70 bg-red-50/82 px-3 py-2 text-xs text-red-700 flex items-center gap-2">
                       <AlertCircle size={14} />
                       <span>本地预算账单引擎加载失败，无法生成离线预算明细：{localBudgetEngineState.error}</span>
                   </div>
               )}
	               {!isBudgetMonthlyServerBlocked &&
                       !isBudgetMonthlyLocalFallbackDisabled &&
                       !isBudgetMonthlyServerLoading &&
                       !isBudgetMonthlyLocalEngineLoading &&
                       !isBudgetMonthlyLocalEngineBlocked &&
                       budgetMonthlyServerState.error &&
                       budgetMonthlyServerState.key === budgetMonthlyComputeRequest.key && (
	                   <div className="border-b border-amber-100/70 bg-amber-50/82 px-3 py-2 text-xs text-amber-700 flex items-center gap-2">
	                       <AlertCircle size={14} />
	                       <span>后台预算明细计算失败，已使用本地缓存兜底：{budgetMonthlyServerState.error}</span>
                   </div>
               )}
	               {importedBudgetForDetailYear && (
	                   <div className="border-b border-blue-100/70 bg-blue-50/86 px-3 py-2 flex items-center justify-between text-xs">
                       <div className="flex items-center gap-2 text-blue-800">
                           <CheckCircle2 size={14} />
                           <span>
                               已导入 <strong>{detailYear}</strong> 年预算表
                               （{importedBudgetForDetailYear.rows.length} 行明细，全年合计 <strong>{formatCurrency(importedBudgetForDetailYear.annualTotal)}</strong>，
                               导入时间：{new Date(importedBudgetForDetailYear.importedAt).toLocaleString('zh-CN', { hour12: false })}
                               {importedBudgetForDetailYear.updatedAt ? `，最近编辑：${new Date(importedBudgetForDetailYear.updatedAt).toLocaleString('zh-CN', { hour12: false })}` : ''}
                               {importedBudgetForDetailYear.sourceSheet ? `，来源表：${importedBudgetForDetailYear.sourceSheet}` : ''}）
                           </span>
                           <span className="text-blue-500">·</span>
                           <span className="text-blue-700">数据已写入存档，点击右上角「保存」即可同步至云端。</span>
                       </div>
                       <button
                           onClick={() => handleClearImportedBudget(detailYear)}
                           className="font-bold text-blue-700 hover:text-rose-600 underline"
                           title="清除本年度的导入预算表（同时清空月度目标值）"
                           disabled={!onBatchUpdate}
                       >
                           清除导入
	                       </button>
	                   </div>
	               )}

	               <div className="liquid-budget-mobile-layout space-y-3 p-3 lg:hidden">
	                   <div className="liquid-budget-mobile-summary rounded-[24px] p-4">
	                       <div className="flex items-start justify-between gap-3">
	                           <div>
	                               <div className="text-xs font-black text-slate-500">{detailYear} 年预算盘点</div>
	                               <div className="mt-1 text-2xl font-black text-slate-950">{formatWan(grandBudgetTotal, 1)}</div>
	                               <div className="mt-1 text-xs font-semibold text-slate-500">
	                                   {isLiveScenario ? 'Live 方案含空置去化预测' : '当前方案按实际履约合同口径'}
	                               </div>
	                           </div>
	                           {isExec ? (
	                               <div className="rounded-2xl bg-cyan-50/78 px-3 py-2 text-right">
	                                   <div className="text-xs font-black text-cyan-700">累计实收</div>
	                                   <div className="mt-0.5 text-lg font-black text-cyan-700">{formatWan(grandActualTotal, 1)}</div>
	                               </div>
	                           ) : (
	                               <div className="rounded-2xl bg-blue-50/78 px-3 py-2 text-right">
	                                   <div className="text-xs font-black text-blue-700">明细行</div>
	                                   <div className="mt-0.5 text-lg font-black text-blue-700">{monthlyData.length}</div>
	                               </div>
	                           )}
	                       </div>
	                       {isLiveScenario && vacancyForecastTotal > 0.005 && (
	                           <div className="mt-3 rounded-2xl bg-white/60 px-3 py-2 text-xs font-semibold text-slate-600">
	                               实际履约合同 {formatWan(realContractTotal, 1)} · 空置去化预测 {formatWan(vacancyForecastTotal, 1)}
	                           </div>
	                       )}
	                   </div>

	                   <div className="liquid-budget-mobile-months -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
	                       {mobileMonthSummaries.map((item) => {
	                           const rate = totalLeasableArea > 0 ? (item.occupancyArea / totalLeasableArea) * 100 : 0;
	                           return (
	                               <div key={item.month} className="liquid-budget-mobile-month shrink-0 rounded-[20px] px-3 py-2">
	                                   <div className="text-xs font-black text-slate-500">{item.month}月</div>
	                                   <div className="mt-1 text-sm font-black text-slate-900">{formatWan(isExec ? item.actual : item.budget, 1)}</div>
	                                   <div className="mt-0.5 text-xs font-semibold text-slate-500">
	                                       {isExec ? `预 ${formatWan(item.budget, 1)}` : formatPercent(rate, 0)}
	                                   </div>
	                               </div>
	                           );
	                       })}
	                   </div>

	                   <div className="space-y-3">
	                       {mobileGroupEntries.length === 0 ? (
	                           <div className="liquid-budget-mobile-card rounded-[24px] p-5 text-center text-sm font-semibold text-slate-500">
	                               暂无预算明细
	                           </div>
	                       ) : mobileGroupEntries.map(([groupName, rows], groupIndex) => {
	                           const groupTotal = mobileGroupTotals(rows);
	                           return (
	                               <details key={groupName} className="liquid-budget-mobile-group rounded-[24px] p-2" open={groupIndex < 2}>
	                                   <summary className="liquid-pressable flex cursor-pointer list-none items-center justify-between gap-3 rounded-[20px] px-3 py-2.5">
	                                       <div className="min-w-0">
	                                           <div className="truncate text-sm font-black text-slate-950">{groupName}</div>
	                                           <div className="mt-0.5 text-xs font-semibold text-slate-500">{rows.length} 条 · 预算 {formatWan(groupTotal.budget, 1)}</div>
	                                       </div>
	                                       <div className="flex items-center gap-2">
	                                           {isExec && (
	                                               <span className="rounded-full bg-cyan-50/82 px-2.5 py-1 text-xs font-black text-cyan-700">
	                                                   实收 {formatWan(groupTotal.actual, 1)}
	                                               </span>
	                                           )}
	                                           <ChevronDown size={16} className="shrink-0 text-slate-400" />
	                                       </div>
	                                   </summary>
	                                   <div className="liquid-budget-mobile-group-body mt-2 space-y-2">
	                                       {rows.map(renderMobileBudgetRowCard)}
	                                   </div>
	                               </details>
	                           );
	                       })}
	                   </div>
	               </div>

	               <div className="liquid-budget-table hidden flex-1 overflow-auto lg:block">
	                    <table className="w-full text-sm text-left border-collapse">
                        {/* 表头粘性：sticky 需写在每个 th 上；写在 thead 上在多数浏览器对 table 无效 */}
                        <thead className="liquid-budget-sticky text-slate-500 font-medium">
                            <tr>
                                <th className="liquid-budget-sticky px-4 py-3 sticky left-0 top-0 z-30 border-b border-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)] w-[220px]">
                                    客户/单元
                                </th>
                                <th className="liquid-budget-sticky px-2 py-3 text-center whitespace-nowrap sticky top-0 z-20 border-b border-slate-200 min-w-[92px]">
                                    签约单价
                                    <span className="block text-[10px] font-normal text-slate-400">(元/㎡·天)</span>
                                </th>
                                <th className="liquid-budget-sticky px-2 py-3 text-center sticky top-0 z-20 border-b border-slate-200 min-w-[128px] max-w-[160px]">
                                    本年度免租期
                                </th>
                                {Array.from({length:12}).map((_, i) => (
                                    <th
                                        key={i}
                                        className={`liquid-budget-sticky px-2 py-3 text-right sticky top-0 z-20 border-b border-slate-200 ${isExec ? 'min-w-[120px]' : 'min-w-[95px]'}`}
                                    >
                                        {i + 1}月
                                    </th>
                                ))}
                                <th className="liquid-budget-sticky px-4 py-3 text-right font-bold sticky right-0 top-0 z-30 border-b border-slate-200 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    合计
                                </th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {Object.entries(groups).map(([groupName, rows]: [string, any]) => {
                                let groupBudgetSum = Array(12).fill(0);
                                let groupActualSum = Array(12).fill(0);
                                const isCollapsed = collapsedBudgetGroups.has(groupName);
                                return (
                                    <React.Fragment key={groupName}>
                                        <tr
                                            className="liquid-budget-group group/hdr font-bold border-t border-slate-200 cursor-pointer hover:brightness-[0.99] select-none"
                                            title={isCollapsed ? '展开本组' : '折叠本组'}
                                            onClick={() => toggleBudgetGroupCollapse(groupName)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' || e.key === ' ') {
                                                    e.preventDefault();
                                                    toggleBudgetGroupCollapse(groupName);
                                                }
                                            }}
                                            tabIndex={0}
                                            role="button"
                                            aria-expanded={!isCollapsed}
                                        >
	                                            <td className="liquid-budget-group px-4 py-2 sticky left-0 z-10 text-slate-500 uppercase tracking-wider text-[10px] shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] border-r border-slate-200/70">
                                                <span className="inline-flex items-center gap-1.5 normal-case tracking-normal font-semibold text-slate-600">
                                                    {isCollapsed ? (
                                                        <ChevronRight size={14} className="shrink-0 text-slate-400" aria-hidden />
                                                    ) : (
                                                        <ChevronDown size={14} className="shrink-0 text-slate-400" aria-hidden />
                                                    )}
                                                    <span className="uppercase tracking-wider text-[10px] text-slate-500">{groupName}</span>
                                                    <span className="text-[10px] font-normal text-slate-400 tabular-nums">({rows.length})</span>
                                                </span>
                                            </td>
                                            <td colSpan={15} className="liquid-budget-group text-[10px] font-normal text-slate-400 text-right pr-4 py-2">
                                                {isCollapsed ? '已折叠，点击左侧展开' : ''}
                                            </td>
                                        </tr>
                                        {!isCollapsed &&
                                            rows.map((row: any) => {
                                            const rowTotalBudget = row.monthlyValues.reduce((acc: number, curr: any) => acc + curr.amount, 0);
                                            const rowTotalActual = row.monthlyValues.reduce((acc: number, curr: any) => acc + (curr.actual || 0), 0);
                                            
                                            row.monthlyValues.forEach((v: any, i: number) => {
                                                groupBudgetSum[i] += v.amount;
                                                groupActualSum[i] += (v.actual || 0);
                                            });
                                            const lastReceivableMonth = row.isTerminatingInYear
                                                ? row.monthlyValues.reduce((last: number | null, v: any, i: number) => (v.amount > 0 ? i : last), null)
                                                : null;

                                            return (
	                                                <tr key={row.id} className={`group transition-colors hover:bg-blue-50/35 ${row.isTerminatingInYear ? 'bg-rose-50/20' : row.isNewSigningInYear ? 'liquid-budget-row-new' : ''}`}>
                                                    <td
	                                                        className={`px-4 py-3 sticky left-0 z-10 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.05)] border-r border-slate-200/70 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:z-20 ${
                                                            row.isTerminatingInYear
                                                                ? 'bg-rose-50 group-hover:bg-rose-50/80 border-l-4 border-l-rose-400'
	                                                                : row.isNewSigningInYear
	                                                                    ? 'liquid-budget-row-new-head group-hover:bg-sky-50/90 border-l-4 border-l-sky-400'
	                                                                    : 'liquid-budget-row-head group-hover:bg-blue-50/70'
                                                        }`}
                                                        title="点击查看合同概要（起租、免租、系统应收口径），便于对照当年预算"
                                                        tabIndex={0}
                                                        role="button"
                                                        onClick={() => setContractSummaryRow(row)}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter' || e.key === ' ') {
                                                                e.preventDefault();
                                                                setContractSummaryRow(row);
                                                            }
                                                        }}
                                                    >
                                                        <div className="flex items-center gap-1.5 min-w-0">
                                                            {/* 复核标记 */}
                                                            {!row.isVirtual && (
                                                                <span
                                                                    className={`shrink-0 w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold ${
                                                                        row.hasBudgetMods
                                                                            ? 'bg-amber-100 text-amber-700'
	                                                                            : 'bg-cyan-100 text-cyan-700'
                                                                    }`}
                                                                    title={row.hasBudgetMods
                                                                        ? `合同应收 vs 预算有差异 (${formatWan(row.contractDiff)})\n原因：${row.verificationReasons.join('；')}`
                                                                        : '合同应收与预算一致，无调整'}
                                                                >
                                                                    {row.hasBudgetMods ? '⚠' : '✓'}
                                                                </span>
                                                            )}
                                                            <div className="font-medium text-slate-700 truncate w-[180px]" title={row.name}>{row.name}</div>
                                                            {row.isTerminatingInYear && (
                                                                <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700" title={`退租/到期日：${row.terminationDate || '—'}`}>
                                                                    退租
                                                                </span>
                                                            )}
                                                            {row.isNewSigningInYear && (
	                                                                <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-0.5 text-[10px] font-bold text-sky-700" title={`签约日：${row.signingDate || '—'}`}>
                                                                    新签
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 flex flex-wrap items-center gap-1 mt-0.5">
                                                            <span className="liquid-glass-readable inline-flex items-center rounded px-1 py-[1px] font-medium text-slate-700">
                                                                {row.building}
                                                            </span>
                                                            <span className="inline-flex items-center rounded bg-blue-50 px-1 py-[1px] font-medium text-blue-700">
                                                                {row.floorSummary || '—'}
                                                            </span>
                                                            <span
	                                                                className="inline-flex items-center rounded bg-cyan-50 px-1 py-[1px] font-medium text-cyan-800 max-w-[min(160px,26vw)] truncate"
                                                                title={row.unitNames ? `房号：${row.unitNames}` : ''}
                                                            >
                                                                {row.unitNames?.trim() ? row.unitNames : '—'}
                                                            </span>
	                                                            <span className="inline-flex items-center rounded bg-blue-50 px-1 py-[1px] font-medium text-blue-700">
                                                                {row.paymentCycleLabel || '季付'}
                                                            </span>
                                                            {row.leaseStartMonthInYear != null && (
                                                                <span className="inline-flex items-center rounded bg-orange-50 px-1 py-[1px] font-medium text-orange-700" title={`起租日：${row.leaseStart || '—'}`}>
                                                                    起租 {row.leaseStartMonthInYear + 1}月
                                                                </span>
                                                            )}
                                                            {row.isTerminatingInYear && (
                                                                <span className="inline-flex items-center rounded bg-rose-50 px-1 py-[1px] font-medium text-rose-700" title={`退租/到期日：${row.terminationDate || '—'}`}>
                                                                    退租 {new Date(row.terminationDate).getMonth() + 1}月
                                                                </span>
                                                            )}
                                                            <span className="text-[10px] text-slate-400">{formatArea(row.area)}</span>
                                                        </div>
                                                    </td>
	                                                    <td className="liquid-budget-data-cell px-2 py-3 text-center font-medium text-slate-700 group-hover:bg-blue-50/50 whitespace-nowrap align-top">
                                                        {row.unitPrice != null && row.unitPrice > 0 ? Number(row.unitPrice.toFixed(2)) : '—'}
                                                    </td>
	                                                    <td className="liquid-budget-data-cell px-2 py-3 text-center font-medium text-slate-700 group-hover:bg-blue-50/50 align-top max-w-[160px] leading-snug" title={row.rentFreeYearSummary}>
                                                        {row.rentFreeYearSummary || '—'}
                                                    </td>
                                                    {row.monthlyValues.map((val: any, idx: number) => {
                                                        const isPastMonth = detailYear < currentYearM || (detailYear === currentYearM && idx <= currentMonthM);
                                                        const isOverdue = isPastMonth && val.amount > 0 && (val.actual || 0) < val.amount;
                                                        const isPaid = val.amount > 0 && (val.actual || 0) >= val.amount;
                                                        const adjSt = budgetAdjustmentCellStyle(val);
                                                        const hasAdj = !!adjSt.shell;
                                                        const adjNote = (val.adjustmentDetail || '').trim();
                                                        const displayBudgetAmount = val.isAdjustedOut ? 0 : val.amount;
                                                        const isLeaseStartMonth = row.leaseStartMonthInYear === idx;
                                                        const isLastReceivableMonth = lastReceivableMonth === idx;
                                                        const isRentFreeMonth = !!row.rentFreeMonthFlags?.[idx];
                                                        const cellTitleParts = [
                                                            isRentFreeMonth ? '合同免租自然月' : '',
                                                            adjNote ? `调整说明：${adjNote}` : '',
                                                            isLastReceivableMonth ? `最后一期应收，退租/到期日：${row.terminationDate || '—'}` : '',
                                                            isLeaseStartMonth ? `起租日：${row.leaseStart || '—'}` : '',
                                                            !isExec && val.amount > 0 ? '点击编辑预算（账期或金额）' : '',
                                                        ].filter(Boolean);

                                                        return (
                                                            <td 
                                                                key={idx} 
                                                                title={cellTitleParts.length ? cellTitleParts.join('；') : undefined}
	                                                                className={`px-2 py-2 text-right relative transition-colors group/cell align-top ${!hasAdj && !isExec && val.amount > 0 ? 'hover:bg-blue-50/60' : ''} ${
                                                                    isExec && isOverdue && !hasAdj ? 'bg-rose-50' : ''
                                                                } ${!hasAdj && isLeaseStartMonth ? 'bg-orange-50/80 ring-1 ring-inset ring-orange-200' : ''} ${!hasAdj && isRentFreeMonth ? 'bg-amber-100/95 ring-1 ring-inset ring-amber-300 shadow-[inset_0_0_0_1px_rgba(245,158,11,0.18)]' : ''} ${!hasAdj && isLastReceivableMonth ? 'bg-rose-50/90 ring-1 ring-inset ring-rose-200' : ''} ${adjSt.shell} ${val.amount > 0 ? 'text-slate-700' : 'text-slate-300'}`}
                                                            >
                                                                {!isExec ? (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center justify-end gap-1">
                                                                            <span className={displayBudgetAmount > 0 ? 'font-medium' : ''}>
                                                                                {displayBudgetAmount > 0 ? formatNumber(displayBudgetAmount) : (val.isAdjustedOut ? '0.00' : '-')}
                                                                            </span>
                                                                            {displayBudgetAmount > 0 && (
	                                                                                <Edit3 size={12} className="text-blue-600 opacity-0 group-hover/cell:opacity-100 transition-opacity flex-shrink-0" aria-hidden />
                                                                            )}
                                                                        </div>
                                                                        {adjNote ? (
                                                                            <div className={`text-[9px] leading-snug max-w-[min(140px,22vw)] text-right font-medium ${adjSt.noteClass || 'text-slate-600'}`}>
                                                                                {adjNote}
                                                                            </div>
                                                                        ) : null}
                                                                        {isRentFreeMonth && (
                                                                            <div className="text-[9px] leading-snug text-amber-800 font-bold">免租月</div>
                                                                        )}
                                                                        {isLeaseStartMonth && (
                                                                            <div className="text-[9px] leading-snug text-orange-700 font-bold">起租月</div>
                                                                        )}
                                                                        {isLastReceivableMonth && (
                                                                            <div className="text-[9px] leading-snug text-rose-700 font-bold">最后一期</div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex flex-col items-end gap-0.5">
                                                                        <div className="flex items-center gap-1">
	                                                                            <span className={`text-[11px] font-bold ${isPaid ? 'text-cyan-700' : isOverdue ? 'text-rose-600 animate-pulse' : 'text-slate-400'}`}>
                                                                                {formatCurrency(val.actual || 0)}
                                                                            </span>
	                                                                            {isPaid && <CheckCircle size={10} className="text-cyan-600" />}
                                                                            {isExec && isOverdue && <AlertCircle size={10} className="text-rose-500" />}
                                                                        </div>
                                                                        <span className="text-[9px] text-slate-400 font-mono opacity-60">预 {formatCurrency(val.amount)}</span>
                                                                        {adjNote ? (
                                                                            <div className={`text-[9px] leading-snug max-w-[min(140px,22vw)] text-right font-medium ${adjSt.noteClass || 'text-slate-600'}`}>
                                                                                {adjNote}
                                                                            </div>
                                                                        ) : null}
                                                                        {isRentFreeMonth && (
                                                                            <div className="text-[9px] leading-snug text-amber-800 font-bold">免租月</div>
                                                                        )}
                                                                        {isLeaseStartMonth && (
                                                                            <div className="text-[9px] leading-snug text-orange-700 font-bold">起租月</div>
                                                                        )}
                                                                        {isLastReceivableMonth && (
                                                                            <div className="text-[9px] leading-snug text-rose-700 font-bold">最后一期</div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
	                                                    <td className={`px-4 py-3 text-right font-bold sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.05)] border-l border-slate-200/70 ${isExec ? 'liquid-budget-total-cell text-cyan-800' : 'liquid-budget-data-cell text-slate-800 group-hover:bg-blue-50/50'}`}>
                                                        {isExec ? (
                                                            <div className="flex flex-col items-end">
                                                                <span>{formatCurrency(rowTotalActual)}</span>
                                                                <span className="text-[10px] text-slate-400 font-normal">预: {formatCurrency(rowTotalBudget)}</span>
                                                            </div>
                                                        ) : (
                                                            formatCurrency(rowTotalBudget)
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        {!isCollapsed && (
                                            <>
                                                {/* Sub-total Row */}
	                                                <tr className="liquid-budget-subtotal font-semibold italic border-b border-slate-200">
	                                                    <td className="liquid-budget-subtotal-cell px-4 py-2 sticky left-0 z-10 text-blue-600 text-xs">
	                                                        小计 ({groupName})
	                                                    </td>
	                                                    <td className="liquid-budget-subtotal-cell px-2 py-2 text-center text-slate-300 text-xs">—</td>
	                                                    <td className="liquid-budget-subtotal-cell px-2 py-2 text-center text-slate-300 text-xs">—</td>
                                                    {groupBudgetSum.map((val, i) => (
                                                        <td key={i} className="px-2 py-2 text-right text-blue-600/70 text-xs">
                                                            {isExec ? (
                                                                <div className="flex flex-col items-end">
	                                                                    <span className="text-cyan-700">{formatCurrency(groupActualSum[i])}</span>
                                                                    <span className="text-[9px] font-normal text-slate-400">预 {formatCurrency(val)}</span>
                                                                </div>
                                                            ) : (
                                                                formatCurrency(val)
                                                            )}
                                                        </td>
                                                    ))}
	                                                    <td className={`px-4 py-2 text-right sticky right-0 ${isExec ? 'liquid-budget-total-cell text-cyan-800' : 'liquid-budget-subtotal-cell text-blue-600'}`}>
                                                        {isExec ? (
                                                            <div className="flex flex-col items-end">
                                                                <span>{formatCurrency(groupActualSum.reduce((a, b) => a + b, 0))}</span>
                                                                <span className="text-[10px] font-normal opacity-60">
                                                                    预 {formatCurrency(groupBudgetSum.reduce((a, b) => a + b, 0))}
                                                                </span>
                                                            </div>
                                                        ) : (
                                                            formatCurrency(groupBudgetSum.reduce((a, b) => a + b, 0))
                                                        )}
                                                    </td>
                                                </tr>
                                            </>
                                        )}
                                    </React.Fragment>
                                );
                            })}
                            
                            {/* Summary Rows */}
                            <tr className="liquid-budget-summary-row font-bold text-white">
                                <td className="liquid-budget-summary-sticky px-4 py-3 sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">月度合计 (实收/预算)</td>
                                <td className="px-2 py-3 text-center text-slate-300 text-xs font-normal">—</td>
                                <td className="px-2 py-3 text-center text-slate-300 text-xs font-normal">—</td>
                                {monthlyBudgetTotals.map((t, i) => (
                                    <td key={i} className="px-2 py-3 text-right">
                                        {isExec ? (
                                            <div className="flex flex-col items-end">
	                                                <span className="text-cyan-300">{formatCurrency(monthlyActualTotals[i])}</span>
                                                <span className="text-[10px] font-normal text-slate-300 opacity-60">预 {formatCurrency(t)}</span>
                                            </div>
                                        ) : (
                                            formatCurrency(t)
                                        )}
                                    </td>
                                ))}
                                <td className="liquid-budget-summary-sticky px-4 py-3 text-right sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    {isExec ? (
                                        <div className="flex flex-col items-end">
	                                            <span className="text-cyan-300 font-black text-base">{formatCurrency(grandActualTotal)}</span>
                                            <span className="text-[10px] font-normal text-slate-300">预 {formatCurrency(grandBudgetTotal)}</span>
                                        </div>
                                    ) : (
                                        formatCurrency(grandBudgetTotal)
                                    )}
                                </td>
                            </tr>
                            
                            {/* Occupancy Rate Row */}
                            <tr className="liquid-budget-occupancy-row font-bold text-blue-800">
                                <td className="liquid-budget-occupancy-sticky px-4 py-3 sticky left-0 z-20 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    <div className="flex items-center gap-2">
                                        <TrendingUp size={14}/>
                                        <span>预测出租率</span>
                                    </div>
                                </td>
                                <td className="px-2 py-3 text-center text-slate-400 text-xs font-normal">—</td>
                                <td className="px-2 py-3 text-center text-slate-400 text-xs font-normal">—</td>
                                {monthlyOccupiedArea.map((occupied, i) => {
                                    const rate = totalLeasableArea > 0 ? (occupied / totalLeasableArea * 100) : 0;
                                    return (
                                        <td key={i} className="px-2 py-3 text-right">
                                            {formatPercent(rate)}
                                            <div className="text-[10px] font-normal opacity-60">({formatArea(occupied)})</div>
                                        </td>
                                    );
                                })}
                                <td className="liquid-budget-occupancy-sticky px-4 py-3 text-right sticky right-0 shadow-[-2px_0_5px_-2px_rgba(0,0,0,0.1)]">
                                    -
                                </td>
                            </tr>
                        </tbody>
                    </table>
               </div>
          </div>
      );
  };

  return (
    <div className={`space-y-6 ${isFullScreen ? 'ios-liquid-app fixed inset-0 z-50 p-4 md:p-6 flex flex-col h-screen overflow-auto' : ''}`}>
       <div className="liquid-glass-toolbar flex flex-wrap items-center justify-between gap-4 rounded-[26px] p-3 md:p-4 flex-shrink-0">
           <div className="flex min-w-0 flex-1 flex-col gap-3 xl:flex-row xl:items-center">
               <div className="flex shrink-0 items-center gap-2 text-sm font-bold text-slate-800">
                   <span className="liquid-icon-well flex h-8 w-8 items-center justify-center rounded-full text-blue-700">
                       <LayoutList size={16} />
                   </span>
                   预算方案
               </div>
               <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                   <select value={scenarioYearFilter} onChange={e => setScenarioYearFilter(Number(e.target.value))} className="liquid-glass-readable h-9 min-w-[7.5rem] rounded-full px-3 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80">
                       {Array.from(new Set([currentYear, currentYear + 1, ...scenarios.map(s => s.budgetYear || currentYear)])).sort((a, b) => a - b).map(y => (
                           <option key={y} value={y}>{y}预算</option>
                       ))}
                   </select>
                   <select value={activeScenarioId} onChange={e => setActiveScenarioId(e.target.value)} className="liquid-glass-readable h-9 min-w-0 flex-1 basis-[22rem] rounded-full px-4 text-sm font-semibold text-slate-700 outline-none focus-visible:ring-4 focus-visible:ring-blue-200/80" title={activeScenarioId === 'current' ? '当前合同履约预算 (Live) 含「空置去化预测」；切换到其他新建方案则仅含实际履约合同（与工作台/财务报表口径一致）' : '新建预算方案：仅按实际履约合同推算（含免租期、收款周期、账期调整），与工作台「合同应收」/财务报表「应收租金」一致'}>
                       <option value="current">🟡 当前合同履约预算情况 (Live)</option>
                     {scenarios.filter(s => !String(s.id).startsWith('invoice_dedicated_') && (s.budgetYear || currentYear) === scenarioYearFilter).map(s => (<option key={s.id} value={s.id}>{s.name} ({s.budgetYear || currentYear}) {s.isActive ? '(✅年初预算生效中)' : ''} {s.isReceivableActive ? '(🧾应收专用)' : ''} · 实际合同口径</option>))}
                   </select>
                   {activeScenarioId !== 'current' && (
                       <div className="flex items-center gap-1">
                           {isRenaming ? (
                               <div className="liquid-glass-readable flex items-center overflow-hidden rounded-full px-1 py-0.5">
                                   <input type="text" value={tempScenarioName} onChange={e => setTempScenarioName(e.target.value)} className="w-36 bg-transparent px-2 py-1 text-xs font-semibold text-slate-700 outline-none" autoFocus />
                                   <button onClick={saveRenaming} className="liquid-pressable rounded-full p-1 text-blue-700 hover:bg-blue-50/80"><Check size={12}/></button>
                                   <button onClick={() => setIsRenaming(false)} className="liquid-pressable rounded-full p-1 text-rose-500 hover:bg-rose-50/80"><X size={12}/></button>
                               </div>
                           ) : (<button onClick={startRenaming} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-600 hover:text-blue-700" title="重命名"><Edit3 size={14} /></button>)}
                           <button onClick={() => handleDeleteScenario(activeScenarioId)} className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-600 hover:text-rose-600" title="删除方案"><Trash2 size={14} /></button>
                       </div>
                   )}
                   <button onClick={() => setShowScenarioModal(true)} className="liquid-action liquid-pressable rounded-full p-2 text-blue-700" title="新建方案"><Plus size={16} /></button>
               </div>
           </div>

           <div className="flex flex-wrap items-center gap-3">
               <div className="liquid-glass-control flex rounded-full p-1">
                   {(['Settings', 'Monthly', 'Execution'] as const).map(mode => (
	                       <button key={mode} onClick={() => setViewMode(mode)} className={`liquid-pressable flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold transition-all ${viewMode === mode ? 'liquid-action-strong text-white' : budgetSegmentIdleClass}`}>
                           {mode === 'Settings' && <Calculator size={14} />}
                           {mode === 'Monthly' && <Table size={14} />}
                           {mode === 'Execution' && <Activity size={14} />}
                           {mode === 'Settings' ? '假设设定' : mode === 'Monthly' ? '预算表' : '执行跟踪'}
                       </button>
                   ))}
               </div>
	               <div className="hidden h-6 w-px bg-blue-200/50 md:block"></div>
               <button disabled={activeScenarioId === 'current' && !scenarios.find(s=>s.isActive)} onClick={() => setShowCloudModal(true)} className={budgetGhostButtonClass}><CloudUpload size={14} /> 云端保存</button>
              {activeScenarioId !== 'current' && (
                  <button
                      onClick={handleSetReceivableScenario}
                      className={`${budgetGhostButtonClass} ${
                          scenarios.find(s => s.id === activeScenarioId)?.isReceivableActive
                              ? 'bg-blue-50/85 text-blue-700'
                              : 'text-slate-700'
                      }`}
                  >
                      <FileText size={14} /> 设为应收专用
                  </button>
              )}
               {activeScenarioId !== 'current' && !scenarios.find(s => s.id === activeScenarioId)?.isActive && (
                   <button onClick={handleActivateCurrentScenario} className="liquid-action-strong liquid-pressable flex items-center gap-1 rounded-full px-3.5 py-2 text-xs font-bold"><Play size={14} /> 推送为{scenarioYearFilter}年工作台KPI基准</button>
               )}
           </div>
       </div>

       <div className="flex-1 min-h-0">
           {viewMode === 'Settings' && renderSettingsView()}
           {(viewMode === 'Monthly' || viewMode === 'Execution') && renderDetailTable()}
       </div>

	       {selectedMobileBudgetRow && (viewMode === 'Monthly' || viewMode === 'Execution') && (
	           <BudgetRowDetailSheet
	               row={selectedMobileBudgetRow}
	               detailYear={detailYear}
	               viewMode={viewMode}
	               canEditAmount={!selectedMobileBudgetEditDisabledReason}
	               editMode={selectedMobileBudgetEditMode}
	               editDisabledReason={selectedMobileBudgetEditDisabledReason}
	               onClose={() => setSelectedMobileBudgetRow(null)}
	               onOpenContractSummary={() => {
	                   setContractSummaryRow(selectedMobileBudgetRow);
	                   setSelectedMobileBudgetRow(null);
	               }}
	               onEditMonth={(monthIndex, currentBudget) => {
	                   startMobileBudgetAmountAdjust(selectedMobileBudgetRow, monthIndex, currentBudget);
	               }}
	           />
	       )}

	       {mobileBudgetAdjustTarget && (
	           <BudgetAmountAdjustSheet
	               target={mobileBudgetAdjustTarget}
	               detailYear={detailYear}
	               amountValue={mobileBudgetAdjustValue}
	               reasonValue={mobileBudgetAdjustReason}
	               error={mobileBudgetAdjustError}
	               onAmountChange={(value) => {
	                   setMobileBudgetAdjustValue(value);
	                   setMobileBudgetAdjustError('');
	               }}
	               onReasonChange={(value) => {
	                   setMobileBudgetAdjustReason(value);
	                   setMobileBudgetAdjustError('');
	               }}
	               onClose={closeMobileBudgetAmountAdjust}
	               onSave={handleSaveMobileBudgetAmountAdjust}
	           />
	       )}

	       {contractSummaryModalPayload && (
           <React.Suspense fallback={null}>
               <ContractSummaryModal
                   open
                   onClose={() => setContractSummaryRow(null)}
                   detailYear={contractSummaryModalPayload.detailYear}
                   subtitle={`${contractSummaryModalPayload.detailYear} 年预算对照 · 应收金额与表中「系统账单 + 人工调整」口径一致`}
                   billsSectionSuffix="与预算列一致"
                   budgetAssumptions={budgetAssumptions}
                   budgetAdjustments={budgetAdjustments}
                   cloudConfig={cloudConfig}
                   serverComputeEnabled={serverComputeEnabled}
                   content={contractSummaryModalPayload.content}
               />
           </React.Suspense>
       )}



       {showScenarioModal && (
           <div className="monthly-detail-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
               <div className="liquid-budget-dialog w-full max-w-md rounded-[26px] p-6 animate-in zoom-in-50 duration-200">
                   <div className="mb-5 flex items-start gap-3">
                       <span className="liquid-icon-well flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                           <Plus size={18} />
                       </span>
                       <div>
                           <h3 className="text-lg font-bold text-slate-900">新建预算方案</h3>
                           <p className="mt-1 text-xs leading-relaxed text-slate-600">
                               新建方案默认按「实际履约合同」推算账单（含免租期、收款周期、账期调整等），<strong className="text-slate-800">不包含空置去化预测</strong>；如需空置去化预测请使用「年初预算方案 (Live)」。
                           </p>
                       </div>
                   </div>
                   <div className="space-y-4">
                      <div>
                          <label className="mb-1 block text-sm font-bold text-slate-700">预算年份</label>
                          <select className={budgetInputClass} value={newScenarioYear} onChange={e => setNewScenarioYear(Number(e.target.value))}>
                              {Array.from(new Set([currentYear, currentYear + 1, currentYear + 2, ...scenarios.map(s => s.budgetYear || currentYear)])).sort((a,b)=>a-b).map(y => <option key={y} value={y}>{y}年</option>)}
                          </select>
                      </div>
                      <div>
                          <label className="mb-1 block text-sm font-bold text-slate-700">方案名称</label>
                          <input
                              type="text"
                              className={budgetInputClass}
                              value={newScenarioName}
                              onChange={e => setNewScenarioName(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleCreateScenario(); } }}
                              placeholder="例如: 2027 保守方案 / Q4 复盘"
                              autoFocus
                          />
                      </div>
                       <div>
                           <label className="mb-1 block text-sm font-bold text-slate-700">描述 (可选)</label>
                           <textarea className={budgetInputClass} rows={3} value={newScenarioDesc} onChange={e => setNewScenarioDesc(e.target.value)} placeholder="备注此方案的关键假设..." />
                       </div>
                       <div className="liquid-glass-readable flex items-center gap-2 rounded-2xl px-3 py-2">
                           <input type="checkbox" id="snapshot" checked={useSnapshot} onChange={e => setUseSnapshot(e.target.checked)} className="rounded border-slate-300 text-blue-600 focus:ring-blue-200" />
                           <label htmlFor="snapshot" className="text-sm font-semibold text-slate-700">保存当前租户与楼宇数据快照 (推荐)</label>
                       </div>
                       <p className="px-1 text-xs leading-relaxed text-slate-500">勾选快照将锁定当前的租赁状态，使方案不受后续实际运营数据变化的影响，适合做静态测算。</p>
                       <div className="liquid-glass-readable rounded-2xl px-3 py-2 text-xs font-semibold leading-relaxed text-blue-900">
                           ✅ 系统会自动继承当前的合同级假设（单价调整、付款转移等）与全部预算调整（账期/金额）。
                           创建后总额会与工作台「合同应收」、财务报表「应收租金」口径一致。
                       </div>
                       <div className="flex justify-end gap-2 pt-2">
                           <button onClick={() => setShowScenarioModal(false)} className={budgetGhostButtonClass}>取消</button>
                           <button onClick={handleCreateScenario} className="liquid-action-strong liquid-pressable rounded-full px-5 py-2 text-sm font-bold">创建</button>
                       </div>
                   </div>
               </div>
           </div>
       )}

       {showCloudModal && (
           <div className="monthly-detail-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
               <div className="liquid-budget-dialog w-full max-w-sm rounded-[26px] p-6 animate-in zoom-in-50 duration-200">
                   <h3 className="mb-4 flex items-center gap-2 text-lg font-bold text-slate-900"><CloudUpload size={20} className="text-blue-700"/> 备份至云端</h3>
                   <div className="space-y-4">
                       <div className="liquid-glass-readable rounded-2xl p-3 text-sm leading-relaxed text-blue-900">即将保存: <strong>{activeScenarioId === 'current' ? '当前合同履约预算 (Live)' : scenarios.find(s=>s.id===activeScenarioId)?.name}</strong></div>
                       <div><label className="mb-1 block text-sm font-bold text-slate-700">操作人员姓名 <span className="text-rose-500">*</span></label><input type="text" className={budgetInputClass} value={operatorName} onChange={e => setOperatorName(e.target.value)} placeholder="请输入您的姓名" /></div>
                       <div className="flex justify-end gap-2 pt-2"><button onClick={() => setShowCloudModal(false)} className={budgetGhostButtonClass}>取消</button><button onClick={confirmCloudSave} disabled={!operatorName.trim()} className="liquid-action-strong liquid-pressable rounded-full px-5 py-2 text-sm font-bold disabled:opacity-50">确认上传</button></div>
                   </div>
               </div>
           </div>
       )}

       {importPreview && (
           <div className="monthly-detail-backdrop fixed inset-0 z-[60] flex items-center justify-center p-4">
               <div className="liquid-budget-dialog flex max-h-[90vh] w-full max-w-4xl flex-col rounded-[28px] animate-in zoom-in-50 duration-200">
                   <div className="flex items-center justify-between border-b border-white/70 px-6 py-4">
                       <div className="flex items-center gap-2">
                           <span className="liquid-icon-well flex h-9 w-9 items-center justify-center rounded-2xl text-blue-700">
                               <Upload size={18} />
                           </span>
                           <h3 className="text-lg font-bold text-slate-900">预算表导入预览</h3>
                       </div>
                       <button
                           onClick={() => setImportPreview(null)}
                           className="liquid-glass-control liquid-pressable rounded-full p-2 text-slate-500 hover:text-slate-800"
                           aria-label="关闭"
                       >
                           <X size={20} />
                       </button>
                   </div>
                   <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                       <div className="liquid-glass-readable grid gap-2 rounded-2xl p-3 text-sm text-blue-900 sm:grid-cols-2">
                           <div>预算年度：<strong>{importPreview.year} 年</strong></div>
                           <div>工作表：<span className="font-mono">{importPreview.sheetName}</span></div>
                           <div>明细行：{importPreview.rows.length} 条</div>
                           <div>全年合计：<strong>{formatCurrency(importPreview.annualTotal)}</strong></div>
                       </div>

                       <div className="liquid-glass-readable overflow-hidden rounded-2xl">
	                           <div className="liquid-budget-import-head border-b border-slate-200/80 px-4 py-2 text-xs font-bold text-slate-600">
                               月度合计（将写入「预算执行」表的目标列）
                           </div>
	                           <div className="liquid-budget-import-body overflow-x-auto">
                           <table className="w-full min-w-[680px] text-sm">
                               <thead className="text-xs text-slate-500">
                                   <tr>
                                       {Array.from({ length: 12 }).map((_, i) => (
                                           <th key={i} className="text-right px-2 py-1.5">{i + 1}月</th>
                                       ))}
                                   </tr>
                               </thead>
                               <tbody>
	                                   <tr className="border-t border-slate-200/70">
                                       {importPreview.monthlyTotals.map((v, i) => (
                                           <td key={i} className="text-right px-2 py-1.5 font-mono text-slate-700">
                                               {(v / 10000).toFixed(2)}万
                                           </td>
                                       ))}
                                   </tr>
                               </tbody>
                           </table>
                           </div>
                       </div>

                       {importPreview.warnings.length > 0 && (
                           <div className="rounded-2xl border border-amber-200/90 bg-amber-50/92 p-3 text-xs text-amber-800 space-y-1">
                               <div className="font-bold flex items-center gap-1">
                                   <AlertCircle size={14} /> 解析提示（{importPreview.warnings.length} 条）
                               </div>
                               <ul className="list-disc list-inside space-y-0.5 max-h-32 overflow-auto">
                                   {importPreview.warnings.slice(0, 50).map((w, i) => (
                                       <li key={i}>{w}</li>
                                   ))}
                               </ul>
                           </div>
                       )}

                       <div className="liquid-glass-readable overflow-hidden rounded-2xl">
	                           <div className="liquid-budget-import-head flex items-center justify-between border-b border-slate-200/80 px-4 py-2 text-xs font-bold text-slate-600">
                               <span>明细预览（前 8 行）</span>
                               <span className="text-slate-500">仅显示，不影响导入结果</span>
                           </div>
	                           <div className="liquid-budget-import-body overflow-x-auto">
                               <table className="w-full text-xs">
                                   <thead className="text-slate-500">
                                       <tr>
                                           <th className="text-left px-2 py-1.5">客户</th>
                                           <th className="text-left px-2 py-1.5">房号</th>
                                           <th className="text-left px-2 py-1.5">楼宇</th>
                                           <th className="text-left px-2 py-1.5">类别</th>
                                           <th className="text-right px-2 py-1.5">合计(元)</th>
                                       </tr>
                                   </thead>
                                   <tbody>
                                       {importPreview.rows.slice(0, 8).map((r, i) => (
	                                           <tr key={i} className="border-t border-slate-200/70">
                                               <td className="px-2 py-1.5">{r.customer}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.unit}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.building}</td>
                                               <td className="px-2 py-1.5 text-slate-500">{r.category}</td>
                                               <td className="px-2 py-1.5 text-right font-mono">{formatCurrency(r.total)}</td>
                                           </tr>
                                       ))}
                                   </tbody>
                               </table>
                           </div>
                       </div>

                       <div className="liquid-glass-readable rounded-2xl p-3 text-xs text-slate-600 leading-relaxed">
                           <div className="font-bold text-slate-700 mb-1">导入说明</div>
                           确认导入后，<strong>{importPreview.year} 年</strong>每月的预算目标将被覆盖为以上「月度合计」值；
                           其它字段（实收金额、出租率、累计欠款）保留原值。
                           导入只在本地生效，请检查无误后再点击右上角「保存」写入后端。
                       </div>
                   </div>
                   <div className="flex justify-end gap-3 border-t border-white/70 px-6 py-4">
                       <button
                           onClick={() => setImportPreview(null)}
                           className={budgetGhostButtonClass}
                       >
                           取消
                       </button>
                       <button
                           onClick={confirmApplyImportedBudget}
                           className="liquid-action-strong liquid-pressable rounded-full px-5 py-2 text-sm font-bold"
                       >
                           确认导入预算表
                       </button>
                   </div>
               </div>
           </div>
       )}
      {budgetPrompt ? (
          <BudgetPromptOverlay prompt={budgetPrompt} onClose={closeBudgetPrompt} />
      ) : null}
    </div>
  );
};
