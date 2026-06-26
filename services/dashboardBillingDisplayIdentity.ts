import type { BillingDetail, DashboardData } from '../types';
import { savePayloadDataIdentityKey } from './savePayloadMemo';

export function dashboardBillingDisplayDataIdentityKey(
    data: DashboardData | null | undefined,
    currentMonthBilling: BillingDetail[] | undefined,
): string {
    if (!data) return '';
    return savePayloadDataIdentityKey([
        ['buildings', data.buildings],
        ['tenants', data.tenants],
        ['payments', data.payments],
        ['billingPeriodNotes', data.billingPeriodNotes],
        ['currentMonthBilling', currentMonthBilling],
    ]);
}
