import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockCreate = vi.fn();
const mockGetList = vi.fn();
const mockDelete = vi.fn();

vi.mock('pocketbase', () => ({
    default: vi.fn(() => ({
        collection: () => ({
            create: mockCreate,
            getList: mockGetList,
            update: vi.fn(),
            delete: mockDelete,
        }),
        authStore: { isValid: true },
    })),
}));

describe('saveIncrementalToPocketBase duplicate create', () => {
    beforeEach(() => {
        vi.resetModules();
        mockCreate.mockReset();
        mockGetList.mockReset();
        mockDelete.mockReset();
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
            items: [{
                id: 'pb1',
                updated: '2026-05-22T00:00:00.000Z',
                original_id: 'p_dup',
                project_id: 'shanghai_park',
                tenant_id: 't1',
                amount: 100,
                type: 'Rent',
                date: '2026-05-22',
            }],
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

    it('rejects duplicate original_id create when existing row content differs', async () => {
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
            items: [{
                id: 'pb1',
                updated: '2026-05-22T00:00:00.000Z',
                original_id: 'p_dup',
                project_id: 'shanghai_park',
                tenant_id: 't1',
                amount: 999,
                type: 'Rent',
                date: '2026-05-22',
            }],
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

        expect(result.applied).toHaveLength(0);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatchObject({ originalId: 'p_dup', op: 'create' });
        expect(result.errors[0].message).toContain('内容不一致');
    });

    it('forceDeleteRecord deletes the latest server row by original_id', async () => {
        mockGetList.mockResolvedValue({
            items: [{ id: 'pb_delete_1', updated: '2026-05-22T00:00:00.000Z', original_id: 'p_delete' }],
        });
        mockDelete.mockResolvedValue({});

        const { initPocketBase, forceDeleteRecord } = await import('../pocketbaseService');
        initPocketBase('http://127.0.0.1:8090');

        const result = await forceDeleteRecord('pb_payments', 'p_delete', 'shanghai_park');

        expect(result.success).toBe(true);
        expect(mockDelete).toHaveBeenCalledWith('pb_delete_1');
    });
});
