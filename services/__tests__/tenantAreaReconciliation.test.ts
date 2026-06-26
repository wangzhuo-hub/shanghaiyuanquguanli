import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, UnitStatus, type Building, type Tenant } from '../../types';
import {
    buildUnitAreaById,
    reconcileTenantAreasWithBuildings,
} from '../tenantAreaReconciliation';

const building = (patch: Partial<Building> & Pick<Building, 'id'>): Building => ({
    id: patch.id,
    name: patch.name || patch.id,
    type: patch.type || 'Building',
    units: patch.units || [],
});

const unit = (id: string, area: number) => ({
    id,
    name: id,
    area,
    floor: 1,
    status: UnitStatus.Vacant,
});

const tenant = (patch: Partial<Tenant> & Pick<Tenant, 'id'>): Tenant => ({
    id: patch.id,
    name: patch.name || patch.id,
    buildingId: patch.buildingId || 'b1',
    unitIds: patch.unitIds || [],
    totalArea: patch.totalArea ?? 0,
    leaseStart: patch.leaseStart || '2026-01-01',
    leaseEnd: patch.leaseEnd || '2026-12-31',
    monthlyRent: patch.monthlyRent ?? 0,
    unitPrice: patch.unitPrice,
    rentFreePeriods: patch.rentFreePeriods || [],
    paymentCycle: patch.paymentCycle || 'Monthly',
    firstPaymentDate: patch.firstPaymentDate || '2026-01-01',
    depositAmount: patch.depositAmount ?? 0,
    depositStatus: patch.depositStatus || DepositStatus.Unpaid,
    status: patch.status || ContractStatus.Active,
});

describe('tenantAreaReconciliation', () => {
    it('builds a unit area index once for all buildings', () => {
        const index = buildUnitAreaById([
            building({ id: 'b1', units: [unit('u1', 12.3)] }),
            building({ id: 'b2', units: [unit('u2', 45.6)] }),
        ]);

        expect(index.get('u1')).toBe(12.3);
        expect(index.get('u2')).toBe(45.6);
    });

    it('recalculates tenant area and monthly rent from explicit unit price', () => {
        const original = tenant({
            id: 't1',
            unitIds: ['u1', 'u2'],
            totalArea: 50,
            unitPrice: 2,
            monthlyRent: 3041.67,
        });

        const [updated] = reconcileTenantAreasWithBuildings([
            building({ id: 'b1', units: [unit('u1', 10.126), unit('u2', 20.126)] }),
        ], [original]);

        expect(updated).not.toBe(original);
        expect(updated.totalArea).toBe(30.25);
        expect(updated.unitPrice).toBe(2);
        expect(updated.monthlyRent).toBe(1840.21);
    });

    it('infers unit price from existing rent when unit price is missing', () => {
        const original = tenant({
            id: 't1',
            unitIds: ['u1'],
            totalArea: 100,
            monthlyRent: 10000,
        });

        const [updated] = reconcileTenantAreasWithBuildings([
            building({ id: 'b1', units: [unit('u1', 120)] }),
        ], [original]);

        expect(updated.totalArea).toBe(120);
        expect(updated.unitPrice).toBeCloseTo((10000 * 12) / (100 * 365));
        expect(updated.monthlyRent).toBe(12000);
    });

    it('keeps the original tenant object when rounded area is unchanged', () => {
        const original = tenant({
            id: 't1',
            unitIds: ['u1'],
            totalArea: 10,
            unitPrice: 1,
            monthlyRent: 304.17,
        });

        const [updated] = reconcileTenantAreasWithBuildings([
            building({ id: 'b1', units: [unit('u1', 10.004)] }),
        ], [original]);

        expect(updated).toBe(original);
    });

    it('matches legacy behavior for duplicate and missing unit ids', () => {
        const original = tenant({
            id: 't1',
            unitIds: ['u1', 'missing', 'u1'],
            totalArea: 15,
            unitPrice: 1,
            monthlyRent: 456.25,
        });

        const [updated] = reconcileTenantAreasWithBuildings([
            building({ id: 'b1', units: [unit('u1', 10)] }),
        ], [original]);

        expect(updated.totalArea).toBe(20);
        expect(updated.monthlyRent).toBe(608.33);
    });
});
