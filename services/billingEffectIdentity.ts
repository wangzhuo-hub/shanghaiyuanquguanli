import type { DashboardData } from '../types';
import {
    DEFER_BILLING_NOTE_PREFIX,
    SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY,
} from './receivableListHelpers';
import { savePayloadDataIdentityKey } from './savePayloadMemo';

const IMPORTED_BUDGET_TABLE_PREFIX = '__budget_table_';
const BUDGET_CUSTOMER_LINKS_PREFIX = '__budget_customer_links_';

export const BILLING_RELEVANT_DIRTY_COLLECTIONS = new Set([
    'pb_buildings',
    'pb_units',
    'pb_tenants',
    'pb_payments',
    'pb_yearly_targets',
    'pb_monthly_init_data',
    'pb_budget_assumptions',
    'pb_budget_adjustments',
    'pb_budget_scenarios',
    'pb_billing_period_notes',
]);

export function hasBillingRelevantDirtyCollections(collections: Iterable<string>): boolean {
    for (const collection of collections) {
        if (BILLING_RELEVANT_DIRTY_COLLECTIONS.has(collection)) return true;
    }
    return false;
}

export function isBillingRelevantNoteKey(key: string): boolean {
    return (
        key.startsWith(DEFER_BILLING_NOTE_PREFIX) ||
        key.startsWith(IMPORTED_BUDGET_TABLE_PREFIX) ||
        key.startsWith(BUDGET_CUSTOMER_LINKS_PREFIX) ||
        key === SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY
    );
}

export function billingRelevantNotesIdentityKey(notes: Record<string, string> | undefined): string {
    if (!notes) return '<notes:none>';
    const parts = Object.keys(notes)
        .filter(isBillingRelevantNoteKey)
        .sort()
        .map((key) => `${key}=${notes[key] ?? ''}`);
    return parts.length > 0 ? parts.join('|') : '<notes:empty>';
}

export function billingEffectDataIdentityKey(data: DashboardData | null | undefined): string {
    if (!data) return '';
    return savePayloadDataIdentityKey([
        ['buildings', data.buildings],
        ['tenants', data.tenants],
        ['payments', data.payments],
        ['yearlyTargets', data.yearlyTargets],
        ['initializationData', data.initializationData],
        ['budgetAssumptions', data.budgetAssumptions],
        ['budgetAdjustments', data.budgetAdjustments],
        ['budgetScenarios', data.budgetScenarios],
        ['billingPeriodNotes', billingRelevantNotesIdentityKey(data.billingPeriodNotes)],
    ]);
}
