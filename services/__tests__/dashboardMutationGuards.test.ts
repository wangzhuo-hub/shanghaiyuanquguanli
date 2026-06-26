import { describe, expect, it } from 'vitest';
import type { DashboardData } from '../../types';
import { shouldRecalculateMetricsForDashboardPatch } from '../dashboardMutationGuards';

describe('dashboard mutation guards', () => {
    it('skips metric recalculation for invoice-only and budget-analysis-only patches', () => {
        expect(shouldRecalculateMetricsForDashboardPatch(['invoices'])).toBe(false);
        expect(shouldRecalculateMetricsForDashboardPatch(['budgetAnalysis'])).toBe(false);
        expect(shouldRecalculateMetricsForDashboardPatch(['invoices', 'budgetAnalysis'])).toBe(false);
    });

    it('recalculates metrics when a metric-relevant slice changes', () => {
        expect(shouldRecalculateMetricsForDashboardPatch(['payments'])).toBe(true);
        expect(shouldRecalculateMetricsForDashboardPatch(['tenants'])).toBe(true);
        expect(shouldRecalculateMetricsForDashboardPatch(['invoices', 'payments'])).toBe(true);
    });

    it('treats unknown dashboard patches as metric-relevant by default', () => {
        expect(shouldRecalculateMetricsForDashboardPatch(['monthlyTrends'])).toBe(true);
        expect(shouldRecalculateMetricsForDashboardPatch(['unknown' as keyof DashboardData])).toBe(true);
    });

    it('does not recalculate when there is no actual patch key', () => {
        expect(shouldRecalculateMetricsForDashboardPatch([])).toBe(false);
    });
});
