import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    fetchCloudDashboardCustomFieldIds,
    writeCloudDashboardCustomFieldIds,
} from '../dashboardCustomFieldCloudPreferences';

vi.mock('../cloudAuthToken', () => {
    return {
        getCurrentCloudAuthToken: vi.fn(() => 'auth-token'),
    };
});

describe('dashboard custom field cloud preferences', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('loads saved field ids from the user preference endpoint', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                found: true,
                field_ids: ['annualLeasedArea', 'unknown', 'annualLeasedArea', 'newContracts'],
                updated_at: '2026-06-24T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudDashboardCustomFieldIds();

        expect(result.success).toBe(true);
        expect(result.found).toBe(true);
        expect(result.fieldIds).toEqual(['annualLeasedArea', 'newContracts']);
        expect(result.updatedAt).toBe('2026-06-24T00:00:00.000Z');
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/preferences/dashboard-custom-fields');
        expect((init as RequestInit).method).toBe('GET');
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer auth-token',
            'Content-Type': 'application/json',
        });
    });

    it('keeps a missing cloud preference distinct from an empty saved selection', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                found: false,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })));

        const result = await fetchCloudDashboardCustomFieldIds();

        expect(result.success).toBe(true);
        expect(result.found).toBe(false);
        expect(result.fieldIds).toBeUndefined();
    });

    it('saves normalized field ids to the user preference endpoint', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                found: true,
                field_ids: ['annualLeasedArea', 'annualTerminatedArea'],
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await writeCloudDashboardCustomFieldIds([
            'annualLeasedArea',
            'annualLeasedArea',
            'annualTerminatedArea',
            'earlyTerminations',
            'newContracts',
            'netIncreaseArea',
            'activeTenants',
        ]);

        expect(result.success).toBe(true);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/preferences/dashboard-custom-fields');
        expect((init as RequestInit).method).toBe('PUT');
        expect(JSON.parse(String((init as RequestInit).body))).toEqual({
            field_ids: [
                'annualLeasedArea',
                'annualTerminatedArea',
                'earlyTerminations',
                'newContracts',
                'netIncreaseArea',
            ],
        });
    });
});
