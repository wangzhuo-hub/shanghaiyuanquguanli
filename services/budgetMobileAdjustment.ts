import type { BudgetAdjustment } from '../types';

export const MOBILE_BUDGET_AMOUNT_ADJUSTMENT_REASON = '移动端单月预算调整';

const roundMoney2 = (value: number): number => Math.round(value * 100) / 100;

const safeIdPart = (value: string): string =>
    value
        .trim()
        .replace(/[^a-zA-Z0-9_-]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 48) || 'tenant';

export function createBudgetAmountDeltaAdjustment(input: {
    tenantId: string;
    tenantName?: string;
    adjustedYear: number;
    adjustedMonth: number;
    amountDelta: number;
    reason?: string;
    idSeed?: string | number;
}): BudgetAdjustment {
    const tenantId = String(input.tenantId || '').trim();
    if (!tenantId) {
        throw new Error('tenantId is required for budget amount adjustment');
    }

    if (!Number.isInteger(input.adjustedYear) || input.adjustedYear < 1900 || input.adjustedYear > 2200) {
        throw new Error('adjustedYear must be a valid year');
    }

    if (!Number.isInteger(input.adjustedMonth) || input.adjustedMonth < 0 || input.adjustedMonth > 11) {
        throw new Error('adjustedMonth must be 0-11');
    }

    const amount = roundMoney2(Number(input.amountDelta));
    if (!Number.isFinite(amount) || Math.abs(amount) <= 0.005) {
        throw new Error('amountDelta must be a non-zero finite number');
    }

    const idSeed = input.idSeed ?? Date.now();
    const reason = String(input.reason || '').trim() || MOBILE_BUDGET_AMOUNT_ADJUSTMENT_REASON;

    return {
        id: `budget_amount_delta_${safeIdPart(tenantId)}_${input.adjustedYear}_${input.adjustedMonth + 1}_${idSeed}`,
        tenantId,
        tenantName: String(input.tenantName || '').trim() || tenantId,
        originalYear: -1,
        originalMonth: -1,
        adjustedYear: input.adjustedYear,
        adjustedMonth: input.adjustedMonth,
        amount,
        reason,
        adjustmentKind: 'amount_delta',
    };
}
