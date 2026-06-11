import type { ParkInfo } from '../types';

export type ParkBillingFeatures = {
    managementFeeBilling: boolean;
    receivableMonthOffset: -1 | 0;
    /** 租金单价展示与录入默认口径（深圳为月单价 元/㎡/月） */
    defaultRentUnitPriceMode?: 'daily' | 'monthly';
    defaultManagementFeeUnitPriceMode?: 'daily' | 'monthly';
};

const DEFAULT_BY_PROJECT: Record<string, ParkBillingFeatures> = {
    shanghai_park: { managementFeeBilling: false, receivableMonthOffset: -1 },
    beijing_park: { managementFeeBilling: false, receivableMonthOffset: -1 },
    shenzhen_park: {
        managementFeeBilling: true,
        receivableMonthOffset: 0,
        defaultRentUnitPriceMode: 'monthly',
        defaultManagementFeeUnitPriceMode: 'monthly',
    },
};

export function getParkBillingFeatures(projectId: string | undefined, parks?: ParkInfo[]): ParkBillingFeatures {
    const pid = (projectId || '').trim();
    const fromPark = parks?.find((p) => p.projectId === pid)?.billingFeatures;
    if (fromPark) {
        return {
            managementFeeBilling: !!fromPark.managementFeeBilling,
            receivableMonthOffset: fromPark.receivableMonthOffset === 0 ? 0 : -1,
            defaultRentUnitPriceMode: fromPark.defaultRentUnitPriceMode,
            defaultManagementFeeUnitPriceMode: fromPark.defaultManagementFeeUnitPriceMode,
        };
    }
    return DEFAULT_BY_PROJECT[pid] ?? { managementFeeBilling: false, receivableMonthOffset: -1 };
}

export function prefersMonthlyRentUnitPrice(projectId: string | undefined, parks?: ParkInfo[]): boolean {
    return getParkBillingFeatures(projectId, parks).defaultRentUnitPriceMode === 'monthly';
}

export function isManagementFeeBillingEnabled(projectId: string | undefined, parks?: ParkInfo[]): boolean {
    return getParkBillingFeatures(projectId, parks).managementFeeBilling;
}

export function getReceivableMonthOffsetForProject(projectId: string | undefined, parks?: ParkInfo[]): number {
    return getParkBillingFeatures(projectId, parks).receivableMonthOffset;
}

/** 起租日 YYYY-MM-DD 的「日」部分；解析失败返回 null */
export function leaseStartDayOfMonth(leaseStart?: string): number | null {
    if (!leaseStart?.trim()) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(leaseStart.trim());
    if (!m) return null;
    const day = Number(m[3]);
    return Number.isFinite(day) ? day : null;
}

/**
 * 北京园区 28–31 日起租：合同约定首期及后续收款日在起租当月 / 对应自然月，
 * 不按「覆盖期开始月 − 1」推算（与深圳同为 offset 0）。
 */
export function isBeijingLateMonthLeaseStart(projectId?: string, leaseStart?: string): boolean {
    if ((projectId || '').trim() !== 'beijing_park') return false;
    const day = leaseStartDayOfMonth(leaseStart);
    return day != null && day >= 28 && day <= 31;
}

/** 季付合同约定的固定收款日（每年 1/4/7/10 月 1 日） */
const QUARTERLY_RECEIVABLE_MONTHS = [0, 3, 6, 9] as const;

/**
 * 北京 28–31 日起租且季付：收款日对齐到覆盖期当月或次月的合同约定锚点（1/4/7/10 月 1 日），
 * 避免覆盖期从 3/31 起算时账单日落在 3/31 而非 4/1。
 */
export function snapBeijingLateMonthReceivableBillDate(
    coverageStart: Date,
    tentativeBillDate: Date,
    projectId?: string,
    leaseStart?: string,
    paymentCycle?: string,
): Date {
    if (!isBeijingLateMonthLeaseStart(projectId, leaseStart)) return tentativeBillDate;
    if (paymentCycle !== 'Quarterly') return tentativeBillDate;

    const cs = new Date(
        coverageStart.getFullYear(),
        coverageStart.getMonth(),
        coverageStart.getDate(),
    ).getTime();
    const candidates: Date[] = [];
    for (const y of [coverageStart.getFullYear(), coverageStart.getFullYear() + 1]) {
        for (const m of QUARTERLY_RECEIVABLE_MONTHS) {
            candidates.push(new Date(y, m, 1));
        }
    }
    candidates.sort((a, b) => a.getTime() - b.getTime());
    for (const anchor of candidates) {
        if (anchor.getTime() >= cs) return anchor;
    }
    return new Date(coverageStart.getFullYear() + 1, 0, 1);
}

/** 账单日是否与覆盖期开始日处于同一自然月（offset 0） */
export function usesSameMonthReceivableBillDate(
    tenant: Pick<{ projectId?: string; leaseStart?: string }, 'projectId' | 'leaseStart'>,
    parks?: ParkInfo[],
): boolean {
    const projectId = (tenant.projectId || '').trim();
    if (isBeijingLateMonthLeaseStart(projectId, tenant.leaseStart)) return true;
    if (projectId && getReceivableMonthOffsetForProject(projectId, parks) === 0) return true;
    return false;
}
