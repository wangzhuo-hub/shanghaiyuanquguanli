import type { BudgetAdjustment, BudgetAssumption, Tenant } from '../types';
import { generateBudgetedBills } from './billingService';

/** YYYY-MM */
export type YearMonth = string;

export type ReceivableVsCoverageIssue = {
    tenantId: string;
    tenantName: string;
    billIndex: number;
    collectionDate: string;
    /** 财务报表「应收核销」当前月口径：与收款日期所在自然月一致 */
    collectionMonth: YearMonth;
    coverageStart: string;
    coverageEnd: string;
    /**
     * 与覆盖区间相交的自然月（YYYY-MM），但其中不含收款日期所在月。
     * 在这些月份的应收列表里，该笔款项不会出现（全额记在收款月）。
     */
    serviceMonthsAttributedElsewhere: YearMonth[];
};

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 与 [start, end]（含首尾日）相交的所有自然月 YYYY-MM */
export function calendarMonthsOverlappingClosedRange(start: Date, end: Date): YearMonth[] {
    const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    if (s > e) return [];

    const out: YearMonth[] = [];
    let y = s.getFullYear();
    let m = s.getMonth();
    const endY = e.getFullYear();
    const endM = e.getMonth();

    while (y < endY || (y === endY && m <= endM)) {
        const monthStart = new Date(y, m, 1);
        const monthEnd = new Date(y, m + 1, 0);
        if (monthEnd >= s && monthStart <= e) {
            out.push(`${y}-${pad2(m + 1)}`);
        }
        m++;
        if (m > 11) {
            m = 0;
            y++;
        }
    }
    return out;
}

function formatLocalYMD(d: Date): string {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function collectionYearMonth(d: Date): YearMonth {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/**
 * 枚举「覆盖周期所含自然月」与「财务报表按收款日所在月记账」不一致的情况。
 * 季付/半年付/自定义首期等情形下大量合同都会出现此类条目——表示口径差异而非 necessarily 数据错误。
 */
export function auditReceivableMonthVsCoverageForTenants(
    tenants: Tenant[],
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    options?: {
        /** 仅扫描租期内这一段（默认 ±2 年窗口由 generateBudgetedBills 约束） */
        genStart?: Date;
        genEnd?: Date;
    }
): ReceivableVsCoverageIssue[] {
    const genStart = options?.genStart ?? new Date(new Date().getFullYear() - 2, 0, 1);
    const genEnd = options?.genEnd ?? new Date(new Date().getFullYear() + 3, 11, 31);

    const issues: ReceivableVsCoverageIssue[] = [];

    for (const tenant of tenants) {
        if (tenant.isSpecialBusiness) continue;

        const bills = generateBudgetedBills(tenant, assumptions, adjustments, genStart, genEnd);

        bills.forEach((b, billIndex) => {
            if (!b.coverageStart || !b.coverageEnd) return;
            const collMonth = collectionYearMonth(b.date);
            const overlapping = calendarMonthsOverlappingClosedRange(b.coverageStart, b.coverageEnd);
            const serviceMonthsAttributedElsewhere = overlapping.filter((ym) => ym !== collMonth);
            if (serviceMonthsAttributedElsewhere.length === 0) return;

            issues.push({
                tenantId: tenant.id,
                tenantName: tenant.name,
                billIndex,
                collectionDate: formatLocalYMD(b.date),
                collectionMonth: collMonth,
                coverageStart: formatLocalYMD(b.coverageStart),
                coverageEnd: formatLocalYMD(b.coverageEnd),
                serviceMonthsAttributedElsewhere,
            });
        });
    }

    return issues;
}
