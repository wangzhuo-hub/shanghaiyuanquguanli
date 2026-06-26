import type { BudgetedBill } from './billingService';
import { shouldAllowLocalHeavyComputeFallback, type LocalHeavyComputeFallbackOption } from './computeFallbackPolicy';

export type BudgetMonthlyServerData = {
    billsByKey?: Map<string, BudgetedBill[]>;
    contractOnlyByMonth?: Array<Map<string, number>>;
};

export const shouldBuildBudgetMonthlyComputeRequest = (viewMode: string): boolean =>
    viewMode === 'Monthly' || viewMode === 'Execution';

export const shouldBuildBudgetMonthlyDetailRows = shouldBuildBudgetMonthlyComputeRequest;

export const resolveBudgetMonthlyBillsForKey = (
    key: string,
    serverData: BudgetMonthlyServerData | undefined,
    localGetter: () => BudgetedBill[],
): BudgetedBill[] => {
    const serverBills = serverData?.billsByKey?.get(key);
    if (serverBills) return serverBills;
    if (serverData) return [];
    return localGetter();
};

export const validateBudgetMonthlyServerPayload = (
    expectedBillIds: string[],
    billsByKey: Map<string, BudgetedBill[]>,
    receivedContractMonths: Set<number>,
): string | null => {
    const missingBillItemCount = expectedBillIds.filter((id) => !billsByKey.has(id)).length;
    if (missingBillItemCount > 0) return `后台预算明细缺少 ${missingBillItemCount} 个账单结果`;
    if (receivedContractMonths.size < 12) return '后台合同应收月度汇总不完整';
    return null;
};

export const shouldRunBudgetMonthlyLocalFallback = (options: {
    shouldUseServer: boolean;
    serverAttempted: boolean;
} & LocalHeavyComputeFallbackOption): boolean => {
    if (!shouldAllowLocalHeavyComputeFallback(options)) return false;
    if (!options.shouldUseServer) return true;
    return !options.serverAttempted;
};
