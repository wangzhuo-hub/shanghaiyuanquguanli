import { describe, expect, it, vi } from 'vitest';
import { LastSavePayloadMemo, savePayloadCollectionsKey, savePayloadDataIdentityKey } from '../savePayloadMemo';

const baseKey = () => ({
    dataRef: { id: 'data' },
    baselineRef: { id: 'baseline' },
    recordMetaRef: { id: 'meta' },
    projectId: 'shanghai_park',
    baselineRevision: 1,
    collectionsKey: 'pb_tenants',
    authScopeKey: 'u1|park_admin|rent_receivable',
});

describe('LastSavePayloadMemo', () => {
    it('reuses the payload for an identical save context', () => {
        const memo = new LastSavePayloadMemo<{ total: number }>();
        const key = baseKey();
        const compute = vi.fn(() => ({ total: 1 }));

        const first = memo.getOrCompute(key, compute);
        const second = memo.getOrCompute({ ...key }, compute);

        expect(second).toBe(first);
        expect(compute).toHaveBeenCalledTimes(1);
    });

    it('recomputes when baseline revision changes', () => {
        const memo = new LastSavePayloadMemo<{ total: number }>();
        const key = baseKey();
        const compute = vi.fn()
            .mockReturnValueOnce({ total: 1 })
            .mockReturnValueOnce({ total: 2 });

        memo.getOrCompute(key, compute);
        const second = memo.getOrCompute({ ...key, baselineRevision: 2 }, compute);

        expect(second.total).toBe(2);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('recomputes when dirty collection scope or auth scope changes', () => {
        const memo = new LastSavePayloadMemo<{ total: number }>();
        const key = baseKey();
        const compute = vi.fn()
            .mockReturnValueOnce({ total: 1 })
            .mockReturnValueOnce({ total: 2 })
            .mockReturnValueOnce({ total: 3 });

        memo.getOrCompute(key, compute);
        memo.getOrCompute({ ...key, collectionsKey: 'pb_payments' }, compute);
        const third = memo.getOrCompute({ ...key, collectionsKey: 'pb_payments', authScopeKey: 'u2|property_staff|mgmt_fee_receivable' }, compute);

        expect(third.total).toBe(3);
        expect(compute).toHaveBeenCalledTimes(3);
    });

    it('reuses the payload when the data reference changes but persistent slice identity is unchanged', () => {
        const memo = new LastSavePayloadMemo<{ total: number }>();
        const tenants = [{ id: 't1' }];
        const firstData = { tenants, monthlyTrends: [{ month: '1月' }] };
        const secondData = { tenants, monthlyTrends: [{ month: '2月' }] };
        const identityKey = savePayloadDataIdentityKey([['tenants', tenants]]);
        const compute = vi.fn(() => ({ total: 1 }));
        const key = baseKey();

        const first = memo.getOrCompute({
            ...key,
            dataRef: firstData,
            dataIdentityKey: identityKey,
        }, compute);
        const second = memo.getOrCompute({
            ...key,
            dataRef: secondData,
            dataIdentityKey: identityKey,
        }, compute);

        expect(second).toBe(first);
        expect(compute).toHaveBeenCalledTimes(1);
    });

    it('recomputes when persistent slice identity changes', () => {
        const memo = new LastSavePayloadMemo<{ total: number }>();
        const firstTenants = [{ id: 't1' }];
        const secondTenants = [{ id: 't1', name: 'updated' }];
        const compute = vi.fn()
            .mockReturnValueOnce({ total: 1 })
            .mockReturnValueOnce({ total: 2 });
        const key = baseKey();

        memo.getOrCompute({
            ...key,
            dataIdentityKey: savePayloadDataIdentityKey([['tenants', firstTenants]]),
        }, compute);
        const second = memo.getOrCompute({
            ...key,
            dataIdentityKey: savePayloadDataIdentityKey([['tenants', secondTenants]]),
        }, compute);

        expect(second.total).toBe(2);
        expect(compute).toHaveBeenCalledTimes(2);
    });

    it('normalizes collection keys independent of input order', () => {
        expect(savePayloadCollectionsKey(['pb_tenants', 'pb_units'])).toBe('pb_tenants,pb_units');
        expect(savePayloadCollectionsKey(['pb_units', 'pb_tenants'])).toBe('pb_tenants,pb_units');
        expect(savePayloadCollectionsKey([])).toBe('<all>');
    });

    it('builds identity keys from object identity without serializing object contents', () => {
        const tenants = [{ id: 't1' }];
        expect(savePayloadDataIdentityKey([['tenants', tenants]]))
            .toBe(savePayloadDataIdentityKey([['tenants', tenants]]));
        expect(savePayloadDataIdentityKey([])).toBe('<empty>');
    });
});
