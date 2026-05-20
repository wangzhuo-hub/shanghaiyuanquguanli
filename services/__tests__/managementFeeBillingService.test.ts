import { describe, expect, it } from 'vitest';
import type { Tenant } from '../../types';
import {
    resolveLeaseOccupancyDate,
    resolveManagementFeeAccrualStartDate,
    generateManagementFeeBills,
    resolveManagementFeeMonthly,
    toManagementFeeMonthlyUnitPrice,
} from '../managementFeeBillingService';
import { parseDateLocal } from '../billingService';

const baseTenant = (): Tenant =>
    ({
        id: 't1',
        name: '测试',
        projectId: 'shenzhen_park',
        leaseStart: '2024-01-01',
        leaseEnd: '2025-12-31',
        managementFeeEnabled: true,
        managementFeeUnitPrice: 10,
        managementFeeUnitPriceMode: 'monthly',
        totalArea: 100,
        paymentCycle: 'Monthly',
    }) as Tenant;

describe('resolveLeaseOccupancyDate', () => {
    it('prefers moveInDate over leaseStart', () => {
        const t = { ...baseTenant(), moveInDate: '2024-03-15' };
        expect(resolveLeaseOccupancyDate(t)).toBe('2024-03-15');
    });

    it('falls back to leaseStart when moveInDate empty', () => {
        expect(resolveLeaseOccupancyDate(baseTenant())).toBe('2024-01-01');
    });
});

describe('resolveManagementFeeMonthly', () => {
    it('computes monthly fee as unit price × area (元/月/㎡)', () => {
        expect(resolveManagementFeeMonthly(baseTenant())).toBe(1000);
    });

    it('converts legacy daily unit price to monthly per sqm', () => {
        const t = {
            ...baseTenant(),
            managementFeeUnitPrice: 1,
            managementFeeUnitPriceMode: 'daily' as const,
            totalArea: 100,
        };
        expect(toManagementFeeMonthlyUnitPrice(1, 'daily')).toBeCloseTo(30.42, 1);
        expect(resolveManagementFeeMonthly(t)).toBeCloseTo(3041.67, 0);
    });
});

describe('resolveManagementFeeAccrualStartDate', () => {
    it('uses occupancy when aligned with lease', () => {
        const t = { ...baseTenant(), moveInDate: '2024-02-01', managementFeeStartWithOccupancy: true };
        expect(resolveManagementFeeAccrualStartDate(t)).toBe('2024-02-01');
    });

    it('uses custom date when not aligned', () => {
        const t = {
            ...baseTenant(),
            managementFeeStartWithOccupancy: false,
            managementFeeStartDate: '2024-06-01',
        };
        expect(resolveManagementFeeAccrualStartDate(t)).toBe('2024-06-01');
    });
});

describe('generateManagementFeeBills', () => {
    it('starts coverage from custom accrual date', () => {
        const t = {
            ...baseTenant(),
            managementFeeStartWithOccupancy: false,
            managementFeeStartDate: '2024-06-01',
        };
        const bills = generateManagementFeeBills(
            t,
            parseDateLocal('2024-01-01'),
            parseDateLocal('2024-12-31'),
        );
        const first = bills[0];
        expect(first?.coverageStart).toBeDefined();
        const cs = first!.coverageStart!;
        const ymd = `${cs.getFullYear()}-${String(cs.getMonth() + 1).padStart(2, '0')}-${String(cs.getDate()).padStart(2, '0')}`;
        expect(ymd).toBe('2024-06-01');
    });
});
