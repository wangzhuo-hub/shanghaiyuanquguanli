import { describe, expect, it, vi } from 'vitest';
import {
    resolveFinanceBillingBaseDetails,
    type FinanceServerBillingDetails,
} from '../FinanceManager';
import type { BillingDetail } from '../../types';

const row = (tenantId: string, amountDue: number): BillingDetail => ({
    tenantId,
    tenantName: tenantId,
    unitIds: [],
    amountDue,
    amountPaid: 0,
    status: 'Unpaid',
});

describe('resolveFinanceBillingBaseDetails', () => {
    it('uses ready server rows for the selected period without local recompute', () => {
        const serverRows = [row('server', 100)];
        const localGetter = vi.fn(() => [row('local', 200)]);
        const server: FinanceServerBillingDetails = {
            periodYYYYMM: '2026-05',
            rows: serverRows,
            ready: true,
        };

        const result = resolveFinanceBillingBaseDetails('2026-05', localGetter, server);

        expect(result).toBe(serverRows);
        expect(localGetter).not.toHaveBeenCalled();
    });

    it('falls back to local billing when server rows are not ready or period differs', () => {
        const localRows = [row('local', 200)];
        const localGetter = vi.fn(() => localRows);
        const server: FinanceServerBillingDetails = {
            periodYYYYMM: '2026-04',
            rows: [row('server', 100)],
            ready: true,
        };

        const result = resolveFinanceBillingBaseDetails('2026-05', localGetter, server);

        expect(result).toBe(localRows);
        expect(localGetter).toHaveBeenCalledWith(2026, 4);
    });

    it('does not call local billing when server billing is required but rows are not ready', () => {
        const localGetter = vi.fn(() => [row('local', 200)]);

        const result = resolveFinanceBillingBaseDetails(
            '2026-05',
            localGetter,
            undefined,
            { serverRequired: true },
        );

        expect(result).toEqual([]);
        expect(localGetter).not.toHaveBeenCalled();
    });

    it('does not call local billing when server billing is required for another period', () => {
        const localGetter = vi.fn(() => [row('local', 200)]);
        const server: FinanceServerBillingDetails = {
            periodYYYYMM: '2026-04',
            rows: [row('server', 100)],
            ready: true,
        };

        const result = resolveFinanceBillingBaseDetails(
            '2026-05',
            localGetter,
            server,
            { serverRequired: true },
        );

        expect(result).toEqual([]);
        expect(localGetter).not.toHaveBeenCalled();
    });
});
