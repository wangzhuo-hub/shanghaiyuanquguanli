import { describe, expect, it } from 'vitest';
import type { PaymentRecord, Tenant } from '../../types';
import { normalizeBudgetRowKeyPart } from '../budgetRowKey';
import {
    buildBudgetActualRentCollectionIndex,
    parseBudgetActualPaymentPeriods,
    sumBudgetActualRentCollectionForTenantPeriod,
} from '../budgetActualRentCollection';

const tenant = (id: string, name: string, rootId?: string): Tenant =>
    ({
        id,
        name,
        rootId,
    }) as Tenant;

const payment = (patch: Partial<PaymentRecord>): PaymentRecord =>
    ({
        id: patch.id || `p_${patch.tenantId}_${patch.date}_${patch.amount}`,
        tenantId: patch.tenantId || '',
        tenantName: patch.tenantName || '',
        amount: patch.amount ?? 0,
        type: patch.type || 'Rent',
        date: patch.date || '2026-05-01',
        period: patch.period,
        status: 'Received',
        invoiceStatus: 'Pending',
    }) as PaymentRecord;

const legacyPaymentMatchesTenant = (p: PaymentRecord, target: Tenant, allTenants: Tenant[]): boolean => {
    if (p.tenantId === target.id) return true;
    const paymentTenant = allTenants.find((t) => t.id === p.tenantId);
    if (paymentTenant) {
        const paymentRoot = paymentTenant.rootId || paymentTenant.id;
        const tenantRoot = target.rootId || target.id;
        if (paymentRoot === tenantRoot) return true;
        if (normalizeBudgetRowKeyPart(paymentTenant.name) === normalizeBudgetRowKeyPart(target.name)) return true;
    }
    return normalizeBudgetRowKeyPart(p.tenantName) === normalizeBudgetRowKeyPart(target.name);
};

const legacyAllocatedAmountForPeriod = (p: PaymentRecord, periodYYYYMM: string): number => {
    const periods = parseBudgetActualPaymentPeriods(p.period);
    if (periods.length === 0) return p.date?.startsWith(periodYYYYMM) ? p.amount : 0;
    if (!periods.includes(periodYYYYMM)) return 0;
    return p.amount / periods.length;
};

const legacyActualRentForPeriod = (
    payments: PaymentRecord[],
    target: Tenant,
    allTenants: Tenant[],
    periodYYYYMM: string,
): number =>
    payments
        .filter((p) => (p.type === 'Rent' || p.type === 'DepositToRent') && legacyPaymentMatchesTenant(p, target, allTenants))
        .reduce((sum, p) => sum + legacyAllocatedAmountForPeriod(p, periodYYYYMM), 0);

describe('budget actual rent collection index', () => {
    it('matches the legacy scan for exact id, root chain, and orphan payment name fallback', () => {
        const current = tenant('tenant-current', '君科', 'root-junke');
        const legacy = tenant('tenant-legacy', '君科旧合同', 'root-junke');
        const allTenants = [current, legacy];
        const payments = [
            payment({
                id: 'exact',
                tenantId: 'tenant-current',
                tenantName: '君科',
                amount: 1200,
                date: '2026-05-10',
                period: '2026-05,2026-06',
            }),
            payment({
                id: 'legacy-root',
                tenantId: 'tenant-legacy',
                tenantName: '君科旧合同',
                amount: 300,
                type: 'DepositToRent',
                date: '2026-05-11',
                period: '2026-05',
            }),
            payment({
                id: 'orphan-name',
                tenantId: 'missing-payment-tenant',
                tenantName: '君科',
                amount: 90,
                date: '2026-05-12',
                period: '2026-05',
            }),
            payment({
                id: 'ignored-deposit',
                tenantId: 'tenant-current',
                tenantName: '君科',
                amount: 999,
                type: 'Deposit',
                date: '2026-05-12',
                period: '2026-05',
            }),
        ];
        const index = buildBudgetActualRentCollectionIndex(payments, allTenants);

        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-05')).toBe(
            legacyActualRentForPeriod(payments, current, allTenants, '2026-05')
        );
        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-05')).toBe(990);
        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-06')).toBe(600);
    });

    it('does not double count when one payment matches by direct id, root, and tenant name', () => {
        const current = tenant('tenant-current', '客户A', 'root-a');
        const payments = [
            payment({
                id: 'multi-match',
                tenantId: 'tenant-current',
                tenantName: '客户A',
                amount: 500,
                type: 'Rent',
                date: '2026-05-12',
                period: '2026-05',
            }),
        ];
        const index = buildBudgetActualRentCollectionIndex(payments, [current]);

        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-05')).toBe(500);
    });

    it('uses payment date month when no explicit billing periods are present', () => {
        const current = tenant('tenant-current', '客户A');
        const payments = [
            payment({
                id: 'date-only',
                tenantId: 'tenant-current',
                tenantName: '客户A',
                amount: 700,
                type: 'Rent',
                date: '2026-04-30',
                period: undefined,
            }),
        ];
        const index = buildBudgetActualRentCollectionIndex(payments, [current]);

        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-04')).toBe(700);
        expect(sumBudgetActualRentCollectionForTenantPeriod(index, current, '2026-05')).toBe(0);
    });
});
