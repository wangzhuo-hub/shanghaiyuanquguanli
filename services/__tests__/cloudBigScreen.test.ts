import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CloudConfig } from '../../types';
import { fetchCloudBigScreenData } from '../cloudComputeClient';

vi.mock('../cloudAuthToken', () => {
    return {
        getCurrentCloudAuthToken: vi.fn(() => 'auth-token'),
    };
});

const emptyBigScreenData = {
    year: 2025,
    parks: [],
    totals: { projectId: '__totals__', parkName: '总计' },
    events: [],
    alerts: [],
    refreshedAt: '2025-03-31T00:00:00.000Z',
};

const config: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    pocketbaseUrl: 'http://127.0.0.1:8090',
    projectId: 'p1',
};

describe('fetchCloudBigScreenData', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.clearAllMocks();
    });

    it('treats skipped park payloads as failure so the caller can fallback', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
            success: true,
            data: {
                ok: true,
                requested_park_count: 2,
                skipped_park_count: 1,
                big_screen_data: emptyBigScreenData,
            },
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
        })));

        const result = await fetchCloudBigScreenData(
            config,
            { year: 2025, billingMonth: '2025-03', parkIds: ['p1', 'p2'] },
        );

        expect(result.success).toBe(false);
        expect(result.message).toContain('部分园区');
    });
});
