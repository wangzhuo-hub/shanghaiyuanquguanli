import { describe, expect, it } from 'vitest';
import { shouldBuildFinanceBillingKeyForView, shouldRunFinanceBillingEffectForView } from '../financeViewGuards';

describe('finance view guards', () => {
    it('builds finance billing keys only on the finance view', () => {
        expect(shouldBuildFinanceBillingKeyForView({ activeTab: 'finance' })).toBe(true);
        expect(shouldBuildFinanceBillingKeyForView({ activeTab: 'dashboard' })).toBe(false);
        expect(shouldBuildFinanceBillingKeyForView({ activeTab: 'contracts' })).toBe(false);
    });

    it('runs finance billing effects only on the finance view when data is ready', () => {
        expect(shouldRunFinanceBillingEffectForView({
            activeTab: 'finance',
            dataReady: true,
        })).toBe(true);

        expect(shouldRunFinanceBillingEffectForView({
            activeTab: 'finance',
            dataReady: false,
        })).toBe(false);

        expect(shouldRunFinanceBillingEffectForView({
            activeTab: 'dashboard',
            dataReady: true,
        })).toBe(false);
    });
});
