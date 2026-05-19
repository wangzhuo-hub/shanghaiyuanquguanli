import { describe, expect, it } from 'vitest';
import {
    migrateShanghaiInitRow,
    resolveInitMonthInitialBudget,
    resolveInitMonthRevenueTarget,
    SHANGHAI_PARK_ID,
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
});
