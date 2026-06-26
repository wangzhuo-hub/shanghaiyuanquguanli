import { describe, expect, it } from 'vitest';
import type { BillingDetail, PaymentRecord, Tenant } from '../../types';
import {
    buildReceivablePaymentPeriodIndex,
    buildReceivableSectionsFromPaymentIndex,
    classifyReceivableRow,
    classifyReceivableRowFromPaymentIndex,
    filterReceivableSectionsByBucket,
    getReceivablePaymentPeriodSummary,
    paymentTenantMatchesBillingTenant,
    sumRentPaymentsAllocatedToBillingTenant,
    sumReceivablePaymentAmountForPeriod,
} from '../receivableListHelpers';

const tenant = (id: string, name: string, rootId?: string): Tenant =>
    ({
        id,
        name,
        rootId,
    }) as Tenant;

const payment = (patch: Partial<PaymentRecord>): PaymentRecord =>
    ({
        id: patch.id || `p_${patch.tenantId}_${patch.date}`,
        tenantId: patch.tenantId || '',
        tenantName: patch.tenantName || '',
        amount: patch.amount ?? 0,
        type: patch.type || 'Rent',
        date: patch.date || '2026-05-01',
        period: patch.period,
        status: 'Received',
        invoiceStatus: 'Pending',
    }) as PaymentRecord;

const paidRow = (tenantId: string, amountDue = 100, feeKind?: BillingDetail['feeKind']): BillingDetail => ({
    tenantId,
    tenantName: tenantId,
    unitIds: [],
    amountDue,
    amountPaid: amountDue,
    status: 'Paid',
    feeKind,
});

describe('receivable payment period index', () => {
    it('matches rent payments by rootId chain and orphan tenant name fallback', () => {
        const tenants = [
            tenant('junke-old', '君科', 'junke-root'),
            tenant('junke-current', '君科', 'junke-root'),
        ];
        const payments = [
            payment({
                tenantId: 'junke-old',
                tenantName: '君科历史合同',
                amount: 100,
                type: 'Rent',
                date: '2026-04-25',
                period: '2026-05',
            }),
            payment({
                tenantId: 'missing-from-current-list',
                tenantName: '君科',
                amount: 50,
                type: 'DepositToRent',
                date: '2026-05-06',
                period: '2026-05',
            }),
            payment({
                tenantId: 'junke-current',
                tenantName: '君科',
                amount: 999,
                type: 'Deposit',
                date: '2026-05-06',
                period: '2026-05',
            }),
        ];

        const index = buildReceivablePaymentPeriodIndex(payments, tenants);
        const summary = getReceivablePaymentPeriodSummary(index, 'junke-current', '2026-05', 'rent');

        expect(summary.amount).toBe(150);
        expect(summary.count).toBe(2);
        expect(summary.hasPaymentDateInPeriod).toBe(true);
    });

    it('keeps exact-id manual rows and full multi-period amount semantics used by FinanceManager', () => {
        const payments = [
            payment({
                tenantId: 'manual_ar_line1',
                tenantName: '手工应收',
                amount: 600,
                type: 'Rent',
                date: '2026-05-20',
                period: '2026-05,2026-06',
            }),
        ];
        const index = buildReceivablePaymentPeriodIndex(payments, []);

        expect(sumReceivablePaymentAmountForPeriod(index, 'manual_ar_line1', '2026-05', 'rent')).toBe(600);
        expect(sumReceivablePaymentAmountForPeriod(index, 'manual_ar_line1', '2026-06', 'rent')).toBe(600);
        expect(sumReceivablePaymentAmountForPeriod(index, 'manual_ar_line1', '2026-07', 'rent')).toBe(0);
    });

    it('can split multi-period payments for dashboard metric receivable matching', () => {
        const payments = [
            payment({
                tenantId: 'tenant-a',
                tenantName: '客户A',
                amount: 600,
                type: 'Rent',
                date: '2026-05-20',
                period: '2026-05,2026-06',
            }),
        ];
        const index = buildReceivablePaymentPeriodIndex(payments, [tenant('tenant-a', '客户A')], {
            splitMultiPeriodAmount: true,
        });

        expect(sumReceivablePaymentAmountForPeriod(index, 'tenant-a', '2026-05', 'rent')).toBe(300);
        expect(sumReceivablePaymentAmountForPeriod(index, 'tenant-a', '2026-06', 'rent')).toBe(300);
    });

    it('classifies paid rows the same as the legacy scan for prepaid and current-month collections', () => {
        const tenants = [
            tenant('tenant-old', '客户A', 'root-a'),
            tenant('tenant-current', '客户A', 'root-a'),
        ];
        const prepaidPayments = [
            payment({
                tenantId: 'tenant-old',
                tenantName: '客户A',
                amount: 100,
                type: 'Rent',
                date: '2026-04-28',
                period: '2026-05',
            }),
        ];
        const currentMonthPayments = [
            payment({
                tenantId: 'tenant-old',
                tenantName: '客户A',
                amount: 100,
                type: 'Rent',
                date: '2026-05-02',
                period: '2026-05',
            }),
        ];
        const row = paidRow('tenant-current', 100);

        const prepaidIndex = buildReceivablePaymentPeriodIndex(prepaidPayments, tenants);
        expect(classifyReceivableRow(row, '2026-05', prepaidPayments, tenants)).toBe('prepaid');
        expect(classifyReceivableRowFromPaymentIndex(row, '2026-05', prepaidIndex)).toBe('prepaid');

        const currentIndex = buildReceivablePaymentPeriodIndex(currentMonthPayments, tenants);
        expect(classifyReceivableRow(row, '2026-05', currentMonthPayments, tenants)).toBe('settled_this_month');
        expect(classifyReceivableRowFromPaymentIndex(row, '2026-05', currentIndex)).toBe('settled_this_month');
    });

    it('keeps management fee matching isolated from rent matching', () => {
        const tenants = [tenant('tenant-a', '客户A')];
        const payments = [
            payment({
                tenantId: 'tenant-a',
                tenantName: '客户A',
                amount: 80,
                type: 'ManagementFee',
                date: '2026-05-03',
                period: '2026-05',
            }),
            payment({
                tenantId: 'tenant-a',
                tenantName: '客户A',
                amount: 120,
                type: 'Rent',
                date: '2026-05-03',
                period: '2026-05',
            }),
        ];

        const index = buildReceivablePaymentPeriodIndex(payments, tenants);

        expect(sumReceivablePaymentAmountForPeriod(index, 'tenant-a', '2026-05', 'management_fee')).toBe(80);
        expect(sumReceivablePaymentAmountForPeriod(index, 'tenant-a', '2026-05', 'rent')).toBe(120);
        expect(classifyReceivableRowFromPaymentIndex(paidRow('tenant-a', 80, 'management_fee'), '2026-05', index)).toBe(
            'settled_this_month'
        );
    });

    it('builds display sections from the payment index without re-scanning rows for active filters', () => {
        const tenants = [tenant('tenant-a', '客户A')];
        const payments = [
            payment({
                tenantId: 'tenant-a',
                tenantName: '客户A',
                amount: 100,
                type: 'Rent',
                date: '2026-06-03',
                period: '2026-06',
            }),
            payment({
                tenantId: 'tenant-b',
                tenantName: '客户B',
                amount: 80,
                type: 'Rent',
                date: '2026-05-03',
                period: '2026-05',
            }),
        ];
        const index = buildReceivablePaymentPeriodIndex(payments, tenants);
        const deferredPaidInTarget: BillingDetail = {
            tenantId: 'tenant-a',
            tenantName: '客户A',
            unitIds: [],
            amountDue: 0,
            amountPaid: 0,
            status: 'Unpaid',
            deferredAmount: 100,
            deferredToPeriod: '2026-06',
        };
        const deferredStillPending: BillingDetail = {
            tenantId: 'tenant-c',
            tenantName: '客户C',
            unitIds: [],
            amountDue: 20,
            amountPaid: 0,
            status: 'Unpaid',
            deferredAmount: 80,
            deferredToPeriod: '2026-06',
        };
        const pending: BillingDetail = {
            tenantId: 'tenant-d',
            tenantName: '客户D',
            unitIds: [],
            amountDue: 50,
            amountPaid: 0,
            status: 'Unpaid',
        };
        const settled = paidRow('tenant-b', 80);

        const sections = buildReceivableSectionsFromPaymentIndex(
            [deferredPaidInTarget, deferredStillPending, pending, settled],
            '2026-05',
            index,
        );

        expect(sections.settledThisMonth.map((r) => r.item.tenantId)).toEqual(['tenant-a', 'tenant-b']);
        expect(sections.deferred.map((r) => r.item.tenantId)).toEqual(['tenant-c']);
        expect(sections.unsettled.map((r) => r.item.tenantId)).toEqual(['tenant-d']);

        expect(filterReceivableSectionsByBucket(sections, 'settled')).toMatchObject({
            unsettled: [],
            deferred: [],
            settledThisMonth: sections.settledThisMonth,
            prepaid: sections.prepaid,
        });
        expect(filterReceivableSectionsByBucket(sections, 'deferred')).toMatchObject({
            unsettled: [],
            deferred: sections.deferred,
            settledThisMonth: [],
            prepaid: [],
        });
    });

    it('scan helpers reuse tenant lookup semantics for root chain and orphan name fallback', () => {
        const tenants = [
            tenant('junke-old', '君科', 'junke-root'),
            tenant('junke-current', '君科', 'junke-root'),
        ];
        const payments = [
            payment({
                tenantId: 'junke-old',
                tenantName: '君科历史合同',
                amount: 100,
                type: 'Rent',
                date: '2026-05-01',
                period: '2026-05',
            }),
            payment({
                tenantId: 'missing-from-current-list',
                tenantName: '君科',
                amount: 50,
                type: 'DepositToRent',
                date: '2026-05-02',
                period: '2026-05',
            }),
        ];
        const paymentsByTenantId = new Map<string, PaymentRecord[]>();
        for (const p of payments) paymentsByTenantId.set(p.tenantId, [p]);
        const tenantById = new Map(tenants.map((t) => [t.id, t] as const));

        expect(sumRentPaymentsAllocatedToBillingTenant('junke-current', '2026-05', tenants, paymentsByTenantId)).toBe(150);
        expect(paymentTenantMatchesBillingTenant('junke-old', 'junke-current', tenantById, '君科历史合同')).toBe(true);
        expect(paymentTenantMatchesBillingTenant('missing-from-current-list', 'junke-current', tenantById, '君科')).toBe(true);
    });
});
