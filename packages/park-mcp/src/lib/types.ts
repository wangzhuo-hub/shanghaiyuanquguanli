export type UserRole =
  | 'park_user'
  | 'park_admin'
  | 'group_admin'
  | 'platform_admin'
  | 'property_staff';

export type ReceivablePermission = 'rent_receivable' | 'mgmt_fee_receivable';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  projectId: string;
  role: UserRole;
  allowedProjectIds: string[];
  enabled: boolean;
  receivablePermissions?: ReceivablePermission[];
  hideRentPricing?: boolean;
}
