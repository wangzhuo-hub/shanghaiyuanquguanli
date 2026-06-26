export interface SavePayloadMemoKey {
    dataRef: unknown;
    dataIdentityKey?: string;
    baselineRef: unknown;
    recordMetaRef: unknown;
    projectId: string;
    baselineRevision: number;
    collectionsKey: string;
    authScopeKey: string;
}

const objectIdentityIds = new WeakMap<object, number>();
let objectIdentitySeq = 0;

const valueIdentityToken = (value: unknown): string => {
    if ((typeof value === 'object' && value !== null) || typeof value === 'function') {
        const obj = value as object;
        const existing = objectIdentityIds.get(obj);
        if (existing !== undefined) return `o:${existing}`;
        objectIdentitySeq += 1;
        objectIdentityIds.set(obj, objectIdentitySeq);
        return `o:${objectIdentitySeq}`;
    }
    return `p:${typeof value}:${String(value)}`;
};

export const savePayloadDataIdentityKey = (parts: Iterable<[string, unknown]>): string => {
    const values = Array.from(parts).map(([key, value]) => `${key}=${valueIdentityToken(value)}`);
    return values.length > 0 ? values.join('|') : '<empty>';
};

const sameMemoKey = (a: SavePayloadMemoKey, b: SavePayloadMemoKey): boolean =>
    (a.dataIdentityKey !== undefined || b.dataIdentityKey !== undefined
        ? a.dataIdentityKey === b.dataIdentityKey
        : a.dataRef === b.dataRef) &&
    a.baselineRef === b.baselineRef &&
    a.recordMetaRef === b.recordMetaRef &&
    a.projectId === b.projectId &&
    a.baselineRevision === b.baselineRevision &&
    a.collectionsKey === b.collectionsKey &&
    a.authScopeKey === b.authScopeKey;

export const savePayloadCollectionsKey = (collections: Iterable<string>): string => {
    const values = Array.from(collections).map(String).filter(Boolean).sort();
    return values.length > 0 ? values.join(',') : '<all>';
};

export class LastSavePayloadMemo<TPayload> {
    private entry: { key: SavePayloadMemoKey; payload: TPayload } | null = null;

    getOrCompute(key: SavePayloadMemoKey, compute: () => TPayload): TPayload {
        if (this.entry && sameMemoKey(this.entry.key, key)) {
            return this.entry.payload;
        }
        const payload = compute();
        this.entry = { key, payload };
        return payload;
    }

    clear(): void {
        this.entry = null;
    }
}
