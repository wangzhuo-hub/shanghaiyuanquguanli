import type { MonthlyInitData } from '../types';

export const SHANGHAI_PARK_ID = 'shanghai_park';

/** 上海园区：将历史「月度应收」并入「年初预算」展示/落库，并清零 revenueTarget */
export function migrateShanghaiInitRow(row: MonthlyInitData): MonthlyInitData {
    const ib = Number(row.initialBudget);
    const rt = Number(row.revenueTarget);
    const hasIb = Number.isFinite(ib) && ib > 0.005;
    const hasRt = Number.isFinite(rt) && rt > 0.005;
    if (hasIb) {
        return { ...row, revenueTarget: 0 };
    }
    if (hasRt) {
        return { ...row, initialBudget: Math.round(rt), revenueTarget: 0 };
    }
    return { ...row, revenueTarget: 0 };
}

/** 初始化数据用于「预算执行」月度目标的口径（上海读年初预算+历史应收；其它园区仍读 revenueTarget） */
export function resolveInitMonthRevenueTarget(
    entry: MonthlyInitData | undefined,
    projectId: string | undefined
): number {
    if (!entry) return 0;
    if (projectId === SHANGHAI_PARK_ID) {
        const ib = Number(entry.initialBudget);
        if (Number.isFinite(ib) && ib > 0.005) return Math.round(ib);
        const rt = Number(entry.revenueTarget);
        if (Number.isFinite(rt) && rt > 0.005) return Math.round(rt);
        return 0;
    }
    const rt = Number(entry.revenueTarget);
    return Number.isFinite(rt) && rt > 0.005 ? Math.round(rt) : 0;
}

/** 年初预算按月汇总（上海含历史 revenueTarget 回退） */
export function resolveInitMonthInitialBudget(
    entry: MonthlyInitData | undefined,
    projectId: string | undefined
): number {
    if (!entry) return 0;
    if (projectId === SHANGHAI_PARK_ID) {
        return resolveInitMonthRevenueTarget(entry, projectId);
    }
    const ib = Number(entry.initialBudget);
    return Number.isFinite(ib) && ib > 0.005 ? Number(ib) : 0;
}
