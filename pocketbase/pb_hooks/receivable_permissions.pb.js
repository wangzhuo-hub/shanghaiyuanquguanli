/// <reference path="../pb_data/types.d.ts" />

/**
 * 核销写权限 + 租金读脱敏 + 物业账号 pb_tenants 租金字段写保护
 *
 * PB 0.36 hooks 限制（实测）：
 * - onRecord* 回调内不可访问任何顶层变量/函数（含 const Set、const 数组）
 * - auth.collection() 须在回调内联，不可抽成外部函数
 * - 常量须在 handler 内局部声明
 * - originalCopy() 须 try/catch
 */

onRecordCreateRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role !== 'platform_admin') {
                const payType = String(e.record.get('type') || '');
                let scope = 'other';
                if (payType === 'ManagementFee') scope = 'management_fee';
                else if (payType === 'Rent' || payType === 'DepositToRent' || payType === 'Deposit' || payType === 'DepositRefund') scope = 'rent';
                if (scope !== 'other') {
                    let perms = ['rent_receivable'];
                    if (role === 'property_staff') {
                        perms = ['mgmt_fee_receivable'];
                    } else if (role === 'group_admin' || role === 'park_admin') {
                        perms = ['rent_receivable', 'mgmt_fee_receivable'];
                    } else {
                        try {
                            const raw = auth.get('receivable_permissions');
                            if (Array.isArray(raw)) {
                                const filtered = raw.filter((x) => x === 'rent_receivable' || x === 'mgmt_fee_receivable');
                                if (filtered.length > 0) perms = filtered;
                            }
                        } catch (_) {}
                    }
                    if (scope === 'rent' && perms.indexOf('rent_receivable') < 0) {
                        throw new ForbiddenError('当前账号无租金核销权限，无法保存该收款记录。');
                    }
                    if (scope === 'management_fee' && perms.indexOf('mgmt_fee_receivable') < 0) {
                        throw new ForbiddenError('当前账号无物业费核销权限，无法保存该收款记录。');
                    }
                }
            }
        }
    }
    e.next();
}, 'pb_payments');

onRecordUpdateRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role !== 'platform_admin') {
                const checkType = (type) => {
                    const payType = String(type || '');
                    let scope = 'other';
                    if (payType === 'ManagementFee') scope = 'management_fee';
                    else if (payType === 'Rent' || payType === 'DepositToRent' || payType === 'Deposit' || payType === 'DepositRefund') scope = 'rent';
                    if (scope === 'other') return;
                    let perms = ['rent_receivable'];
                    if (role === 'property_staff') {
                        perms = ['mgmt_fee_receivable'];
                    } else if (role === 'group_admin' || role === 'park_admin') {
                        perms = ['rent_receivable', 'mgmt_fee_receivable'];
                    } else {
                        try {
                            const raw = auth.get('receivable_permissions');
                            if (Array.isArray(raw)) {
                                const filtered = raw.filter((x) => x === 'rent_receivable' || x === 'mgmt_fee_receivable');
                                if (filtered.length > 0) perms = filtered;
                            }
                        } catch (_) {}
                    }
                    if (scope === 'rent' && perms.indexOf('rent_receivable') < 0) {
                        throw new ForbiddenError('当前账号无租金核销权限，无法保存该收款记录。');
                    }
                    if (scope === 'management_fee' && perms.indexOf('mgmt_fee_receivable') < 0) {
                        throw new ForbiddenError('当前账号无物业费核销权限，无法保存该收款记录。');
                    }
                };
                checkType(e.record.get('type'));
                try {
                    const original = e.record.originalCopy();
                    if (original) checkType(original.get('type'));
                } catch (err) {
                    if (err instanceof ForbiddenError) throw err;
                }
            }
        }
    }
    e.next();
}, 'pb_payments');

onRecordDeleteRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role !== 'platform_admin') {
                const payType = String(e.record.get('type') || '');
                let scope = 'other';
                if (payType === 'ManagementFee') scope = 'management_fee';
                else if (payType === 'Rent' || payType === 'DepositToRent' || payType === 'Deposit' || payType === 'DepositRefund') scope = 'rent';
                if (scope !== 'other') {
                    let perms = ['rent_receivable'];
                    if (role === 'property_staff') {
                        perms = ['mgmt_fee_receivable'];
                    } else if (role === 'group_admin' || role === 'park_admin') {
                        perms = ['rent_receivable', 'mgmt_fee_receivable'];
                    } else {
                        try {
                            const raw = auth.get('receivable_permissions');
                            if (Array.isArray(raw)) {
                                const filtered = raw.filter((x) => x === 'rent_receivable' || x === 'mgmt_fee_receivable');
                                if (filtered.length > 0) perms = filtered;
                            }
                        } catch (_) {}
                    }
                    if (scope === 'rent' && perms.indexOf('rent_receivable') < 0) {
                        throw new ForbiddenError('当前账号无租金核销权限，无法保存该收款记录。');
                    }
                    if (scope === 'management_fee' && perms.indexOf('mgmt_fee_receivable') < 0) {
                        throw new ForbiddenError('当前账号无物业费核销权限，无法保存该收款记录。');
                    }
                }
            }
        }
    }
    e.next();
}, 'pb_payments');

onRecordCreateRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role === 'property_staff') {
                throw new ForbiddenError('物业账号不可新建租户合同。');
            }
        }
    }
    e.next();
}, 'pb_tenants');

onRecordUpdateRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role === 'property_staff') {
                let original = null;
                try { original = e.record.originalCopy(); } catch (_) {}
                if (original) {
                    const rentFields = [
                        'unit_price', 'unit_price_mode', 'monthly_rent', 'rent_free_periods',
                        'free_rent_handling', 'deposit_amount', 'first_receivable_amount',
                        'first_receivable_start_date', 'first_receivable_end_date', 'payment_terms',
                    ];
                    for (let i = 0; i < rentFields.length; i += 1) {
                        const f = rentFields[i];
                        const nextVal = e.record.get(f);
                        const oldVal = original.get(f);
                        if (JSON.stringify(nextVal) !== JSON.stringify(oldVal)) {
                            throw new ForbiddenError('物业账号不可修改租金相关字段。');
                        }
                    }
                }
            }
        }
    }
    e.next();
}, 'pb_tenants');

onRecordDeleteRequest((e) => {
    const auth = e.auth;
    if (auth) {
        let isUser = false;
        try {
            const coll = auth.collection();
            isUser = !!(coll && String(coll.name || '') === 'users');
        } catch (_) {}
        if (isUser) {
            let role = '';
            try { role = String(auth.get('role') || ''); } catch (_) {}
            if (role === 'property_staff') {
                throw new ForbiddenError('物业账号不可删除租户合同。');
            }
        }
    }
    e.next();
}, 'pb_tenants');

onRecordEnrich((e) => {
    const auth = e.requestInfo ? e.requestInfo.auth : null;
    if (!auth) {
        e.next();
        return;
    }
    let isUser = false;
    try {
        const coll = auth.collection();
        isUser = !!(coll && String(coll.name || '') === 'users');
    } catch (_) {}
    if (!isUser) {
        e.next();
        return;
    }
    let role = '';
    try { role = String(auth.get('role') || ''); } catch (_) {}
    let hide = false;
    if (role === 'platform_admin') {
        hide = false;
    } else if (role === 'property_staff') {
        hide = true;
    } else {
        try { hide = auth.get('hide_rent_pricing') === true; } catch (_) {}
    }
    if (hide) {
        const rentFields = [
            'unit_price', 'unit_price_mode', 'monthly_rent', 'rent_free_periods',
            'free_rent_handling', 'deposit_amount', 'first_receivable_amount',
            'first_receivable_start_date', 'first_receivable_end_date', 'payment_terms',
        ];
        for (let i = 0; i < rentFields.length; i += 1) {
            const f = rentFields[i];
            try { e.record.hide(f); } catch (_) {}
        }
    }
    e.next();
}, 'pb_tenants');
