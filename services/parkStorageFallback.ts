export type ParkStringStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): ParkStringStorage | null => {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
};

export const getParkStorageFallbackMetaKey = (key: string): string => `${key}::fallback_pending`;

export const putParkStorageFallback = (
    key: string,
    jsonStr: string,
    storage: ParkStringStorage | null = browserStorage(),
): boolean => {
    if (!storage) return false;
    try {
        storage.setItem(key, jsonStr);
        storage.setItem(getParkStorageFallbackMetaKey(key), String(Date.now()));
        return true;
    } catch {
        return false;
    }
};

export const clearParkStorageFallbackIfMatches = (
    key: string,
    jsonStr: string,
    primaryWriteStartedAtMsOrStorage?: number | ParkStringStorage | null,
    storageArg?: ParkStringStorage | null,
): void => {
    const primaryWriteStartedAtMs =
        typeof primaryWriteStartedAtMsOrStorage === 'number' ? primaryWriteStartedAtMsOrStorage : undefined;
    const storage =
        typeof primaryWriteStartedAtMsOrStorage === 'object'
            ? primaryWriteStartedAtMsOrStorage
            : storageArg === undefined
              ? browserStorage()
              : storageArg;
    if (!storage) return;
    try {
        const metaKey = getParkStorageFallbackMetaKey(key);
        const stored = storage.getItem(key);
        const markerRaw = storage.getItem(metaKey);
        const markerMs = Number(markerRaw);
        const isOlderThanPrimaryWrite =
            primaryWriteStartedAtMs !== undefined &&
            markerRaw !== null &&
            Number.isFinite(markerMs) &&
            markerMs < primaryWriteStartedAtMs;

        if (stored === jsonStr || isOlderThanPrimaryWrite) {
            storage.removeItem(key);
            storage.removeItem(metaKey);
        }
    } catch {
        // Ignore localStorage cleanup failures; IndexedDB remains the primary cache.
    }
};

export const getMarkedParkStorageFallback = (
    key: string,
    storage: ParkStringStorage | null = browserStorage(),
): string | null => {
    if (!storage) return null;
    try {
        const legacy = storage.getItem(key);
        if (!legacy) return null;
        return storage.getItem(getParkStorageFallbackMetaKey(key)) ? legacy : null;
    } catch {
        return null;
    }
};

export const clearUnmarkedParkStorageLegacy = (
    key: string,
    storage: ParkStringStorage | null = browserStorage(),
): void => {
    if (!storage) return;
    try {
        if (storage.getItem(key) !== null && storage.getItem(getParkStorageFallbackMetaKey(key)) === null) {
            storage.removeItem(key);
        }
    } catch {
        // Ignore local legacy cleanup failures; IndexedDB remains the primary cache.
    }
};

export type ReadParkDataCacheOptions = {
    cacheGet: (key: string) => Promise<string | null>;
    cachePut: (key: string, value: string) => Promise<boolean>;
    storage?: ParkStringStorage | null;
};

export const readParkDataCache = async (
    key: string,
    options: ReadParkDataCacheOptions,
): Promise<string | null> => {
    const storage = options.storage === undefined ? browserStorage() : options.storage;
    const markedFallback = getMarkedParkStorageFallback(key, storage);
    if (markedFallback) {
        const migrated = await options.cachePut(key, markedFallback).catch(() => false);
        if (migrated) clearParkStorageFallbackIfMatches(key, markedFallback, undefined, storage);
        return markedFallback;
    }

    const cached = await options.cacheGet(key);
    if (cached) {
        clearUnmarkedParkStorageLegacy(key, storage);
        return cached;
    }

    try {
        const legacy = storage?.getItem(key);
        if (legacy) {
            const migrated = await options.cachePut(key, legacy).catch(() => false);
            if (migrated) clearParkStorageFallbackIfMatches(key, legacy, undefined, storage);
            return legacy;
        }
    } catch {
        // Local legacy cache is best-effort only.
    }
    return null;
};
