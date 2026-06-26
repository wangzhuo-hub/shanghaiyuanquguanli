import type { DashboardData } from '../types';

const NON_METRIC_PATCH_KEYS = new Set<keyof DashboardData>([
    'budgetAnalysis',
    'invoices',
]);

export function shouldRecalculateMetricsForDashboardPatch(keys: Array<keyof DashboardData>): boolean {
    if (keys.length === 0) return false;
    return keys.some((key) => !NON_METRIC_PATCH_KEYS.has(key));
}
