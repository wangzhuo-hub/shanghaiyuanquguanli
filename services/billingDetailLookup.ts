import type { BillingDetail } from '../types';

export const billingDetailRowKey = (
    detail: Pick<BillingDetail, 'tenantId' | 'feeKind'>,
): string => `${detail.feeKind || 'rent'}|${detail.tenantId}`;

export function buildBillingDetailByRowKey(rows: BillingDetail[]): Map<string, BillingDetail> {
    const byKey = new Map<string, BillingDetail>();
    for (const row of rows) {
        const key = billingDetailRowKey(row);
        if (!byKey.has(key)) byKey.set(key, row);
    }
    return byKey;
}
