/// <reference path="../pb_data/types.d.ts" />

/**
 * 核销写权限 + 租金读脱敏 + 物业账号 pb_tenants 租金字段写保护
 * 所有 handler 必须在返回前调用 e.next()（抛 ForbiddenError 除外）。
 *
 * 注意：onRecordEnrich 内不要访问 e.collection.name（PB 0.36 会致 enrich 失败），
 * 集合过滤依赖 onRecordEnrich(..., "pb_tenants") 第三个参数。
 */

const RENT_PAYMENT_TYPES = new Set(['Rent', 'DepositToRent', 'Deposit', 'DepositRefund']);
const MGMT_PAYMENT_TYPES = new Set(['ManagementFee']);

const RENT_TENANT_FIELDS = [
    'unit_price', 'unit_price_mode', 'monthly_rent', 'rent_free_periods',
    'free_rent_handling', 'deposit_amount', 'first_receivable_amount',
    'first_receivable_start_date', 'first_receivable_end_date', 'payment_terms',
];

function safeAuthField(auth, field) {
    if (!auth) return undefined;
    try {
        return auth.get(field);
    } catch (_) {
        return undefined;
    }
}

function normalizePermissions(auth) {
    const role = String(safeAuthField(auth, 'role') || 'park_user');
    if (role === 'property_staff') return ['mgmt_fee_receivable'];
    if (role === 'platform_admin' || role === 'group_admin' || role === 'park_admin') {
        return ['rent_receivable', 'mgmt_fee_receivable'];
    }
    const raw = safeAuthField(auth, 'receivable_permissions');
    let list = [];
    if (Array.isArray(raw)) {
        list = raw.filter((x) => x === 'rent_receivable' || x === 'mgmt_fee_receivable');
    }
    if (list.length > 0) return list;
    return ['rent_receivable'];
}

function shouldHideRentPricing(auth) {
    if (!auth) return false;
    const role = String(safeAuthField(auth, 'role') || '');
    if (role === 'platform_admin') return false;
    if (role === 'property_staff') return true;
    return safeAuthField(auth, 'hide_rent_pricing') === true;
}

function paymentScope(type) {
    const t = String(type || '');
    if (MGMT_PAYMENT_TYPES.has(t)) return 'management_fee';
    if (RENT_PAYMENT_TYPES.has(t)) return 'rent';
    return 'other';
}

function assertCanMutatePayment(auth, type) {
    if (!auth) return;
    const role = String(safeAuthField(auth, 'role') || '');
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

function stripRentFromTenantRecord(record) {
    for (let i = 0; i < RENT_TENANT_FIELDS.length; i += 1) {
        const f = RENT_TENANT_FIELDS[i];
        try { record.hide(f); } catch (_) {}
    }
}

function guardTenantWrite(e) {
    const auth = e.auth;
    if (!auth) return;
    const role = String(safeAuthField(auth, 'role') || '');
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

onRecordCreateRequest((e) => {
    if (e.auth) {
        assertCanMutatePayment(e.auth, e.record.get('type'));
    }
    e.next();
}, 'pb_payments');

onRecordUpdateRequest((e) => {
    if (e.auth) {
        assertCanMutatePayment(e.auth, e.record.get('type'));
        const original = e.record.originalCopy();
        if (original) assertCanMutatePayment(e.auth, original.get('type'));
    }
    e.next();
}, 'pb_payments');

onRecordDeleteRequest((e) => {
    if (e.auth) {
        assertCanMutatePayment(e.auth, e.record.get('type'));
    }
    e.next();
}, 'pb_payments');

onRecordCreateRequest((e) => {
    if (e.auth && String(safeAuthField(e.auth, 'role') || '') === 'property_staff') {
        throw new ForbiddenError('物业账号不可新建租户合同。');
    }
    e.next();
}, 'pb_tenants');

onRecordUpdateRequest((e) => {
    guardTenantWrite(e);
    e.next();
}, 'pb_tenants');

onRecordDeleteRequest((e) => {
    if (e.auth && String(safeAuthField(e.auth, 'role') || '') === 'property_staff') {
        throw new ForbiddenError('物业账号不可删除租户合同。');
    }
    e.next();
}, 'pb_tenants');

onRecordEnrich((e) => {
    // PB 0.36：enrich 内勿调用嵌套函数里的 auth.get()，也勿访问 e.collection.name
    const auth = e.requestInfo ? e.requestInfo.auth : null;
    if (!auth) {
        e.next();
        return;
    }
    let collectionName = '';
    try {
        const coll = auth.collection();
        if (coll) collectionName = String(coll.name || '');
    } catch (_) {}
    if (collectionName !== 'users') {
        e.next();
        return;
    }
    let role = '';
    try { role = String(auth.get('role') || ''); } catch (_) { role = ''; }
    let hide = false;
    if (role === 'platform_admin') {
        hide = false;
    } else if (role === 'property_staff') {
        hide = true;
    } else {
        try { hide = auth.get('hide_rent_pricing') === true; } catch (_) { hide = false; }
    }
    if (hide) {
        stripRentFromTenantRecord(e.record);
    }
    e.next();
}, 'pb_tenants');
