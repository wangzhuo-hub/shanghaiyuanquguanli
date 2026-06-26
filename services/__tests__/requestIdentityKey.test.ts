import { describe, expect, it } from 'vitest';
import { collectionIdentityKey, objectIdentityKey } from '../requestIdentityKey';

describe('requestIdentityKey', () => {
    it('keeps object identities stable without serializing object content', () => {
        const item = { id: 'a', amount: 1 };
        const sameRef = item;
        const sameContent = { id: 'a', amount: 1 };

        expect(objectIdentityKey(item)).toBe(objectIdentityKey(sameRef));
        expect(objectIdentityKey(item)).not.toBe(objectIdentityKey(sameContent));
    });

    it('reflects collection membership by item reference', () => {
        const first = { id: 'first' };
        const second = { id: 'second' };
        const replacement = { id: 'second' };
        const original = [first, second];
        const changed = [first, replacement];

        expect(collectionIdentityKey(original)).toBe(collectionIdentityKey(original));
        expect(collectionIdentityKey(original)).not.toBe(collectionIdentityKey(changed));
    });

    it('reflects in-place collection membership changes', () => {
        const first = { id: 'first' };
        const second = { id: 'second' };
        const replacement = { id: 'replacement' };
        const items = [first, second];

        const before = collectionIdentityKey(items);
        items[1] = replacement;

        expect(collectionIdentityKey(items)).not.toBe(before);
    });
});
