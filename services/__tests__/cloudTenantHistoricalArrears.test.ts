import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudConfig } from '../../types';
import { fetchCloudTenantHistoricalArrears } from '../cloudComputeClient';

vi.mock('../cloudAuthToken', () => {
    return {
        getCurrentCloudAuthToken: vi.fn(() => 'auth-token'),
    };
});

const config: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    pocketbaseUrl: 'http://127.0.0.1:8090',
    projectId: 'shanghai_park',
};

describe('fetchCloudTenantHistoricalArrears', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('posts to the tenant historical arrears endpoint and restores the tenant map', async () => {
        const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                available: true,
                items: [
                    { tenant_id: 't1', amount: 1200, months: 2, latest_period: '2026-05' },
                ],
                start_period: '2026-01',
                end_period: '2026-05',
                data_version: 9,
                computed_at: '2026-06-20T00:00:00.000Z',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetchMock);

        const result = await fetchCloudTenantHistoricalArrears(config, {
            referenceDate: '2026-06-20',
        });

        expect(result.success).toBe(true);
        expect(result.available).toBe(true);
        expect(result.byTenantId?.get('t1')).toEqual({
            amount: 1200,
            months: 2,
            latestPeriod: '2026-05',
        });
        expect(result.startPeriod).toBe('2026-01');
        expect(result.endPeriod).toBe('2026-05');
        expect(result.dataVersion).toBe(9);
        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toContain('/api/integration/app/compute/tenant-historical-arrears');
        expect((init as RequestInit).headers).toMatchObject({
            Authorization: 'Bearer auth-token',
            'Content-Type': 'application/json',
        });
        expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
            project_id: 'shanghai_park',
            reference_date: '2026-06-20',
        });
    });

    it('keeps sealed-detail unavailable responses as successful but unavailable', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                available: false,
                unavailable_reason: '封账月 2026-01 缺少客户级应收明细',
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })));

        const result = await fetchCloudTenantHistoricalArrears(config);

        expect(result.success).toBe(true);
        expect(result.available).toBe(false);
        expect(result.byTenantId?.size).toBe(0);
        expect(result.unavailableReason).toContain('封账月 2026-01');
    });
});
