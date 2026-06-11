import { describe, expect, it } from 'vitest';
import {
  assertPaymentWriteAllowed,
  canAccessProject,
  filterPaymentsForUser,
  mapAuthUser,
  resolveAuthorizedProjectId,
} from '../../scripts/paymentApiAuth';
import type { AuthUser } from '../../types';

const shanghaiUser: AuthUser = {
  id: 'u1',
  email: 'a@example.com',
  projectId: 'shanghai_park',
  role: 'park_user',
  allowedProjectIds: ['shanghai_park'],
  enabled: true,
  receivablePermissions: ['rent_receivable'],
};

const propertyUser: AuthUser = {
  ...shanghaiUser,
  id: 'u2',
  role: 'property_staff',
  receivablePermissions: ['mgmt_fee_receivable'],
};

describe('paymentApiAuth', () => {
  it('canAccessProject blocks cross-park access', () => {
    expect(canAccessProject(shanghaiUser, 'shanghai_park')).toBe(true);
    expect(canAccessProject(shanghaiUser, 'beijing_park')).toBe(false);
  });

  it('platform_admin can access any park', () => {
    const admin: AuthUser = { ...shanghaiUser, role: 'platform_admin' };
    expect(canAccessProject(admin, 'beijing_park')).toBe(true);
  });

  it('resolveAuthorizedProjectId rejects foreign project_id', () => {
    expect(() => resolveAuthorizedProjectId(shanghaiUser, 'beijing_park')).toThrow(/无权访问园区/);
    expect(resolveAuthorizedProjectId(shanghaiUser, 'shanghai_park')).toBe('shanghai_park');
  });

  it('assertPaymentWriteAllowed respects receivable permissions', () => {
    expect(() => assertPaymentWriteAllowed(shanghaiUser, 'Rent')).not.toThrow();
    expect(() => assertPaymentWriteAllowed(shanghaiUser, 'ManagementFee')).toThrow(/物业费/);
    expect(() => assertPaymentWriteAllowed(propertyUser, 'ManagementFee')).not.toThrow();
    expect(() => assertPaymentWriteAllowed(propertyUser, 'Rent')).toThrow(/租金/);
  });

  it('filterPaymentsForUser hides rent rows for property staff', () => {
    const rows = [
      { type: 'Rent', amount: 1 },
      { type: 'ManagementFee', amount: 2 },
    ];
    expect(filterPaymentsForUser(propertyUser, rows)).toEqual([{ type: 'ManagementFee', amount: 2 }]);
  });

  it('mapAuthUser normalizes permissions from PB record', () => {
    const user = mapAuthUser({
      id: 'x',
      email: 'b@example.com',
      project_id: 'shenzhen_park',
      role: 'park_admin',
      enabled: true,
    });
    expect(user?.receivablePermissions).toEqual(['rent_receivable', 'mgmt_fee_receivable']);
  });
});
