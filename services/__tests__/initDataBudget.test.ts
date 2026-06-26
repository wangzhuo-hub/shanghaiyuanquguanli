import { describe, expect, it } from 'vitest';
import {
    migrateShanghaiInitRow,
    resolveInitMonthInitialBudget,
    resolveInitMonthRevenueTarget,
    SHANGHAI_PARK_ID,
    shouldRunLocalInitialBudgetImportFallback,
    validateInitialBudgetImportServerItems,
} from '../initDataBudget';

describe('initDataBudget', () => {
    it('migrates Shanghai legacy revenueTarget into initialBudget', () => {
        const row = migrateShanghaiInitRow({
            year: 2025,
            month: 3,
            revenueTarget: 120_000,
            revenueCollected: 0,
            occupancyRate: 0,
        });
        expect(row.initialBudget).toBe(120_000);
        expect(row.revenueTarget).toBe(0);
    });

    it('Shanghai reads initialBudget for budget execution override', () => {
        expect(
            resolveInitMonthRevenueTarget(
                { year: 2026, month: 1, revenueTarget: 99, initialBudget: 50_000, revenueCollected: 0, occupancyRate: 0 },
                SHANGHAI_PARK_ID
            )
        ).toBe(50_000);
    });

    it('Beijing/Shenzhen still read revenueTarget only', () => {
        const entry = {
            year: 2026,
            month: 1,
            revenueTarget: 80_000,
            initialBudget: 1,
            revenueCollected: 0,
            occupancyRate: 0,
        };
        expect(resolveInitMonthRevenueTarget(entry, 'beijing_park')).toBe(80_000);
        expect(resolveInitMonthInitialBudget(entry, 'beijing_park')).toBe(1);
    });

    it('does not auto-run heavy local initial budget import after a server attempt', () => {
        expect(shouldRunLocalInitialBudgetImportFallback({
            canUseServer: true,
            tenantCount: 10,
            serverAttempted: true,
        })).toBe(false);

        expect(shouldRunLocalInitialBudgetImportFallback({
            canUseServer: false,
            tenantCount: 10,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalInitialBudgetImportFallback({
            canUseServer: true,
            tenantCount: 0,
            serverAttempted: false,
        })).toBe(true);

        expect(shouldRunLocalInitialBudgetImportFallback({
            canUseServer: false,
            tenantCount: 10,
            serverAttempted: false,
            localFallbackEnabled: false,
        })).toBe(false);
    });

    it('rejects incomplete server bill items for initial budget import', () => {
        expect(validateInitialBudgetImportServerItems(['t1', 't2'], ['t1', 't2'])).toBeNull();
        expect(validateInitialBudgetImportServerItems(['t1', 't2'], ['t1'])).toBe('后台年初预算导入缺少 1 个账单结果');
    });
});
