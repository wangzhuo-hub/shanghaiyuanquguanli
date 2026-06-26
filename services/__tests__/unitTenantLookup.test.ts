import { describe, expect, it } from 'vitest';
import { ContractStatus, DepositStatus, type Tenant } from '../../types';
import {
    buildActiveTenantByUnitId,
    buildActiveThenTerminatedTenantByUnitId,
    buildTenantByUnitIdForStatuses,
} from '../unitTenantLookup';

const tenant = (patch: Partial<Tenant> & Pick<Tenant, 'id'>): Tenant =>
    ({
        id: patch.id,
        name: patch.name || patch.id,
        buildingId: patch.buildingId || 'b1',
        unitIds: patch.unitIds || [],
        totalArea: patch.totalArea ?? 0,
        leaseStart: patch.leaseStart || '2026-01-01',
        leaseEnd: patch.leaseEnd || '2026-12-31',
        monthlyRent: patch.monthlyRent ?? 0,
        rentFreePeriods: patch.rentFreePeriods || [],
        paymentCycle: patch.paymentCycle || 'Monthly',
        firstPaymentDate: patch.firstPaymentDate || '2026-01-01',
        depositAmount: patch.depositAmount ?? 0,
        depositStatus: patch.depositStatus || DepositStatus.Unpaid,
        status: patch.status || ContractStatus.Active,
    }) as Tenant;

describe('unitTenantLookup', () => {
    it('builds active tenant lookup by unit id', () => {
        const active = tenant({ id: 'active', unitIds: ['u1', 'u2'], status: ContractStatus.Active });
        const terminated = tenant({ id: 'terminated', unitIds: ['u3'], status: ContractStatus.Terminated });

        const lookup = buildActiveTenantByUnitId([active, terminated]);

        expect(lookup.get('u1')).toBe(active);
        expect(lookup.get('u2')).toBe(active);
        expect(lookup.has('u3')).toBe(false);
    });

    it('keeps the first matching tenant for duplicate active unit occupancy', () => {
        const first = tenant({ id: 'first', unitIds: ['u1'], status: ContractStatus.Active });
        const second = tenant({ id: 'second', unitIds: ['u1'], status: ContractStatus.Active });

        const lookup = buildActiveTenantByUnitId([first, second]);

        expect(lookup.get('u1')).toBe(first);
    });

    it('uses active tenant before terminated tenant for export lookup', () => {
        const terminated = tenant({ id: 'terminated', unitIds: ['u1'], status: ContractStatus.Terminated });
        const active = tenant({ id: 'active', unitIds: ['u1'], status: ContractStatus.Active });

        const lookup = buildActiveThenTerminatedTenantByUnitId([terminated, active]);

        expect(lookup.get('u1')).toBe(active);
    });

    it('falls back to terminated tenant when no active tenant exists', () => {
        const terminated = tenant({ id: 'terminated', unitIds: ['u1'], status: ContractStatus.Terminated });

        const lookup = buildActiveThenTerminatedTenantByUnitId([terminated]);

        expect(lookup.get('u1')).toBe(terminated);
    });

    it('supports explicit status sets', () => {
        const pending = tenant({ id: 'pending', unitIds: ['u1'], status: ContractStatus.Pending });
        const active = tenant({ id: 'active', unitIds: ['u2'], status: ContractStatus.Active });

        const lookup = buildTenantByUnitIdForStatuses([pending, active], [ContractStatus.Pending]);

        expect(lookup.get('u1')).toBe(pending);
        expect(lookup.has('u2')).toBe(false);
    });
});
