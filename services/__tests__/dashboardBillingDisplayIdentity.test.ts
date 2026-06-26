import { describe, expect, it } from 'vitest';
import type { BillingDetail, DashboardData } from '../../types';
import { dashboardBillingDisplayDataIdentityKey } from '../dashboardBillingDisplayIdentity';

const dashboardData = (patch: Partial<DashboardData> = {}): DashboardData => ({
    buildings: [],
    tenants: [],
    payments: [],
    billingPeriodNotes: {},
    invoices: [],
    budgetAnalysis: { occupancy: '', revenue: '' },
    cloudSaveVersion: 0,
    ...patch,
} as DashboardData);

describe('dashboardBillingDisplayDataIdentityKey', () => {
    it('ignores dashboard slices that BillingTable does not read', () => {
        const buildings = [] as DashboardData['buildings'];
        const tenants = [{ id: 't1' }] as DashboardData['tenants'];
        const payments = [{ id: 'p1' }] as DashboardData['payments'];
        const notes = { '__rent_remark__t1_2026-01': 'first' };
        const rows = [{ tenantId: 't1', amountDue: 100 }] as BillingDetail[];
        const first = dashboardData({
            buildings,
            tenants,
            payments,
            billingPeriodNotes: notes,
            invoices: [{ id: 'i1' }] as DashboardData['invoices'],
            budgetAnalysis: { occupancy: 'first', revenue: 'first' },
            cloudSaveVersion: 1,
        });
        const second = dashboardData({
            buildings,
            tenants,
            payments,
            billingPeriodNotes: notes,
            invoices: [{ id: 'i2' }] as DashboardData['invoices'],
            budgetAnalysis: { occupancy: 'second', revenue: 'second' },
            cloudSaveVersion: 2,
        });

        expect(dashboardBillingDisplayDataIdentityKey(second, rows))
            .toBe(dashboardBillingDisplayDataIdentityKey(first, rows));
    });

    it('changes when BillingTable-visible inputs change', () => {
        const rows = [{ tenantId: 't1', amountDue: 100 }] as BillingDetail[];
        const base = dashboardData({
            payments: [{ id: 'p1', amount: 100 }] as DashboardData['payments'],
            billingPeriodNotes: { '__rent_remark__t1_2026-01': 'first' },
        });
        const changedNotes = dashboardData({
            payments: base.payments,
            billingPeriodNotes: { '__rent_remark__t1_2026-01': 'second' },
        });
        const changedRows = [{ tenantId: 't1', amountDue: 200 }] as BillingDetail[];
        const changedPayments = dashboardData({
            payments: [{ id: 'p1', amount: 200 }] as DashboardData['payments'],
            billingPeriodNotes: base.billingPeriodNotes,
        });

        const key = dashboardBillingDisplayDataIdentityKey(base, rows);
        expect(dashboardBillingDisplayDataIdentityKey(changedNotes, rows)).not.toBe(key);
        expect(dashboardBillingDisplayDataIdentityKey(base, changedRows)).not.toBe(key);
        expect(dashboardBillingDisplayDataIdentityKey(changedPayments, rows)).not.toBe(key);
    });
});
