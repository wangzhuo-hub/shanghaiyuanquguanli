import type { AuthUser, DashboardData, Tenant } from '../types';
import { canViewRentPricing } from './receivablePermissions';

function stripRentPricingFromTenant(t: Tenant): Tenant {
    return {
        ...t,
        unitPrice: undefined,
        unitPriceMode: undefined,
        monthlyRent: 0,
        rentFreePeriods: [],
        freeRentHandling: undefined,
        depositAmount: 0,
        unitTerms: (t.unitTerms || []).map((term) => ({
            ...term,
            unitPrice: undefined,
            monthlyRent: 0,
            rentFreePeriods: [],
        })),
        paymentTerms: (t.paymentTerms || []).map((term) => ({
            ...term,
            unitPrice: undefined,
            monthlyRent: 0,
            rentFreePeriods: [],
        })),
    };
}

/** 对 hide_rent_pricing 账号裁剪租金价格与租金类流水（仍可看物业费与基础档案） */
export function applyDashboardDataScope(data: DashboardData, user: AuthUser | null | undefined): DashboardData {
    if (!data || canViewRentPricing(user)) return data;

    const tenants = (data.tenants || []).map(stripRentPricingFromTenant);
    const payments = (data.payments || []).filter((p) => p.type !== 'Rent' && p.type !== 'DepositToRent');

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

    return {
        ...data,
        tenants,
        payments,
        budgetScenarios,
    };
}
