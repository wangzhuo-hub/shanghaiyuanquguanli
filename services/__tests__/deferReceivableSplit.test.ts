import { describe, expect, it } from 'vitest';
import type { BillingDetail, Tenant } from '../../types';
import { ContractStatus, DepositStatus } from '../../types';
import {
    applyBillingPeriodDeferNotes,
    deferBillingNoteKeyFromDeferInDisplayTenantId,
    deferInDisplayTenantId,
    isDeferInDisplayTenantId,
    receivableBudgetDisplay,
    removeDeferBillingNoteByKey,
} from '../receivableListHelpers';

function makeTenant(id: string, name: string): Tenant {
    return {
        id,
        name,
        buildingId: 'b1',
        unitIds: ['u1'],
        totalArea: 100,
        leaseStart: '2026-01-01',
        leaseEnd: '2026-12-31',
        monthlyRent: 100000,
        rentFreePeriods: [],
        paymentCycle: 'Monthly',
        paymentCycleMonths: 1,
        firstPaymentDate: '2026-01-01',
        firstPaymentMonths: 1,
        depositAmount: 0,
        depositStatus: DepositStatus.Unpaid,
        status: ContractStatus.Active,
    };
}

describe('applyBillingPeriodDeferNotes — 缓入拆行', () => {
    it('同一目标账期多笔缓入拆成多行，不再合并到合同行', () => {
        const tenants = [makeTenant('t-gy', '管易云')];
        const base: BillingDetail[] = [
            {
                tenantId: 't-gy',
                tenantName: '管易云',
                unitIds: ['u1'],
                amountDue: 73943,
                amountPaid: 0,
                status: 'Unpaid',
            },
        ];
        const notes: Record<string, string> = {
            __defer__a: JSON.stringify({
                tenantId: 't-gy',
                fromYear: 2026,
                fromMonth: 1,
                toYear: 2026,
                toMonth: 0,
                amount: 50000,
            }),
            __defer__b: JSON.stringify({
                tenantId: 't-gy',
                fromYear: 2026,
                fromMonth: 2,
                toYear: 2026,
                toMonth: 0,
                amount: 23943,
            }),
        };
        const out = applyBillingPeriodDeferNotes(base, 2026, 0, notes, tenants);
        const deferRows = out.filter((r) => isDeferInDisplayTenantId(r.tenantId));
        expect(deferRows).toHaveLength(2);
        expect(deferRows.map((r) => r.amountDue).sort((a, b) => b - a)).toEqual([50000, 23943]);
        const contract = out.find((r) => r.tenantId === 't-gy');
        expect(contract?.amountDue).toBe(73943);
        const sumDisplay = out.reduce((s, r) => s + receivableBudgetDisplay(r), 0);
        expect(sumDisplay).toBe(73943 + 50000 + 23943);
    });
});

describe('deferBillingNoteKeyFromDeferInDisplayTenantId', () => {
    it('与 deferInDisplayTenantId 互逆（键中含 | 时编码为 /）', () => {
        const noteKey = '__defer__t1_2026_4_2026_5_999';
        const displayId = deferInDisplayTenantId('t1', noteKey);
        expect(deferBillingNoteKeyFromDeferInDisplayTenantId(displayId)).toBe(noteKey);
    });

    it('removeDeferBillingNoteByKey 删除单条', () => {
        const notes = { __defer__x: '{"tenantId":"a"}', other: '1' };
        const { next, removed } = removeDeferBillingNoteByKey(notes, '__defer__x');
        expect(removed).toBe(true);
        expect(next.__defer__x).toBeUndefined();
        expect(next.other).toBe('1');
    });
});
