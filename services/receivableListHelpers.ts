import type { BillingDetail, PaymentRecord, Tenant, ManualReceivableLine, SpecialBusinessReceivable } from '../types';
import type { BudgetedBill } from './billingService';
import { normalizeBudgetRowKeyPart } from './budgetTableImport';
import { roundMoney2 } from './numberFormat';

/** 与 App.tsx / dashboardMetrics 缓缴 JSON 存储键前缀一致 */
export const DEFER_BILLING_NOTE_PREFIX = '__defer__';

/** 收款核销尾差容差（元）：待收余额在此范围内视为已结清 */
export const RECEIVABLE_TAIL_TOLERANCE = 1;

/** 将待收余额按尾差容差归零（≤1 元视为 0） */
export function normalizeReceivableRemaining(rawRemaining: number): number {
    const remaining = roundMoney2(rawRemaining);
    return remaining <= RECEIVABLE_TAIL_TOLERANCE ? 0 : remaining;
}

/** 应收是否已在尾差容差内结清 */
export function isReceivableTailSettled(amountDue: number, effectivePaid: number): boolean {
    if (amountDue <= 0.005) return false;
    return normalizeReceivableRemaining(amountDue - effectivePaid) <= 0;
}

/** 本次实收是否可核销：允许分次收款；仅限制超额收款不超过尾差容差 */
export function isCollectAmountAcceptable(remaining: number, amount: number): boolean {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    return amount <= remaining + RECEIVABLE_TAIL_TOLERANCE + 0.005;
}

/** 尾差自动核销金额（实收少于待收且在容差内时返回差额，否则 0） */
export function receivableTailWaivedAmount(remaining: number, collectedAmount: number): number {
    const shortfall = roundMoney2(remaining - collectedAmount);
    if (shortfall > 0.005 && shortfall <= RECEIVABLE_TAIL_TOLERANCE) return shortfall;
    return 0;
}

/** 统一账单状态：含 ≤1 元尾差自动视为 Paid */
export function billingStatusFromAmounts(amountDue: number, amountPaid: number): BillingDetail['status'] {
    if (amountDue === 0 && amountPaid > 0) return 'Paid';
    if (amountDue > 0.005 && isReceivableTailSettled(amountDue, amountPaid)) return 'Paid';
    if (amountPaid > 0 && amountPaid < amountDue) return 'Partial';
    return 'Unpaid';
}

/**
 * 识别「应收核销」内单笔收款 / 批量核销生成的流水，便于一键撤回时不误删「收款明细」手工记账。
 * - id 含 `_col_`（Collect modal / batch）
 * - 或备注含系统写入的「月度账单」「批量核销」
 */
export function isAutoReceivableWriteOffPayment(p: PaymentRecord): boolean {
    if (p.type === 'ManagementFee') {
        if (typeof p.id === 'string' && p.id.includes('_col_')) return true;
        const r = p.remarks || '';
        return r.includes('物业费月度账单') || r.includes('物业费批量核销');
    }
    if (p.type !== 'Rent' && p.type !== 'DepositToRent') return false;
    if (typeof p.id === 'string' && p.id.includes('_col_')) return true;
    const r = p.remarks || '';
    return r.includes('月度账单') || r.includes('批量核销');
}

export function removeDeferBillingNotesFromNotes(notes: Record<string, string> | undefined): {
    next: Record<string, string>;
    removed: number;
} {
    if (!notes) return { next: {}, removed: 0 };
    if (Object.keys(notes).length === 0) return { next: {}, removed: 0 };
    const next = { ...notes };
    let removed = 0;
    for (const k of Object.keys(next)) {
        if (k.startsWith(DEFER_BILLING_NOTE_PREFIX)) {
            delete next[k];
            removed++;
        }
    }
    return { next, removed };
}

export function partitionPaymentsRemovingAutoReceivableWriteOffs(payments: PaymentRecord[]): {
    kept: PaymentRecord[];
    removedCount: number;
} {
    const kept: PaymentRecord[] = [];
    let removedCount = 0;
    for (const p of payments) {
        if (isAutoReceivableWriteOffPayment(p)) removedCount++;
        else kept.push(p);
    }
    return { kept, removedCount };
}

export function countReceivableTabResetImpact(
    notes: Record<string, string> | undefined,
    payments: PaymentRecord[],
): { deferNotes: number; autoWriteOffPayments: number } {
    const deferNotes = notes ? Object.keys(notes).filter((k) => k.startsWith(DEFER_BILLING_NOTE_PREFIX)).length : 0;
    const autoWriteOffPayments = payments.filter(isAutoReceivableWriteOffPayment).length;
    return { deferNotes, autoWriteOffPayments };
}

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

/** 缓缴调入独立行 tenantId：`defer_in|{realTenantId}|{noteKey}`（noteKey 中 `|` 已替换为 `/`） */
const DEFER_IN_DISPLAY_PREFIX = 'defer_in|';

export function isDeferInDisplayTenantId(tenantId: string): boolean {
    return typeof tenantId === 'string' && tenantId.startsWith(DEFER_IN_DISPLAY_PREFIX);
}

export function deferInDisplayTenantId(realTenantId: string, noteKey: string): string {
    const safeNote = noteKey.replace(/\|/g, '/');
    return `${DEFER_IN_DISPLAY_PREFIX}${realTenantId}|${safeNote}`;
}

/** 若非缓缴调入展示行则返回 null */
export function realTenantIdFromDeferInDisplayTenantId(displayTenantId: string): string | null {
    if (!isDeferInDisplayTenantId(displayTenantId)) return null;
    const rest = displayTenantId.slice(DEFER_IN_DISPLAY_PREFIX.length);
    const pipe = rest.indexOf('|');
    if (pipe <= 0) return null;
    return rest.slice(0, pipe);
}

/** 从缓缴调入展示行的 tenantId 还原 `billingPeriodNotes` 中的备注键（与 `deferInDisplayTenantId` 互逆） */
export function deferBillingNoteKeyFromDeferInDisplayTenantId(displayTenantId: string): string | null {
    if (!isDeferInDisplayTenantId(displayTenantId)) return null;
    const rest = displayTenantId.slice(DEFER_IN_DISPLAY_PREFIX.length);
    const pipe = rest.indexOf('|');
    if (pipe < 0) return null;
    const safeNote = rest.slice(pipe + 1);
    if (!safeNote) return null;
    return safeNote.replace(/\//g, '|');
}

/** 删除单条缓缴备注（不影响其它键） */
export function removeDeferBillingNoteByKey(
    notes: Record<string, string> | undefined,
    key: string
): { next: Record<string, string>; removed: boolean } {
    if (!notes || !key || !key.startsWith(DEFER_BILLING_NOTE_PREFIX)) {
        return { next: notes ? { ...notes } : {}, removed: false };
    }
    if (!(key in notes)) return { next: { ...notes }, removed: false };
    const next = { ...notes };
    delete next[key];
    return { next, removed: true };
}

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

export function paymentTenantMatchesBillingTenant(
    paymentTenantId: string,
    billingTenantId: string,
    tenantList: Tenant[],
    paymentTenantName?: string | null
): boolean {
    if (paymentTenantId === billingTenantId) return true;
    const billReal = realTenantIdFromDeferInDisplayTenantId(billingTenantId);
    const billId = billReal ?? billingTenantId;
    if (billReal && paymentTenantId === billReal) return true;

    const billT = tenantList.find((t) => t.id === billId);
    const payT = tenantList.find((t) => t.id === paymentTenantId);

    // 与预算表「实际」列一致：流水的 tenantId 已不在当前租户列表时，按客户名称回退（续签换 id、历史流水未改 tenantId）
    if (billT && !payT && paymentTenantName != null && String(paymentTenantName).trim() !== '') {
        return normalizeBudgetRowKeyPart(paymentTenantName) === normalizeBudgetRowKeyPart(billT.name);
    }

    if (!payT || !billT) return false;
    const payRoot = payT.rootId || payT.id;
    const billRoot = billT.rootId || billT.id;
    return payRoot === billRoot;
}

/** 解析收款「关联账期」列表（YYYY-MM），与 dashboardMetrics / FinanceManager 一致 */
export function parsePaymentPeriodYYYYMMs(periodRaw?: string): string[] {
    if (!periodRaw) return [];
    const parts = periodRaw
        .split(/[,\n;，；\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .filter((s) => /^\d{4}-\d{2}$/.test(s));
    return Array.from(new Set(parts));
}

/** 单笔收款分摊到某一账期的金额（多账期命中时按月均分） */
export function paymentAllocatedAmountForBillingPeriod(p: PaymentRecord, periodYYYYMM: string): number {
    const periods = parsePaymentPeriodYYYYMMs(p.period);
    if (periods.length === 0) {
        return p.date.startsWith(periodYYYYMM) ? p.amount : 0;
    }
    if (!periods.includes(periodYYYYMM)) return 0;
    return p.amount / periods.length;
}

/**
 * 某账单行在指定账期已归属的租金流水合计（含押金转租金）。
 * 与财务报表 FinanceManager 一致：同一 rootId 合同链上任意 tenantId 的流水均可核销当前行。
 */
export function sumManagementFeePaymentsAllocatedToBillingTenant(
    billingTenantId: string,
    periodYYYYMM: string,
    tenantList: Tenant[],
    paymentsByTenantId: Map<string, PaymentRecord[]>,
): number {
    let sum = 0;
    for (const list of paymentsByTenantId.values()) {
        for (const p of list) {
            if (p.type !== 'ManagementFee') continue;
            if (!paymentTenantMatchesBillingTenant(p.tenantId, billingTenantId, tenantList, p.tenantName)) continue;
            sum += paymentAllocatedAmountForBillingPeriod(p, periodYYYYMM);
        }
    }
    return roundMoney2(sum);
}

export function sumRentPaymentsAllocatedToBillingTenant(
    billingTenantId: string,
    periodYYYYMM: string,
    tenantList: Tenant[],
    paymentsByTenantId: Map<string, PaymentRecord[]>
): number {
    let sum = 0;
    for (const list of paymentsByTenantId.values()) {
        for (const p of list) {
            if (p.type !== 'Rent' && p.type !== 'DepositToRent') continue;
            if (!paymentTenantMatchesBillingTenant(p.tenantId, billingTenantId, tenantList, p.tenantName)) continue;
            sum += paymentAllocatedAmountForBillingPeriod(p, periodYYYYMM);
        }
    }
    return roundMoney2(sum);
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
 * 单笔推算账单归属到哪一自然月（0–11）：与 `dashboardMetrics` 应收核销、预算表明细列、合同概要「账单月」一致。
 * 统一按 **账单日 bill.date** 所在自然月归属（含免租顺延 Defer、先付后住等），避免按覆盖期首月归到错误月份、进而在无关月（如 1 月）出现幽灵应收。
 * 提前退租结算附加行仍按账单日。
 */
export function receivableBudgetMonthForBill(
    bill: BudgetedBill,
    _tenant?: Pick<Tenant, 'freeRentHandling'>
): { year: number; monthIndex: number } {
    const d = bill.date;
    return { year: d.getFullYear(), monthIndex: d.getMonth() };
}

/**
 * 应收列展示（与预算表口径对齐）：
 * - 缓缴调出：加回 deferredAmount（恢复原账面应收展示）
 * - 缓缴调入：`amountDue` 已含调入额，不再扣减 `deferredInAmount`（否则目标账期会少计一笔应收）
 */
export function receivableBudgetDisplay(item: BillingDetail): number {
    const x = item as BillingDetailExtras;
    let v = item.amountDue;
    if (x.deferredToPeriod && x.deferredAmount != null && x.deferredAmount > 0) {
        v += x.deferredAmount;
    }
    return Math.round(v * 100) / 100;
}

/**
 * 本账期已将「可单独核销」的账面余额全部缓出：收款/核销应在 `deferredToPeriod` 操作。
 * （若仍留有本账期合同应收未缓部分，则返回 false，允许在本账期继续收款/缓缴。）
 */
export function isFullDeferOutSourceRow(item: BillingDetail): boolean {
    const def = item.deferredAmount ?? 0;
    if (def <= 0.005) return false;
    if (!item.deferredToPeriod || !String(item.deferredToPeriod).trim()) return false;
    const nativeRem = Math.max(0, roundMoney2((item.amountDue ?? 0) - (item.amountPaid ?? 0)));
    return nativeRem <= 0.005;
}

/**
 * 核销流水应写入的关联账期：全额缓出时记入目标账期；本账期仍有未缓部分时记入当前查看账期。
 * 部分缓缴后若单次核销额超过「本账期未缓余额」，返回 error 提示拆分。
 */
export function resolveRentWriteOffPaymentPeriod(
    detail: BillingDetail,
    viewingPeriodYYYYMM: string,
    amount: number
): { period: string; error?: string } {
    const defAmt = detail.deferredAmount ?? 0;
    const defTo = detail.deferredToPeriod?.trim();
    const hasOut = defAmt > 0.005 && !!defTo;
    const nativeRem = Math.max(0, roundMoney2((detail.amountDue ?? 0) - (detail.amountPaid ?? 0)));
    if (!hasOut) return { period: viewingPeriodYYYYMM };
    if (nativeRem > 0.005) {
        if (amount > nativeRem + 0.005) {
            return {
                period: viewingPeriodYYYYMM,
                error: `本账期未缓部分为 ${nativeRem} 元，超出部分请分次核销或到目标账期 ${defTo} 核销缓入金额。`,
            };
        }
        return { period: viewingPeriodYYYYMM };
    }
    return { period: defTo! };
}

export type DeferBillingNote = {
    tenantId: string;
    fromYear: number;
    fromMonth: number;
    toYear: number;
    toMonth: number;
    amount: number;
};

export type DeferBillingNoteEntry = DeferBillingNote & { noteKey: string };

function parsePeriodLabelForDefer(value: unknown): { year: number; month: number } | null {
    if (typeof value !== 'string') return null;
    const m = value.trim().match(/^(\d{4})-(\d{2})$/);
    if (!m) return null;
    const year = Number(m[1]);
    const month1 = Number(m[2]);
    if (!Number.isFinite(year) || !Number.isFinite(month1) || month1 < 1 || month1 > 12) return null;
    return { year, month: month1 - 1 };
}

/** 解析全部缓缴备注（含 noteKey，用于调入拆行） */
export function parseDeferBillingNoteEntries(notes: Record<string, string> | undefined): DeferBillingNoteEntry[] {
    if (!notes) return [];
    const out: DeferBillingNoteEntry[] = [];
    for (const [k, v] of Object.entries(notes)) {
        if (!k.startsWith(DEFER_BILLING_NOTE_PREFIX)) continue;
        try {
            const j = JSON.parse(v) as DeferBillingNote & { fromPeriod?: string; toPeriod?: string };
            if (!j?.tenantId || typeof j.amount !== 'number' || j.amount <= 0) continue;
            if (
                Number.isFinite(j.fromYear) &&
                Number.isFinite(j.fromMonth) &&
                Number.isFinite(j.toYear) &&
                Number.isFinite(j.toMonth)
            ) {
                out.push({
                    tenantId: j.tenantId,
                    fromYear: j.fromYear,
                    fromMonth: j.fromMonth,
                    toYear: j.toYear,
                    toMonth: j.toMonth,
                    amount: j.amount,
                    noteKey: k,
                });
                continue;
            }
            const from = parsePeriodLabelForDefer(j.fromPeriod);
            const to = parsePeriodLabelForDefer(j.toPeriod);
            if (!from || !to) continue;
            out.push({
                tenantId: j.tenantId,
                fromYear: from.year,
                fromMonth: from.month,
                toYear: to.year,
                toMonth: to.month,
                amount: j.amount,
                noteKey: k,
            });
        } catch {
            /* ignore */
        }
    }
    return out;
}

function splitPeriodRentPaidForDeferInRows(base: BillingDetail, deferRows: BillingDetail[]): void {
    const totalPaid = roundMoney2(base.amountPaid ?? 0);
    const baseDue = Math.max(0, roundMoney2(base.amountDue ?? 0));
    let rem = totalPaid;
    const baseAlloc = Math.min(baseDue, rem);
    rem = roundMoney2(rem - baseAlloc);
    base.amountPaid = baseAlloc;
    for (const row of deferRows) {
        const d = Math.max(0, roundMoney2(row.amountDue ?? 0));
        const take = Math.min(d, Math.max(0, rem));
        row.amountPaid = take;
        rem = roundMoney2(rem - take);
    }
    if (rem > 0.005) {
        base.amountPaid = roundMoney2((base.amountPaid ?? 0) + rem);
    }
}

function billingDetailStatusFromPaid(amountDue: number, amountPaid: number): BillingDetail['status'] {
    return billingStatusFromAmounts(amountDue, amountPaid);
}

/**
 * 应用缓缴备注：调出账期减少 amountDue；调入账期为**每条**缓缴记录单独一行（不再按租户合并）。
 */
export function applyBillingPeriodDeferNotes(
    details: BillingDetail[],
    year: number,
    month: number,
    notes: Record<string, string> | undefined,
    allTenants: Tenant[]
): BillingDetail[] {
    const entries = parseDeferBillingNoteEntries(notes);
    if (entries.length === 0) return details;

    const copy = details.map((d) => ({ ...d }));
    const idx = new Map(copy.map((d, i) => [d.tenantId, i] as const));

    for (const e of entries) {
        const tenantForEntry = allTenants.find((x) => x.id === e.tenantId);
        if (tenantForEntry?.isSpecialBusiness) continue;
        const toPeriodLabel = `${e.toYear}-${String(e.toMonth + 1).padStart(2, '0')}`;
        const fromPeriodLabel = `${e.fromYear}-${String(e.fromMonth + 1).padStart(2, '0')}`;
        if (e.fromYear === year && e.fromMonth === month) {
            const i = idx.get(e.tenantId);
            if (i !== undefined) {
                copy[i].amountDue = Math.max(0, copy[i].amountDue - e.amount);
                copy[i].deferredAmount = (copy[i].deferredAmount || 0) + e.amount;
                copy[i].deferredToPeriod = toPeriodLabel;
                copy[i].deferredFromPeriod = fromPeriodLabel;
            }
        }
    }

    const toEntries = entries
        .filter((e) => {
            if (e.toYear !== year || e.toMonth !== month) return false;
            const t = allTenants.find((x) => x.id === e.tenantId);
            return !t?.isSpecialBusiness;
        })
        .sort((a, b) => a.noteKey.localeCompare(b.noteKey));

    const deferSyntheticByReal = new Map<string, BillingDetail[]>();
    for (const e of toEntries) {
        const t = allTenants.find((x) => x.id === e.tenantId);
        const fromLbl = `${e.fromYear}-${String(e.fromMonth + 1).padStart(2, '0')}`;
        const displayId = deferInDisplayTenantId(e.tenantId, e.noteKey);
        const baseIdx = idx.get(e.tenantId);
        const baseTerms = baseIdx !== undefined ? copy[baseIdx].billingTermsTenant : undefined;
        const row: BillingDetail = {
            tenantId: displayId,
            tenantName: t?.name || '',
            unitIds: t?.unitIds || [],
            amountDue: e.amount,
            amountPaid: 0,
            status: 'Unpaid',
            deferredInAmount: e.amount,
            deferredInFromSummary: fromLbl,
            ...(baseTerms ? { billingTermsTenant: baseTerms } : {}),
        };
        const cur = deferSyntheticByReal.get(e.tenantId);
        if (cur) cur.push(row);
        else deferSyntheticByReal.set(e.tenantId, [row]);
    }

    const out: BillingDetail[] = [];
    for (const row of copy) {
        out.push(row);
        const list = deferSyntheticByReal.get(row.tenantId);
        if (list && list.length > 0) {
            splitPeriodRentPaidForDeferInRows(row, list);
            out.push(...list);
            deferSyntheticByReal.delete(row.tenantId);
        }
    }

    for (const [tid, list] of deferSyntheticByReal) {
        const t = allTenants.find((x) => x.id === tid);
        const stub: BillingDetail = {
            tenantId: tid,
            tenantName: t?.name || '',
            unitIds: t?.unitIds || [],
            amountDue: 0,
            amountPaid: 0,
            status: 'Unpaid',
        };
        splitPeriodRentPaidForDeferInRows(stub, list);
        if ((stub.amountPaid ?? 0) > 0.005) {
            out.push(stub);
        }
        out.push(...list);
    }

    for (const d of out) {
        d.status = billingDetailStatusFromPaid(d.amountDue ?? 0, d.amountPaid ?? 0);
    }

    return out.filter(
        (d) =>
            (d.amountDue ?? 0) > 0.005 ||
            (d.amountPaid ?? 0) > 0.005 ||
            ((d.deferredAmount ?? 0) > 0.005 && !!(d.deferredToPeriod && String(d.deferredToPeriod).trim())) ||
            ((d.deferredInAmount ?? 0) > 0.005)
    );
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

/** 存在于 billingPeriodNotes 的特殊业态月度应收 JSON */
export const SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY = '__special_business_receivables_v1__';

/** 特殊业态客户在「应收核销」中的虚拟账单 tenantId 前缀；保证与系统账单/手工应收彼此可区分。 */
export const SPECIAL_BUSINESS_AR_TENANT_PREFIX = 'sbiz_ar_';

export function isSpecialBusinessArTenantId(tenantId: string): boolean {
    return typeof tenantId === 'string' && tenantId.startsWith(SPECIAL_BUSINESS_AR_TENANT_PREFIX);
}

export function specialBusinessArDisplayTenantId(realTenantId: string, periodYYYYMM: string): string {
    return `${SPECIAL_BUSINESS_AR_TENANT_PREFIX}${realTenantId}__${periodYYYYMM}`;
}

/** 反解 specialBusinessArDisplayTenantId → realTenantId（无法解析时返回原值） */
export function realTenantIdFromSpecialBusinessAr(displayTenantId: string): string {
    if (!isSpecialBusinessArTenantId(displayTenantId)) return displayTenantId;
    const rest = displayTenantId.slice(SPECIAL_BUSINESS_AR_TENANT_PREFIX.length);
    const sepIdx = rest.lastIndexOf('__');
    if (sepIdx <= 0) return rest;
    return rest.slice(0, sepIdx);
}

export function parseSpecialBusinessReceivablesFromNotes(
    notes: Record<string, string> | undefined
): SpecialBusinessReceivable[] {
    if (!notes) return [];
    const raw = notes[SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY];
    if (!raw || typeof raw !== 'string') return [];
    try {
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr)) return [];
        const out: SpecialBusinessReceivable[] = [];
        for (const row of arr) {
            if (!row || typeof row !== 'object') continue;
            const r = row as Partial<SpecialBusinessReceivable>;
            const tenantId = String(r.tenantId || '').trim();
            const periodYYYYMM = String(r.periodYYYYMM || '').slice(0, 7);
            if (!tenantId || !/^\d{4}-\d{2}$/.test(periodYYYYMM)) continue;
            const amount = roundMoney2(Number(r.amount) || 0);
            if (!Number.isFinite(amount)) continue;
            out.push({
                id: String(r.id || `sbiz_${tenantId}_${periodYYYYMM}`),
                tenantId,
                periodYYYYMM,
                amount,
                remark: r.remark != null ? String(r.remark) : undefined,
                updatedAt: r.updatedAt != null ? String(r.updatedAt) : undefined,
            });
        }
        return out;
    } catch {
        return [];
    }
}

export function stringifySpecialBusinessReceivables(list: SpecialBusinessReceivable[]): string {
    return JSON.stringify(list);
}

export function findSpecialBusinessReceivable(
    notes: Record<string, string> | undefined,
    tenantId: string,
    periodYYYYMM: string
): SpecialBusinessReceivable | undefined {
    const all = parseSpecialBusinessReceivablesFromNotes(notes);
    return all.find((r) => r.tenantId === tenantId && r.periodYYYYMM === periodYYYYMM);
}

/**
 * 在已有 list 上 upsert 一行特殊业态应收：
 * - 金额 ≤ 0 时自动移除该 (tenantId, period) 行；
 * - 同一 (tenantId, period) 仅保留一行（后写覆盖前写）。
 */
export function upsertSpecialBusinessReceivable(
    list: SpecialBusinessReceivable[],
    entry: Omit<SpecialBusinessReceivable, 'id'> & { id?: string }
): SpecialBusinessReceivable[] {
    const period = String(entry.periodYYYYMM || '').slice(0, 7);
    const tenantId = String(entry.tenantId || '').trim();
    if (!tenantId || !/^\d{4}-\d{2}$/.test(period)) return list;
    const next = list.filter((r) => !(r.tenantId === tenantId && r.periodYYYYMM === period));
    const amount = roundMoney2(Number(entry.amount) || 0);
    if (!Number.isFinite(amount) || amount <= 0.005) return next;
    next.push({
        id: entry.id || `sbiz_${tenantId}_${period}`,
        tenantId,
        periodYYYYMM: period,
        amount,
        remark: entry.remark,
        updatedAt: entry.updatedAt || new Date().toISOString(),
    });
    return next;
}

export function removeSpecialBusinessReceivable(
    list: SpecialBusinessReceivable[],
    tenantId: string,
    periodYYYYMM: string
): SpecialBusinessReceivable[] {
    const period = String(periodYYYYMM || '').slice(0, 7);
    return list.filter((r) => !(r.tenantId === tenantId && r.periodYYYYMM === period));
}

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
    const remaining = normalizeReceivableRemaining(d.amountDue - d.amountPaid);
    if (d.status === 'Unpaid' || d.status === 'Partial' || d.status === 'Overdue' || remaining > 0) {
        return 'unsettled';
    }
    if (d.status === 'Paid' || remaining <= 0) {
        const isMgmt = d.feeKind === 'management_fee';
        const matched = payments.filter(
            (p) =>
                paymentMatchesRentBillingPeriod(p, receivableMonth) &&
                paymentTenantMatchesBillingTenant(p.tenantId, d.tenantId, tenantList, p.tenantName) &&
                (isMgmt
                    ? p.type === 'ManagementFee'
                    : p.type === 'Rent' || p.type === 'DepositToRent'),
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
