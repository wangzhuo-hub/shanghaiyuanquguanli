
import {
    Tenant,
    BudgetAssumption,
    BudgetAdjustment,
    RentFreePeriod,
    LeaseUnitTerm,
    Building,
    PaymentCycle,
} from '../types';
import {
    getParkBillingFeatures,
    getReceivableMonthOffsetForProject,
    snapBeijingLateMonthReceivableBillDate,
    usesSameMonthReceivableBillDate,
} from './parkBillingConfig';
export { getVirtualTenants } from './virtualTenants';

const rentFreePeriodKey = (r: RentFreePeriod) => `${r.start}|${r.end}`;

/** 分房源计费时合并合同级免租与房源级免租，避免合同级免租被忽略。 */
const mergeRentFreeForUnitTerm = (tenant: Tenant, term: Pick<LeaseUnitTerm, 'rentFreePeriods'>): RentFreePeriod[] => {
    const base = tenant.rentFreePeriods || [];
    const extra = term.rentFreePeriods || [];
    if (extra.length === 0) return [...base];
    if (base.length === 0) return [...extra];
    const seen = new Set(base.map(rentFreePeriodKey));
    return [...base, ...extra.filter((r) => !seen.has(rentFreePeriodKey(r)))];
};

/** 多单元合并后付款转移只应执行一次，内层递归需暂时关闭 isActive。 */
const assumptionsForUnitInnerCalls = (
    assumptions: BudgetAssumption[],
    tenantId: string,
    suppressPaymentShift: boolean,
): BudgetAssumption[] => {
    if (!suppressPaymentShift) return assumptions;
    return assumptions.map((a) => {
        if (a.targetId !== tenantId || a.targetType !== 'Existing' || !a.paymentShift?.isActive) return a;
        return { ...a, paymentShift: { ...a.paymentShift, isActive: false } };
    });
};

/** 合并账单后一次性应用「付款转移」（与单合同循环内逻辑一致）。 */
const applyExistingPaymentShiftToMergedBills = (bills: BudgetedBill[], ps: NonNullable<BudgetAssumption['paymentShift']>): void => {
    if (!ps.isActive) return;
    const sourceBill = bills.find(
        (b) => b.date.getFullYear() === ps.fromYear && b.date.getMonth() === ps.fromMonth,
    );
    if (!sourceBill) return;
    sourceBill.amount -= ps.amount;
    if (sourceBill.amount < 0) sourceBill.amount = 0;
    const shiftedDate = new Date(ps.toYear, ps.toMonth, 1);
    bills.push({
        date: shiftedDate,
        amount: Math.round(ps.amount),
        originalDate: new Date(sourceBill.date),
        coverageStart: sourceBill.coverageStart ? new Date(sourceBill.coverageStart) : undefined,
        coverageEnd: sourceBill.coverageEnd ? new Date(sourceBill.coverageEnd) : undefined,
    });
};

/** 最小金额阈值（低于此值视为零，用于舍入和过滤） */
/** 根据 unitPriceMode 将单价转换为月租金 */
export const monthlyRentFromUnitPrice = (unitPrice: number, area: number, mode?: 'daily' | 'monthly'): number => {
    if (mode === 'monthly') return unitPrice * area;
    return (unitPrice * area * 365) / 12;
};

/** 天单价 → 月单价（元/㎡/月） */
export const toMonthlyRentUnitPrice = (
    unitPrice: number | undefined,
    mode?: 'daily' | 'monthly',
): number | undefined => {
    if (unitPrice == null || !(unitPrice > 0)) return undefined;
    if (mode === 'monthly') return round2(unitPrice);
    return round2((unitPrice * 365) / 12);
};

export type RentUnitPriceDisplay = {
    unitPrice: number;
    mode: 'daily' | 'monthly';
    label: string;
    suffix: string;
};

/**
 * 列表/卡片租金单价展示：深圳等园区固定按月单价（元/㎡/月），优先用 月租金÷面积 避免历史天单价误标为月单价。
 */
export const resolveRentUnitPriceForDisplay = (
    tenant: Tenant,
    projectIdFallback?: string,
): RentUnitPriceDisplay => {
    const projectId = tenant.projectId || projectIdFallback || '';
    const preferMonthly = getParkBillingFeatures(projectId).defaultRentUnitPriceMode === 'monthly';
    const area = tenant.totalArea || 0;
    const monthlyRent = tenant.monthlyRent || 0;

    if (preferMonthly) {
        if (area > 0 && monthlyRent > 0) {
            return {
                unitPrice: round2(monthlyRent / area),
                mode: 'monthly',
                label: '月单价',
                suffix: '月',
            };
        }
        const monthly = toMonthlyRentUnitPrice(
            tenant.unitPrice,
            tenant.unitPriceMode === 'monthly' ? 'monthly' : 'daily',
        );
        return {
            unitPrice: monthly ?? 0,
            mode: 'monthly',
            label: '月单价',
            suffix: '月',
        };
    }

    const isMonthly = tenant.unitPriceMode === 'monthly';
    const unitPrice =
        tenant.unitPrice ||
        (area > 0 && monthlyRent > 0 ? round2((monthlyRent / area) * 12 / 365) : 0);
    return {
        unitPrice,
        mode: isMonthly ? 'monthly' : 'daily',
        label: isMonthly ? '月单价' : '日单价',
        suffix: isMonthly ? '月' : '天',
    };
};

export const MIN_AMOUNT_THRESHOLD = 0.005;
/** 日租金计算基准天数（月租金 / 30） */
export const DAILY_RENT_BASE_DAYS = 30;
/** 金额保留两位小数（避免 Math.round 取整丢失日租精度） */
const round2 = (n: number): number => Math.round(n * 100) / 100;
/** 计费循环安全迭代上限 */
export const BILLING_LOOP_LIMIT = 300;

/** 租约永不到期哨兵日期（无 leaseEnd 时的默认值） */
export const FAR_FUTURE_DATE = '2099-12-31';
export const farFutureDate = (): Date => parseDateLocal(FAR_FUTURE_DATE);

/**
 * 当月应收账期园区清单（全园区统一 offset 0）。
 * 上海 / 北京默认仍为「覆盖期开始月 − 1」，但北京 28–31 日起租见 `usesSameMonthReceivableBillDate`。
 */
export const SAME_MONTH_RECEIVABLE_PROJECT_IDS: ReadonlySet<string> = new Set(['shenzhen_park']);

/**
 * 计算「账单日」相对「覆盖期开始日」的月份偏移。
 * - 默认（上海 / 北京 1–27 日起租）：`-1`，账单日在覆盖期开始前一个自然月。
 * - 深圳园区、北京 28–31 日起租：`0`，账单日与覆盖期开始在同一自然月（合同约定「当月收款」）。
 *
 * NOTE：仅作用于系统自动推算的账单日；用户显式填写的 `firstPaymentDate` 仍按原值落账。
 */
/** 按园区 / 起租日规则解析账单日（含北京 28–31 日季付锚点） */
export const resolveReceivableBillDate = (
    coverageStart: Date,
    tentativeBillDate: Date,
    tenant: Pick<Tenant, 'projectId' | 'leaseStart' | 'paymentCycle' | 'firstPaymentDate'>,
    opts?: { isFirstCycle?: boolean },
): Date => {
    if (opts?.isFirstCycle && tenant.firstPaymentDate?.trim()) {
        return parseDateLocal(tenant.firstPaymentDate);
    }
    const aligned = snapBeijingLateMonthReceivableBillDate(
        coverageStart,
        tentativeBillDate,
        tenant.projectId,
        tenant.leaseStart,
        tenant.paymentCycle,
    );
    return aligned;
};

export function getReceivableMonthOffsetForTenant(
    tenant: Pick<Tenant, 'projectId' | 'leaseStart'>,
): number {
    if (usesSameMonthReceivableBillDate(tenant)) return 0;
    const projectId = (tenant.projectId || '').trim();
    if (projectId) {
        const fromConfig = getReceivableMonthOffsetForProject(projectId);
        if (fromConfig === 0 || fromConfig === -1) return fromConfig;
    }
    if (projectId && SAME_MONTH_RECEIVABLE_PROJECT_IDS.has(projectId)) return 0;
    return -1;
}

export interface BudgetedBill {
    date: Date;
    amount: number;
    /** 应用固定金额减免前的应收（用于预览对账） */
    grossAmount?: number;
    /** 免租扣减合计（元） */
    rentFreeDeduction?: number;
    /** 合同固定金额减免分摊（元） */
    fixedReductionDeduction?: number;
    originalDate?: Date;
    coverageStart?: Date;
    coverageEnd?: Date;
    /**
     * 提前退租：**单独一行**落在退租日，`amount` 仅为免租扣回+押金扣款+其它调整之和；
     * 当期租金仍在原收款日的账单行上（由计费循环生成）。
     */
    earlyTerminationExtraAmount?: number;
    earlyTerminationExtraDetail?: { clawback: number; deposit: number; other: number };
}

export type GenerateBudgetedBillsOptions = {
    /** 多单元递归子调用时为 false，避免免租扣回重复 */
    applyEarlyTerminationSettlement?: boolean;
};

// Helper to parse "YYYY-MM-DD" string into a Local Date object (00:00:00)
// This avoids UTC offsets issues where "2026-06-01" becomes "2026-05-31" in some timezones
export const parseDateLocal = (dateInput: string | Date | undefined): Date => {
    if (!dateInput) return new Date(); // Fallback
    if (dateInput instanceof Date) return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());
    
    // Handle string "YYYY-MM-DD"
    const parts = dateInput.split('-').map(Number);
    if (parts.length === 3) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateInput);
};

/**
 * 合同「单月账期调整」按收款日自然月匹配账单。
 * 先尝试 hintYear + month；若无精确年匹配且同月有多笔，取与 hintYear（或 anchorYear）最接近的年份，
 * 缓解 UI 误把 originalYear 写成「操作当年」导致只加不减、金额堆叠成数倍的问题。
 */
const resolveBillForContractPeriodMonth = (
    bills: BudgetedBill[],
    month0: number,
    hintYear: number,
    anchorYear?: number,
): BudgetedBill | undefined => {
    const inMonth = bills
        .filter((b) => b.date.getMonth() === month0)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    if (inMonth.length === 0) return undefined;
    const exact = inMonth.find((b) => b.date.getFullYear() === hintYear);
    if (exact) return exact;
    const pivot = anchorYear ?? hintYear;
    let best = inMonth[0];
    let bestDist = Math.abs(best.date.getFullYear() - pivot);
    for (let i = 1; i < inMonth.length; i++) {
        const cand = inMonth[i];
        const d = Math.abs(cand.date.getFullYear() - pivot);
        if (d < bestDist || (d === bestDist && cand.date.getTime() < best.date.getTime())) {
            best = cand;
            bestDist = d;
        }
    }
    return best;
};

/** 已知原收款日及目标自然月(0-11)，推算目标收款日（用于原月无账单、仅写了目标月的情形） */
const syntheticReceivableDateForShiftedMonth = (sourceBill: BudgetedBill, targetMonth0: number): Date => {
    const sy = sourceBill.date.getFullYear();
    const sm = sourceBill.date.getMonth();
    const tm = targetMonth0;
    let ty = sy;
    if (tm < sm) ty += 1;
    return new Date(ty, tm, 1);
};

/** 确保 Date 输出为本地日期字符串 "YYYY-MM-DD"（避免 toISOString UTC 偏移） */
const toLocalDateString = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/** 按日历月加减月份，收款日落在目标自然月内（避免起租日 28–31 日时用 setMonth 溢出到其他月） */
export function addCalendarMonths(date: Date, deltaMonths: number): Date {
    const y = date.getFullYear();
    const m = date.getMonth();
    const day = date.getDate();
    const target = new Date(y, m + deltaMonths, 1);
    const dim = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, dim));
    return target;
}

export const getDaysDiff = (start: Date, end: Date): number => {
    // Reset hours to ensure pure date difference
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (e.getTime() < s.getTime()) {
        console.warn('[getDaysDiff] 日期反序，已自动交换', { start: start.toISOString(), end: end.toISOString() });
        const diffTime = s.getTime() - e.getTime();
        return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
    }
    const diffTime = e.getTime() - s.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
};

export const getOverlapDays = (start1: Date, end1: Date, start2: Date, end2: Date): number => {
    const s1 = new Date(start1.getFullYear(), start1.getMonth(), start1.getDate());
    const e1 = new Date(end1.getFullYear(), end1.getMonth(), end1.getDate());
    const s2 = new Date(start2.getFullYear(), start2.getMonth(), start2.getDate());
    const e2 = new Date(end2.getFullYear(), end2.getMonth(), end2.getDate());

    const overlapStart = s1 > s2 ? s1 : s2;
    const overlapEnd = e1 < e2 ? e1 : e2;

    if (overlapStart <= overlapEnd) {
        return getDaysDiff(overlapStart, overlapEnd);
    }
    return 0;
};

export const isRentFreeDate = (date: Date, rentFreePeriods: RentFreePeriod[]): boolean => {
    if (!rentFreePeriods || rentFreePeriods.length === 0) return false;
    // Normalize check date
    const checkTime = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
    
    return rentFreePeriods.some(rf => {
        const start = parseDateLocal(rf.start).getTime();
        const end = parseDateLocal(rf.end).getTime();
        return checkTime >= start && checkTime <= end;
    });
};

/**
 * Defer 模式：新账期锚点若落在某免租段开始前的「紧邻窗口」内，整段顺延至该免租段结束次日。
 * 避免上期覆盖止于 2/11、免租 2/15 起算时，在 2/12 误开季付（覆盖期穿过免租段、应收落在 2 月）。
 */
export const DEFER_IMMINENT_RENT_FREE_GAP_DAYS = 31;

export const snapDeferCycleCursorPastImminentRentFree = (
    cursor: Date,
    rentFreePeriods: RentFreePeriod[] | undefined,
    leaseEnd: Date,
): Date => {
    const out = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
    const periods = rentFreePeriods || [];
    if (periods.length === 0) return out;

    const advancePastEnd = (rf: RentFreePeriod) => {
        const end = parseDateLocal(rf.end);
        out.setTime(end.getTime());
        out.setDate(out.getDate() + 1);
    };

    let guard = 0;
    while (guard++ < periods.length * 2 + 4) {
        if (out > leaseEnd) break;
        let moved = false;

        if (isRentFreeDate(out, periods)) {
            for (const rf of periods) {
                if (!isRentFreeDate(out, [rf])) continue;
                advancePastEnd(rf);
                moved = true;
                break;
            }
        } else {
            for (const rf of periods) {
                const rfStart = parseDateLocal(rf.start);
                const rfEnd = parseDateLocal(rf.end);
                if (out > rfEnd) continue;
                const gapDays = getDaysDiff(out, rfStart);
                if (gapDays > 0 && gapDays <= DEFER_IMMINENT_RENT_FREE_GAP_DAYS) {
                    advancePastEnd(rf);
                    moved = true;
                    break;
                }
            }
        }

        if (!moved) break;
    }
    return out;
};

/**
 * 计算合同月结束日：从 start 的 day-of-month 到次月同日-1天。
 * 若 anchorDay 在次月不存在（如31日在2月），回退到次月最后一天。
 */
export const getContractMonthEnd = (start: Date, anchorDay: number): Date => {
    const y = start.getFullYear();
    const m = start.getMonth();
    const next = new Date(y, m + 1, anchorDay);
    // JS Date 溢出：new Date(2026,1,31)→ Mar 3，此时 getMonth()≠target
    if (next.getMonth() !== (m + 1) % 12) {
        return new Date(y, m + 2, 0); // 次月最后一天
    }
    next.setDate(next.getDate() - 1);
    return next;
};

/** 合同月当期最后一天（含）：起租日在 anchorDay，或账期从非 anchor 日开始的当月段 */
export const contractMonthEndInclusive = (cursor: Date, anchorDay: number): Date => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    if (cursor.getDate() === anchorDay) {
        return getContractMonthEnd(cursor, anchorDay);
    }
    const lastDay = new Date(y, m + 1, 0).getDate();
    const endDay = Math.min(anchorDay, lastDay) - 1;
    if (endDay >= 1) {
        return new Date(y, m, endDay);
    }
    return new Date(y, m, lastDay);
};

const previousContractPeriodStart = (periodStart: Date, anchorDay: number): Date => {
    const dayBefore = new Date(periodStart.getFullYear(), periodStart.getMonth(), periodStart.getDate());
    dayBefore.setDate(dayBefore.getDate() - 1);
    const y = dayBefore.getFullYear();
    const m = dayBefore.getMonth();
    const lastDay = new Date(y, m + 1, 0).getDate();
    const endDay = Math.min(anchorDay, lastDay) - 1;
    if (dayBefore.getDate() === endDay) {
        if (anchorDay > lastDay || endDay < anchorDay - 1) {
            return new Date(y, m, 1);
        }
        return new Date(y, m, Math.min(anchorDay, lastDay));
    }
    if (dayBefore.getDate() === lastDay) {
        return new Date(y, m, 1);
    }
    const pm = m === 0 ? 11 : m - 1;
    const py = m === 0 ? y - 1 : y;
    const lastPrev = new Date(py, pm + 1, 0).getDate();
    return new Date(py, pm, Math.min(anchorDay, lastPrev));
};

/**
 * 从 start 起按合同月（锚定起租日）推进 months，返回下一段账期的首日（exclusive end）。
 * 与 Deduct 模式 coverageEnd = addContractMonths(start, n) - 1 天 配套使用。
 */
export const addContractMonths = (start: Date, months: number, anchorDay?: number): Date => {
    const anchor = anchorDay ?? start.getDate();
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const wholeMonths = Math.trunc(months);
    const fractionalMonths = months - wholeMonths;

    if (wholeMonths > 0) {
        for (let i = 0; i < wholeMonths; i++) {
            const end = contractMonthEndInclusive(cursor, anchor);
            cursor = new Date(end);
            cursor.setDate(cursor.getDate() + 1);
        }
    } else if (wholeMonths < 0) {
        for (let i = 0; i < -wholeMonths; i++) {
            cursor = previousContractPeriodStart(cursor, anchor);
        }
    }

    if (fractionalMonths !== 0) {
        cursor.setDate(cursor.getDate() + Math.round(fractionalMonths * 30));
    }
    return cursor;
};

export const calculateRentForDuration = (start: Date, end: Date, monthlyRent: number): number => {
    let total = 0;
    let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const finalEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    const anchorDay = start.getDate();

    let safety = 0;
    while (cursor <= finalEnd && safety < BILLING_LOOP_LIMIT) {
        safety++;

        // 日历月边界
        const calendarMonthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        // 合同月边界（从 anchorDay 到次月 anchorDay-1）
        const contractMonthEnd = getContractMonthEnd(cursor, anchorDay);

        // 取更远的边界作为本段结束（尽量一次跳完整月）
        const naturalEnd = contractMonthEnd > calendarMonthEnd ? contractMonthEnd : calendarMonthEnd;
        const segmentEnd = naturalEnd < finalEnd ? naturalEnd : finalEnd;

        const isFullCalendarMonth =
            cursor.getDate() === 1 &&
            segmentEnd.getTime() === calendarMonthEnd.getTime();

        const isFullContractMonth =
            cursor.getDate() === anchorDay &&
            segmentEnd.getTime() === contractMonthEnd.getTime();

        if (isFullCalendarMonth || isFullContractMonth) {
            total += monthlyRent;
        } else {
            // 按天计算：统一月租 / DAILY_RENT_BASE_DAYS（30）口径，与合同预览及测试一致
            let dayCursor = new Date(cursor);
            while (dayCursor <= segmentEnd) {
                const monthEnd = new Date(dayCursor.getFullYear(), dayCursor.getMonth() + 1, 0);
                const segEnd = monthEnd < segmentEnd ? monthEnd : segmentEnd;
                const days = getDaysDiff(dayCursor, segEnd);
                total += days * (monthlyRent / DAILY_RENT_BASE_DAYS);
                dayCursor = new Date(segEnd);
                dayCursor.setDate(dayCursor.getDate() + 1);
            }
        }

        cursor = new Date(segmentEnd);
        cursor.setDate(cursor.getDate() + 1);
    }
    return total;
};

/** 单条免租段在覆盖期内的扣减额 */
export const calculateRentFreeDeductionForPeriod = (
    rf: RentFreePeriod,
    overlapStart: Date,
    overlapEnd: Date,
    monthlyRent: number,
): number => {
    if (
        rf.deductionMode === 'fixed' &&
        rf.deductionAmount != null &&
        rf.deductionAmount > 0 &&
        overlapStart <= overlapEnd
    ) {
        return rf.deductionAmount;
    }
    return calculateRentFreeDeduction(overlapStart, overlapEnd, monthlyRent);
};

export const calculateRentFreeDeduction = (start: Date, end: Date, monthlyRent: number): number => {
    const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    endExclusive.setDate(endExclusive.getDate() + 1);

    const monthDiff = (endExclusive.getFullYear() - normalizedStart.getFullYear()) * 12
        + (endExclusive.getMonth() - normalizedStart.getMonth());
    if (monthDiff > 0 && addCalendarMonths(normalizedStart, monthDiff).getTime() === endExclusive.getTime()) {
        return monthDiff * monthlyRent;
    }

    // 非整月免租按半月粒度折算，避免 31 天被按 31/30 多扣。
    const days = getDaysDiff(normalizedStart, end);
    const halfMonths = Math.max(0.5, Math.round(days / 15) * 0.5);
    return halfMonths * monthlyRent;
};

/**
 * 当期扣除模式：按覆盖期计算应收（含免租扣减）；分房源时按房源汇总。
 * 首期自定义覆盖期重锚账期后须用本函数重算，不能沿用起租日周期合并前的金额。
 */
export const computeDeductModeAmountForCoverage = (
    tenant: Tenant,
    coverageStart: Date,
    coverageEnd: Date,
    monthlyRent: number,
    unitTerms?: LeaseUnitTerm[],
): number => {
    const terms = (unitTerms || []).filter((term) => (term.monthlyRent || term.unitPrice) && term.area > 0);
    const rentFreeDeductionFor = (rentFreeList: RentFreePeriod[], rent: number) => {
        let deduction = 0;
        for (const rf of rentFreeList) {
            const rfStart = parseDateLocal(rf.start);
            const rfEnd = parseDateLocal(rf.end);
            const overlapStart = rfStart > coverageStart ? rfStart : coverageStart;
            const overlapEnd = rfEnd < coverageEnd ? rfEnd : coverageEnd;
            if (overlapStart <= overlapEnd) {
                deduction += calculateRentFreeDeductionForPeriod(rf, overlapStart, overlapEnd, rent);
            }
        }
        return deduction;
    };

    if (terms.length === 0) {
        const gross = calculateRentForDuration(coverageStart, coverageEnd, monthlyRent);
        const deduction = rentFreeDeductionFor(tenant.rentFreePeriods || [], monthlyRent);
        return Math.max(0, round2(gross - deduction));
    }

    let total = 0;
    for (const term of terms) {
        const termMonthly =
            term.monthlyRent && term.monthlyRent > 0
                ? term.monthlyRent
                : monthlyRentFromUnitPrice(term.unitPrice || 0, term.area, tenant.unitPriceMode);
        const gross = calculateRentForDuration(coverageStart, coverageEnd, termMonthly);
        const deduction = rentFreeDeductionFor(mergeRentFreeForUnitTerm(tenant, term), termMonthly);
        total += Math.max(0, gross - deduction);
    }
    return round2(total);
};

/**
 * 提前退租免租期扣回（月租金口径）：
 * max(0, 已享免租权重 − (实际承租天数/合同期天数)×合同约定免租权重) × 月租金
 * 权重与 calculateRentFreeDeduction(..., 1) 一致，便于与账单内免租扣减口径对齐。
 */
export const computeEarlyTerminationFreeRentClawbackAmount = (tenant: Tenant): number => {
    if (tenant.terminationType !== 'Early' || !tenant.terminationDate || !tenant.leaseEnd) return 0;
    const leaseStart = parseDateLocal(tenant.leaseStart);
    const leaseEnd = parseDateLocal(tenant.leaseEnd);
    const term = parseDateLocal(tenant.terminationDate);
    if (term >= leaseEnd) return 0;

    let monthlyRent = tenant.monthlyRent || 0;
    if (monthlyRent === 0 && tenant.unitPrice && tenant.totalArea) {
        monthlyRent = monthlyRentFromUnitPrice(tenant.unitPrice, tenant.totalArea, tenant.unitPriceMode);
    }
    if (monthlyRent <= 0) return 0;

    const contractDays = Math.max(1, getDaysDiff(leaseStart, leaseEnd));
    const actualDays = Math.max(1, getDaysDiff(leaseStart, term));

    let contractualFreeWeight = 0;
    let enjoyedFreeWeight = 0;
    for (const rf of tenant.rentFreePeriods || []) {
        const rfStart = parseDateLocal(rf.start);
        const rfEnd = parseDateLocal(rf.end);
        const cStart = rfStart > leaseStart ? rfStart : leaseStart;
        const cEnd = rfEnd < leaseEnd ? rfEnd : leaseEnd;
        if (cStart <= cEnd) {
            contractualFreeWeight += calculateRentFreeDeduction(cStart, cEnd, 1);
        }
        const eEnd = rfEnd < term ? rfEnd : term;
        const eStart = rfStart > leaseStart ? rfStart : leaseStart;
        if (eStart <= eEnd) {
            enjoyedFreeWeight += calculateRentFreeDeduction(eStart, eEnd, 1);
        }
    }

    const proportionalAllowed = (actualDays / contractDays) * contractualFreeWeight;
    const clawbackWeight = Math.max(0, enjoyedFreeWeight - proportionalAllowed);
    return Math.round(clawbackWeight * monthlyRent);
};

/** 合同级固定金额减免：按覆盖期重叠的账单行比例分摊 reductionAmount */
export const applyContractFixedRentReductions = (tenant: Tenant, bills: BudgetedBill[]): void => {
    const reductions = tenant.rentReductions || [];
    if (!reductions.length) return;

    for (const r of reductions) {
        const reductionAmount = Number(r.reductionAmount);
        if (!(reductionAmount > 0)) continue;

        const rStart = parseDateLocal(r.start);
        const rEnd = parseDateLocal(r.end);

        const affected = bills.filter((b) => {
            if (b.earlyTerminationExtraDetail) return false;
            const cs = b.coverageStart ?? b.date;
            const ce = b.coverageEnd ?? b.date;
            const csDay = new Date(cs.getFullYear(), cs.getMonth(), cs.getDate());
            const ceDay = new Date(ce.getFullYear(), ce.getMonth(), ce.getDate());
            return csDay <= rEnd && ceDay >= rStart && b.amount > MIN_AMOUNT_THRESHOLD;
        });
        if (!affected.length) continue;

        const total = affected.reduce((s, b) => s + b.amount, 0);
        if (total <= 0) continue;

        let remaining = round2(reductionAmount);
        const sorted = [...affected].sort((a, b) => a.date.getTime() - b.date.getTime());
        for (let i = 0; i < sorted.length; i++) {
            const bill = sorted[i];
            if (bill.grossAmount == null) bill.grossAmount = bill.amount;
            const isLast = i === sorted.length - 1;
            const deduct = isLast
                ? remaining
                : round2(reductionAmount * (bill.amount / total));
            const applied = round2(Math.min(bill.amount, Math.max(0, deduct)));
            if (applied <= 0) continue;
            bill.fixedReductionDeduction = round2((bill.fixedReductionDeduction || 0) + applied);
            bill.amount = round2(Math.max(0, bill.amount - applied));
            remaining = round2(Math.max(0, remaining - applied));
        }

        if (r.grossAmount != null && r.grossAmount > reductionAmount) {
            const targetNet = round2(r.grossAmount - reductionAmount);
            const actualNet = round2(affected.reduce((s, b) => s + b.amount, 0));
            const diff = round2(targetNet - actualNet);
            if (Math.abs(diff) >= 0.005 && sorted.length > 0) {
                const last = sorted[sorted.length - 1];
                last.amount = round2(Math.max(0, last.amount + diff));
            }
        }
    }
};

const applyEarlyTerminationExtrasToBills = (tenant: Tenant, bills: BudgetedBill[]): void => {
    if (tenant.terminationType !== 'Early' || !tenant.terminationDate || bills.length === 0) return;
    const term = parseDateLocal(tenant.terminationDate);
    const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : null;
    if (!leaseEnd || term >= leaseEnd) return;

    const computedClawback = computeEarlyTerminationFreeRentClawbackAmount(tenant);
    const clawback =
        tenant.earlyTerminationFreeRentClawbackOverride != null &&
        Number.isFinite(tenant.earlyTerminationFreeRentClawbackOverride)
            ? Math.round(tenant.earlyTerminationFreeRentClawbackOverride)
            : computedClawback;
    const deposit = Math.max(0, Math.round(tenant.earlyTerminationDepositDeduction ?? 0));
    const other = Math.round(tenant.earlyTerminationOtherAdjustment ?? 0);
    const extra = clawback + deposit + other;

    const termTime = term.getTime();
    const withCoverage = bills.filter(
        (b) =>
            !b.earlyTerminationExtraDetail &&
            b.coverageStart &&
            b.coverageEnd &&
            b.coverageStart.getTime() <= termTime &&
            b.coverageEnd.getTime() >= termTime
    );
    const target =
        withCoverage.length > 0
            ? withCoverage.reduce((a, b) =>
                  (a.coverageStart!.getTime() >= b.coverageStart!.getTime() ? a : b)
              )
            : bills
                  .filter(
                      (b) =>
                          !b.earlyTerminationExtraDetail &&
                          (b.coverageEnd ? b.coverageEnd.getTime() <= termTime : b.date.getTime() <= termTime)
                  )
                  .reduce((a, b) => (a.date.getTime() >= b.date.getTime() ? a : b), bills[0]);

    const currentPeriodRent = Math.max(0, Math.round(target.amount));
    target.amount = currentPeriodRent;
    delete target.earlyTerminationExtraAmount;
    delete target.earlyTerminationExtraDetail;

    if (Math.abs(extra) <= MIN_AMOUNT_THRESHOLD) return;

    const settlementAmount = Math.round(extra);
    bills.push({
        date: new Date(term.getFullYear(), term.getMonth(), term.getDate()),
        amount: settlementAmount,
        coverageStart: new Date(term.getFullYear(), term.getMonth(), term.getDate()),
        coverageEnd: new Date(term.getFullYear(), term.getMonth(), term.getDate()),
        earlyTerminationExtraAmount: settlementAmount,
        earlyTerminationExtraDetail: { clawback, deposit, other },
    });
    bills.sort((a, b) => a.date.getTime() - b.date.getTime());
};

/** 当前租户房源上挂接的空置去化预算假设（按单元 targetId） */
export const pickVacancyAssumptionsForTenant = (
    tenant: Pick<Tenant, 'unitIds'>,
    assumptions: BudgetAssumption[],
): BudgetAssumption[] => {
    const uids = tenant.unitIds || [];
    return assumptions.filter(
        (a) => a.targetType === 'Vacancy' && !!a.projectedSignDate && uids.includes(a.targetId),
    );
};

/**
 * 当合同起租日与预算「预计签约日」一致时，用空置去化卡片的单价与免租参数推算收款计划，
 * 使合同预览 / 财务报表应收核销与预算管理口径一致。
 */
export const applyVacancyBudgetOverlayToTenant = (tenant: Tenant, assumptions: BudgetAssumption[]): Tenant => {
    if (!tenant.leaseStart || tenant.id?.startsWith('virt_')) return tenant;
    const matching = pickVacancyAssumptionsForTenant(tenant, assumptions);
    if (matching.length === 0) return tenant;

    const sig = (a: BudgetAssumption) =>
        `${a.projectedSignDate}|${Number(a.projectedUnitPrice ?? 0)}|${Number(a.projectedRentFreeMonths ?? 0)}`;
    if (new Set(matching.map(sig)).size !== 1) return tenant;

    const vac = matching[0];
    if (tenant.leaseStart !== vac.projectedSignDate) return tenant;

    const uids = tenant.unitIds || [];
    if (uids.length > 1 && matching.length !== uids.length) return tenant;

    const start = parseDateLocal(vac.projectedSignDate);
    const rfMonths = vac.projectedRentFreeMonths || 0;
    const rfEndStr =
        rfMonths > 0
            ? toLocalDateString(new Date(new Date(start).setMonth(start.getMonth() + rfMonths)))
            : undefined;

    const addMonthsStr = (dateStr: string, months: number): string => {
        const d = parseDateLocal(dateStr);
        d.setMonth(d.getMonth() + months);
        return toLocalDateString(d);
    };
    const firstPayDate = addMonthsStr(vac.projectedSignDate, rfMonths);

    const unitPrice = vac.projectedUnitPrice ?? tenant.unitPrice;
    // projectedUnitPrice 始终为天单价；仅当回落至 tenant.unitPrice 时需考虑 unitPriceMode
    const priceMode = vac.projectedUnitPrice != null ? 'daily' : tenant.unitPriceMode;
    let monthlyRent = tenant.monthlyRent || 0;
    if (unitPrice != null && tenant.totalArea) {
        monthlyRent = monthlyRentFromUnitPrice(unitPrice, tenant.totalArea, priceMode);
    }

    const rentFreePeriods =
        rfMonths > 0 && rfEndStr
            ? [{ start: vac.projectedSignDate, end: rfEndStr, description: '预算空置去化（免租）' }]
            : tenant.rentFreePeriods || [];

    return {
        ...tenant,
        unitPrice: unitPrice ?? tenant.unitPrice,
        monthlyRent,
        rentFreePeriods,
        firstPaymentDate: firstPayDate,
        freeRentHandling: 'Defer',
    };
};

/** 给客户合同 / 核销界面展示的预算对齐说明文案 */
export function buildVacancyBudgetAlignmentNote(
    tenant: Pick<Tenant, 'unitIds' | 'leaseStart'> | undefined,
    assumptions: BudgetAssumption[],
): string | undefined {
    if (!tenant?.unitIds?.length) return undefined;
    const matching = pickVacancyAssumptionsForTenant(tenant, assumptions);
    if (matching.length === 0) return undefined;

    const sig = (a: BudgetAssumption) =>
        `${a.projectedSignDate}|${Number(a.projectedUnitPrice ?? 0)}|${Number(a.projectedRentFreeMonths ?? 0)}`;
    const sigSet = new Set(matching.map(sig));
    if (sigSet.size !== 1) {
        return '预算空置去化：多套房源对应的预算参数不一致，系统未自动合并至收款计划，请在预算管理中统一参数或拆分合同。';
    }

    const vac = matching[0];
    const aligned = tenant.leaseStart === vac.projectedSignDate;
    const base = `预算空置去化：预计签约 ${vac.projectedSignDate}，单价 ${vac.projectedUnitPrice} 元/㎡·天，免租 ${vac.projectedRentFreeMonths || 0} 月`;
    if (aligned) {
        const multiPartial =
            (tenant.unitIds?.length || 0) > 1 && matching.length !== (tenant.unitIds?.length || 0)
                ? '（多房源合同：仅部分单元配置了空置预算的，不在合同层自动对齐）'
                : '';
        return `${base}。合同起租日与预算一致，收款推算已与预算参数对齐（与财务报表应收核销一致）。${multiPartial}`;
    }
    return `${base}。当前合同起租为 ${tenant.leaseStart || '—'}，与预算不一致 → 应收按合同字段推算；可调整预算「预计签约日」或修正合同起租以保持一致。`;
}

export const generateBudgetedBills = (
    tenantInput: Tenant,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    startDateConstraint: Date,
    endDateConstraint: Date,
    options?: GenerateBudgetedBillsOptions
): BudgetedBill[] => {
    let tenant = applyVacancyBudgetOverlayToTenant(tenantInput, assumptions);
    let bills: BudgetedBill[] = [];

    if (!tenant.leaseStart) return [];

    // Parse lease dates strictly as Local Time to avoid timezone shifts（首期自定义后处理依赖）
    const leaseStart = parseDateLocal(tenant.leaseStart);
    const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : farFutureDate();

    const terminationDate = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
    const effectiveLeaseEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;

    let monthlyRent = tenant.monthlyRent || 0;
    if (monthlyRent === 0 && tenant.unitPrice && tenant.totalArea) {
        monthlyRent = monthlyRentFromUnitPrice(tenant.unitPrice, tenant.totalArea, tenant.unitPriceMode);
    }

    const applyEarlyTerm = options?.applyEarlyTerminationSettlement !== false;
    /** 应收账期月份偏移：上海/北京 = -1（前一个月），深圳 = 0（当月）。 */
    const receivableMonthOffset = getReceivableMonthOffsetForTenant(tenant);

    // 付款周期变更：将租期按变更点拆分为多个时间段，每段用对应周期独立生成账单
    const cycleChanges = tenant.paymentCycleChanges && tenant.paymentCycleChanges.length > 0
        ? [...tenant.paymentCycleChanges].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
        : [];
    if (cycleChanges.length > 0 && applyEarlyTerm) {
        // 构建时间段：[(leaseStart 或上次变更日期), 变更日期, ...变更日期, leaseEnd]
        const segments: { cycle: PaymentCycle; cycleMonths?: number; start: Date; end: Date }[] = [];
        let segStart = new Date(leaseStart);
        let currentCycle = tenant.paymentCycle;
        let currentCycleMonths = tenant.paymentCycleMonths;

        for (const ch of cycleChanges) {
            const effDate = parseDateLocal(ch.effectiveDate);
            if (effDate > segStart && effDate < effectiveLeaseEnd) {
                segments.push({
                    cycle: currentCycle,
                    cycleMonths: currentCycle === 'Custom' ? currentCycleMonths : undefined,
                    start: new Date(segStart),
                    end: new Date(effDate),
                });
                segStart = new Date(effDate);
                currentCycle = ch.toCycle;
                currentCycleMonths = ch.toCycleMonths;
            }
        }
        // 最后一段
        if (segStart < effectiveLeaseEnd) {
            segments.push({
                cycle: currentCycle,
                cycleMonths: currentCycle === 'Custom' ? currentCycleMonths : undefined,
                start: new Date(segStart),
                end: new Date(effectiveLeaseEnd),
            });
        }

        if (segments.length > 1) {
            for (const seg of segments) {
                const segTenant: Tenant = {
                    ...tenant,
                    paymentCycle: seg.cycle,
                    paymentCycleMonths: seg.cycleMonths,
                    paymentCycleChanges: [], // 防止递归再次拆分
                    firstPaymentMonths: undefined, // 仅首段适用首期逻辑
                    firstReceivableAmount: undefined,
                };
                const segBills = generateBudgetedBills(
                    segTenant, assumptions, adjustments,
                    seg.start, seg.end,
                    { applyEarlyTerminationSettlement: false },
                );
                bills.push(...segBills);
            }
            // 提前退租结算在最后一段之后处理
            if (terminationDate) {
                applyEarlyTerminationExtrasToBills(tenant, bills);
            }
            // 对合并账单应用 Existing payment shifts
            const existingAsm = assumptions.find((a) => a.targetId === tenant.id && a.targetType === 'Existing');
            if (existingAsm?.paymentShift?.isActive) {
                applyExistingPaymentShiftToMergedBills(bills, existingAsm.paymentShift);
            }
            bills.forEach((b) => {
                if (b.grossAmount == null && !b.earlyTerminationExtraDetail) {
                    b.grossAmount = b.amount;
                }
            });
            applyContractFixedRentReductions(tenant, bills);
            return bills;
        }
    }

    const resolveCycleMonths = (): number => {
        if (tenant.paymentCycle === 'HalfMonthly') return 0.5;
        if (tenant.paymentCycle === 'Monthly') return 1;
        if (tenant.paymentCycle === 'BiMonthly') return 2;
        if (tenant.paymentCycle === 'Quarterly') return 3;
        if (tenant.paymentCycle === 'SemiAnnual') return 6;
        if (tenant.paymentCycle === 'Annual') return 12;
        if (tenant.paymentCycleMonths && tenant.paymentCycleMonths > 0) return tenant.paymentCycleMonths;
        return 3;
    };
    const addCycleMonths = (date: Date, months: number): Date => {
        const next = new Date(date);
        const wholeMonths = Math.trunc(months);
        const fractionalMonths = months - wholeMonths;
        // `!== 0` 而非 `> 0`：合同卡片 ◀ 前移按钮写入的 paymentPeriodShiftMonths 为负数，
        // 走 generateBills 时 shiftMonths 也会是负数，旧逻辑下负值路径不动，前移完全失效。
        if (wholeMonths !== 0) next.setMonth(next.getMonth() + wholeMonths);
        if (fractionalMonths !== 0) next.setDate(next.getDate() + Math.round(fractionalMonths * 30));
        return next;
    };
    /** 起租日在 29–31 日时 setMonth 会溢出，覆盖期须按合同月锚定 */
    const useContractMonthCoverage = leaseStart.getDate() >= 29;

    const regularCycleMonths = resolveCycleMonths();
    const firstCycleMonths =
        tenant.firstPaymentMonths && tenant.firstPaymentMonths > 0 ? tenant.firstPaymentMonths : regularCycleMonths;

    const unitTerms =
        Array.isArray(tenant.unitTerms) && tenant.unitTerms.length > 0
            ? tenant.unitTerms
            : Array.isArray(tenant.paymentTerms)
              ? tenant.paymentTerms
              : [];
    const validUnitTerms = unitTerms.filter((term) => (term.monthlyRent || term.unitPrice) && term.area > 0);

    let filledFromUnitMerge = false;
    if (validUnitTerms.length > 0) {
        const innerAssumptions = assumptionsForUnitInnerCalls(
            assumptions,
            tenant.id,
            validUnitTerms.length > 1,
        );
        const billsByDate = new Map<string, BudgetedBill>();
        validUnitTerms.forEach((term) => {
            const termMonthly =
                term.monthlyRent && term.monthlyRent > 0
                    ? term.monthlyRent
                    : monthlyRentFromUnitPrice((term.unitPrice || 0), term.area, tenant.unitPriceMode);
            const termBills = generateBudgetedBills(
                {
                    ...tenant,
                    unitTerms: undefined,
                    paymentTerms: undefined,
                    unitIds: [term.unitId],
                    totalArea: term.area,
                    unitPrice: term.unitPrice,
                    monthlyRent: termMonthly,
                    rentFreePeriods: mergeRentFreeForUnitTerm(tenant, term),
                    // 首期自定义仅能在合并后的账单上执行一次，不能随 ...tenant 传入子房源递归
                    firstReceivableAmount: undefined,
                    firstReceivableStartDate: undefined,
                    firstReceivableEndDate: undefined,
                },
                innerAssumptions,
                [],
                startDateConstraint,
                endDateConstraint,
                { applyEarlyTerminationSettlement: false },
            );
            termBills.forEach((bill) => {
                // 同一客户同一收款日应合并为一笔；覆盖期各房源不同时不应拆成多行。
                const key = [
                    bill.date.getFullYear(),
                    bill.date.getMonth(),
                    bill.date.getDate(),
                    bill.originalDate ? toLocalDateString(bill.originalDate) : '',
                ].join('-');
                const existing = billsByDate.get(key);
                if (existing) {
                    existing.amount += bill.amount;
                    if (bill.grossAmount != null) {
                        existing.grossAmount = round2((existing.grossAmount ?? existing.amount) + bill.grossAmount);
                    }
                    if (bill.coverageStart && existing.coverageStart) {
                        if (bill.coverageStart.getTime() < existing.coverageStart.getTime()) {
                            existing.coverageStart = new Date(bill.coverageStart);
                        }
                    } else if (bill.coverageStart && !existing.coverageStart) {
                        existing.coverageStart = new Date(bill.coverageStart);
                    }
                    if (bill.coverageEnd && existing.coverageEnd) {
                        if (bill.coverageEnd.getTime() > existing.coverageEnd.getTime()) {
                            existing.coverageEnd = new Date(bill.coverageEnd);
                        }
                    } else if (bill.coverageEnd && !existing.coverageEnd) {
                        existing.coverageEnd = new Date(bill.coverageEnd);
                    }
                } else {
                    billsByDate.set(key, { ...bill });
                }
            });
        });
        const merged = Array.from(billsByDate.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
        const existingAsm = assumptions.find((a) => a.targetId === tenant.id && a.targetType === 'Existing');
        if (validUnitTerms.length > 1 && existingAsm?.paymentShift?.isActive) {
            applyExistingPaymentShiftToMergedBills(merged, existingAsm.paymentShift);
        }
        bills = merged;
        filledFromUnitMerge = true;
    }

    if (!filledFromUnitMerge && monthlyRent > 0) {
        const existingAssumption = assumptions.find((a) => a.targetId === tenant.id && a.targetType === 'Existing');
        // 预算假设 `billingCycleShiftMonths`（预算页）与合同 `paymentPeriodShiftMonths`（合同中心）叠加；
        // 应收明细 / 核销依赖根级假设覆盖应收方案快照时，此处必须读到假设偏移。
        const billingShift =
            (existingAssumption?.billingCycleShiftMonths ?? 0) + (tenant.paymentPeriodShiftMonths || 0);

        // 支持新的 freeRentHandling 字段
        const isDeferMode = tenant.freeRentHandling === 'Defer';
        
        if (isDeferMode) {
            // Strategy: Defer billing cycle when encountering rent-free periods
            let cursor = new Date(leaseStart);
            let isFirstCycle = true;
            let safetyCounter = 0;

            const loopLimitDate = new Date(endDateConstraint);
            loopLimitDate.setFullYear(loopLimitDate.getFullYear() + 2); 

            while (cursor <= effectiveLeaseEnd && cursor <= loopLimitDate && safetyCounter < BILLING_LOOP_LIMIT) {
                safetyCounter++;

                // 1. Skip Rent Free Gap
                let inRentFreeGap = true;
                while (inRentFreeGap && cursor <= effectiveLeaseEnd) {
                    if (isRentFreeDate(cursor, tenant.rentFreePeriods)) {
                        cursor.setDate(cursor.getDate() + 1);
                    } else {
                        inRentFreeGap = false;
                    }
                }

                if (cursor > effectiveLeaseEnd) break;

                // 紧邻免租段：勿在免租开始前数日开新账期（首期有自定义支付日时不改锚点）
                if (!(isFirstCycle && tenant.firstPaymentDate)) {
                    const snapped = snapDeferCycleCursorPastImminentRentFree(
                        cursor,
                        tenant.rentFreePeriods,
                        effectiveLeaseEnd,
                    );
                    cursor.setTime(snapped.getTime());
                }
                if (cursor > effectiveLeaseEnd) break;

                // 2. Determine Bill Date：默认覆盖期前 1 个月；深圳 / 北京 28–31 日起租为覆盖期当月（offset=0）。
                const coverageStartDefer = new Date(cursor);
                let billDate = addCalendarMonths(
                    new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate()),
                    receivableMonthOffset,
                );
                billDate = resolveReceivableBillDate(coverageStartDefer, billDate, tenant, {
                    isFirstCycle,
                });

                // 3. Collect Billable Months
                const targetVirtualMonths = isFirstCycle ? firstCycleMonths : regularCycleMonths;
                let collectedVirtualMonths = 0;
                let segmentCursor = new Date(cursor);

                // 防止 Defer 模式下逐日推进失控（深圳园区 13 年租约 + 长免租期可达 4000+ 天）。
                // 5 年（1825 天）足够覆盖任何合理单期账单 + 免租跳跃，超出则跳出避免阻塞主线程。
                const INNER_DAY_LIMIT = 365 * 5;
                let innerIter = 0;

                // 1e-9 容差修正浮点累积误差（如 28×1/28≠1.0），避免多累一天导致覆盖期偏移
                while (collectedVirtualMonths + 1e-9 < targetVirtualMonths && segmentCursor <= effectiveLeaseEnd) {
                    if (innerIter++ >= INNER_DAY_LIMIT) {
                        console.warn('[generateBudgetedBills] Defer 模式内层循环超过 5 年逐日推进上限，强制跳出。tenantId=', tenant.id);
                        break;
                    }
                    if (!isRentFreeDate(segmentCursor, tenant.rentFreePeriods)) {
                        collectedVirtualMonths += 1 / DAILY_RENT_BASE_DAYS;
                    }
                    segmentCursor.setDate(segmentCursor.getDate() + 1);
                }
                
                if (collectedVirtualMonths < 0.05) break;
                const coverageStart = new Date(cursor);
                const coverageEnd = new Date(segmentCursor);
                coverageEnd.setDate(coverageEnd.getDate() - 1);

                let finalBillableMonths = collectedVirtualMonths;
                if (Math.abs(collectedVirtualMonths - Math.round(collectedVirtualMonths)) < 0.1) {
                    finalBillableMonths = Math.round(collectedVirtualMonths);
                }

                let grossAmount = round2(finalBillableMonths * monthlyRent);

                // Assumption Payment Shift
                if (existingAssumption?.paymentShift?.isActive) {
                    const ps = existingAssumption.paymentShift;
                    if (billDate.getFullYear() === ps.fromYear && billDate.getMonth() === ps.fromMonth) {
                        grossAmount -= ps.amount;
                        if (grossAmount < 0) grossAmount = 0;
                        const shiftedDate = new Date(billDate);
                        shiftedDate.setFullYear(ps.toYear);
                        shiftedDate.setMonth(ps.toMonth);
                        shiftedDate.setDate(1);
                        bills.push({
                            date: shiftedDate,
                            amount: Math.round(ps.amount),
                            originalDate: new Date(billDate),
                            coverageStart: new Date(coverageStart),
                            coverageEnd: new Date(coverageEnd),
                        });
                    }
                }

                if (grossAmount > 0) {
                    // 用户显式设定了首期支付日时，账期平移（billingShift）不覆盖首期，
                    // 仅对后续自动推算的账单生效，确保两个设定并行生效
                    if (billingShift !== 0 && !(isFirstCycle && !!tenant.firstPaymentDate)) {
                        billDate = addCalendarMonths(billDate, billingShift);
                    }
                    bills.push({
                        date: billDate,
                        amount: round2(grossAmount),
                        coverageStart: new Date(coverageStart),
                        coverageEnd: new Date(coverageEnd),
                    });
                }

                cursor = new Date(segmentCursor);
                isFirstCycle = false;
            }

        } else {
            // Strategy: Deduct (当期账单扣除模式) - 默认逻辑
            // 免租期从当期账单中扣除，收款时间不变但金额减少
            // Use local date for billing logic
            const leaseStartDay = new Date(leaseStart.getFullYear(), leaseStart.getMonth(), leaseStart.getDate());
            let currentBillDate = resolveReceivableBillDate(
                leaseStart,
                tenant.firstPaymentDate
                    ? parseDateLocal(tenant.firstPaymentDate)
                    : addCalendarMonths(leaseStartDay, receivableMonthOffset),
                tenant,
                { isFirstCycle: true },
            );

            let coverageStart = new Date(leaseStart);
            let isFirstCycle = true;
            let safetyCounter = 0;

            const loopLimitDate = new Date(endDateConstraint);
            loopLimitDate.setFullYear(loopLimitDate.getFullYear() + 2); 

            while (coverageStart <= effectiveLeaseEnd && safetyCounter < BILLING_LOOP_LIMIT) {
                safetyCounter++;

                const durationMonths = isFirstCycle ? firstCycleMonths : regularCycleMonths;
                const coverageEnd = useContractMonthCoverage
                    ? addContractMonths(coverageStart, durationMonths, leaseStart.getDate())
                    : addCycleMonths(coverageStart, durationMonths);
                coverageEnd.setDate(coverageEnd.getDate() - 1);
                
                const effectiveCoverageEnd = coverageEnd > effectiveLeaseEnd ? effectiveLeaseEnd : coverageEnd;

                // Price Adjustment Assumption
                let currentMonthlyRent = monthlyRent;
                if (existingAssumption?.priceAdjustment) {
                    const pa = existingAssumption.priceAdjustment;
                    const paStart = parseDateLocal(pa.startDate);
                    if (paStart <= effectiveCoverageEnd) {
                        currentMonthlyRent = (pa.newUnitPrice * tenant.totalArea * 365) / 12;
                    }
                }

                const fullCycleDays = getDaysDiff(coverageStart, coverageEnd);
                const actualDays = getDaysDiff(coverageStart, effectiveCoverageEnd);
                
                let grossAmount = 0;
                // If it's effectively a full cycle (within few days tolerance for month length diffs), use standard formula
                if (actualDays >= fullCycleDays - 5) {
                    grossAmount = currentMonthlyRent * durationMonths;
                } else {
                    // Use standard calculation for gross to maintain accuracy for partial lease periods
                    grossAmount = calculateRentForDuration(coverageStart, effectiveCoverageEnd, currentMonthlyRent);
                }

                let deduction = 0;
                if (tenant.rentFreePeriods) {
                    tenant.rentFreePeriods.forEach(rf => {
                        // Use strict local parsing for rent free periods
                        const rfStart = parseDateLocal(rf.start);
                        const rfEnd = parseDateLocal(rf.end);
                        
                        const overlapStart = rfStart > coverageStart ? rfStart : coverageStart;
                        const overlapEnd = rfEnd < effectiveCoverageEnd ? rfEnd : effectiveCoverageEnd;

                        if (overlapStart <= overlapEnd) {
                            deduction += calculateRentFreeDeductionForPeriod(
                                rf,
                                overlapStart,
                                overlapEnd,
                                currentMonthlyRent,
                            );
                        }
                    });
                }

                let finalAmount = Math.max(0, grossAmount - deduction);
                let finalBillDate = resolveReceivableBillDate(
                    coverageStart,
                    new Date(currentBillDate),
                    tenant,
                    { isFirstCycle },
                );

                // Assumption Payment Shift
                if (existingAssumption?.paymentShift?.isActive) {
                    const ps = existingAssumption.paymentShift;
                    if (finalBillDate.getFullYear() === ps.fromYear && finalBillDate.getMonth() === ps.fromMonth) {
                        finalAmount -= ps.amount;
                        if (finalAmount < 0) finalAmount = 0;

                        const shiftedDate = new Date(finalBillDate);
                        shiftedDate.setFullYear(ps.toYear);
                        shiftedDate.setMonth(ps.toMonth);
                        shiftedDate.setDate(1);
                        
                        bills.push({
                            date: shiftedDate,
                            amount: Math.round(ps.amount),
                            originalDate: new Date(currentBillDate),
                            coverageStart: new Date(coverageStart),
                            coverageEnd: new Date(effectiveCoverageEnd),
                        });
                    }
                }

                if (finalAmount > 0) {
                    // 用户显式设定了首期支付日时，账期平移不覆盖首期
                    if (billingShift !== 0 && !(isFirstCycle && !!tenant.firstPaymentDate)) {
                        finalBillDate = addCalendarMonths(finalBillDate, billingShift);
                    }
                    bills.push({
                        date: finalBillDate,
                        amount: round2(finalAmount),
                        grossAmount: round2(grossAmount),
                        rentFreeDeduction: round2(deduction),
                        coverageStart: new Date(coverageStart),
                        coverageEnd: new Date(effectiveCoverageEnd),
                    });
                }

                coverageStart = new Date(effectiveCoverageEnd);
                coverageStart.setDate(coverageStart.getDate() + 1);
                currentBillDate = resolveReceivableBillDate(
                    coverageStart,
                    addCalendarMonths(
                        new Date(coverageStart.getFullYear(), coverageStart.getMonth(), coverageStart.getDate()),
                        receivableMonthOffset,
                    ),
                    tenant,
                    { isFirstCycle: false },
                );
                
                isFirstCycle = false;
                
                if (coverageStart > loopLimitDate) break;
            }
        }
    }

    // --- 合同级账期调整（Tenant.paymentPeriodAdjustments）：先于预算调整执行 ---
    // 单笔原子移动：先定位原收款日账单并扣减，再加到目标月（避免「先加后减」时原月匹配失败导致金额堆叠数倍）。
    const contractPeriodAdjs = tenant.paymentPeriodAdjustments || [];
    for (const adj of contractPeriodAdjs) {
        if (!(adj.amount > 0)) continue;
        const oy = Number(adj.originalYear);
        const om = Number(adj.originalMonth);
        const ay = Number(adj.adjustedYear);
        const am = Number(adj.adjustedMonth);
        if (oy === -1 || om === -1 || ay === -1 || am === -1) continue;
        if (!Number.isFinite(oy) || !Number.isFinite(om) || !Number.isFinite(ay) || !Number.isFinite(am)) {
            console.warn('[generateBudgetedBills] 跳过无效合同账期调整（年月非数字）', adj);
            continue;
        }

        const sourceBill = resolveBillForContractPeriodMonth(bills, om, oy);
        if (!sourceBill) {
            console.warn('[generateBudgetedBills] 合同账期调整未找到原收款月账单，已跳过（避免误加金额）', adj);
            continue;
        }

        let destBill = resolveBillForContractPeriodMonth(bills, am, ay, sourceBill.date.getFullYear());
        if (!destBill) {
            const syntheticDate = syntheticReceivableDateForShiftedMonth(sourceBill, am);
            destBill = {
                date: syntheticDate,
                amount: 0,
            };
            bills.push(destBill);
        }

        sourceBill.amount -= adj.amount;
        if (sourceBill.amount < 0) sourceBill.amount = 0;
        destBill.amount += adj.amount;
    }

    // --- POST-PROCESS ADJUSTMENTS (Robust 2-Pass Method) ---
    const tenantAdjustments = adjustments.filter(a => a.tenantId === tenant.id);

    // Pass 1: Additions
    tenantAdjustments.forEach(adj => {
        if (adj.adjustedYear !== -1 && adj.adjustedMonth !== -1) {
            const existingBill = bills.find(b =>
                b.date.getFullYear() === adj.adjustedYear &&
                b.date.getMonth() === adj.adjustedMonth
            );

            if (existingBill) {
                existingBill.amount += adj.amount;
            } else {
                bills.push({
                    date: new Date(adj.adjustedYear, adj.adjustedMonth, 1),
                    amount: adj.amount
                });
            }
        }
    });

    // Pass 2: Subtractions
    tenantAdjustments.forEach(adj => {
        if (adj.originalYear !== -1 && adj.originalMonth !== -1) {
            const sourceBill = bills.find(b => 
                b.date.getFullYear() === adj.originalYear && 
                b.date.getMonth() === adj.originalMonth
            );

            if (sourceBill) {
                sourceBill.amount -= adj.amount;
                if (sourceBill.amount < 0) sourceBill.amount = 0;
            }
        }
    });

    // 首期应收自定义（优先按日期最早的账单覆盖金额与覆盖期）
    const fra = tenant.firstReceivableAmount;
    const unitTermRowsForFirstRec =
        (Array.isArray(tenant.unitTerms) && tenant.unitTerms.length > 0
            ? tenant.unitTerms
            : Array.isArray(tenant.paymentTerms)
              ? tenant.paymentTerms
              : []
        ).filter((term) => (term.monthlyRent || term.unitPrice) && term.area > 0);
    /** 分房源合并后的覆盖期非单一租金流，顺延重算会与合并结果不一致，仅覆盖首期金额/区间。 */
    const skipFirstReceivableShiftRecalc = unitTermRowsForFirstRec.length > 0;

    if (fra != null && fra > 0 && bills.length > 0) {
        let minIdx = 0;
        for (let i = 1; i < bills.length; i++) {
            if (bills[i].date.getTime() < bills[minIdx].date.getTime()) minIdx = i;
        }
        bills[minIdx].amount = round2(fra);
        if (tenant.firstReceivableStartDate) {
            bills[minIdx].coverageStart = parseDateLocal(tenant.firstReceivableStartDate);
        }
        if (tenant.firstReceivableEndDate) {
            bills[minIdx].coverageEnd = parseDateLocal(tenant.firstReceivableEndDate);
        }

        // 当设定了首期覆盖起止日期时，后续账期从首期覆盖止+1天开始（绝对重锚），
        // 避免相对月份偏移导致的日期精度丢失（如 17 天首期被按 0.57 月偏移后差 1 天）。
        const hasCustomCoverageRange = !!tenant.firstReceivableStartDate && !!tenant.firstReceivableEndDate;
        if (hasCustomCoverageRange && bills.length > 1) {
            const firstEnd = parseDateLocal(tenant.firstReceivableEndDate!);
            const order = bills
                .map((bill, idx) => ({ idx, time: bill.date.getTime() }))
                .sort((a, b) => a.time - b.time);
            let nextCoverageStart = new Date(firstEnd);
            nextCoverageStart.setDate(nextCoverageStart.getDate() + 1);

            for (let i = 1; i < order.length; i++) {
                const idx = order[i].idx;

                // 绝对重锚覆盖期起点
                bills[idx].coverageStart = new Date(nextCoverageStart);
                const rawEnd = addCycleMonths(new Date(nextCoverageStart), regularCycleMonths);
                rawEnd.setDate(rawEnd.getDate() - 1);
                const adjustedEnd = rawEnd > effectiveLeaseEnd ? new Date(effectiveLeaseEnd) : rawEnd;
                bills[idx].coverageEnd = adjustedEnd;

                // 从新覆盖期起点推算收款日，计入合同级账期偏移
                bills[idx].date = addCalendarMonths(
                    new Date(nextCoverageStart.getFullYear(), nextCoverageStart.getMonth(), nextCoverageStart.getDate()),
                    receivableMonthOffset,
                );
                const existingAsmForShift = assumptions.find((a) => a.targetId === tenant.id && a.targetType === 'Existing');
                const billingShift = (existingAsmForShift?.billingCycleShiftMonths ?? 0) + (tenant.paymentPeriodShiftMonths || 0);
                if (billingShift !== 0) {
                    bills[idx].date = addCalendarMonths(bills[idx].date, billingShift);
                }

                if (bills[idx].coverageStart > effectiveLeaseEnd) {
                    bills[idx].amount = 0;
                    nextCoverageStart = new Date(adjustedEnd);
                    nextCoverageStart.setDate(nextCoverageStart.getDate() + 1);
                    continue;
                }

                // 首期覆盖期重锚后必须按新覆盖期重算（含免租）；仅「无自定义覆盖期 + 分房源」时保留合并金额
                if (!skipFirstReceivableShiftRecalc || hasCustomCoverageRange) {
                    bills[idx].amount = computeDeductModeAmountForCoverage(
                        tenant,
                        bills[idx].coverageStart!,
                        adjustedEnd,
                        monthlyRent,
                        unitTermRowsForFirstRec.length > 0 ? unitTermRowsForFirstRec : undefined,
                    );
                }

                nextCoverageStart = new Date(adjustedEnd);
                nextCoverageStart.setDate(nextCoverageStart.getDate() + 1);
            }
        } else if (!skipFirstReceivableShiftRecalc && !hasCustomCoverageRange) {
            // 仅有首期应收金额而无自定义覆盖期时，按金额比例推算偏移
            const firstCycleMonthsDefault = tenant.firstPaymentMonths && tenant.firstPaymentMonths > 0
                ? tenant.firstPaymentMonths
                : regularCycleMonths;
            const customFirstCycleMonths = monthlyRent > 0
                ? Number((fra / monthlyRent).toFixed(2))
                : firstCycleMonthsDefault;
            const shiftMonths = Number((customFirstCycleMonths - firstCycleMonthsDefault).toFixed(2));
            if (Math.abs(shiftMonths) >= 0.01) {
                const order = bills
                    .map((bill, idx) => ({ idx, time: bill.date.getTime() }))
                    .sort((a, b) => a.time - b.time);
                for (let i = 1; i < order.length; i++) {
                    const idx = order[i].idx;
                    bills[idx].date = addCycleMonths(bills[idx].date, shiftMonths);
                    if (bills[idx].coverageStart) {
                        bills[idx].coverageStart = addCycleMonths(bills[idx].coverageStart, shiftMonths);
                    }
                    if (bills[idx].coverageEnd) {
                        bills[idx].coverageEnd = addCycleMonths(bills[idx].coverageEnd, shiftMonths);
                    }

                    if (bills[idx].coverageStart && bills[idx].coverageStart > effectiveLeaseEnd) {
                        bills[idx].amount = 0;
                        continue;
                    }
                    if (bills[idx].coverageStart && bills[idx].coverageEnd) {
                        const adjustedCoverageEnd = bills[idx].coverageEnd > effectiveLeaseEnd
                            ? new Date(effectiveLeaseEnd)
                            : bills[idx].coverageEnd;
                        bills[idx].coverageEnd = adjustedCoverageEnd;

                        let adjustedAmount = calculateRentForDuration(
                            bills[idx].coverageStart,
                            adjustedCoverageEnd,
                            monthlyRent
                        );
                        let adjustedDeduction = 0;
                        if (tenant.rentFreePeriods) {
                            tenant.rentFreePeriods.forEach(rf => {
                                const rfStart = parseDateLocal(rf.start);
                                const rfEnd = parseDateLocal(rf.end);
                                const overlapStart = rfStart > bills[idx].coverageStart! ? rfStart : bills[idx].coverageStart!;
                                const overlapEnd = rfEnd < adjustedCoverageEnd ? rfEnd : adjustedCoverageEnd;
                                if (overlapStart <= overlapEnd) {
                                    adjustedDeduction += calculateRentFreeDeductionForPeriod(
                                        rf,
                                        overlapStart,
                                        overlapEnd,
                                        monthlyRent,
                                    );
                                }
                            });
                        }
                        bills[idx].amount = Math.max(0, round2(adjustedAmount - adjustedDeduction));
                    }
                }
            }
        }
    }

    bills.forEach((b) => {
        if (b.grossAmount == null && !b.earlyTerminationExtraDetail) {
            b.grossAmount = b.amount;
        }
    });
    applyContractFixedRentReductions(tenant, bills);

    if (applyEarlyTerm) {
        applyEarlyTerminationExtrasToBills(tenant, bills);
    }

    return bills.filter((b) => {
        if (Math.abs(b.amount) <= MIN_AMOUNT_THRESHOLD) return false;
        if (b.amount < 0 && !b.earlyTerminationExtraDetail) return false;
        return true;
    });
};
