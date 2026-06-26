import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('fetchPocketBaseBackup transport options', () => {
    it('uses a larger getFullList batch with an explicit baseline-safe field projection', () => {
        const source = readFileSync(
            new URL('../pocketbaseService.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('batchSize = 1000');
        expect(source).toContain('batch: batchSize');
        expect(source).toContain('backupFieldsByCollection');
        expect(source).toContain('fields: backupFieldsByCollection[collection]');
        expect(source).toContain("fields: 'notes_json,updated'");
        expect(source).toContain("['id', 'updated', ...fields].join(',')");
        expect(source).toContain('mapWindowedList');
        expect(source).toContain('inTextDateWindow');
        expect(source).toContain("'payment_period_adjustments'");
        expect(source).toContain("'management_fee_monthly_amount'");
        expect(source).toContain("'base_data_snapshot'");
    });
});
