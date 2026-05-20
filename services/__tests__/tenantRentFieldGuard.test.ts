import { describe, expect, it } from 'vitest';
import type { AuthUser } from '../../types';
import {
    filterDirtyPayloadForRentMaskedUser,
    preserveRentFieldsInTenantPbMap,
} from '../tenantRentFieldGuard';

const propertyStaff: AuthUser = {
    id: 'u1',
    email: 'prop@example.com',
    role: 'property_staff',
    projectId: 'shenzhen_park',
    allowedProjectIds: ['shenzhen_park'],
    hideRentPricing: true,
    receivablePermissions: ['mgmt_fee_receivable'],
    enabled: true,
};

const admin: AuthUser = {
    id: 'u2',
    email: 'admin@example.com',
    role: 'platform_admin',
    projectId: 'shanghai_park',
    allowedProjectIds: ['shanghai_park'],
    hideRentPricing: false,
    receivablePermissions: ['rent_receivable', 'mgmt_fee_receivable'],
    enabled: true,
};

describe('preserveRentFieldsInTenantPbMap', () => {
    it('restores rent fields from baseline for property staff', () => {
        const baseline = {
            pb_tenants: {
                t1: { name: 'A', monthly_rent: 12000, unit_price: 3.5 },
            },
        };
        const next = {
            pb_tenants: {
                t1: { name: 'A', monthly_rent: 0, unit_price: 0 },
            },
        };
        const out = preserveRentFieldsInTenantPbMap(next, baseline, propertyStaff);
        expect(out.pb_tenants!.t1.monthly_rent).toBe(12000);
        expect(out.pb_tenants!.t1.unit_price).toBe(3.5);
    });

    it('does not patch for admin users', () => {
        const baseline = {
            pb_tenants: { t1: { monthly_rent: 12000 } },
        };
        const next = {
            pb_tenants: { t1: { monthly_rent: 8000 } },
        };
        const out = preserveRentFieldsInTenantPbMap(next, baseline, admin);
        expect(out.pb_tenants!.t1.monthly_rent).toBe(8000);
    });
});

describe('filterDirtyPayloadForRentMaskedUser', () => {
    it('strips rent field updates and blocks tenant create/delete', () => {
        const payload = {
            pb_tenants: {
                creates: [{ originalId: 'new1', data: { name: 'X' } }],
                updates: [
                    {
                        pbId: 'pb1',
                        originalId: 't1',
                        changedFields: { name: 'A', monthly_rent: 0 },
                    },
                ],
                deletes: [{ pbId: 'pb1', originalId: 't1' }],
            },
        };
        const filtered = filterDirtyPayloadForRentMaskedUser(payload as any, propertyStaff);
        expect(filtered.pb_tenants?.creates).toEqual([]);
        expect(filtered.pb_tenants?.deletes).toEqual([]);
        expect(filtered.pb_tenants?.updates).toEqual([
            { pbId: 'pb1', originalId: 't1', changedFields: { name: 'A' } },
        ]);
    });
});
