/**
 * DirtyTracker —— 招商看板「增量保存」改造的核心数据结构
 *
 * 用途：
 *   - 业务组件在修改 React state 的同时，调用 markCreate/markUpdate/markDelete
 *     把 dirty 行登记进来。
 *   - 保存按钮一次性取出 getPayload()，交给 saveIncrementalToCloud 提交。
 *
 * 关键合并规则（避免重复 / 抵消）：
 *   1. 同一 originalId 多次 update -> 字段后者覆盖前者，baseUpdated 取最早一次
 *      （因为乐观锁要比对的是「用户加载该行时」的 updated，而非中间态）
 *   2. 先 create 后 update -> 仍按 create 提交，update 的字段合并进 create record
 *   3. 先 create 后 delete -> 直接抵消（从未提交过给服务端，无须 DELETE）
 *   4. 先 update 后 delete -> 只发 DELETE，丢弃 update（用最新一次 update 的 baseUpdated）
 *   5. delete 之后又 create -> 视为复活，按 create 处理
 *
 * 仅做内存登记，不直接发起网络请求。
 */

export type CollectionName = string;

/**
 * 业务侧对一条记录的不可变识别。
 * 在招商看板里，每条记录都有一个 `original_id`（业务主键，例如租户的 t.id）。
 * DirtyTracker 内部使用它作为合并键。
 */
export type OriginalId = string;

export interface DirtyCreate<TRecord = Record<string, any>> {
    originalId: OriginalId;
    /** 写入 PocketBase 的完整字段（不含 PocketBase 自动管理的 id/created/updated） */
    data: TRecord;
}

export interface DirtyUpdate<TFields = Record<string, any>> {
    originalId: OriginalId;
    /** 仅本次保存需要 PATCH 的字段（多次 markUpdate 后已合并） */
    changedFields: TFields;
    /**
     * 用户「加载该行时」的服务端 updated 时间戳，作为行级乐观锁基准。
     * 保存时若服务端 updated !== baseUpdated，则视为冲突。
     */
    baseUpdated: string;
}

export interface DirtyDelete {
    originalId: OriginalId;
    baseUpdated: string;
}

export interface CollectionDirtyBucket<TRecord = Record<string, any>> {
    creates: DirtyCreate<TRecord>[];
    updates: DirtyUpdate[];
    deletes: DirtyDelete[];
}

export type DirtyPayload = Record<CollectionName, CollectionDirtyBucket>;

/** 内部存储：方便按 originalId O(1) 合并，对外 getPayload() 时再展平为数组 */
interface InternalBucket {
    creates: Map<OriginalId, DirtyCreate>;
    updates: Map<OriginalId, DirtyUpdate>;
    deletes: Map<OriginalId, DirtyDelete>;
}

const emptyBucket = (): InternalBucket => ({
    creates: new Map(),
    updates: new Map(),
    deletes: new Map(),
});

const isPlainObject = (v: unknown): v is Record<string, any> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

export class DirtyTracker {
    private buckets: Map<CollectionName, InternalBucket> = new Map();

    private bucket(collection: CollectionName): InternalBucket {
        let b = this.buckets.get(collection);
        if (!b) {
            b = emptyBucket();
            this.buckets.set(collection, b);
        }
        return b;
    }

    /**
     * 登记新增。`record` 必须自带 `id`（业务主键，对应 PocketBase 的 original_id）。
     * 如果之前对同一 originalId 已经 markDelete，则视为「先删后增」=> 复活成新建。
     */
    markCreate(collection: CollectionName, record: Record<string, any>): void {
        if (!isPlainObject(record)) {
            throw new TypeError('DirtyTracker.markCreate: record 必须是对象');
        }
        const originalId = String(record.id ?? record.originalId ?? '');
        if (!originalId) {
            throw new Error('DirtyTracker.markCreate: record 必须包含 id（业务主键）');
        }
        const b = this.bucket(collection);
        // 抵消之前的 delete
        b.deletes.delete(originalId);
        // 之前若已是 update，新建覆盖之（按业务语义不应发生，这里宽容处理）
        b.updates.delete(originalId);
        b.creates.set(originalId, { originalId, data: { ...record } });
    }

    /**
     * 登记更新。
     * - changedFields 只包含本次真正改动的字段；多次 markUpdate 会合并。
     * - baseUpdated 是用户加载该行时的服务端 updated；同一行多次 markUpdate 时
     *   保留最早一次的 baseUpdated（因为乐观锁基准不变）。
     */
    markUpdate(
        collection: CollectionName,
        originalId: OriginalId,
        changedFields: Record<string, any>,
        baseUpdated: string
    ): void {
        if (!originalId) {
            throw new Error('DirtyTracker.markUpdate: originalId 不能为空');
        }
        if (!isPlainObject(changedFields)) {
            throw new TypeError('DirtyTracker.markUpdate: changedFields 必须是对象');
        }
        const b = this.bucket(collection);

        if (b.deletes.has(originalId)) {
            // 已经标记删除的记录又被改 —— 视为撤销 delete 然后改
            b.deletes.delete(originalId);
        }

        if (b.creates.has(originalId)) {
            // 还没提交过的新增 —— 直接把改动合并进 create record
            const prev = b.creates.get(originalId)!;
            b.creates.set(originalId, {
                originalId,
                data: { ...prev.data, ...changedFields },
            });
            return;
        }

        const existing = b.updates.get(originalId);
        if (existing) {
            b.updates.set(originalId, {
                originalId,
                changedFields: { ...existing.changedFields, ...changedFields },
                // 保留最早一次的 baseUpdated，因为乐观锁基准应是用户「加载时」的版本
                baseUpdated: existing.baseUpdated,
            });
            return;
        }

        b.updates.set(originalId, {
            originalId,
            changedFields: { ...changedFields },
            baseUpdated,
        });
    }

    /**
     * 登记删除。
     * - 如果之前是 markCreate（还没提交给服务端） => 直接抵消，不再 DELETE
     * - 如果之前是 markUpdate => 取消 update，登记 delete（用最新一次 markDelete 的 baseUpdated）
     */
    markDelete(collection: CollectionName, originalId: OriginalId, baseUpdated: string): void {
        if (!originalId) {
            throw new Error('DirtyTracker.markDelete: originalId 不能为空');
        }
        const b = this.bucket(collection);
        if (b.creates.has(originalId)) {
            b.creates.delete(originalId);
            // 抵消，不需要 delete
            return;
        }
        b.updates.delete(originalId);
        b.deletes.set(originalId, { originalId, baseUpdated });
    }

    /** 清空所有登记。一般在「保存成功 + 重新拉取 recordMeta」之后调用。 */
    reset(): void {
        this.buckets.clear();
    }

    /** 仅清空指定 collection；很少用，主要给单测便利。 */
    resetCollection(collection: CollectionName): void {
        this.buckets.delete(collection);
    }

    isEmpty(): boolean {
        return this.size() === 0;
    }

    /** 总条目数（creates + updates + deletes） */
    size(): number {
        let n = 0;
        for (const b of this.buckets.values()) {
            n += b.creates.size + b.updates.size + b.deletes.size;
        }
        return n;
    }

    /** 单 collection 内的条目数 */
    sizeOf(collection: CollectionName): number {
        const b = this.buckets.get(collection);
        if (!b) return 0;
        return b.creates.size + b.updates.size + b.deletes.size;
    }

    /** 导出可序列化结构。返回的对象互不引用内部 Map，可直接交给网络层。 */
    getPayload(): DirtyPayload {
        const out: DirtyPayload = {};
        for (const [collection, b] of this.buckets.entries()) {
            if (b.creates.size === 0 && b.updates.size === 0 && b.deletes.size === 0) {
                continue;
            }
            out[collection] = {
                creates: Array.from(b.creates.values()).map((c) => ({
                    originalId: c.originalId,
                    data: { ...c.data },
                })),
                updates: Array.from(b.updates.values()).map((u) => ({
                    originalId: u.originalId,
                    changedFields: { ...u.changedFields },
                    baseUpdated: u.baseUpdated,
                })),
                deletes: Array.from(b.deletes.values()).map((d) => ({
                    originalId: d.originalId,
                    baseUpdated: d.baseUpdated,
                })),
            };
        }
        return out;
    }

    /** 调试用：人类可读的摘要 */
    describe(): string {
        const lines: string[] = [];
        for (const [collection, b] of this.buckets.entries()) {
            lines.push(
                `${collection}: +${b.creates.size} ~${b.updates.size} -${b.deletes.size}`
            );
        }
        return lines.join('\n') || '<empty>';
    }
}

/** 默认导出一个共享实例，App 顶层会替换为通过 Context 提供的实例 */
export const dirtyTracker = new DirtyTracker();
