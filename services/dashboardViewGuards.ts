export function shouldRenderDesktopDashboardContent(options: {
    activeTab: string;
    mobileNavLayout: boolean;
}): boolean {
    return options.activeTab === 'dashboard' && !options.mobileNavLayout;
}

export const shouldBuildAnnualComparisonDataForView = shouldRenderDesktopDashboardContent;

export function shouldRunDashboardMetricsFilterEffectForView(options: {
    activeTab: string;
}): boolean {
    return options.activeTab === 'dashboard';
}

export function shouldBuildDashboardBillingKeyForView(options: {
    activeTab: string;
    mobileNavLayout: boolean;
    showDashboardBillingTable: boolean;
}): boolean {
    return shouldRenderDesktopDashboardContent(options) && options.showDashboardBillingTable;
}

export function shouldRunDashboardBillingEffectForView(options: {
    activeTab: string;
    mobileNavLayout: boolean;
    showDashboardBillingTable: boolean;
    dataReady: boolean;
}): boolean {
    return shouldBuildDashboardBillingKeyForView(options) && options.dataReady;
}

export function shouldBuildDashboardBillingDataForView(options: {
    activeTab: string;
    mobileNavLayout: boolean;
    showDashboardBillingTable: boolean;
    dashboardBillingReady: boolean;
}): boolean {
    return (
        shouldRenderDesktopDashboardContent(options) &&
        options.showDashboardBillingTable &&
        options.dashboardBillingReady
    );
}
