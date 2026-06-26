import type { BudgetScenario, Building, Tenant } from '../types';

export type BudgetScenarioSnapshot = NonNullable<BudgetScenario['baseDataSnapshot']>;

const stripUndefinedFields = <T>(value: T): T => {
    if (Array.isArray(value)) {
        return value.map((item) => stripUndefinedFields(item)) as T;
    }
    if (!value || typeof value !== 'object' || value instanceof Date) {
        return value;
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
        if (item === undefined) continue;
        result[key] = stripUndefinedFields(item);
    }
    return result as T;
};

const cloneSnapshotValue = <T>(value: T): T => {
    if (typeof structuredClone === 'function') {
        return stripUndefinedFields(structuredClone(value));
    }
    return JSON.parse(JSON.stringify(value)) as T;
};

export const cloneBudgetScenarioSnapshot = (
    tenants: Tenant[],
    buildings: Building[],
): BudgetScenarioSnapshot => cloneSnapshotValue({ tenants, buildings });
