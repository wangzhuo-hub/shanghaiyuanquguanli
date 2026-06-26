import type { BudgetAdjustment, BudgetAssumption, Tenant } from '../types';
import type { BudgetedBill, GenerateBudgetedBillsOptions } from './billingService';

type BillGenerationCacheInput = {
    tenant: Tenant;
    assumptions: BudgetAssumption[];
    adjustments: BudgetAdjustment[];
    start: Date;
    end: Date;
    options?: GenerateBudgetedBillsOptions;
    scopeHint?: string;
};

export type BillGenerationCache = {
    get(input: BillGenerationCacheInput): BudgetedBill[];
    clear(): void;
    size(): number;
};

export type GenerateBudgetedBillsFn = (
    tenant: Tenant,
    assumptions: BudgetAssumption[],
    adjustments: BudgetAdjustment[],
    start: Date,
    end: Date,
    options?: GenerateBudgetedBillsOptions,
) => BudgetedBill[];

const normalizeForKey = (value: unknown): unknown => {
    if (value instanceof Date) {
        const time = value.getTime();
        return Number.isFinite(time) ? { $date: value.toISOString() } : { $date: String(value) };
    }
    if (Array.isArray(value)) {
        return value.map(normalizeForKey);
    }
    if (value && typeof value === 'object') {
        const normalized: Record<string, unknown> = {};
        for (const key of Object.keys(value as Record<string, unknown>).sort()) {
            const item = (value as Record<string, unknown>)[key];
            if (typeof item !== 'undefined') {
                normalized[key] = normalizeForKey(item);
            }
        }
        return normalized;
    }
    return value;
};

const cacheKey = (input: BillGenerationCacheInput): string =>
    JSON.stringify(
        normalizeForKey({
            tenant: input.tenant,
            assumptions: input.assumptions,
            adjustments: input.adjustments,
            start: input.start,
            end: input.end,
            options: input.options || {},
            scopeHint: input.scopeHint || '',
        }),
    );

export const cloneBudgetedBills = (bills: BudgetedBill[]): BudgetedBill[] =>
    bills.map((bill) => ({
        ...bill,
        date: new Date(bill.date),
        originalDate: bill.originalDate ? new Date(bill.originalDate) : undefined,
        coverageStart: bill.coverageStart ? new Date(bill.coverageStart) : undefined,
        coverageEnd: bill.coverageEnd ? new Date(bill.coverageEnd) : undefined,
    }));

export const createBudgetedBillCache = (options: {
    maxEntries?: number;
    generateBudgetedBills: GenerateBudgetedBillsFn;
}): BillGenerationCache => {
    const maxEntries = Math.max(1, Math.floor(options.maxEntries ?? 320));
    const generateBudgetedBills = options.generateBudgetedBills;
    const entries = new Map<string, BudgetedBill[]>();

    return {
        get(input) {
            const key = cacheKey(input);
            const cached = entries.get(key);
            if (cached) return cloneBudgetedBills(cached);

            const bills = generateBudgetedBills(
                input.tenant,
                input.assumptions,
                input.adjustments,
                input.start,
                input.end,
                input.options,
            );
            entries.set(key, cloneBudgetedBills(bills));
            while (entries.size > maxEntries) {
                const firstKey = entries.keys().next().value;
                if (!firstKey) break;
                entries.delete(firstKey);
            }
            return bills;
        },
        clear() {
            entries.clear();
        },
        size() {
            return entries.size;
        },
    };
};
