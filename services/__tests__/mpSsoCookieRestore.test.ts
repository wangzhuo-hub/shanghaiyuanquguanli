import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    authRefresh: vi.fn(),
    authStore: {
        token: '',
        model: null as Record<string, unknown> | null,
        isValid: false,
        save: vi.fn((token: string, model: Record<string, unknown> | null) => {
            mocks.authStore.token = token;
            mocks.authStore.model = model;
            mocks.authStore.isValid = Boolean(token);
        }),
        clear: vi.fn(() => {
            mocks.authStore.token = '';
            mocks.authStore.model = null;
            mocks.authStore.isValid = false;
        }),
    },
}));

vi.mock('pocketbase', () => ({
    default: vi.fn(() => ({
        collection: (name: string) => {
            if (name === 'users') {
                return { authRefresh: mocks.authRefresh };
            }
            return {};
        },
        authStore: mocks.authStore,
    })),
}));

describe('mini program SSO cookie restore', () => {
    let cookieValue = '';
    let cookieWrites: string[] = [];

    beforeEach(() => {
        vi.resetModules();
        mocks.authRefresh.mockReset();
        mocks.authStore.token = '';
        mocks.authStore.model = null;
        mocks.authStore.isValid = false;
        mocks.authStore.save.mockClear();
        mocks.authStore.clear.mockClear();
        cookieValue = 'kd_token=pb-token-from-mp';
        cookieWrites = [];

        Object.defineProperty(globalThis, 'document', {
            configurable: true,
            value: {
                get cookie() {
                    return cookieValue;
                },
                set cookie(value: string) {
                    cookieWrites.push(value);
                    if (value.startsWith('kd_token=;')) cookieValue = '';
                    else cookieValue = value;
                },
            },
        });
        Object.defineProperty(globalThis, 'window', {
            configurable: true,
            value: {
                location: { hostname: 'kdpark.fun' },
            },
        });
    });

    it('restores PocketBase authStore from kd_token and clears the bridge cookie', async () => {
        mocks.authRefresh.mockResolvedValue({
            record: {
                id: 'user1',
                email: 'user@example.com',
                name: '小程序用户',
                role: 'park_user',
                project_id: 'shanghai_park',
                allowed_project_ids: ['shanghai_park'],
                enabled: true,
            },
        });

        const {
            initPocketBase,
            restorePocketBaseSessionFromCookie,
            getCurrentAuthToken,
            getCurrentAuthUser,
        } = await import('../pocketbaseService');

        initPocketBase('/api/pb');
        const result = await restorePocketBaseSessionFromCookie();

        expect(result.success).toBe(true);
        expect(mocks.authStore.save).toHaveBeenCalledWith('pb-token-from-mp', null);
        expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
        expect(getCurrentAuthToken()).toBe('pb-token-from-mp');
        expect(getCurrentAuthUser()?.projectId).toBe('shanghai_park');
        expect(cookieWrites.some((value) => value.includes('Domain=.kdpark.fun'))).toBe(true);
    });
});
