import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
    readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('frontend service boundaries', () => {
    it('keeps backend compute requests out of cloudService', () => {
        const cloudService = readSource('../cloudService.ts');
        const computeOnlyExports = [
            'fetchCloudComputedDashboard',
            'fetchCloudDraftComputedDashboard',
            'fetchCloudComputedBilling',
            'fetchCloudDraftComputedBilling',
            'fetchCloudBudgetedBillsPreview',
            'fetchCloudBudgetedBillsPreviewBatch',
            'fetchCloudContractReceivableMonthly',
            'fetchCloudSourceAgentMetrics',
            'fetchCloudContractAnalysisMetrics',
            'fetchCloudTenantHistoricalArrears',
            'fetchCloudBigScreenData',
        ];

        for (const name of computeOnlyExports) {
            expect(cloudService).not.toContain(`export const ${name}`);
        }
        expect(cloudService).not.toContain("from '../config/urls'");
        expect(cloudService).not.toContain("from './requestIdentityKey'");
    });

    it('routes App through service facades instead of importing pocketbaseService directly', () => {
        const app = readSource('../../App.tsx');

        expect(app).not.toContain("from './services/pocketbaseService'");
        expect(app).toContain("from './services/cloudService'");
        expect(app).toContain("import('./services/cloudComputeClient')");
        expect(app).toContain("import('./services/cloudAccountService')");
    });

    it('keeps account management calls in the lazy account service', () => {
        const cloudService = readSource('../cloudService.ts');
        const cloudAccountService = readSource('../cloudAccountService.ts');
        const accountExports = [
            'changeOwnCloudPassword',
            'fetchManagedCloudUsers',
            'fetchPublicCloudParks',
            'submitCloudSignupRequest',
            'fetchCloudSignupRequests',
            'approveCloudSignupRequest',
            'rejectCloudSignupRequest',
            'createManagedCloudUser',
            'updateManagedCloudUserEnabled',
            'updateManagedCloudUser',
            'deleteManagedCloudUser',
            'deleteCloudSignupRequest',
        ];

        for (const name of accountExports) {
            expect(cloudService).not.toContain(`export const ${name}`);
            expect(cloudAccountService).toContain(`export const ${name}`);
        }
    });
});
