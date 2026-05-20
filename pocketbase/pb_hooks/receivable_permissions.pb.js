/// <reference path="../pb_data/types.d.ts" />

/**
 * 核销写权限 + 租金读脱敏 + 物业账号 pb_tenants 租金字段写保护
 */

const RENT_PAYMENT_TYPES = new Set(['Rent', 'DepositToRent', 'Deposit', 'DepositRefund']);
const MGMT_PAYMENT_TYPES = new Set(['ManagementFee']);

const RENT_TENANT_FIELDS = [
    'unit_price', 'unit_price_mode', 'monthly_rent', 'rent_free_periods',
    'free_rent_handling', 'deposit_amount', 'first_receivable_amount',
    'first_receivable_start_date', 'first_receivable_end_date', 'payment_terms',
];

function normalizePermissions(auth) {
    const role = String(auth.get('role') || 'park_user');
    if (role === 'property_staff') return ['mgmt_fee_receivable'];
    if (role === 'platform_admin' || role === 'group_admin' || role === 'park_admin') {
        return ['rent_receivable', 'mgmt_fee_receivable'];
    }
    const raw = auth.get('receivable_permissions');
    let list = [];
    if (Array.isArray(raw)) {
        list = raw.filter((x) => x === 'rent_receivable' || x === 'mgmt_fee_receivable');
    }
    if (list.length > 0) return list;
    return ['rent_receivable'];
}

function shouldHideRentPricing(auth) {
    if (!auth) return false;
    const role = String(auth.get('role') || '');
    if (role === 'platform_admin') return false;
    if (role === 'property_staff') return true;
    return auth.get('hide_rent_pricing') === true;
}

function paymentScope(type) {
    const t = String(type || '');
    if (MGMT_PAYMENT_TYPES.has(t)) return 'management_fee';
    if (RENT_PAYMENT_TYPES.has(t)) return 'rent';
    return 'other';
}

function assertCanMutatePayment(auth, type) {
    if (!auth) return;
    const role = String(auth.get('role') || '');
    if (role === 'platform_admin') return;

    const scope = paymentScope(type);
    if (scope === 'other') return;

    const perms = normalizePermissions(auth);
    if (scope === 'rent' && !perms.includes('rent_receivable')) {
        throw new ForbiddenError('当前账号无租金核销权限，无法保存该收款记录。');
    }
    if (scope === 'management_fee' && !perms.includes('mgmt_fee_receivable')) {
        throw new ForbiddenError('当前账号无物业费核销权限，无法保存该收款记录。');
    }
}

function guardPaymentWrite(e) {
    if (e.collection.name !== 'pb_payments') return;
    const auth = e.auth;
    if (!auth) return;
    assertCanMutatePayment(auth, e.record.get('type'));
}

function stripRentFromTenantRecord(record) {
    for (let i = 0; i < RENT_TENANT_FIELDS.length; i += 1) {
        const f = RENT_TENANT_FIELDS[i];
        try { record.set(f, null); } catch (_) {}
    }
}

function guardTenantWrite(e) {
    if (e.collection.name !== 'pb_tenants') return;
    const auth = e.auth;
    if (!auth) return;
    const role = String(auth.get('role') || '');
    if (role === 'platform_admin') return;

    if (role === 'property_staff') {
        const original = e.record.originalCopy();
        if (original) {
            for (let i = 0; i < RENT_TENANT_FIELDS.length; i += 1) {
                const f = RENT_TENANT_FIELDS[i];
                const nextVal = e.record.get(f);
                const oldVal = original.get(f);
                if (JSON.stringify(nextVal) !== JSON.stringify(oldVal)) {
                    throw new ForbiddenError('物业账号不可修改租金相关字段。');
                }
            }
        }
    }
}

onRecordCreateRequest(guardPaymentWrite, 'pb_payments');
onRecordUpdateRequest((e) => {
    guardPaymentWrite(e);
    guardTenantWrite(e);
    if (e.collection.name !== 'pb_payments' || !e.auth) return;
    const original = e.record.originalCopy();
    if (original) assertCanMutatePayment(e.auth, original.get('type'));
}, 'pb_payments');
onRecordUpdateRequest(guardTenantWrite, 'pb_tenants');
onRecordCreateRequest((e) => {
    if (e.collection.name !== 'pb_tenants' || !e.auth) return;
    if (String(e.auth.get('role') || '') === 'property_staff') {
        throw new ForbiddenError('物业账号不可新建租户合同。');
    }
}, 'pb_tenants');
onRecordDeleteRequest((e) => {
    if (e.collection.name !== 'pb_payments' || !e.auth) return;
    assertCanMutatePayment(e.auth, e.record.get('type'));
}, 'pb_payments');
onRecordDeleteRequest((e) => {
    if (e.collection.name !== 'pb_tenants' || !e.auth) return;
    if (String(e.auth.get('role') || '') === 'property_staff') {
        throw new ForbiddenError('物业账号不可删除租户合同。');
    }
}, 'pb_tenants');

onRecordEnrich((e) => {
    if (e.collection.name !== 'pb_tenants') return;
    if (!shouldHideRentPricing(e.auth)) return;
    stripRentFromTenantRecord(e.record);
}, 'pb_tenants');
