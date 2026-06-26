import { describe, expect, it } from 'vitest';
import { shouldBuildSourceTenantLookup } from '../sourceAnalysisViewGuards';

describe('source analysis view guards', () => {
    it('builds the tenant lookup only when a source row is expanded', () => {
        expect(shouldBuildSourceTenantLookup({ expandedSource: null })).toBe(false);
        expect(shouldBuildSourceTenantLookup({ expandedSource: '自拓' })).toBe(true);
    });
});
