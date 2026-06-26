import { describe, expect, it } from 'vitest';
import {
    shouldBuildAnnualComparisonDataForView,
    shouldBuildDashboardBillingDataForView,
    shouldBuildDashboardBillingKeyForView,
    shouldRenderDesktopDashboardContent,
    shouldRunDashboardBillingEffectForView,
    shouldRunDashboardMetricsFilterEffectForView,
} from '../dashboardViewGuards';

describe('dashboard view guards', () => {
    it('renders desktop dashboard content only on the desktop dashboard view', () => {
        expect(shouldRenderDesktopDashboardContent({
            activeTab: 'dashboard',
            mobileNavLayout: false,
        })).toBe(true);

        expect(shouldRenderDesktopDashboardContent({
            activeTab: 'dashboard',
            mobileNavLayout: true,
        })).toBe(false);

        expect(shouldRenderDesktopDashboardContent({
            activeTab: 'finance',
            mobileNavLayout: false,
        })).toBe(false);
    });

    it('builds annual comparison data only when the desktop dashboard can render it', () => {
        expect(shouldBuildAnnualComparisonDataForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
        })).toBe(true);

        expect(shouldBuildAnnualComparisonDataForView({
            activeTab: 'dashboard',
            mobileNavLayout: true,
        })).toBe(false);
    });

    it('runs dashboard metrics filter effects only on dashboard views', () => {
        expect(shouldRunDashboardMetricsFilterEffectForView({
            activeTab: 'dashboard',
        })).toBe(true);

        expect(shouldRunDashboardMetricsFilterEffectForView({
            activeTab: 'finance',
        })).toBe(false);

        expect(shouldRunDashboardMetricsFilterEffectForView({
            activeTab: 'contracts',
        })).toBe(false);
    });

    it('builds dashboard billing data only when the visible desktop billing table is ready', () => {
        expect(shouldBuildDashboardBillingKeyForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: true,
        })).toBe(true);

        expect(shouldBuildDashboardBillingKeyForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: false,
        })).toBe(false);

        expect(shouldBuildDashboardBillingDataForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: true,
            dashboardBillingReady: true,
        })).toBe(true);

        expect(shouldBuildDashboardBillingDataForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: false,
            dashboardBillingReady: true,
        })).toBe(false);

        expect(shouldBuildDashboardBillingDataForView({
            activeTab: 'dashboard',
            mobileNavLayout: true,
            showDashboardBillingTable: true,
            dashboardBillingReady: true,
        })).toBe(false);
    });

    it('runs dashboard billing effects only when desktop dashboard billing data is ready to load', () => {
        expect(shouldRunDashboardBillingEffectForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: true,
            dataReady: true,
        })).toBe(true);

        expect(shouldRunDashboardBillingEffectForView({
            activeTab: 'dashboard',
            mobileNavLayout: false,
            showDashboardBillingTable: true,
            dataReady: false,
        })).toBe(false);

        expect(shouldRunDashboardBillingEffectForView({
            activeTab: 'finance',
            mobileNavLayout: false,
            showDashboardBillingTable: true,
            dataReady: true,
        })).toBe(false);
    });
});
