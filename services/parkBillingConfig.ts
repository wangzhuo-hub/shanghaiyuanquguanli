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
