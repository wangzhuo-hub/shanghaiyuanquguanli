import { describe, expect, it, vi } from 'vitest';
import {
    clearParkStorageFallbackIfMatches,
    clearUnmarkedParkStorageLegacy,
    getMarkedParkStorageFallback,
    getParkStorageFallbackMetaKey,
    putParkStorageFallback,
    readParkDataCache,
    type ParkStringStorage,
} from '../parkStorageFallback';

const memoryStorage = (): ParkStringStorage & { dump: () => Record<string, string> } => {
    const map = new Map<string, string>();
    return {
        getItem: (key) => map.get(key) ?? null,
        setItem: (key, value) => {
            map.set(key, value);
        },
        removeItem: (key) => {
            map.delete(key);
        },
        dump: () => Object.fromEntries(map.entries()),
    };
};

describe('parkStorageFallback', () => {
    it('writes fallback data with a pending marker', () => {
        const storage = memoryStorage();

        expect(putParkStorageFallback('park:a', '{"tenants":[]}', storage)).toBe(true);

        expect(storage.getItem('park:a')).toBe('{"tenants":[]}');
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toMatch(/^\d+$/);
        expect(getMarkedParkStorageFallback('park:a', storage)).toBe('{"tenants":[]}');
    });

    it('clears fallback data only when it matches the primary persisted payload', () => {
        const storage = memoryStorage();
        putParkStorageFallback('park:a', 'old', storage);

        clearParkStorageFallbackIfMatches('park:a', 'new', storage);
        expect(storage.getItem('park:a')).toBe('old');
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).not.toBeNull();

        clearParkStorageFallbackIfMatches('park:a', 'old', storage);
        expect(storage.getItem('park:a')).toBeNull();
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toBeNull();
    });

    it('clears older mismatched fallback after a newer primary cache write succeeds', () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'stale-fallback');
        storage.setItem(getParkStorageFallbackMetaKey('park:a'), '1000');

        clearParkStorageFallbackIfMatches('park:a', 'indexed-newer', 2000, storage);

        expect(storage.getItem('park:a')).toBeNull();
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toBeNull();
    });

    it('keeps mismatched fallback written after the primary cache write started', () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'newer-fallback');
        storage.setItem(getParkStorageFallbackMetaKey('park:a'), '3000');

        clearParkStorageFallbackIfMatches('park:a', 'indexed-older', 2000, storage);

        expect(storage.getItem('park:a')).toBe('newer-fallback');
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toBe('3000');
    });

    it('keeps mismatched fallback with the same millisecond as the primary cache write start', () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'same-tick-fallback');
        storage.setItem(getParkStorageFallbackMetaKey('park:a'), '2000');

        clearParkStorageFallbackIfMatches('park:a', 'indexed-current', 2000, storage);

        expect(storage.getItem('park:a')).toBe('same-tick-fallback');
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toBe('2000');
    });

    it('clears unmarked legacy storage but preserves marked fallback data', () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'legacy-old');

        clearUnmarkedParkStorageLegacy('park:a', storage);

        expect(storage.getItem('park:a')).toBeNull();

        putParkStorageFallback('park:b', 'marked-fallback', storage);
        clearUnmarkedParkStorageLegacy('park:b', storage);

        expect(storage.getItem('park:b')).toBe('marked-fallback');
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:b'))).not.toBeNull();
    });

    it('prefers marked fallback over IndexedDB cache and clears it after migration', async () => {
        const storage = memoryStorage();
        putParkStorageFallback('park:a', 'fallback-newer', storage);
        const cacheGet = vi.fn(async () => 'indexed-old');
        const cachePut = vi.fn(async () => true);

        const result = await readParkDataCache('park:a', { cacheGet, cachePut, storage });

        expect(result).toBe('fallback-newer');
        expect(cacheGet).not.toHaveBeenCalled();
        expect(cachePut).toHaveBeenCalledWith('park:a', 'fallback-newer');
        expect(storage.getItem('park:a')).toBeNull();
        expect(storage.getItem(getParkStorageFallbackMetaKey('park:a'))).toBeNull();
    });

    it('uses IndexedDB cache before unmarked legacy localStorage', async () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'legacy-old');
        const cacheGet = vi.fn(async () => 'indexed-current');
        const cachePut = vi.fn(async () => true);

        const result = await readParkDataCache('park:a', { cacheGet, cachePut, storage });

        expect(result).toBe('indexed-current');
        expect(cachePut).not.toHaveBeenCalled();
        expect(storage.getItem('park:a')).toBeNull();
    });

    it('migrates unmarked legacy localStorage only when primary cache is empty', async () => {
        const storage = memoryStorage();
        storage.setItem('park:a', 'legacy-only');
        const cacheGet = vi.fn(async () => null);
        const cachePut = vi.fn(async () => true);

        const result = await readParkDataCache('park:a', { cacheGet, cachePut, storage });

        expect(result).toBe('legacy-only');
        expect(cachePut).toHaveBeenCalledWith('park:a', 'legacy-only');
        expect(storage.getItem('park:a')).toBeNull();
    });
});
