import type { BudgetAssumption, RentFreePeriod, Tenant } from '../types';
import {
    getParkBillingFeatures,
    getReceivableMonthOffsetForProject,
    usesSameMonthReceivableBillDate,
} from './parkBillingConfig';

/** 最小金额阈值（低于此值视为零，用于舍入和过滤） */
export const MIN_AMOUNT_THRESHOLD = 0.005;
/** 日租金计算基准天数（月租金 / 30） */
export const DAILY_RENT_BASE_DAYS = 30;
/** 计费循环安全迭代上限 */
export const BILLING_LOOP_LIMIT = 300;
/** 租约永不到期哨兵日期（无 leaseEnd 时的默认值） */
export const FAR_FUTURE_DATE = '2099-12-31';

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** 根据 unitPriceMode 将单价转换为月租金 */
export const monthlyRentFromUnitPrice = (unitPrice: number, area: number, mode?: 'daily' | 'monthly'): number => {
    if (mode === 'monthly') return unitPrice * area;
    return (unitPrice * area * 365) / 12;
};

/** 天单价 -> 月单价（元/㎡/月） */
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

// Helper to parse "YYYY-MM-DD" string into a Local Date object (00:00:00)
// This avoids UTC offsets issues where "2026-06-01" becomes "2026-05-31" in some timezones
export const parseDateLocal = (dateInput: string | Date | undefined): Date => {
    if (!dateInput) return new Date();
    if (dateInput instanceof Date) return new Date(dateInput.getFullYear(), dateInput.getMonth(), dateInput.getDate());

    const parts = dateInput.split('-').map(Number);
    if (parts.length === 3) {
        return new Date(parts[0], parts[1] - 1, parts[2]);
    }
    return new Date(dateInput);
};

export const farFutureDate = (): Date => parseDateLocal(FAR_FUTURE_DATE);

/** 当月应收账期园区清单（全园区统一 offset 0）。 */
export const SAME_MONTH_RECEIVABLE_PROJECT_IDS: ReadonlySet<string> = new Set(['shenzhen_park']);

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

/** 确保 Date 输出为本地日期字符串 "YYYY-MM-DD"（避免 toISOString UTC 偏移） */
export const toLocalDateString = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

/** 按日历月加减月份，收款日落在目标自然月内（避免起租日 28-31 日时用 setMonth 溢出到其他月） */
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
    return overlapStart <= overlapEnd ? getDaysDiff(overlapStart, overlapEnd) : 0;
};

export const isRentFreeDate = (date: Date, rentFreePeriods: RentFreePeriod[]): boolean => {
    if (!rentFreePeriods || rentFreePeriods.length === 0) return false;
    const checkTime = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

    return rentFreePeriods.some((rf) => {
        const start = parseDateLocal(rf.start).getTime();
        const end = parseDateLocal(rf.end).getTime();
        return checkTime >= start && checkTime <= end;
    });
};

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

export const getContractMonthEnd = (start: Date, anchorDay: number): Date => {
    const y = start.getFullYear();
    const m = start.getMonth();
    const next = new Date(y, m + 1, anchorDay);
    if (next.getMonth() !== (m + 1) % 12) {
        return new Date(y, m + 2, 0);
    }
    next.setDate(next.getDate() - 1);
    return next;
};

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
        const calendarMonthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
        const contractMonthEnd = getContractMonthEnd(cursor, anchorDay);
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

export const calculateRentFreeDeduction = (start: Date, end: Date, monthlyRent: number): number => {
    const normalizedStart = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const endExclusive = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    endExclusive.setDate(endExclusive.getDate() + 1);

    const monthDiff = (endExclusive.getFullYear() - normalizedStart.getFullYear()) * 12
        + (endExclusive.getMonth() - normalizedStart.getMonth());
    if (monthDiff > 0 && addCalendarMonths(normalizedStart, monthDiff).getTime() === endExclusive.getTime()) {
        return monthDiff * monthlyRent;
    }

    const days = getDaysDiff(normalizedStart, end);
    const halfMonths = Math.max(0.5, Math.round(days / 15) * 0.5);
    return halfMonths * monthlyRent;
};

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

export const pickVacancyAssumptionsForTenant = (
    tenant: Pick<Tenant, 'unitIds'>,
    assumptions: BudgetAssumption[],
): BudgetAssumption[] => {
    const uids = tenant.unitIds || [];
    return assumptions.filter(
        (a) => a.targetType === 'Vacancy' && !!a.projectedSignDate && uids.includes(a.targetId),
    );
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
