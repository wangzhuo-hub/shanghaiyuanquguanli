import { describe, expect, it } from 'vitest';
import type { DashboardData } from '../../types';
import {
    billingEffectDataIdentityKey,
    billingRelevantNotesIdentityKey,
    hasBillingRelevantDirtyCollections,
    isBillingRelevantNoteKey,
} from '../billingEffectIdentity';
import { importedBudgetTableKey, budgetCustomerNameLinksKey } from '../budgetTableImport';
import {
    DEFER_BILLING_NOTE_PREFIX,
    RENT_COLLECTION_REMARK_PREFIX,
    SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY,
} from '../receivableListHelpers';

const dashboardData = (patch: Partial<DashboardData> = {}): DashboardData => ({
    buildings: [],
    tenants: [],
    payments: [],
    yearlyTargets: {},
    initializationData: [],
    budgetAssumptions: [],
    budgetAdjustments: [],
    budgetScenarios: [],
    billingPeriodNotes: {},
    invoices: [],
    budgetAnalysis: {} as DashboardData['budgetAnalysis'],
    ...patch,
} as DashboardData);

describe('billingEffectIdentity', () => {
    it('ignores non-billing dashboard slices when building the billing identity', () => {
        const buildings = [] as DashboardData['buildings'];
        const tenants = [{ id: 't1' }] as DashboardData['tenants'];
        const payments = [{ id: 'p1' }] as DashboardData['payments'];
        const yearlyTargets = {};
        const initializationData = [] as DashboardData['initializationData'];
        const budgetAssumptions = [] as DashboardData['budgetAssumptions'];
        const budgetAdjustments = [] as DashboardData['budgetAdjustments'];
        const budgetScenarios = [] as DashboardData['budgetScenarios'];
        const notes = {};
        const first = dashboardData({
            buildings,
            tenants,
            payments,
            yearlyTargets,
            initializationData,
            budgetAssumptions,
            budgetAdjustments,
            budgetScenarios,
            billingPeriodNotes: notes,
            invoices: [{ id: 'i1' }] as DashboardData['invoices'],
            budgetAnalysis: { occupancy: 'first', revenue: 'first' },
        });
        const second = dashboardData({
            buildings,
            tenants,
            payments,
            yearlyTargets,
            initializationData,
            budgetAssumptions,
            budgetAdjustments,
            budgetScenarios,
            billingPeriodNotes: notes,
            invoices: [{ id: 'i2' }] as DashboardData['invoices'],
            budgetAnalysis: { occupancy: 'second', revenue: 'second' },
        });

        expect(billingEffectDataIdentityKey(second)).toBe(billingEffectDataIdentityKey(first));
    });

    it('changes identity when a billing slice changes', () => {
        const first = dashboardData({ payments: [{ id: 'p1', amount: 100 }] as DashboardData['payments'] });
        const second = dashboardData({ payments: [{ id: 'p1', amount: 200 }] as DashboardData['payments'] });

        expect(billingEffectDataIdentityKey(second)).not.toBe(billingEffectDataIdentityKey(first));
    });

    it('tracks only billing-relevant billingPeriodNotes keys', () => {
        const deferKey = `${DEFER_BILLING_NOTE_PREFIX}tenant_2026_0_2026_1`;
        expect(isBillingRelevantNoteKey(deferKey)).toBe(true);
        expect(isBillingRelevantNoteKey(SPECIAL_BUSINESS_RECEIVABLES_NOTE_KEY)).toBe(true);
        expect(isBillingRelevantNoteKey(importedBudgetTableKey(2026))).toBe(true);
        expect(isBillingRelevantNoteKey(budgetCustomerNameLinksKey(2026))).toBe(true);
        expect(isBillingRelevantNoteKey(`${RENT_COLLECTION_REMARK_PREFIX}tenant_2026-01`)).toBe(false);

        const first = billingRelevantNotesIdentityKey({
            [deferKey]: '{"amount":100}',
            [`${RENT_COLLECTION_REMARK_PREFIX}tenant_2026-01`]: 'call tomorrow',
        });
        const second = billingRelevantNotesIdentityKey({
            [deferKey]: '{"amount":100}',
            [`${RENT_COLLECTION_REMARK_PREFIX}tenant_2026-01`]: 'changed display remark',
        });
        const third = billingRelevantNotesIdentityKey({
            [deferKey]: '{"amount":200}',
            [`${RENT_COLLECTION_REMARK_PREFIX}tenant_2026-01`]: 'changed display remark',
        });

        expect(second).toBe(first);
        expect(third).not.toBe(first);
    });

    it('recognizes dirty collections that can affect billing', () => {
        expect(hasBillingRelevantDirtyCollections(['pb_invoices'])).toBe(false);
        expect(hasBillingRelevantDirtyCollections(['pb_invoices', 'pb_payments'])).toBe(true);
        expect(hasBillingRelevantDirtyCollections(['pb_budget_analysis'])).toBe(false);
    });
});
