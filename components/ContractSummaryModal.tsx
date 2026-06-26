import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Calendar, FileText, Info, X } from 'lucide-react';
import { ContractStatus, type BudgetAdjustment, type BudgetAssumption, type Building, type CloudConfig, type RentFreePeriod, type Tenant, type Unit } from '../types';
import type { BudgetedBill } from '../services/billingService';
import {
    buildVacancyBudgetAlignmentNote,
    pickVacancyAssumptionsForTenant,
} from '../services/billingLightweight';
import { createBudgetedBillCache, type BillGenerationCache } from '../services/billGenerationCache';
import { fetchCloudBudgetedBillsPreviewBatch } from '../services/cloudComputeClient';
import { shouldRunLocalBudgetedBillPreviewFallback } from '../services/computeFallbackPolicy';
import { indexBudgetedBillPreviewBatchResult } from '../services/budgetedBillPreviewBatch';
import { receivableBudgetMonthForBill } from '../services/receivableListHelpers';
import { formatArea, formatCurrency } from '../services/numberFormat';
import {
    formatLocalYMD,
    budgetBillCoverageLabel,
    monthOverlapsRentFree,
    formatYearRentFreeSummary,
    compareUnitNameNumeric,
    tenantUnitsResolved,
    paymentCycleLabelMap,
    paymentCycleLabel,
    freeRentHandlingLabel,
} from '../services/sharedUtils';
import type { ContractSummaryContent } from './contractSummaryHelpers';

const CONTRACT_STATUS_LABEL: Record<ContractStatus, string> = {
    [ContractStatus.Active]: '履约中',
    [ContractStatus.Expiring]: '即将到期',
    [ContractStatus.Pending]: '签约中',
    [ContractStatus.Terminated]: '已退租',
    [ContractStatus.Expired]: '已到期',
};

function parseYYYYMM(s: string | undefined): { y: number; m: number } | null {
    if (!s || typeof s !== 'string') return null;
    const match = s.trim().match(/^(\d{4})-(\d{2})$/);
    if (!match) return null;
    const y = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isFinite(y) || !Number.isFinite(month) || month < 1 || month > 12) return null;
    return { y, m: month };
}

/** 与财务报表当月应收口径一致：归属「账单日 b.date」落在该自然月的推算账单 */
function billDateMatchesReceivableMonth(b: BudgetedBill, receivableYYYYMM: string | undefined): boolean {
    const p = parseYYYYMM(receivableYYYYMM);
    if (!p) return false;
    return b.date.getFullYear() === p.y && b.date.getMonth() + 1 === p.m;
}

/** 覆盖租期与核销自然月（YYYY-MM）有交集（先付后住、账期偏移等常见：收款日不在当月但覆盖当月） */
function billCoverageTouchesReceivableMonth(b: BudgetedBill, receivableYYYYMM: string | undefined): boolean {
    const p = parseYYYYMM(receivableYYYYMM);
    if (!p || !b.coverageStart || !b.coverageEnd) return false;
    const ms = new Date(p.y, p.m - 1, 1);
    const me = new Date(p.y, p.m, 0);
    const cs = new Date(b.coverageStart.getFullYear(), b.coverageStart.getMonth(), b.coverageStart.getDate());
    const ce = new Date(b.coverageEnd.getFullYear(), b.coverageEnd.getMonth(), b.coverageEnd.getDate());
    return cs <= me && ce >= ms;
}

/** 与财务报表「按月应收」一致：账期顺延按覆盖期首月，否则按收款日所在月 */
function billAccrualMonthMatchesReceivableMonth(
    b: BudgetedBill,
    tenant: Tenant,
    receivableYYYYMM: string | undefined
): boolean {
    const p = parseYYYYMM(receivableYYYYMM);
    if (!p) return false;
    const { year, monthIndex } = receivableBudgetMonthForBill(b, tenant);
    return year === p.y && monthIndex + 1 === p.m;
}

/** 与「客户合同详情 → 应收款明细预览」勾选叠加预算时紫色摘要一致：存量假设 + 预算调整记录 */
function buildStockOptimizationOverlayItems(
    tenantId: string,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
): { tag: string; color: string; text: string }[] {
    const existingTenantAssumptions = assumptions.filter((a) => a.targetId === tenantId && a.targetType === 'Existing');
    const tenantAdjs = adjustments.filter((a) => a.tenantId === tenantId);
    const items: { tag: string; color: string; text: string }[] = [];
    existingTenantAssumptions.forEach((a) => {
        if (a.priceAdjustment) {
            items.push({
                tag: '调价',
                color: 'amber',
                text: `自 ${a.priceAdjustment.startDate} 起单价改为 ¥${a.priceAdjustment.newUnitPrice}/天/㎡`,
            });
        }
        if (a.billingCycleShiftMonths && a.billingCycleShiftMonths !== 0) {
            items.push({
                tag: '账期偏移',
                color: 'blue',
                text: `所有收款日期整体${a.billingCycleShiftMonths > 0 ? '推后' : '提前'} ${Math.abs(a.billingCycleShiftMonths)} 个月`,
            });
        }
        if (a.paymentShift?.isActive) {
            items.push({
                tag: '付款转移',
                color: 'cyan',
                text: `${a.paymentShift.fromYear}年${a.paymentShift.fromMonth + 1}月 → ${a.paymentShift.toYear}年${a.paymentShift.toMonth + 1}月，金额 ¥${a.paymentShift.amount.toLocaleString()}`,
            });
        }
    });
    tenantAdjs.forEach((adj) => {
        const isAmt =
            adj.adjustmentKind === 'amount_delta' || (adj.originalYear === -1 && adj.originalMonth === -1);
        if (isAmt) {
            items.push({
                tag: '金额调整',
                color: 'cyan',
                text: `${adj.adjustedYear}年${adj.adjustedMonth + 1}月 ${adj.amount >= 0 ? '+' : ''}¥${adj.amount.toLocaleString()}${adj.reason ? `（${adj.reason}）` : ''}`,
            });
        } else {
            items.push({
                tag: '账期调整',
                color: 'cyan',
                text: `${adj.originalYear}年${adj.originalMonth + 1}月 → ${adj.adjustedYear}年${adj.adjustedMonth + 1}月${adj.reason ? `（${adj.reason}）` : ''}`,
            });
        }
    });
    return items;
}

const OVERLAY_TAG_COLOR_MAP: Record<string, string> = {
    amber: 'bg-amber-50/88 text-amber-800 border-amber-200/80',
    blue: 'bg-blue-50/88 text-blue-800 border-blue-200/80',
    cyan: 'bg-cyan-50/88 text-cyan-800 border-cyan-200/80',
};

export type ContractSummaryModalProps = {
    open: boolean;
    onClose: () => void;
    detailYear: number;
    /** 标题下的灰色说明 */
    subtitle: string;
    /** 推算应收表格小标题，默认「与预算列一致」 */
    billsSectionSuffix?: string;
    budgetAssumptions?: BudgetAssumption[];
    budgetAdjustments?: BudgetAdjustment[];
    cloudConfig?: CloudConfig;
    serverComputeEnabled?: boolean;
    content: ContractSummaryContent;
    /**
     * 财务报表核销视图：当前账期 `YYYY-MM`。
     * 与列表应收口径一致，高亮「账单日」落在该月的推算账单行。
     */
    highlightReceivableYYYYMM?: string;
};

export const ContractSummaryModal: React.FC<ContractSummaryModalProps> = ({
    open,
    onClose,
    detailYear,
    subtitle,
    billsSectionSuffix = '与预算列一致',
    budgetAssumptions = [],
    budgetAdjustments = [],
    cloudConfig,
    serverComputeEnabled = false,
    content,
    highlightReceivableYYYYMM,
}) => {
    const billCacheRef = useRef<BillGenerationCache | null>(null);
    const getLocalBillCache = useCallback(async (): Promise<BillGenerationCache> => {
        if (billCacheRef.current) return billCacheRef.current;
        const { generateBudgetedBills } = await import('../services/billingService');
        const cache = createBudgetedBillCache({ maxEntries: 96, generateBudgetedBills });
        billCacheRef.current = cache;
        return cache;
    }, []);
    const [billPreviewState, setBillPreviewState] = useState<{
        yearBills: BudgetedBill[];
        rawYearBills: BudgetedBill[];
        loading: boolean;
        error?: string;
    }>({ yearBills: [], rawYearBills: [], loading: false });

    const vacancyBudgetNote = useMemo(() => {
        if (content.kind !== 'tenant') return undefined;
        return buildVacancyBudgetAlignmentNote(content.tenant, budgetAssumptions);
    }, [content, budgetAssumptions]);

    const stockOverlayItems = useMemo(() => {
        if (content.kind !== 'tenant') return [];
        return buildStockOptimizationOverlayItems(content.tenant.id, budgetAssumptions, budgetAdjustments);
    }, [content, budgetAssumptions, budgetAdjustments]);

    /** 与合同预览一致：存在空置去化挂接、存量假设或预算调整时，与纯合同推算对照标注行 */
    const tenantBudgetTouches = useMemo(() => {
        if (content.kind !== 'tenant') return false;
        const t = content.tenant;
        const vac = pickVacancyAssumptionsForTenant(t, budgetAssumptions).length > 0;
        const existing = budgetAssumptions.some((a) => a.targetType === 'Existing' && a.targetId === t.id);
        const adj = budgetAdjustments.some((a) => a.tenantId === t.id);
        return vac || existing || adj;
    }, [content, budgetAssumptions, budgetAdjustments]);

    useEffect(() => {
        if (!open || content.kind !== 'tenant') {
            setBillPreviewState({ yearBills: [], rawYearBills: [], loading: false });
            return;
        }
        const billingGenStart = new Date(detailYear - 2, 0, 1);
        const billingGenEnd = new Date(detailYear, 11, 31);
        const filterYearBills = (bills: BudgetedBill[]) =>
            bills
                .filter((b) => b.date.getFullYear() === detailYear)
                .sort((a, b) => a.date.getTime() - b.date.getTime());
        const localPreview = async () => {
            const cache = await getLocalBillCache();
            return {
                yearBills: filterYearBills(cache.get({
                    tenant: content.tenant,
                    assumptions: budgetAssumptions,
                    adjustments: budgetAdjustments,
                    start: billingGenStart,
                    end: billingGenEnd,
                    scopeHint: `contract-summary:${content.tenant.id}:budget:${detailYear}`,
                })),
                rawYearBills: tenantBudgetTouches
                    ? filterYearBills(cache.get({
                          tenant: content.tenant,
                          assumptions: [],
                          adjustments: [],
                          start: billingGenStart,
                          end: billingGenEnd,
                          scopeHint: `contract-summary:${content.tenant.id}:raw:${detailYear}`,
                      }))
                    : [],
                loading: false,
            };
        };
        const setLocalPreview = () => {
            setBillPreviewState((prev) => ({ ...prev, loading: true, error: undefined }));
            localPreview()
                .then((state) => {
                    if (!cancelled) setBillPreviewState(state);
                })
                .catch((error: unknown) => {
                    if (!cancelled) {
                        setBillPreviewState({
                            yearBills: [],
                            rawYearBills: [],
                            loading: false,
                            error: error instanceof Error ? error.message : '本地推算应收账单模块加载失败。',
                        });
                    }
                });
        };

        const canUseServer = serverComputeEnabled && !!cloudConfig?.projectId;
        let cancelled = false;
        if (!canUseServer || !cloudConfig) {
            if (!shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: false })) {
                setBillPreviewState({
                    yearBills: [],
                    rawYearBills: [],
                    loading: false,
                    error: '后台批量推算应收账单计算不可用，未执行前端本地重算。',
                });
                return;
            }
            setLocalPreview();
            return () => {
                cancelled = true;
            };
        }

        setBillPreviewState({ yearBills: [], rawYearBills: [], loading: true });
        const batchItems = [
            {
                id: 'budget',
                tenant: content.tenant,
                assumptions: budgetAssumptions,
                adjustments: budgetAdjustments,
                startDate: billingGenStart,
                endDate: billingGenEnd,
            },
            ...(tenantBudgetTouches
                ? [{
                    id: 'raw',
                    tenant: content.tenant,
                    assumptions: [],
                    adjustments: [],
                    startDate: billingGenStart,
                    endDate: billingGenEnd,
                }]
                : []),
        ];

        fetchCloudBudgetedBillsPreviewBatch(cloudConfig, { items: batchItems }).then((result) => {
            if (cancelled) return;
            const lookup = indexBudgetedBillPreviewBatchResult(
                result,
                tenantBudgetTouches ? ['budget', 'raw'] : ['budget'],
            );
            if (lookup.ok) {
                const budgetBills = lookup.billsById.get('budget') || [];
                const rawBills = lookup.billsById.get('raw') || [];
                setBillPreviewState({
                    yearBills: filterYearBills(budgetBills),
                    rawYearBills: filterYearBills(rawBills),
                    loading: false,
                });
                return;
            }
            if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
                setLocalPreview();
                return;
            }
            setBillPreviewState({
                yearBills: [],
                rawYearBills: [],
                loading: false,
                error:
                    lookup.message ||
                    '后台批量推算应收账单计算失败，未执行前端本地重算。',
            });
        }).catch((error: unknown) => {
            if (!cancelled) {
                if (shouldRunLocalBudgetedBillPreviewFallback({ canUseServer, serverAttempted: true })) {
                    setLocalPreview();
                    return;
                }
                setBillPreviewState({
                    yearBills: [],
                    rawYearBills: [],
                    loading: false,
                    error: error instanceof Error
                        ? error.message
                        : '后台推算应收账单计算失败，未执行前端本地重算。',
                });
            }
        });

        return () => {
            cancelled = true;
        };
    }, [
        budgetAdjustments,
        budgetAssumptions,
        cloudConfig,
        content,
        detailYear,
        getLocalBillCache,
        open,
        serverComputeEnabled,
        tenantBudgetTouches,
    ]);

    const yearBills = billPreviewState.yearBills;

    const rawYearBillDiffSets = useMemo(() => {
        if (content.kind !== 'tenant' || !tenantBudgetTouches) return null;
        const raw = billPreviewState.rawYearBills;
        return {
            rawDateAmtSet: new Set(
                raw.map((b) => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}|${b.amount.toFixed(2)}`),
            ),
            rawDateSet: new Set(raw.map((b) => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`)),
        };
    }, [billPreviewState.rawYearBills, content.kind, tenantBudgetTouches]);

    const highlightPeriod = parseYYYYMM(highlightReceivableYYYYMM);
    const highlightPeriodLabel = highlightPeriod
        ? `${highlightPeriod.y}-${String(highlightPeriod.m).padStart(2, '0')}`
        : '';
    const hasAccrualMonthMatchInYearBills = useMemo(() => {
        if (content.kind !== 'tenant' || !highlightReceivableYYYYMM) return false;
        return yearBills.some((b) =>
            billAccrualMonthMatchesReceivableMonth(b, content.tenant, highlightReceivableYYYYMM)
        );
    }, [content, yearBills, highlightReceivableYYYYMM]);

    const hasHighlightMatch =
        content.kind === 'tenant' &&
        !!highlightPeriod &&
        yearBills.some((b) => {
            const accrual = billAccrualMonthMatchesReceivableMonth(b, content.tenant, highlightReceivableYYYYMM);
            const dateM = billDateMatchesReceivableMonth(b, highlightReceivableYYYYMM);
            if (accrual || dateM) return true;
            return (
                !hasAccrualMonthMatchInYearBills && billCoverageTouchesReceivableMonth(b, highlightReceivableYYYYMM)
            );
        });

    const getBillVisualState = (b: BudgetedBill) => {
        const accrualMatch =
            content.kind === 'tenant' &&
            billAccrualMonthMatchesReceivableMonth(b, content.tenant, highlightReceivableYYYYMM);
        const dateMatch = billDateMatchesReceivableMonth(b, highlightReceivableYYYYMM);
        const coverageOnlyMatch =
            !accrualMatch &&
            !dateMatch &&
            billCoverageTouchesReceivableMonth(b, highlightReceivableYYYYMM) &&
            !hasAccrualMonthMatchInYearBills;
        const dateKey = `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`;
        const dateAmtKey = `${dateKey}|${b.amount.toFixed(2)}`;
        const isBudgetNew = !!rawYearBillDiffSets && !rawYearBillDiffSets.rawDateSet.has(dateKey);
        const isBudgetChanged =
            !!rawYearBillDiffSets &&
            !isBudgetNew &&
            !rawYearBillDiffSets.rawDateAmtSet.has(dateAmtKey);
        return {
            accrualMatch,
            dateMatch,
            coverageOnlyMatch,
            isBudgetNew,
            isBudgetChanged,
            rowHighlight: accrualMatch || dateMatch || coverageOnlyMatch,
        };
    };

    const getBillRowClass = (state: ReturnType<typeof getBillVisualState>) => {
        if (state.rowHighlight) return 'bg-sky-50 ring-1 ring-inset ring-sky-300/90 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]';
        if (state.isBudgetNew) return 'bg-blue-50/54';
        if (state.isBudgetChanged) return 'bg-amber-50/40';
        return 'hover:bg-blue-50/32';
    };

    const getBillCardClass = (state: ReturnType<typeof getBillVisualState>) => {
        if (state.rowHighlight) return 'border-sky-200/80 bg-sky-50/78 shadow-[0_14px_32px_rgba(14,165,233,0.10)]';
        if (state.isBudgetNew) return 'border-blue-200/80 bg-blue-50/64';
        if (state.isBudgetChanged) return 'border-amber-200/80 bg-amber-50/64';
        return 'border-white/70 bg-white/62';
    };

    const renderBillBadges = (b: BudgetedBill, state: ReturnType<typeof getBillVisualState>) => (
        <>
            {state.accrualMatch || state.dateMatch ? (
                <span className="rounded-full bg-sky-200/95 px-2 py-0.5 text-xs font-black text-sky-950 md:text-[10px]">
                    当前账期
                </span>
            ) : state.coverageOnlyMatch ? (
                <span
                    className="rounded-full bg-sky-100/95 px-2 py-0.5 text-xs font-black text-sky-900 md:text-[10px]"
                    title="收款日不在该自然月，但覆盖租期与该核销月有交集"
                >
                    覆盖含当月
                </span>
            ) : null}
            {state.isBudgetNew ? (
                <span
                    className="rounded-full bg-blue-100/95 px-2 py-0.5 text-xs font-black text-blue-800 md:text-[10px]"
                    title="此账期由预算假设/调整新增"
                >
                    预算新增
                </span>
            ) : null}
            {state.isBudgetChanged ? (
                <span
                    className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-800 md:text-[10px]"
                    title="此账期金额因预算调整发生变化（含账期调整合并等）"
                >
                    金额已调整
                </span>
            ) : null}
            {b.earlyTerminationExtraDetail ? (
                <span
                    className="rounded-full border border-amber-200 bg-amber-100 px-2 py-0.5 text-xs font-black text-amber-900 md:text-[10px]"
                    title="免租扣回、押金扣款、其它调整（不含当期租金）"
                >
                    提前退租结算
                </span>
            ) : null}
        </>
    );

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div className="liquid-elevated-backdrop fixed inset-0 z-[62] flex items-end justify-center p-0 sm:p-4 md:items-center" onClick={onClose}>
            <div
                className="liquid-elevated-panel flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-[30px] animate-in zoom-in-50 duration-200 md:max-h-[92vh] md:rounded-[28px]"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="contract-summary-title"
            >
                <div className="liquid-elevated-header px-4 sm:px-6 py-4 border-b border-white/70 flex justify-between items-start gap-3 flex-shrink-0">
                    <div className="min-w-0">
                        <h3 id="contract-summary-title" className="text-lg font-black text-slate-950 flex items-center gap-2">
                            <span className="liquid-icon-well inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl text-blue-700">
                                <FileText size={20} />
                            </span>
                            合同概要
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
                    </div>
                    <button type="button" onClick={onClose} className="liquid-glass-control liquid-pressable inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-slate-500 hover:text-slate-950" aria-label="关闭">
                        <X size={22} />
                    </button>
                </div>
                <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 text-sm text-slate-700">
                    {content.kind === 'vacant' ? (
                        <div className="liquid-elevated-card rounded-2xl p-4 sm:p-5 space-y-4">
                            <div>
                                <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">空置去化（假设）</div>
                                <div className="text-base font-bold text-slate-900 mt-1">{content.building}</div>
                                <div className="text-sm text-slate-600 mt-0.5">{content.unitNames}</div>
                            </div>
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                                <div>
                                    <dt className="text-xs text-slate-500">预测签约 / 起租</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.leaseStart)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">租赁面积</dt>
                                    <dd className="font-medium">{formatArea(content.area)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">假设单价（元/㎡·天）</dt>
                                    <dd className="font-medium">
                                        {content.unitPrice != null && content.unitPrice > 0 ? Number(content.unitPrice.toFixed(2)) : '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">{detailYear} 年免租（自然月）</dt>
                                    <dd className="font-medium leading-snug">{content.rentFreeYearSummary || '—'}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">付款周期</dt>
                                    <dd className="font-medium">{content.paymentCycleLabel || '季付'}</dd>
                                </div>
                            </dl>
                            <p className="text-xs text-slate-500 border-t border-white/70 pt-3">该行来自招商空置假设，正式条款以签约合同为准。</p>
                        </div>
                    ) : content.kind === 'missing' ? (
                        <p className="liquid-elevated-card rounded-2xl px-4 py-3 text-rose-600">{content.hint || '未找到该客户的合同档案，无法展示明细。'}</p>
                    ) : (
                        <>
                            <div className="liquid-elevated-card rounded-2xl p-4 sm:p-5">
                                <div className="text-lg font-bold text-slate-900 leading-snug">{content.tenant.name}</div>
                                <div className="text-xs text-slate-500 mt-1 flex flex-wrap gap-x-2 gap-y-1">
                                    <span>{content.buildingLabel}</span>
                                    <span className="text-slate-300">·</span>
                                    <span title={content.unitNamesLabel ? `房号：${content.unitNamesLabel}` : undefined}>
                                        {content.unitNamesLabel?.trim() || '—'}
                                    </span>
                                    <span className="text-slate-300">·</span>
                                    <span>{formatArea(content.tenant.totalArea)}</span>
                                </div>
                            </div>
                            <dl className="liquid-elevated-card rounded-2xl p-4 sm:p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
                                <div>
                                    <dt className="text-xs text-slate-500">合同状态</dt>
                                    <dd className="font-medium">{CONTRACT_STATUS_LABEL[content.tenant.status] ?? String(content.tenant.status)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">签约日</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.tenant.signingDate)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">起租日</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.tenant.leaseStart)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">合同到期</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.tenant.leaseEnd)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">实际退租 / 结算日</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.tenant.terminationDate)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">租金单价（元/㎡·天）</dt>
                                    <dd className="font-medium">
                                        {content.tenant.unitPrice != null && content.tenant.unitPrice > 0
                                            ? Number(content.tenant.unitPrice.toFixed(2))
                                            : '—'}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">月租金（含税口径参考）</dt>
                                    <dd className="font-medium">{formatCurrency(content.tenant.monthlyRent)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">付款方式</dt>
                                    <dd className="font-medium">
                                        {paymentCycleLabel(content.tenant.paymentCycle)}
                                        {content.tenant.paymentCycle === 'Custom' &&
                                            content.tenant.paymentCycleMonths != null &&
                                            `（${content.tenant.paymentCycleMonths} 个月）`}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">首期应收日</dt>
                                    <dd className="font-medium">{formatLocalYMD(content.tenant.firstPaymentDate)}</dd>
                                </div>
                                <div>
                                    <dt className="text-xs text-slate-500">押金</dt>
                                    <dd className="font-medium">{formatCurrency(content.tenant.depositAmount)}</dd>
                                </div>
                                <div className="sm:col-span-2">
                                    <dt className="text-xs text-slate-500">免租期处理方式</dt>
                                    <dd className="font-medium">{freeRentHandlingLabel(content.tenant.freeRentHandling)}</dd>
                                </div>
                                <div className="sm:col-span-2">
                                    <dt className="text-xs text-slate-500 mb-1">{detailYear} 年涉及免租（自然月）</dt>
                                    <dd className="font-medium">{formatYearRentFreeSummary(detailYear, content.tenant.rentFreePeriods || [])}</dd>
                                </div>
                                <div className="sm:col-span-2">
                                    <dt className="text-xs text-slate-500 mb-1">合同约定免租区间</dt>
                                    <dd className="font-medium space-y-1">
                                        {(content.tenant.rentFreePeriods || []).length === 0 ? (
                                            <span>—</span>
                                        ) : (
                                            <ul className="list-disc pl-4 space-y-0.5 text-slate-700">
                                                {(content.tenant.rentFreePeriods || []).map((p, i) => (
                                                    <li key={`${p.start}-${p.end}-${i}`}>
                                                        {formatLocalYMD(p.start)} ~ {formatLocalYMD(p.end)}
                                                        {p.description ? ` · ${p.description}` : ''}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </dd>
                                </div>
                            </dl>
                            <div>
                                <div className="text-xs font-black text-slate-700 mb-2 flex items-center gap-1.5 flex-wrap">
                                    <Calendar size={14} className="text-slate-400 shrink-0" />
                                    <span>
                                        {detailYear} 年系统推算每期应收（{billsSectionSuffix}）
                                    </span>
                                </div>
                                {highlightPeriod && yearBills.length > 0 ? (
                                    <p
                                        className={`liquid-elevated-card mb-2 rounded-2xl px-3 py-2 text-xs font-semibold leading-snug ${
                                            hasHighlightMatch
                                                ? 'border border-sky-200/80 bg-sky-50/76 text-sky-900'
                                                : 'border border-amber-200/80 bg-amber-50/76 text-amber-900'
                                        }`}
                                    >
                                        {hasHighlightMatch ? (
                                            <>
                                                浅蓝底行为当前核销账期 <span className="font-mono font-bold">{highlightPeriodLabel}</span>{' '}
                                                对应的推算应收：与财务报表一致按「账单日所在自然月」归属；无命中期次时才用覆盖租期交集标灰提示。
                                            </>
                                        ) : (
                                            <>
                                                当前核销账期为 <span className="font-mono font-bold">{highlightPeriodLabel}</span>
                                                ，本年度推算中暂无与该月对应的期次（账单日不在该月且覆盖租期亦未触及该月；或该月仅有缓缴/导入等表外调整，见核销列表）。
                                            </>
                                        )}
                                    </p>
                                ) : null}
                                {stockOverlayItems.length > 0 ? (
                                    <div className="liquid-elevated-card mb-3 p-3 rounded-2xl border border-cyan-200/80 bg-cyan-50/58">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Info size={14} className="text-cyan-700 shrink-0" />
                                            <span className="text-xs font-bold text-cyan-900">
                                                已叠加 {stockOverlayItems.length} 项存量调优设置（与「客户合同详情 → 应收款明细预览」勾选预算叠加口径一致）
                                            </span>
                                        </div>
                                        <ul className="space-y-1">
                                            {stockOverlayItems.map((it, i) => (
                                                <li key={i} className="text-xs flex items-start gap-2">
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded border text-xs font-bold flex-shrink-0 md:text-[10px] ${
                                                            OVERLAY_TAG_COLOR_MAP[it.color] ?? 'bg-blue-50/88 text-blue-800 border-blue-200/80'
                                                        }`}
                                                    >
                                                        {it.tag}
                                                    </span>
                                                    <span className="text-slate-700">{it.text}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                ) : null}
                                {billPreviewState.loading ? (
                                    <p className="liquid-elevated-card text-xs text-slate-500 rounded-xl px-3 py-2">
                                        后台正在计算推算应收账单...
                                    </p>
                                ) : billPreviewState.error ? (
                                    <p className="liquid-elevated-card flex items-start gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/78 px-3 py-2 text-xs font-semibold text-amber-900">
                                        <AlertCircle size={14} className="mt-0.5 shrink-0" />
                                        <span>{billPreviewState.error}</span>
                                    </p>
                                ) : yearBills.length === 0 ? (
                                    <p className="liquid-elevated-card text-xs text-slate-500 rounded-xl px-3 py-2">
                                        本年度无系统推算应收账单（未起租、已结束履约或金额为零等情况）。
                                    </p>
                                ) : (
                                    <>
                                    <div className="space-y-2 md:hidden">
                                        {yearBills.map((b, i) => {
                                            const state = getBillVisualState(b);
                                            return (
                                                <article
                                                    key={`${b.date.getTime()}-${i}-mobile`}
                                                    className={`liquid-elevated-card rounded-3xl border px-3.5 py-3 ${getBillCardClass(state)}`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="min-w-0">
                                                            <div className="text-xs font-black text-slate-500">账单月</div>
                                                            <div className="mt-0.5 font-mono text-base font-black text-slate-950">
                                                                {b.date.getFullYear()}-
                                                                {String(b.date.getMonth() + 1).padStart(2, '0')}
                                                            </div>
                                                        </div>
                                                        <div className="shrink-0 text-right">
                                                            <div className="text-xs font-black text-slate-500">应收金额</div>
                                                            <div className="mt-0.5 font-mono text-base font-black text-blue-800">
                                                                {formatCurrency(b.amount)}
                                                            </div>
                                                        </div>
                                                    </div>
                                                    <div className="mt-3 flex flex-wrap gap-1.5">
                                                        {renderBillBadges(b, state)}
                                                    </div>
                                                    <div className="mt-3 rounded-2xl border border-white/70 bg-white/58 px-3 py-2">
                                                        <div className="text-xs font-black text-slate-500">覆盖租期</div>
                                                        <div className="mt-0.5 text-sm font-bold text-slate-800">
                                                            {budgetBillCoverageLabel(b)}
                                                        </div>
                                                    </div>
                                                </article>
                                            );
                                        })}
                                    </div>
                                    <div className="liquid-elevated-table hidden overflow-x-auto rounded-2xl border border-white/75 md:block">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="liquid-contract-sticky text-slate-600 text-left border-b border-white/70">
                                                    <th className="px-3 py-2 font-semibold whitespace-nowrap">账单月</th>
                                                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">应收金额</th>
                                                    <th className="px-3 py-2 font-semibold whitespace-nowrap min-w-[180px]">覆盖租期</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-200/60 bg-transparent">
                                                {yearBills.map((b, i) => {
                                                    const state = getBillVisualState(b);
                                                    return (
                                                        <tr
                                                            key={`${b.date.getTime()}-${i}`}
                                                            className={getBillRowClass(state)}
                                                        >
                                                            <td className="px-3 py-2 whitespace-nowrap font-mono align-top">
                                                                <span className="inline-flex items-center gap-1.5 flex-wrap">
                                                                    <span>
                                                                        {b.date.getFullYear()}-
                                                                        {String(b.date.getMonth() + 1).padStart(2, '0')}
                                                                    </span>
                                                                    {renderBillBadges(b, state)}
                                                                </span>
                                                            </td>
                                                            <td className="px-3 py-2 text-right font-semibold text-slate-800 align-top">
                                                                {formatCurrency(b.amount)}
                                                            </td>
                                                            <td className="px-3 py-2 text-slate-600 whitespace-nowrap align-top">
                                                                {budgetBillCoverageLabel(b)}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                    </>
                                )}
                                {vacancyBudgetNote ? (
                                    <p className="liquid-elevated-card mt-2 rounded-2xl border border-rose-200/80 bg-rose-50/78 px-3 py-2 text-xs font-semibold leading-snug text-rose-900">
                                        {vacancyBudgetNote}
                                    </p>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
                <div className="liquid-elevated-footer flex flex-shrink-0 justify-end border-t border-white/70 px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] sm:px-6 sm:pb-4">
                    <button type="button" onClick={onClose} className="liquid-action-strong liquid-pressable w-full rounded-full px-5 py-2.5 font-bold sm:w-auto sm:py-2">
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
