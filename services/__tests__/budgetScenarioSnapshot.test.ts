import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Building, Tenant } from '../../types';
import { cloneBudgetScenarioSnapshot } from '../budgetScenarioSnapshot';

const tenant = (): Tenant => ({
    id: 't1',
    name: '测试客户',
    buildingId: 'b1',
    unitIds: ['u1'],
    totalArea: 120,
    leaseStart: '2026-01-01',
    leaseEnd: '2026-12-31',
    monthlyRent: 10000,
    paymentCycle: 'Monthly',
    firstPaymentDate: '2026-01-05',
    depositAmount: 0,
    depositStatus: 'Unpaid',
    status: 'Active',
    rentFreePeriods: [],
} as Tenant);

const building = (): Building => ({
    id: 'b1',
    name: 'A座',
    units: [{
        id: 'u1',
        name: '101',
        floor: 1,
        area: 120,
        status: 'Occupied',
    }],
} as Building);

describe('cloneBudgetScenarioSnapshot', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('deep clones tenants and buildings without sharing nested references', () => {
        const tenants = [tenant()];
        const buildings = [building()];

        const snapshot = cloneBudgetScenarioSnapshot(tenants, buildings);

        expect(snapshot.tenants).not.toBe(tenants);
        expect(snapshot.tenants[0]).not.toBe(tenants[0]);
        expect(snapshot.buildings).not.toBe(buildings);
        expect(snapshot.buildings[0].units[0]).not.toBe(buildings[0].units[0]);

        tenants[0].name = '已修改';
        buildings[0].units[0].name = '102';

        expect(snapshot.tenants[0].name).toBe('测试客户');
        expect(snapshot.buildings[0].units[0].name).toBe('101');
    });

    it('removes undefined object fields to keep JSON-like snapshot shape', () => {
        const tenants = [tenant() as Tenant & { optionalField?: string }];
        tenants[0].optionalField = undefined;

        const snapshot = cloneBudgetScenarioSnapshot(tenants, [building()]);

        expect('optionalField' in snapshot.tenants[0]).toBe(false);
    });

    it('falls back to JSON cloning when structuredClone is unavailable', () => {
        vi.stubGlobal('structuredClone', undefined);
        const tenants = [tenant()];
        const buildings = [building()];

        const snapshot = cloneBudgetScenarioSnapshot(tenants, buildings);

        expect(snapshot).toEqual({ tenants, buildings });
        expect(snapshot.tenants[0]).not.toBe(tenants[0]);
        expect(snapshot.buildings[0]).not.toBe(buildings[0]);
    });
});
