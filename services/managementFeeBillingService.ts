import type { PaymentCycle, RentFreePeriod, Tenant } from '../types';
import {
    BILLING_LOOP_LIMIT,
    BudgetedBill,
    addCalendarMonths,
    calculateRentForDuration,
    farFutureDate,
    getReceivableMonthOffsetForTenant,
    parseDateLocal,
} from './billingService';
import { roundMoney2 } from './numberFormat';
import { isManagementFeeBillingEnabled } from './parkBillingConfig';

export type ManagementFeeCardStatus = {
    parkEnabled: boolean;
    collecting: boolean;
    exempt: boolean;
    disabled: boolean;
    needsSetup: boolean;
    monthlyUnitPrice?: number;
    monthlyAmount: number;
};

/** 合同列表卡片：物业费收取状态与展示金额 */
export function getManagementFeeCardStatus(tenant: Tenant, projectIdFallback?: string): ManagementFeeCardStatus {
    const projectId = tenant.projectId || projectIdFallback || '';
    const parkEnabled = isManagementFeeBillingEnabled(projectId);
    if (!parkEnabled) {
        return {
            parkEnabled: false,
            collecting: false,
            exempt: false,
            disabled: true,
            needsSetup: false,
            monthlyAmount: 0,
        };
    }
    const exempt = !!tenant.managementFeeExempt;
    const disabled = tenant.managementFeeEnabled === false;
    const monthlyUnitPrice = toManagementFeeMonthlyUnitPrice(
        tenant.managementFeeUnitPrice,
        tenant.managementFeeUnitPriceMode,
    );
    const monthlyAmount = resolveManagementFeeMonthly(tenant);
    const collecting = !exempt && !disabled && shouldGenerateManagementFeeBills(tenant);
    const needsSetup =
        !exempt && !disabled && tenant.managementFeeEnabled !== false && monthlyAmount <= 0;
    return {
        parkEnabled,
        collecting,
        exempt,
        disabled,
        needsSetup,
        monthlyUnitPrice,
        monthlyAmount,
    };
}

const round2 = (n: number) => roundMoney2(n);

const resolveCycleMonths = (tenant: Tenant): number => {
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
    if (wholeMonths !== 0) next.setMonth(next.getMonth() + wholeMonths);
    if (fractionalMonths !== 0) next.setDate(next.getDate() + Math.round(fractionalMonths * 30));
    return next;
};

/** 招商合同入驻日：实际入驻日优先，未填则起租日 */
export function resolveLeaseOccupancyDate(tenant: Tenant): string | undefined {
    const moveIn = tenant.moveInDate?.trim();
    if (moveIn) return moveIn;
    const leaseStart = tenant.leaseStart?.trim();
    return leaseStart || undefined;
}

/** 物业费起算日（用于计费覆盖起点） */
export function resolveManagementFeeAccrualStartDate(tenant: Tenant): string | undefined {
    if (tenant.managementFeeStartWithOccupancy !== false) {
        return resolveLeaseOccupancyDate(tenant);
    }
    const custom = tenant.managementFeeStartDate?.trim();
    if (custom) return custom;
    return resolveLeaseOccupancyDate(tenant);
}

/** 物业费单价统一为 元/月/㎡；历史 daily 数据按 元/㎡·天 换算为月单价 */
export function toManagementFeeMonthlyUnitPrice(
    unitPrice: number | undefined,
    mode?: 'daily' | 'monthly',
): number | undefined {
    if (unitPrice == null || !(unitPrice > 0)) return undefined;
    if (mode === 'daily') return round2((unitPrice * 365) / 12);
    return round2(unitPrice);
}

export function resolveManagementFeeMonthly(tenant: Tenant): number {
    if (tenant.managementFeeExempt) return 0;
    if (tenant.managementFeeEnabled === false) return 0;
    const area = tenant.totalArea || 0;
    const monthlyUnitPrice = toManagementFeeMonthlyUnitPrice(
        tenant.managementFeeUnitPrice,
        tenant.managementFeeUnitPriceMode,
    );
    if (monthlyUnitPrice && monthlyUnitPrice > 0 && area > 0) {
        return round2(monthlyUnitPrice * area);
    }
    const fixed = tenant.managementFeeMonthlyAmount;
    if (typeof fixed === 'number' && fixed > 0) return round2(fixed);
    return 0;
}

function deductManagementFeeFree(
    gross: number,
    coverageStart: Date,
    coverageEnd: Date,
    periods: RentFreePeriod[],
    monthlyFee: number,
): number {
    if (!periods?.length || gross <= 0) return gross;
    let deduction = 0;
    for (const rf of periods) {
        const rfStart = parseDateLocal(rf.start);
        const rfEnd = parseDateLocal(rf.end);
        const overlapStart = rfStart > coverageStart ? rfStart : coverageStart;
        const overlapEnd = rfEnd < coverageEnd ? rfEnd : coverageEnd;
        if (overlapStart <= overlapEnd) {
            deduction += calculateRentForDuration(overlapStart, overlapEnd, monthlyFee);
        }
    }
    return Math.max(0, round2(gross - deduction));
}

/** 是否应为该租户生成物业费账单 */
export function shouldGenerateManagementFeeBills(tenant: Tenant): boolean {
    if (tenant.isSpecialBusiness) return false;
    if (tenant.managementFeeExempt) return false;
    if (tenant.managementFeeEnabled === false) return false;
    return resolveManagementFeeMonthly(tenant) > 0;
}

/**
 * 物业费账单：与租金同付款周期与账期偏移，不读取租金免租；支持 managementFeeFreePeriods 按天扣减。
 */
export function generateManagementFeeBills(
    tenant: Tenant,
    startDateConstraint: Date,
    endDateConstraint: Date,
): BudgetedBill[] {
    if (!shouldGenerateManagementFeeBills(tenant)) return [];
    const accrualStartStr = resolveManagementFeeAccrualStartDate(tenant);
    if (!accrualStartStr) return [];

    const monthlyFee = resolveManagementFeeMonthly(tenant);
    if (monthlyFee <= 0) return [];

    const feeAccrualStart = parseDateLocal(accrualStartStr);
    const leaseEnd = tenant.leaseEnd ? parseDateLocal(tenant.leaseEnd) : farFutureDate();
    const terminationDate = tenant.terminationDate ? parseDateLocal(tenant.terminationDate) : null;
    const effectiveLeaseEnd = terminationDate && terminationDate < leaseEnd ? terminationDate : leaseEnd;
    if (feeAccrualStart > effectiveLeaseEnd) return [];

    const receivableMonthOffset = getReceivableMonthOffsetForTenant(tenant);
    const regularCycleMonths = resolveCycleMonths(tenant);
    const firstCycleMonths =
        tenant.firstPaymentMonths && tenant.firstPaymentMonths > 0 ? tenant.firstPaymentMonths : regularCycleMonths;
    const freePeriods = tenant.managementFeeFreePeriods || [];

    const firstPaymentDate =
        tenant.managementFeeFirstPaymentDate || tenant.firstPaymentDate || '';

    const bills: BudgetedBill[] = [];
    const feeAccrualStartDay = new Date(
        feeAccrualStart.getFullYear(),
        feeAccrualStart.getMonth(),
        feeAccrualStart.getDate(),
    );
    let currentBillDate = firstPaymentDate
        ? parseDateLocal(firstPaymentDate)
        : addCalendarMonths(feeAccrualStartDay, receivableMonthOffset);

    let coverageStart = new Date(feeAccrualStart);
    let isFirstCycle = true;
    let safetyCounter = 0;
    const loopLimitDate = new Date(endDateConstraint);
    loopLimitDate.setFullYear(loopLimitDate.getFullYear() + 2);

    while (coverageStart <= effectiveLeaseEnd && safetyCounter < BILLING_LOOP_LIMIT) {
        safetyCounter++;
        const durationMonths = isFirstCycle ? firstCycleMonths : regularCycleMonths;
        const coverageEnd = addCycleMonths(coverageStart, durationMonths);
        coverageEnd.setDate(coverageEnd.getDate() - 1);
        const effectiveCoverageEnd = coverageEnd > effectiveLeaseEnd ? effectiveLeaseEnd : coverageEnd;

        const fullCycleDays =
            Math.ceil((coverageEnd.getTime() - coverageStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
        const actualDays =
            Math.ceil((effectiveCoverageEnd.getTime() - coverageStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        let grossAmount = 0;
        if (actualDays >= fullCycleDays - 5) {
            grossAmount = monthlyFee * durationMonths;
        } else {
            grossAmount = calculateRentForDuration(coverageStart, effectiveCoverageEnd, monthlyFee);
        }

        grossAmount = deductManagementFeeFree(
            grossAmount,
            coverageStart,
            effectiveCoverageEnd,
            freePeriods,
            monthlyFee,
        );

        if (grossAmount > 0.005) {
            bills.push({
                date: new Date(currentBillDate),
                amount: round2(grossAmount),
                coverageStart: new Date(coverageStart),
                coverageEnd: new Date(effectiveCoverageEnd),
            });
        }

        coverageStart = new Date(effectiveCoverageEnd);
        coverageStart.setDate(coverageStart.getDate() + 1);
        currentBillDate = addCalendarMonths(
            new Date(coverageStart.getFullYear(), coverageStart.getMonth(), coverageStart.getDate()),
            receivableMonthOffset,
        );
        isFirstCycle = false;
        if (coverageStart > loopLimitDate) break;
    }

    return bills;
}
