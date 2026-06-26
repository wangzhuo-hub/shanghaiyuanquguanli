const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

export const objectIdentityKey = (value: unknown): string => {
    if (value === null) return 'null';
    const type = typeof value;
    if (type !== 'object' && type !== 'function') return `${type}:${String(value)}`;
    const objectValue = value as object;
    let id = objectIds.get(objectValue);
    if (!id) {
        id = nextObjectId++;
        objectIds.set(objectValue, id);
    }
    return `${Array.isArray(value) ? 'array' : 'object'}:${id}`;
};

export const collectionIdentityKey = (items: readonly unknown[] | undefined | null): string => {
    if (!items) return 'collection:null';
    return [
        objectIdentityKey(items),
        `len:${items.length}`,
        items.map(objectIdentityKey).join(','),
    ].join('|');
};
