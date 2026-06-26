import { describe, expect, it } from 'vitest';
import type { BillingDetail } from '../../types';
import {
    billingDetailRowKey,
    buildBillingDetailByRowKey,
} from '../billingDetailLookup';

const row = (patch: Partial<BillingDetail> & Pick<BillingDetail, 'tenantId'>): BillingDetail => ({
    tenantId: patch.tenantId,
    tenantName: patch.tenantName || patch.tenantId,
    unitIds: patch.unitIds || [],
    amountDue: patch.amountDue ?? 0,
    amountPaid: patch.amountPaid ?? 0,
    status: patch.status || 'Unpaid',
    feeKind: patch.feeKind,
});

describe('billingDetailLookup', () => {
    it('uses rent as the default row key fee kind', () => {
        expect(billingDetailRowKey(row({ tenantId: 't1' }))).toBe('rent|t1');
    });

    it('keeps fee kind in the row key so rent and management fee rows do not collide', () => {
        expect(billingDetailRowKey(row({ tenantId: 't1', feeKind: 'management_fee' }))).toBe('management_fee|t1');
    });

    it('builds a billing detail lookup by row key', () => {
        const rent = row({ tenantId: 't1' });
        const mgmt = row({ tenantId: 't1', feeKind: 'management_fee' });

        const lookup = buildBillingDetailByRowKey([rent, mgmt]);

        expect(lookup.get('rent|t1')).toBe(rent);
        expect(lookup.get('management_fee|t1')).toBe(mgmt);
    });

    it('matches Array.find semantics by keeping the first duplicate key', () => {
        const first = row({ tenantId: 't1', amountDue: 100 });
        const second = row({ tenantId: 't1', amountDue: 200 });

        const lookup = buildBillingDetailByRowKey([first, second]);

        expect(lookup.get('rent|t1')).toBe(first);
    });
});
