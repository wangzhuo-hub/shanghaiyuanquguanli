import type { AuthUser, BudgetAssumption, DashboardData, MonthlyTrend, Tenant } from '../types';
import { canViewRentPricing } from './receivablePermissions';

const RENT_PAYMENT_TYPES = new Set(['Rent', 'DepositToRent', 'Deposit', 'DepositRefund']);

function stripRentPricingFromTenant(t: Tenant): Tenant {
    return {
        ...t,
        unitPrice: undefined,
        unitPriceMode: undefined,
        monthlyRent: undefined as unknown as number,
        rentFreePeriods: [],
        freeRentHandling: undefined,
        depositAmount: undefined as unknown as number,
        unitTerms: (t.unitTerms || []).map((term) => ({
            ...term,
            unitPrice: undefined,
            monthlyRent: undefined as unknown as number,
            rentFreePeriods: [],
        })),
        paymentTerms: (t.paymentTerms || []).map((term) => ({
            ...term,
            unitPrice: undefined,
            monthlyRent: undefined as unknown as number,
            rentFreePeriods: [],
        })),
    };
}

function stripRentFromAssumption(a: BudgetAssumption): BudgetAssumption {
    const next = { ...a };
    if (next.priceAdjustment) {
        next.priceAdjustment = { ...next.priceAdjustment, newUnitPrice: 0 };
    }
    return next;
}

function stripRentFromBillingNotes(notes: Record<string, string> | undefined): Record<string, string> {
    if (!notes) return {};
    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(notes)) {
        if (key.startsWith('__defer__') || key.startsWith('__budget_') || key.includes('mgmt')) {
            next[key] = value;
            continue;
        }
        if (key.includes('rentCollection') || key.includes('###')) continue;
        if (value.includes('租金') || value.includes('Rent')) continue;
        next[key] = value;
    }
    return next;
}

const emptyTrends = (): MonthlyTrend[] => [];

/** 对 hide_rent_pricing 账号裁剪租金价格与租金类流水（仍可看物业费与基础档案） */
export function applyDashboardDataScope(data: DashboardData, user: AuthUser | null | undefined): DashboardData {
    if (!data || canViewRentPricing(user)) return data;

    const tenants = (data.tenants || []).map(stripRentPricingFromTenant);
    const payments = (data.payments || []).filter((p) => !RENT_PAYMENT_TYPES.has(p.type));

    const budgetScenarios = (data.budgetScenarios || []).map((s) => {
        if (!s.baseDataSnapshot?.tenants) return s;
        return {
            ...s,
            baseDataSnapshot: {
                ...s.baseDataSnapshot,
                tenants: s.baseDataSnapshot.tenants.map(stripRentPricingFromTenant),
            },
        };
    });

    const budgetAssumptions = (data.budgetAssumptions || []).map(stripRentFromAssumption);
    const billingPeriodNotes = stripRentFromBillingNotes(data.billingPeriodNotes);

    const scrubTrend = (t: MonthlyTrend): MonthlyTrend => ({
        ...t,
        revenueTarget: 0,
        revenueCollected: 0,
        contractReceivable: 0,
        collectionRate: 0,
    });

    return {
        ...data,
        tenants,
        payments,
        budgetScenarios,
        budgetAssumptions,
        billingPeriodNotes,
        budgetAnalysis: { occupancy: data.budgetAnalysis?.occupancy || '', revenue: '' },
        yearlyTargets: {},
        annualRevenueTarget: 0,
        annualRevenueCollected: 0,
        monthlyRevenueTarget: 0,
        monthlyRevenueCollected: 0,
        collectionRate: 0,
        accumulatedArrears: 0,
        monthlyTrends: emptyTrends(),
        prevYearMonthlyTrends: emptyTrends(),
        currentMonthBilling: (data.currentMonthBilling || []).filter((b) => b.feeKind === 'management_fee'),
    };
}

/** 本地缓存合并后再次裁剪（园区切换 fallback 路径） */
export function scopeCachedDashboardData(
    data: DashboardData,
    user: AuthUser | null | undefined,
    expectedProjectId: string,
): DashboardData {
    const scoped = applyDashboardDataScope(data, user);
    if (!expectedProjectId) return scoped;
    return {
        ...scoped,
        tenants: (scoped.tenants || []).map((t) => ({ ...t, projectId: t.projectId || expectedProjectId })),
    };
}
