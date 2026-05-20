import type { AuthUser, PaymentRecord, UserRole } from '../types';

export type ReceivablePermission = 'rent_receivable' | 'mgmt_fee_receivable';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
    park_user: '普通用户',
    park_admin: '园区管理员',
    group_admin: '集团管理员',
    platform_admin: '平台管理员',
    property_staff: '物业人员',
};

export function userRoleLabel(role: UserRole | string | undefined): string {
    const key = String(role || 'park_user') as UserRole;
    return USER_ROLE_LABELS[key] || key;
}

export function isPropertyStaffRole(role: UserRole | string | undefined): boolean {
    return String(role || '') === 'property_staff';
}

/** 创建/更新用户时，按角色写入 hide_rent_pricing 与 receivable_permissions */
export function receivableDefaultsForRole(role: UserRole): {
    hideRentPricing: boolean;
    receivablePermissions: ReceivablePermission[];
} {
    if (role === 'property_staff') {
        return { hideRentPricing: true, receivablePermissions: ['mgmt_fee_receivable'] };
    }
    if (role === 'platform_admin' || role === 'group_admin' || role === 'park_admin') {
        return { hideRentPricing: false, receivablePermissions: ['rent_receivable', 'mgmt_fee_receivable'] };
    }
    return { hideRentPricing: false, receivablePermissions: ['rent_receivable'] };
}

export function resolveHideRentPricing(
    role: UserRole | string | undefined,
    hideRentPricingFlag: unknown,
): boolean {
    if (isPropertyStaffRole(role)) return true;
    return hideRentPricingFlag === true;
}

export function normalizeReceivablePermissions(
    raw: unknown,
    role?: UserRole,
): ReceivablePermission[] {
    if (isPropertyStaffRole(role)) {
        return ['mgmt_fee_receivable'];
    }
    const list = Array.isArray(raw)
        ? raw.filter((x): x is ReceivablePermission => x === 'rent_receivable' || x === 'mgmt_fee_receivable')
        : [];
    if (list.length > 0) return list;
    if (role === 'platform_admin' || role === 'group_admin' || role === 'park_admin') {
        return ['rent_receivable', 'mgmt_fee_receivable'];
    }
    return ['rent_receivable'];
}

export function canViewRentPricing(user: AuthUser | null | undefined): boolean {
    if (!user) return true;
    if (user.role === 'platform_admin') return true;
    if (isPropertyStaffRole(user.role) || user.hideRentPricing) return false;
    return true;
}

export function canWriteReceivableScope(
    user: AuthUser | null | undefined,
    scope: 'rent' | 'management_fee',
): boolean {
    if (!user) return true;
    if (user.role === 'platform_admin') return true;
    if (isPropertyStaffRole(user.role) && scope === 'rent') return false;
    const perms = normalizeReceivablePermissions(user.receivablePermissions, user.role);
    if (scope === 'rent') return perms.includes('rent_receivable');
    return perms.includes('mgmt_fee_receivable');
}

export function paymentTypeToReceivableScope(type: PaymentRecord['type']): 'rent' | 'management_fee' | 'other' {
    if (type === 'ManagementFee') return 'management_fee';
    if (type === 'Rent' || type === 'DepositToRent' || type === 'Deposit' || type === 'DepositRefund') {
        return 'rent';
    }
    return 'other';
}

export function assertCanMutatePayment(user: AuthUser | null | undefined, payment: PaymentRecord): void {
    const scope = paymentTypeToReceivableScope(payment.type);
    if (scope === 'other') return;
    if (!canWriteReceivableScope(user, scope)) {
        const label = scope === 'rent' ? '租金' : '物业费';
        throw new Error(`当前账号无「${label}」核销权限，无法保存该收款记录。`);
    }
}
