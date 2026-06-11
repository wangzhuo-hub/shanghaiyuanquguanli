import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockGetList = vi.fn();

vi.mock('pocketbase', () => ({
    default: vi.fn(() => ({
        collection: () => ({
            create: mockCreate,
            getList: mockGetList,
            update: vi.fn(),
            delete: vi.fn(),
        }),
        authStore: { isValid: true },
    })),
}));

describe('saveIncrementalToPocketBase duplicate create', () => {
    beforeEach(() => {
        vi.resetModules();
        mockCreate.mockReset();
        mockGetList.mockReset();
    });

    it('treats duplicate original_id create as idempotent success', async () => {
        mockCreate.mockRejectedValue({
            status: 400,
            response: {
                message: 'Failed to create record.',
                data: {
                    original_id: { code: 'validation_not_unique', message: 'Value must be unique.' },
                },
            },
        });
        mockGetList.mockResolvedValue({
            items: [{ id: 'pb1', updated: '2026-05-22T00:00:00.000Z', original_id: 'p_dup' }],
        });

        const { initPocketBase, saveIncrementalToPocketBase } = await import('../pocketbaseService');
        initPocketBase('http://127.0.0.1:8090');

        const result = await saveIncrementalToPocketBase(
            {
                pb_payments: {
                    creates: [
                        {
                            originalId: 'p_dup',
                            data: {
                                original_id: 'p_dup',
                                tenant_id: 't1',
                                amount: 100,
                                type: 'Rent',
                                date: '2026-05-22',
                            },
                        },
                    ],
                    updates: [],
                    deletes: [],
                },
            },
            'shanghai_park',
            {}
        );

        expect(result.errors).toHaveLength(0);
        expect(result.applied).toHaveLength(1);
        expect(result.applied[0]).toMatchObject({ originalId: 'p_dup', op: 'create' });
    });
});
