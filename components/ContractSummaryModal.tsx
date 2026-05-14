import React, { useEffect, useMemo } from 'react';
import { Calendar, FileText, Info, X } from 'lucide-react';
import { ContractStatus, type BudgetAdjustment, type BudgetAssumption, type Building, type RentFreePeriod, type Tenant, type Unit } from '../types';
import {
    buildVacancyBudgetAlignmentNote,
    generateBudgetedBills,
    pickVacancyAssumptionsForTenant,
    type BudgetedBill,
} from '../services/billingService';
import { receivableBudgetMonthForBill } from '../services/receivableListHelpers';
import { formatArea, formatCurrency } from '../services/numberFormat';
import {
    formatLocalYMD,
    budgetBillCoverageLabel,
    monthOverlapsRentFree,
    formatYearRentFreeSummary,
    compareUnitNameNumeric,
    tenantUnitsResolved,
    tenantMergedRoomLabels,
    paymentCycleLabelMap,
    paymentCycleLabel,
    freeRentHandlingLabel,
} from '../services/sharedUtils';

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
                color: 'indigo',
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
                color: 'teal',
                text: `${adj.adjustedYear}年${adj.adjustedMonth + 1}月 ${adj.amount >= 0 ? '+' : ''}¥${adj.amount.toLocaleString()}${adj.reason ? `（${adj.reason}）` : ''}`,
            });
        } else {
            items.push({
                tag: '账期调整',
                color: 'purple',
                text: `${adj.originalYear}年${adj.originalMonth + 1}月 → ${adj.adjustedYear}年${adj.adjustedMonth + 1}月${adj.reason ? `（${adj.reason}）` : ''}`,
            });
        }
    });
    return items;
}

const OVERLAY_TAG_COLOR_MAP: Record<string, string> = {
    amber: 'bg-amber-50 text-amber-800 border-amber-200',
    blue: 'bg-blue-50 text-blue-800 border-blue-200',
    indigo: 'bg-indigo-50 text-indigo-800 border-indigo-200',
    teal: 'bg-teal-50 text-teal-800 border-teal-200',
    purple: 'bg-purple-50 text-purple-800 border-purple-200',
};

export type ContractSummaryContent =
    | {
          kind: 'vacant';
          building: string;
          unitNames: string;
          leaseStart?: string;
          area: number;
          unitPrice?: number | null;
          rentFreeYearSummary?: string;
          paymentCycleLabel?: string;
      }
    | {
          kind: 'tenant';
          tenant: Tenant;
          buildingLabel: string;
          unitNamesLabel: string;
      }
    | { kind: 'missing'; hint?: string };

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
    content: ContractSummaryContent;
    /**
     * 财务报表核销视图：当前账期 `YYYY-MM`。
     * 与列表应收口径一致，高亮「账单日」落在该月的推算账单行。
     */
    highlightReceivableYYYYMM?: string;
};

/** 由租户 + 楼宇列表解析展示用楼宇名、房号串（财务报表等无预算行数据时使用） */
export function resolveTenantAssetLabels(tenant: Tenant, buildings: Building[] | undefined): {
    buildingLabel: string;
    unitNamesLabel: string;
} {
    const b = buildings?.find((x) => x.id === tenant.buildingId);
    const unitNamesLabel = tenantMergedRoomLabels(tenant, b) || tenant.unitIds.join('、');
    return { buildingLabel: b?.name || '未知楼宇', unitNamesLabel };
}

export const ContractSummaryModal: React.FC<ContractSummaryModalProps> = ({
    open,
    onClose,
    detailYear,
    subtitle,
    billsSectionSuffix = '与预算列一致',
    budgetAssumptions = [],
    budgetAdjustments = [],
    content,
    highlightReceivableYYYYMM,
}) => {
    const yearBills = useMemo(() => {
        if (content.kind !== 'tenant') return [];
        const billingGenStart = new Date(detailYear - 2, 0, 1);
        const billingGenEnd = new Date(detailYear, 11, 31);
        return generateBudgetedBills(content.tenant, budgetAssumptions, budgetAdjustments, billingGenStart, billingGenEnd)
            .filter((b) => b.date.getFullYear() === detailYear)
            .sort((a, b) => a.date.getTime() - b.date.getTime());
    }, [content, detailYear, budgetAssumptions, budgetAdjustments]);

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

    const rawYearBillDiffSets = useMemo(() => {
        if (content.kind !== 'tenant' || !tenantBudgetTouches) return null;
        const billingGenStart = new Date(detailYear - 2, 0, 1);
        const billingGenEnd = new Date(detailYear, 11, 31);
        const raw = generateBudgetedBills(content.tenant, [], [], billingGenStart, billingGenEnd).filter(
            (b) => b.date.getFullYear() === detailYear,
        );
        return {
            rawDateAmtSet: new Set(
                raw.map((b) => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}|${b.amount.toFixed(2)}`),
            ),
            rawDateSet: new Set(raw.map((b) => `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`)),
        };
    }, [content, detailYear, tenantBudgetTouches]);

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
        <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col animate-in zoom-in-50 duration-200"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="contract-summary-title"
            >
                <div className="px-6 py-4 border-b border-slate-100 flex justify-between items-start gap-3 bg-slate-50/80 flex-shrink-0">
                    <div className="min-w-0">
                        <h3 id="contract-summary-title" className="text-lg font-bold text-slate-800 flex items-center gap-2">
                            <FileText size={20} className="text-blue-600 shrink-0" />
                            合同概要
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">{subtitle}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-1 rounded hover:bg-slate-200 text-slate-500 shrink-0" aria-label="关闭">
                        <X size={22} />
                    </button>
                </div>
                <div className="p-6 overflow-y-auto flex-1 space-y-5 text-sm text-slate-700">
                    {content.kind === 'vacant' ? (
                        <>
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
                            <p className="text-xs text-slate-500 border-t border-slate-100 pt-3">该行来自招商空置假设，正式条款以签约合同为准。</p>
                        </>
                    ) : content.kind === 'missing' ? (
                        <p className="text-rose-600">{content.hint || '未找到该客户的合同档案，无法展示明细。'}</p>
                    ) : (
                        <>
                            <div>
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
                            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3">
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
                                <div className="text-xs font-semibold text-slate-600 mb-2 flex items-center gap-1.5 flex-wrap">
                                    <Calendar size={14} className="text-slate-400 shrink-0" />
                                    <span>
                                        {detailYear} 年系统推算每期应收（{billsSectionSuffix}）
                                    </span>
                                </div>
                                {highlightPeriod && yearBills.length > 0 ? (
                                    <p
                                        className={`text-[11px] rounded-md px-2 py-1.5 mb-2 leading-snug ${
                                            hasHighlightMatch
                                                ? 'text-sky-900 bg-sky-50 border border-sky-200'
                                                : 'text-amber-900 bg-amber-50 border border-amber-200'
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
                                    <div className="mb-3 p-3 rounded-lg bg-purple-50/60 border border-purple-200">
                                        <div className="flex items-center gap-2 mb-2">
                                            <Info size={14} className="text-purple-600 shrink-0" />
                                            <span className="text-xs font-bold text-purple-800">
                                                已叠加 {stockOverlayItems.length} 项存量调优设置（与「客户合同详情 → 应收款明细预览」勾选预算叠加口径一致）
                                            </span>
                                        </div>
                                        <ul className="space-y-1">
                                            {stockOverlayItems.map((it, i) => (
                                                <li key={i} className="text-xs flex items-start gap-2">
                                                    <span
                                                        className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-bold flex-shrink-0 ${
                                                            OVERLAY_TAG_COLOR_MAP[it.color] ?? 'bg-slate-50 text-slate-800 border-slate-200'
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
                                {yearBills.length === 0 ? (
                                    <p className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                                        本年度无系统推算应收账单（未起租、已结束履约或金额为零等情况）。
                                    </p>
                                ) : (
                                    <div className="overflow-x-auto rounded-lg border border-slate-200">
                                        <table className="w-full text-xs">
                                            <thead>
                                                <tr className="bg-slate-50 text-slate-600 text-left border-b border-slate-200">
                                                    <th className="px-3 py-2 font-semibold whitespace-nowrap">账单月</th>
                                                    <th className="px-3 py-2 font-semibold text-right whitespace-nowrap">应收金额</th>
                                                    <th className="px-3 py-2 font-semibold whitespace-nowrap min-w-[180px]">覆盖租期</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 bg-white">
                                                {yearBills.map((b, i) => {
                                                    const accrualMatch =
                                                        content.kind === 'tenant' &&
                                                        billAccrualMonthMatchesReceivableMonth(
                                                            b,
                                                            content.tenant,
                                                            highlightReceivableYYYYMM
                                                        );
                                                    const dateMatch = billDateMatchesReceivableMonth(b, highlightReceivableYYYYMM);
                                                    const coverageOnlyMatch =
                                                        !accrualMatch &&
                                                        !dateMatch &&
                                                        billCoverageTouchesReceivableMonth(b, highlightReceivableYYYYMM) &&
                                                        !hasAccrualMonthMatchInYearBills;
                                                    const rowHighlight = accrualMatch || dateMatch || coverageOnlyMatch;
                                                    const dateKey = `${b.date.getFullYear()}-${b.date.getMonth()}-${b.date.getDate()}`;
                                                    const dateAmtKey = `${dateKey}|${b.amount.toFixed(2)}`;
                                                    const isBudgetNew =
                                                        !!rawYearBillDiffSets && !rawYearBillDiffSets.rawDateSet.has(dateKey);
                                                    const isBudgetChanged =
                                                        !!rawYearBillDiffSets &&
                                                        !isBudgetNew &&
                                                        !rawYearBillDiffSets.rawDateAmtSet.has(dateAmtKey);
                                                    return (
                                                        <tr
                                                            key={`${b.date.getTime()}-${i}`}
                                                            className={`${
                                                                rowHighlight
                                                                    ? 'bg-sky-50 ring-1 ring-inset ring-sky-300/90 shadow-[inset_0_0_0_1px_rgba(56,189,248,0.2)]'
                                                                    : isBudgetNew
                                                                      ? 'bg-purple-50/40'
                                                                      : isBudgetChanged
                                                                        ? 'bg-amber-50/40'
                                                                        : 'hover:bg-slate-50/80'
                                                            }`}
                                                        >
                                                            <td className="px-3 py-2 whitespace-nowrap font-mono align-top">
                                                                <span className="inline-flex items-center gap-1.5 flex-wrap">
                                                                    <span>
                                                                        {b.date.getFullYear()}-
                                                                        {String(b.date.getMonth() + 1).padStart(2, '0')}
                                                                    </span>
                                                                    {accrualMatch || dateMatch ? (
                                                                        <span className="rounded bg-sky-200/95 text-sky-950 px-1 py-px text-[10px] font-bold shrink-0">
                                                                            当前账期
                                                                        </span>
                                                                    ) : coverageOnlyMatch ? (
                                                                        <span
                                                                            className="rounded bg-sky-100/95 text-sky-900 px-1 py-px text-[10px] font-bold shrink-0"
                                                                            title="收款日不在该自然月，但覆盖租期与该核销月有交集"
                                                                        >
                                                                            覆盖含当月
                                                                        </span>
                                                                    ) : null}
                                                                    {isBudgetNew ? (
                                                                        <span
                                                                            className="rounded bg-purple-100 text-purple-800 px-1 py-px text-[10px] font-bold shrink-0"
                                                                            title="此账期由预算假设/调整新增"
                                                                        >
                                                                            预算新增
                                                                        </span>
                                                                    ) : null}
                                                                    {isBudgetChanged ? (
                                                                        <span
                                                                            className="rounded bg-amber-100 text-amber-800 px-1 py-px text-[10px] font-bold shrink-0"
                                                                            title="此账期金额因预算调整发生变化（含账期调整合并等）"
                                                                        >
                                                                            金额已调整
                                                                        </span>
                                                                    ) : null}
                                                                    {b.earlyTerminationExtraDetail ? (
                                                                        <span
                                                                            className="rounded bg-amber-100 text-amber-900 px-1 py-px text-[10px] font-bold shrink-0 border border-amber-200"
                                                                            title="免租扣回、押金扣款、其它调整（不含当期租金）"
                                                                        >
                                                                            提前退租结算
                                                                        </span>
                                                                    ) : null}
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
                                )}
                                {vacancyBudgetNote ? (
                                    <p className="text-[11px] text-rose-900 bg-rose-50/80 border border-rose-200 rounded-lg px-3 py-2 mt-2 leading-snug">
                                        {vacancyBudgetNote}
                                    </p>
                                ) : null}
                            </div>
                        </>
                    )}
                </div>
                <div className="px-6 py-4 border-t border-slate-100 flex justify-end bg-slate-50/50 flex-shrink-0">
                    <button type="button" onClick={onClose} className="px-5 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 font-medium">
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
};
