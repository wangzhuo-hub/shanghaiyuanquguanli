import { describe, expect, it } from 'vitest';
import {
    canViewRentPricing,
    canWriteReceivableScope,
    normalizeReceivablePermissions,
    receivableDefaultsForRole,
    resolveHideRentPricing,
    userRoleLabel,
} from '../receivablePermissions';
import type { AuthUser } from '../../types';

describe('receivablePermissions property_staff', () => {
    const propertyUser: AuthUser = {
        id: 'u1',
        email: 'wy@example.com',
        projectId: 'shenzhen_park',
        role: 'property_staff',
        allowedProjectIds: ['shenzhen_park'],
        enabled: true,
    };

    it('labels property_staff in Chinese', () => {
        expect(userRoleLabel('property_staff')).toBe('物业人员');
    });

    it('hides rent pricing for property_staff', () => {
        expect(canViewRentPricing(propertyUser)).toBe(false);
        expect(resolveHideRentPricing('property_staff', false)).toBe(true);
    });

    it('defaults to mgmt fee receivable only', () => {
        expect(receivableDefaultsForRole('property_staff')).toEqual({
            hideRentPricing: true,
            receivablePermissions: ['mgmt_fee_receivable'],
        });
        expect(normalizeReceivablePermissions([], 'property_staff')).toEqual(['mgmt_fee_receivable']);
    });

    it('cannot write rent scope but can write mgmt fee', () => {
        expect(canWriteReceivableScope(propertyUser, 'rent')).toBe(false);
        expect(canWriteReceivableScope(propertyUser, 'management_fee')).toBe(true);
    });

    it('platform_admin still sees rent', () => {
        expect(
            canViewRentPricing({
                ...propertyUser,
                role: 'platform_admin',
                hideRentPricing: true,
            }),
        ).toBe(true);
    });
});
