import type { BudgetedBill } from './billingService';
import type { CloudBudgetedBillsPreviewBatchResult } from './cloudComputeClient';

export type BudgetedBillPreviewBatchLookup =
    | { ok: true; billsById: Map<string, BudgetedBill[]> }
    | { ok: false; message: string };

export type BudgetedBillPreviewBatchItem = {
    id: string;
    bills: BudgetedBill[];
};

export function indexBudgetedBillPreviewBatchResult(
    result: CloudBudgetedBillsPreviewBatchResult,
    requiredIds: string[],
): BudgetedBillPreviewBatchLookup {
    if (!result.success) {
        return { ok: false, message: result.message || '后台批量账单预览计算失败。' };
    }
    if (!Array.isArray(result.items)) {
        return { ok: false, message: '后台批量账单预览结果缺少 items。' };
    }

    const billsById = new Map<string, BudgetedBill[]>();
    for (const item of result.items) {
        if (!item.id) continue;
        billsById.set(item.id, item.bills || []);
    }

    const missingIds = requiredIds.filter((id) => !billsById.has(id));
    if (missingIds.length > 0) {
        return {
            ok: false,
            message: `后台批量账单预览结果缺少 ${missingIds.join(', ')}。`,
        };
    }

    return { ok: true, billsById };
}

export function resolveBudgetedBillPreviewBatchItems(
    result: CloudBudgetedBillsPreviewBatchResult,
    requiredIds: string[],
): { ok: true; items: BudgetedBillPreviewBatchItem[] } | { ok: false; message: string } {
    const lookup = indexBudgetedBillPreviewBatchResult(result, requiredIds);
    if (!lookup.ok) return lookup;

    return {
        ok: true,
        items: requiredIds.map((id) => ({
            id,
            bills: lookup.billsById.get(id) || [],
        })),
    };
}
