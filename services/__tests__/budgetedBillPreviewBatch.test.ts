import { describe, expect, it } from 'vitest';
import type { BudgetedBill } from '../billingService';
import {
    indexBudgetedBillPreviewBatchResult,
    resolveBudgetedBillPreviewBatchItems,
} from '../budgetedBillPreviewBatch';

const bill = (amount: number): BudgetedBill => ({
    date: new Date('2026-01-01T00:00:00.000Z'),
    amount,
});

describe('budgeted bill preview batch lookup', () => {
    it('indexes batch bills by explicit item id', () => {
        const lookup = indexBudgetedBillPreviewBatchResult({
            success: true,
            items: [
                { id: 'budget', bills: [bill(100)], count: 1 },
                { id: 'raw', bills: [bill(80)], count: 1 },
            ],
        }, ['budget', 'raw']);

        expect(lookup.ok).toBe(true);
        if (lookup.ok) {
            expect(lookup.billsById.get('budget')?.[0].amount).toBe(100);
            expect(lookup.billsById.get('raw')?.[0].amount).toBe(80);
        }
    });

    it('rejects incomplete successful batch results', () => {
        const lookup = indexBudgetedBillPreviewBatchResult({
            success: true,
            items: [
                { id: 'budget', bills: [bill(100)], count: 1 },
            ],
        }, ['budget', 'raw']);

        expect(lookup).toEqual({
            ok: false,
            message: '后台批量账单预览结果缺少 raw。',
        });
    });

    it('passes through backend failure messages', () => {
        const lookup = indexBudgetedBillPreviewBatchResult({
            success: false,
            message: '服务端计算失败',
        }, ['budget']);

        expect(lookup).toEqual({
            ok: false,
            message: '服务端计算失败',
        });
    });

    it('returns required batch items in request order', () => {
        const result = resolveBudgetedBillPreviewBatchItems({
            success: true,
            items: [
                { id: 'tenant-b', bills: [bill(200)], count: 1 },
                { id: 'tenant-a', bills: [bill(100)], count: 1 },
            ],
        }, ['tenant-a', 'tenant-b']);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.items.map((item) => item.id)).toEqual(['tenant-a', 'tenant-b']);
            expect(result.items.map((item) => item.bills[0].amount)).toEqual([100, 200]);
        }
    });

    it('treats zero-bill required items as complete results', () => {
        const result = resolveBudgetedBillPreviewBatchItems({
            success: true,
            items: [
                { id: 'tenant-empty', bills: [], count: 0 },
            ],
        }, ['tenant-empty']);

        expect(result).toEqual({
            ok: true,
            items: [{ id: 'tenant-empty', bills: [] }],
        });
    });
});
