export function shouldBuildFinanceBillingKeyForView(options: {
    activeTab: string;
}): boolean {
    return options.activeTab === 'finance';
}

export function shouldRunFinanceBillingEffectForView(options: {
    activeTab: string;
    dataReady: boolean;
}): boolean {
    return shouldBuildFinanceBillingKeyForView(options) && options.dataReady;
}
