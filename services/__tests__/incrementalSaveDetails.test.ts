import { describe, expect, it } from 'vitest';
import {
    formatIncrementalSaveAlertTitle,
    formatIncrementalSaveDetails,
    type SaveIncrementalResult,
} from '../pocketbaseService';

const baseResult = (): SaveIncrementalResult => ({
    success: false,
    applied: [],
    conflicts: [],
    errors: [],
    message: '增量保存部分完成：成功 1 条，失败 4 条',
});

describe('formatIncrementalSaveDetails', () => {
    it('uses partial-success title when some rows applied', () => {
        const result = {
            ...baseResult(),
            applied: [{ collection: 'pb_payments', originalId: 'p1', op: 'update' as const, newUpdated: 't1' }],
            errors: [
                {
                    collection: 'pb_billing_period_notes',
                    originalId: 'billing_period_notes',
                    op: 'update' as const,
                    message: 'Something went wrong while processing your request.',
                },
            ],
        };
        expect(formatIncrementalSaveAlertTitle(result)).toBe('部分保存成功');
        const text = formatIncrementalSaveDetails(result, {
            labelFor: (collection, originalId) =>
                collection === 'pb_payments' ? '浙江智行微电子 · 2026-05-21' : undefined,
        });
        expect(text).toContain('成功 1 条，失败 1 条');
        expect(text).toContain('已成功写入：');
        expect(text).toContain('浙江智行微电子 · 2026-05-21');
        expect(text).toContain('失败明细：');
        expect(text).toContain('账期备注');
    });
});
