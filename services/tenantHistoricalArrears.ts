import { BillingDetail, DashboardData } from '../types';
import {
    buildBillingDetailsForPeriod,
    createBillingCache,
} from './dashboardMetrics';
import {
    realTenantIdFromDeferInDisplayTenantId,
    realTenantIdFromSpecialBusinessAr,
} from './receivableListHelpers';
import { roundMoney2 } from './numberFormat';

export type TenantHistoricalArrearsSummary = {
    amount: number;
    months: number;
    latestPeriod?: string;
};

export type TenantHistoricalArrearsResult = {
    available: boolean;
    byTenantId: Map<string, TenantHistoricalArrearsSummary>;
    startPeriod?: string;
    endPeriod?: string;
    unavailableReason?: string;
};

export type TenantHistoricalArrearsBillingDetailFilter = (detail: BillingDetail) => boolean;

const ARREARS_START_YEAR = 2026;

const periodKey = (year: number, monthOneBased: number): string =>
    `${year}-${String(monthOneBased).padStart(2, '0')}`;

function receivableArrearsAmount(detail: BillingDetail): number {
    if (detail.status === 'Unpaid') return roundMoney2(detail.amountDue || 0);
    if (detail.status === 'Partial') return roundMoney2(Math.max(0, (detail.amountDue || 0) - (detail.amountPaid || 0)));
    return 0;
}

function resolveArrearsTenantId(detail: BillingDetail, knownTenantIds: Set<string>): string | null {
    const direct = detail.tenantId;
    if (direct && knownTenantIds.has(direct)) return direct;
    const deferRealId = direct ? realTenantIdFromDeferInDisplayTenantId(direct) : null;
    if (deferRealId && knownTenantIds.has(deferRealId)) return deferRealId;
    const specialRealId = direct ? realTenantIdFromSpecialBusinessAr(direct) : '';
    if (specialRealId && knownTenantIds.has(specialRealId)) return specialRealId;
    return null;
}

function addDetailArrears(
    detail: BillingDetail,
    period: string,
    knownTenantIds: Set<string>,
    byTenantId: Map<string, TenantHistoricalArrearsSummary>,
) {
    const amount = receivableArrearsAmount(detail);
    if (amount <= 0.005) return;
    const tenantId = resolveArrearsTenantId(detail, knownTenantIds);
    if (!tenantId) return;
    const previous = byTenantId.get(tenantId) || { amount: 0, months: 0 };
    byTenantId.set(tenantId, {
        amount: roundMoney2(previous.amount + amount),
        months: previous.months + 1,
        latestPeriod: period,
    });
}

/**
 * 客户级历史欠费筛选的唯一前端入口。
 *
 * 与 `dashboardMetrics` 园区累计欠款保持同一时间范围和状态口径：
 * - 从 2026-01 起算；
 * - 只统计到当前自然月的上月；
 * - Unpaid 取全额，Partial 取未收余额；
 * - 已封账月必须使用封账 `billingDetails` 明细，避免用后续合同/收款变更重算历史。
 */
export function buildTenantHistoricalArrears(input: {
    data: DashboardData;
    referenceDate?: Date;
    includeBillingDetail?: TenantHistoricalArrearsBillingDetailFilter;
}): TenantHistoricalArrearsResult {
    const { data } = input;
    const now = input.referenceDate || new Date();
    const nowYear = now.getFullYear();
    const nowMonthIndex = now.getMonth();
    const byTenantId = new Map<string, TenantHistoricalArrearsSummary>();
    const knownTenantIds = new Set((data.tenants || []).map((tenant) => tenant.id).filter(Boolean));

    const sealedByKey = new Map<string, NonNullable<DashboardData['sealedMonths']>[number]>();
    for (const sealed of data.sealedMonths || []) {
        if (!Number.isFinite(sealed.year) || !Number.isFinite(sealed.month)) continue;
        sealedByKey.set(`${sealed.year}-${sealed.month}`, sealed);
    }

    const cache = createBillingCache(data.buildings || [], data.payments || [], data.initializationData || []);
    let startPeriod: string | undefined;
    let endPeriod: string | undefined;

    for (let year = ARREARS_START_YEAR; year <= nowYear; year += 1) {
        const endMonthIndex = year === nowYear ? nowMonthIndex - 1 : 11;
        if (endMonthIndex < 0) continue;
        for (let monthIndex = 0; monthIndex <= endMonthIndex; monthIndex += 1) {
            const monthOneBased = monthIndex + 1;
            const key = `${year}-${monthOneBased}`;
            const period = periodKey(year, monthOneBased);
            if (!startPeriod) startPeriod = period;
            endPeriod = period;

            const sealed = sealedByKey.get(key);
            let details: BillingDetail[];
            if (sealed) {
                if (!Array.isArray(sealed.billingDetails)) {
                    return {
                        available: false,
                        byTenantId: new Map(),
                        startPeriod,
                        endPeriod,
                        unavailableReason: `封账月 ${period} 缺少客户级应收明细，不能可靠拆分历史欠费。`,
                    };
                }
                details = sealed.billingDetails;
            } else {
                details = buildBillingDetailsForPeriod(year, monthIndex, data, cache);
            }

            for (const detail of details) {
                if (input.includeBillingDetail && !input.includeBillingDetail(detail)) continue;
                addDetailArrears(detail, period, knownTenantIds, byTenantId);
            }
        }
    }

    return {
        available: true,
        byTenantId,
        startPeriod,
        endPeriod,
    };
}
