import { describe, expect, it } from 'vitest';
import type { DashboardData } from '../../types';
import {
    mergeLocalDashboardCacheIntoCloud,
    mergeManualReceivableLineNotes,
    mergePaymentsFromLocalCache,
    mergeSpecialBusinessReceivableNotes,
} from '../localCloudMerge';

const base = (): DashboardData =>
    ({
        buildings: [],
        tenants: [{ id: 't1', name: '喜柿', isSpecialBusiness: false } as any],
        payments: [{ id: 'p1', tenantId: 't1', amount: 100 } as any],
        billingPeriodNotes: {},
    }) as unknown as DashboardData;

describe('mergeLocalDashboardCacheIntoCloud', () => {
    it('无差异时不标记 recovered', () => {
        const cloud = base();
        const local = base();
        const { data, recovered } = mergeLocalDashboardCacheIntoCloud(cloud, local);
        expect(recovered).toBe(false);
        expect(data).toBe(cloud);
    });

    it('补回本地特殊业态备注；收款仅在本地版本更高时补回', () => {
        const cloud = { ...base(), cloudSaveVersion: 3 };
        const local = {
            ...base(),
            cloudSaveVersion: 4,
            billingPeriodNotes: {
                __special_business_receivables_v1__: '[{"tenantId":"t1","periodYYYYMM":"2026-05","amount":12000,"updatedAt":"2026-05-25T10:00:00.000Z"}]',
            },
            payments: [
                { id: 'p1', tenantId: 't1', amount: 100 } as any,
                { id: 'p_new', tenantId: 't1', amount: 200 } as any,
            ],
            tenants: [{ id: 't1', name: '喜柿', isSpecialBusiness: true } as any],
        };
        const { data, recovered } = mergeLocalDashboardCacheIntoCloud(cloud, local);
        expect(recovered).toBe(true);
        expect(data.billingPeriodNotes?.__special_business_receivables_v1__).toContain('12000');
        expect(data.payments?.some((p) => p.id === 'p_new')).toBe(true);
        expect(data.tenants?.[0]?.isSpecialBusiness).toBe(true);
    });

    it('云端已删的收款不会被 localStorage resurrect', () => {
        const cloud = {
            ...base(),
            cloudSaveVersion: 5,
            payments: [{ id: 'p1', tenantId: 't1', amount: 100 } as any],
        };
        const local = {
            ...base(),
            cloudSaveVersion: 5,
            payments: [
                { id: 'p1', tenantId: 't1', amount: 100 } as any,
                { id: 'p_deleted', tenantId: 't1', amount: 999 } as any,
            ],
        };
        const { data, recovered } = mergeLocalDashboardCacheIntoCloud(cloud, local);
        expect(recovered).toBe(false);
        expect(data.payments?.map((p) => p.id)).toEqual(['p1']);
    });

    it('云端已删的特殊业态行不会被 localStorage 整包 resurrect', () => {
        const cloud = {
            ...base(),
            billingPeriodNotes: {
                __special_business_receivables_v1__:
                    '[{"id":"sbiz_t1_2026-05","tenantId":"t1","periodYYYYMM":"2026-05","amount":1000,"updatedAt":"2026-05-23T08:00:00.000Z"}]',
            },
        };
        const local = {
            ...base(),
            billingPeriodNotes: {
                __special_business_receivables_v1__:
                    '[{"id":"sbiz_t1_2026-05","tenantId":"t1","periodYYYYMM":"2026-05","amount":1000,"updatedAt":"2026-05-20T08:00:00.000Z"},{"id":"sbiz_t2_2026-05","tenantId":"t2","periodYYYYMM":"2026-05","amount":2000,"updatedAt":"2026-05-20T08:00:00.000Z"}]',
            },
        };
        const { data, recovered } = mergeLocalDashboardCacheIntoCloud(cloud, local);
        expect(recovered).toBe(false);
        const parsed = JSON.parse(data.billingPeriodNotes!.__special_business_receivables_v1__!);
        expect(parsed).toHaveLength(1);
        expect(parsed[0].tenantId).toBe('t1');
    });
});

describe('mergeSpecialBusinessReceivableNotes', () => {
    it('保留云端删除结果，仅补回 local 中更新更晚的新增行', () => {
        const cloud =
            '[{"id":"sbiz_a_2026-05","tenantId":"a","periodYYYYMM":"2026-05","amount":1,"updatedAt":"2026-05-23T12:00:00.000Z"}]';
        const local =
            '[{"id":"sbiz_a_2026-05","tenantId":"a","periodYYYYMM":"2026-05","amount":1,"updatedAt":"2026-05-20T08:00:00.000Z"},{"id":"sbiz_b_2026-05","tenantId":"b","periodYYYYMM":"2026-05","amount":2,"updatedAt":"2026-05-20T08:00:00.000Z"},{"id":"sbiz_c_2026-05","tenantId":"c","periodYYYYMM":"2026-05","amount":3,"updatedAt":"2026-05-24T09:00:00.000Z"}]';
        const merged = JSON.parse(mergeSpecialBusinessReceivableNotes(cloud, local)!);
        expect(merged.map((r: any) => r.tenantId).sort()).toEqual(['a', 'c']);
    });
});

describe('mergePaymentsFromLocalCache', () => {
    it('版本相同或云端更新时，不补回 local-only 收款', () => {
        const cloud = [{ id: 'p1', tenantId: 't1', amount: 1 } as any];
        const local = [
            { id: 'p1', tenantId: 't1', amount: 1 } as any,
            { id: 'p_old', tenantId: 't1', amount: 9 } as any,
        ];
        expect(mergePaymentsFromLocalCache(cloud, local, 5, 5).payments.map((p) => p.id)).toEqual(['p1']);
        expect(mergePaymentsFromLocalCache(cloud, local, 6, 5).payments.map((p) => p.id)).toEqual(['p1']);
    });

    it('本地版本更高时可补回未落库的新增收款', () => {
        const cloud = [{ id: 'p1', tenantId: 't1', amount: 1 } as any];
        const local = [
            { id: 'p1', tenantId: 't1', amount: 1 } as any,
            { id: 'p_new', tenantId: 't1', amount: 2 } as any,
        ];
        const { payments, recovered } = mergePaymentsFromLocalCache(cloud, local, 3, 4);
        expect(recovered).toBe(true);
        expect(payments.map((p) => p.id)).toEqual(['p_new', 'p1']);
    });
});

describe('mergeManualReceivableLineNotes', () => {
    it('云端已有数据时不再从 local 补回已删行', () => {
        const cloud = '[{"id":"m1","customerLabel":"A","amount":100,"periodYYYYMM":"2026-05"}]';
        const local =
            '[{"id":"m1","customerLabel":"A","amount":100,"periodYYYYMM":"2026-05"},{"id":"m2","customerLabel":"B","amount":200,"periodYYYYMM":"2026-05"}]';
        expect(mergeManualReceivableLineNotes(cloud, local)).toBe(cloud);
    });

    it('云端为空时仍用 local 补回未落库手工行', () => {
        const local = '[{"id":"m2","customerLabel":"B","amount":200,"periodYYYYMM":"2026-05"}]';
        expect(mergeManualReceivableLineNotes(undefined, local)).toBe(local);
    });
});
