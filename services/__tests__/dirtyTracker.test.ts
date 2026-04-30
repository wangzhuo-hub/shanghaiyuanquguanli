import { describe, it, expect, beforeEach } from 'vitest';
import { DirtyTracker } from '../dirtyTracker';

describe('DirtyTracker', () => {
    let tracker: DirtyTracker;

    beforeEach(() => {
        tracker = new DirtyTracker();
    });

    describe('基础登记', () => {
        it('初始为空', () => {
            expect(tracker.isEmpty()).toBe(true);
            expect(tracker.size()).toBe(0);
            expect(tracker.getPayload()).toEqual({});
        });

        it('markCreate 写入 creates 桶', () => {
            tracker.markCreate('pb_tenants', { id: 't1', name: '张三', monthly_rent: 1000 });
            expect(tracker.isEmpty()).toBe(false);
            expect(tracker.size()).toBe(1);
            expect(tracker.sizeOf('pb_tenants')).toBe(1);

            const payload = tracker.getPayload();
            expect(payload.pb_tenants.creates).toHaveLength(1);
            expect(payload.pb_tenants.creates[0]).toEqual({
                originalId: 't1',
                data: { id: 't1', name: '张三', monthly_rent: 1000 },
            });
            expect(payload.pb_tenants.updates).toHaveLength(0);
            expect(payload.pb_tenants.deletes).toHaveLength(0);
        });

        it('markCreate 必须包含业务主键 id', () => {
            expect(() =>
                tracker.markCreate('pb_tenants', { name: '匿名' } as any)
            ).toThrow(/必须包含 id/);
        });

        it('markUpdate 写入 updates 桶并保留 baseUpdated', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.updates).toEqual([
                {
                    originalId: 't1',
                    changedFields: { monthly_rent: 2000 },
                    baseUpdated: '2026-04-21T10:00:00.000Z',
                },
            ]);
        });

        it('markDelete 写入 deletes 桶', () => {
            tracker.markDelete('pb_tenants', 't1', '2026-04-21T10:00:00.000Z');
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.deletes).toEqual([
                { originalId: 't1', baseUpdated: '2026-04-21T10:00:00.000Z' },
            ]);
        });
    });

    describe('合并规则', () => {
        // 场景 A：用户改了租户张三月租，saveIncremental 只发一个 PATCH
        it('场景 A：单次 update 只发一个 PATCH', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.updates).toHaveLength(1);
            expect(payload.pb_tenants.creates).toHaveLength(0);
            expect(payload.pb_tenants.deletes).toHaveLength(0);
        });

        // 场景 B：同一条记录连续改 3 次，最终只发一个 PATCH，字段为最终值
        it('场景 B：同一记录 3 次 update -> 合并为一个 PATCH，字段后者覆盖前者', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 1500 },
                '2026-04-21T10:00:00.000Z'
            );
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 1800, contact_info: '13800000000' },
                '2026-04-21T10:00:30.000Z'
            );
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:01:00.000Z'
            );
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.updates).toHaveLength(1);
            expect(payload.pb_tenants.updates[0]).toEqual({
                originalId: 't1',
                changedFields: { monthly_rent: 2000, contact_info: '13800000000' },
                // 保留最早的 baseUpdated
                baseUpdated: '2026-04-21T10:00:00.000Z',
            });
        });

        // 场景 C：先 create 后 update，合并为一个 POST
        it('场景 C：create 后 update -> 合并为一个 create', () => {
            tracker.markCreate('pb_tenants', {
                id: 't_new',
                name: '新租户',
                monthly_rent: 1000,
            });
            tracker.markUpdate(
                'pb_tenants',
                't_new',
                { monthly_rent: 1500, contact_info: '13900000000' },
                '2026-04-21T10:00:00.000Z'
            );
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.creates).toHaveLength(1);
            expect(payload.pb_tenants.updates).toHaveLength(0);
            expect(payload.pb_tenants.creates[0].data).toEqual({
                id: 't_new',
                name: '新租户',
                monthly_rent: 1500,
                contact_info: '13900000000',
            });
        });

        // 场景 D：update 后 delete，只发一个 DELETE
        it('场景 D：update 后 delete -> 只剩 delete', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            tracker.markDelete('pb_tenants', 't1', '2026-04-21T10:01:00.000Z');
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.updates).toHaveLength(0);
            expect(payload.pb_tenants.deletes).toEqual([
                { originalId: 't1', baseUpdated: '2026-04-21T10:01:00.000Z' },
            ]);
        });

        it('create 后 delete -> 直接抵消，不留任何条目', () => {
            tracker.markCreate('pb_tenants', { id: 't_new', name: '昙花一现' });
            tracker.markDelete('pb_tenants', 't_new', '2026-04-21T10:00:00.000Z');
            expect(tracker.isEmpty()).toBe(true);
            expect(tracker.getPayload()).toEqual({});
        });

        it('delete 后 create -> 视为复活，按 create 处理', () => {
            tracker.markDelete('pb_tenants', 't1', '2026-04-21T10:00:00.000Z');
            tracker.markCreate('pb_tenants', { id: 't1', name: '复活', monthly_rent: 999 });
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.deletes).toHaveLength(0);
            expect(payload.pb_tenants.creates).toHaveLength(1);
            expect(payload.pb_tenants.creates[0].data.name).toBe('复活');
        });

        it('多次 markUpdate 不同字段 -> 合并所有字段', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { contact_info: '13800000000' },
                '2026-04-21T10:00:01.000Z'
            );
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { industry: 'IT' },
                '2026-04-21T10:00:02.000Z'
            );
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.updates[0].changedFields).toEqual({
                monthly_rent: 2000,
                contact_info: '13800000000',
                industry: 'IT',
            });
            expect(payload.pb_tenants.updates[0].baseUpdated).toBe(
                '2026-04-21T10:00:00.000Z'
            );
        });
    });

    describe('多 collection 隔离', () => {
        it('不同 collection 不互相影响', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            tracker.markUpdate(
                'pb_units',
                'u1',
                { status: 'Vacant' },
                '2026-04-21T10:00:00.000Z'
            );
            const payload = tracker.getPayload();
            expect(Object.keys(payload).sort()).toEqual(['pb_tenants', 'pb_units']);
            expect(payload.pb_tenants.updates).toHaveLength(1);
            expect(payload.pb_units.updates).toHaveLength(1);
        });

        it('相同 originalId 在不同 collection 下互不干扰', () => {
            tracker.markCreate('pb_tenants', { id: 'shared', name: 'tenant' });
            tracker.markDelete('pb_units', 'shared', '2026-04-21T10:00:00.000Z');
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.creates).toHaveLength(1);
            expect(payload.pb_units.deletes).toHaveLength(1);
        });
    });

    describe('reset 与计数', () => {
        it('reset 清空所有桶', () => {
            tracker.markCreate('pb_tenants', { id: 't1' });
            tracker.markUpdate('pb_units', 'u1', { status: 'Vacant' }, '2026-04-21T10:00:00.000Z');
            expect(tracker.size()).toBe(2);
            tracker.reset();
            expect(tracker.isEmpty()).toBe(true);
            expect(tracker.getPayload()).toEqual({});
        });

        it('resetCollection 仅清空指定 collection', () => {
            tracker.markCreate('pb_tenants', { id: 't1' });
            tracker.markCreate('pb_units', { id: 'u1' });
            tracker.resetCollection('pb_tenants');
            expect(tracker.sizeOf('pb_tenants')).toBe(0);
            expect(tracker.sizeOf('pb_units')).toBe(1);
        });

        it('size 正确累计 creates+updates+deletes', () => {
            tracker.markCreate('pb_tenants', { id: 't1' });
            tracker.markUpdate('pb_tenants', 't2', { name: 'a' }, 'ts');
            tracker.markDelete('pb_tenants', 't3', 'ts');
            tracker.markUpdate('pb_units', 'u1', { status: 'Vacant' }, 'ts');
            expect(tracker.size()).toBe(4);
            expect(tracker.sizeOf('pb_tenants')).toBe(3);
            expect(tracker.sizeOf('pb_units')).toBe(1);
        });
    });

    describe('payload 不可变性', () => {
        it('修改返回的 payload 不影响内部状态', () => {
            tracker.markUpdate(
                'pb_tenants',
                't1',
                { monthly_rent: 2000 },
                '2026-04-21T10:00:00.000Z'
            );
            const payload = tracker.getPayload();
            payload.pb_tenants.updates[0].changedFields.monthly_rent = 9999;
            payload.pb_tenants.updates.push({
                originalId: 'evil',
                changedFields: {},
                baseUpdated: '',
            });

            const fresh = tracker.getPayload();
            expect(fresh.pb_tenants.updates).toHaveLength(1);
            expect(fresh.pb_tenants.updates[0].changedFields.monthly_rent).toBe(2000);
        });

        it('markCreate 后修改原始对象不影响 tracker 内部', () => {
            const record = { id: 't1', name: '张三', monthly_rent: 1000 };
            tracker.markCreate('pb_tenants', record);
            record.monthly_rent = 9999;
            const payload = tracker.getPayload();
            expect(payload.pb_tenants.creates[0].data.monthly_rent).toBe(1000);
        });
    });

    describe('describe()', () => {
        it('返回人类可读的摘要', () => {
            expect(tracker.describe()).toBe('<empty>');
            tracker.markCreate('pb_tenants', { id: 't1' });
            tracker.markUpdate('pb_tenants', 't2', { name: 'x' }, 'ts');
            tracker.markDelete('pb_tenants', 't3', 'ts');
            expect(tracker.describe()).toContain('pb_tenants: +1 ~1 -1');
        });
    });
});
