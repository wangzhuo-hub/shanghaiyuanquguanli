import type { BillingDetail, PaymentRecord, Tenant, ManualReceivableLine } from '../types';
import { roundMoney2 } from './numberFormat';

/** 缓缴调出 / 调入行的醒目底色与左边线（工作台账单 + 财务报表应收共用） */
export function deferReceivableShellClass(item: BillingDetail): string {
    const out = !!(item.deferredToPeriod && (item.deferredAmount ?? 0) > 0);
    const inn = !!(item.deferredInAmount && item.deferredInAmount > 0);
    if (out && inn) return 'border-l-4 border-l-amber-500 bg-gradient-to-r from-orange-50/40 to-sky-50/35';
    if (out) return 'border-l-4 border-l-orange-500 bg-orange-50/35';
    if (inn) return 'border-l-4 border-l-sky-500 bg-sky-50/35';
    return '';
}

/** 与 billingService 一致的可选缓缴展示字段（Dashboard 可能塞入） */
type BillingDetailExtras = BillingDetail & {
    deferredToPeriod?: string;
    deferredAmount?: number;
};

function paymentMatchesRentBillingPeriod(p: PaymentRecord, receivableMonthYYYYMM: string): boolean {
    if (!receivableMonthYYYYMM || receivableMonthYYYYMM.length < 7) return false;
    const periods = (p.period || '')
        .split(/[,\n;，；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => /^\d{4}-\d{2}$/.test(s));
    if (periods.length > 0) return periods.includes(receivableMonthYYYYMM);
    return p.date.startsWith(receivableMonthYYYYMM);
}

function paymentTenantMatchesBillingTenant(
    paymentTenantId: string,
    billingTenantId: string,
    tenantList: Tenant[]
): boolean {
    if (paymentTenantId === billingTenantId) return true;
    const payT = tenantList.find((t) => t.id === paymentTenantId);
    const billT = tenantList.find((t) => t.id === billingTenantId);
    if (!payT || !billT) return false;
    const payRoot = payT.rootId || payT.id;
    const billRoot = billT.rootId || billT.id;
    return payRoot === billRoot;
}

/** 应收按月备注存储键：tenantId + 账期 YYYY-MM */
export function billingNoteKey(tenantId: string, periodYYYYMM: string): string {
    return `${tenantId}###${periodYYYYMM}`;
}

/** 租金跟进备注（预期收款日、沟通情况等），与缓缴 JSON 键隔离 */
export const RENT_COLLECTION_REMARK_PREFIX = '__rent_remark__';

export function rentCollectionRemarkKey(tenantId: string, periodYYYYMM: string): string {
    return `${RENT_COLLECTION_REMARK_PREFIX}${billingNoteKey(tenantId, periodYYYYMM)}`;
}

export function getRentCollectionRemark(
    notes: Record<string, string> | undefined,
    tenantId: string,
    periodYYYYMM: string
): string {
    if (!notes) return '';
    return notes[rentCollectionRemarkKey(tenantId, periodYYYYMM)] || '';
}

/** 手工应收行 tenantId 前缀（不计入「本月应收租金」等与预算表对齐的汇总） */
export function isManualArTenantId(tenantId: string): boolean {
    return typeof tenantId === 'string' && tenantId.startsWith('manual_ar_');
}

/**
 * 应收列展示（与预算表口径对齐）：
 * - 缓缴调出：加回 deferredAmount（恢复原账面应收）
 * - 缓缴调入：扣除 deferredInAmount（调入额已在调出侧体现）
 */
export function receivableBudgetDisplay(item: BillingDetail): number {
    const x = item as BillingDetailExtras;
    let v = item.amountDue;
    if (x.deferredToPeriod && x.deferredAmount != null && x.deferredAmount > 0) {
        v += x.deferredAmount;
    }
    if ((x.deferredInAmount ?? 0) > 0.005) {
        v -= x.deferredInAmount ?? 0;
    }
    return Math.round(v);
}

/**
 * 财务报表顶部卡片应收合计：系统账单（含调价/账期/金额调整/缓缴还原）+ 手工应收行。
 * 体现真实「本月需要催收」的口径，因此**包含手工应收行**。
 */
export function sumBudgetReceivableForFinance(rows: BillingDetail[]): number {
    return rows.reduce((sum, r) => sum + receivableBudgetDisplay(r), 0);
}

/** 仅统计系统账单部分（与预算表/工作台保持一致），用于「与工作台一致」对账 */
export function sumSystemBudgetReceivable(rows: BillingDetail[]): number {
    return rows
        .filter((r) => !isManualArTenantId(r.tenantId))
        .reduce((sum, r) => sum + receivableBudgetDisplay(r), 0);
}

/** 仅统计手工应收行金额（同样的「展示口径」） */
export function sumManualArReceivable(rows: BillingDetail[]): number {
    return rows
        .filter((r) => isManualArTenantId(r.tenantId))
        .reduce((sum, r) => sum + receivableBudgetDisplay(r), 0);
}

/** 存在于 billingPeriodNotes 的手工应收 JSON（与缓缴备注并存） */
export const MANUAL_RECEIVABLE_LINES_NOTE_KEY = '__manual_receivable_lines_v1__';

export function parseManualReceivableLinesFromNotes(notes: Record<string, string> | undefined): ManualReceivableLine[] {
    if (!notes) return [];
    const raw = notes[MANUAL_RECEIVABLE_LINES_NOTE_KEY];
    if (!raw || typeof raw !== 'string') return [];
    try {
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return [];
        return arr
            .filter((row) => row && typeof row === 'object')
            .map((row: any) => ({
                id: String(row.id || `mar_${Date.now()}`),
                tenantId: row.tenantId ? String(row.tenantId) : undefined,
                customerLabel: String(row.customerLabel || row.title || '').trim(),
                title: row.title != null ? String(row.title) : undefined,
                amount: roundMoney2(Number(row.amount) || 0),
                periodYYYYMM: String(row.periodYYYYMM || '').slice(0, 7),
            }));
    } catch {
        return [];
    }
}

export type ReceivableListBucket = 'unsettled' | 'settled_this_month' | 'prepaid' | 'deferred';

export function classifyReceivableRow(
    d: BillingDetail,
    receivableMonth: string,
    payments: PaymentRecord[],
    tenantList: Tenant[]
): ReceivableListBucket {
    if ((d.deferredAmount ?? 0) > 0.005 && !!(d.deferredToPeriod && String(d.deferredToPeriod).trim())) {
        return 'deferred';
    }
    const remaining = d.amountDue - d.amountPaid;
    if (d.status === 'Unpaid' || d.status === 'Partial' || d.status === 'Overdue' || remaining > 0) {
        return 'unsettled';
    }
    if (d.status === 'Paid' || remaining <= 0) {
        const matched = payments.filter(
            (p) =>
                paymentMatchesRentBillingPeriod(p, receivableMonth) &&
                paymentTenantMatchesBillingTenant(p.tenantId, d.tenantId, tenantList) &&
                (p.type === 'Rent' || p.type === 'DepositToRent')
        );
        if (matched.length === 0) return 'settled_this_month';
        const [y, m] = receivableMonth.split('-').map(Number);
        const hasPayInReceivableMonth = matched.some((p) => {
            const parts = p.date.split('-').map(Number);
            return parts[0] === y && parts[1] === m;
        });
        return hasPayInReceivableMonth ? 'settled_this_month' : 'prepaid';
    }
    return 'unsettled';
}

export interface ReceivableSectionEntry {
    item: BillingDetail;
    i: number;
}

export interface ReceivableSections {
    unsettled: ReceivableSectionEntry[];
    settledThisMonth: ReceivableSectionEntry[];
    prepaid: ReceivableSectionEntry[];
    deferred: ReceivableSectionEntry[];
}

/** 与财务报表应收列表相同的分组顺序（未核销在上，已处理在下且分子组） */
export function buildReceivableSections(
    rows: BillingDetail[],
    receivableMonth: string,
    payments: PaymentRecord[],
    tenants: Tenant[]
): ReceivableSections {
    const unsettled: ReceivableSectionEntry[] = [];
    const settledThisMonth: ReceivableSectionEntry[] = [];
    const prepaid: ReceivableSectionEntry[] = [];
    const deferred: ReceivableSectionEntry[] = [];
    if (!receivableMonth) {
        return { unsettled, settledThisMonth, prepaid, deferred };
    }
    rows.forEach((item, i) => {
        const bucket = classifyReceivableRow(item, receivableMonth, payments, tenants);
        const entry: ReceivableSectionEntry = { item, i };
        if (bucket === 'unsettled') unsettled.push(entry);
        else if (bucket === 'deferred') deferred.push(entry);
        else if (bucket === 'prepaid') prepaid.push(entry);
        else settledThisMonth.push(entry);
    });
    const byIdx = (a: ReceivableSectionEntry, b: ReceivableSectionEntry) => a.i - b.i;
    unsettled.sort(byIdx);
    settledThisMonth.sort(byIdx);
    prepaid.sort(byIdx);
    deferred.sort(byIdx);
    return { unsettled, settledThisMonth, prepaid, deferred };
}
