import { describe, expect, it } from 'vitest';
import {
    decideSealedMonthBackfillAction,
    hasUsableSealedMonthDetails,
} from '../sealed-month-backfill-policy';

describe('sealed month backfill policy', () => {
    it('skips existing sealed months that already have details_json', () => {
        const existing = { id: 'seal-1', detailsJson: [] };

        expect(hasUsableSealedMonthDetails(existing)).toBe(true);
        expect(decideSealedMonthBackfillAction(existing)).toBe('skip_existing');
    });

    it('updates existing sealed months when details_json is missing', () => {
        const existing = { id: 'seal-1', detailsJson: undefined };

        expect(hasUsableSealedMonthDetails(existing)).toBe(false);
        expect(decideSealedMonthBackfillAction(existing)).toBe('update_for_missing_details');
    });

    it('does not create missing months when running in missing-details-only mode', () => {
        expect(decideSealedMonthBackfillAction(null)).toBe('create');
        expect(decideSealedMonthBackfillAction(null, { missingDetailsOnly: true })).toBe('skip_missing_row');
    });

    it('force mode recomputes existing sealed months even when details exist', () => {
        const existing = { id: 'seal-1', detailsJson: [{ tenantId: 't1' }] };

        expect(decideSealedMonthBackfillAction(existing, { force: true })).toBe('update_for_force');
    });
});
