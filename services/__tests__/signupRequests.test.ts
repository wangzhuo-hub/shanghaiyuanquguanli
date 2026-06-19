import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    signupGetOne: vi.fn(),
    signupUpdate: vi.fn(),
    usersGetFirstListItem: vi.fn(),
    usersCreate: vi.fn(),
}));

vi.mock('pocketbase', () => ({
    default: vi.fn(() => ({
        collection: (name: string) => {
            if (name === 'pb_user_signup_requests') {
                return {
                    getOne: mocks.signupGetOne,
                    update: mocks.signupUpdate,
                };
            }
            if (name === 'users') {
                return {
                    getFirstListItem: mocks.usersGetFirstListItem,
                    create: mocks.usersCreate,
                };
            }
            return {};
        },
        authStore: {
            isValid: true,
            model: { id: 'admin1', role: 'platform_admin' },
        },
    })),
}));

describe('signup request workflow', () => {
    beforeEach(() => {
        vi.resetModules();
        Object.values(mocks).forEach((mock) => mock.mockReset());
    });

    it('does not clear the required signup password field after approval', async () => {
        mocks.signupGetOne.mockResolvedValue({
            id: 'req1',
            applicant_name: '张三',
            email: 'zhangsan@example.com',
            password_plain: 'password123',
            requested_project_ids: ['shanghai_park'],
            status: 'pending',
        });
        mocks.usersGetFirstListItem.mockRejectedValue({ status: 404 });
        mocks.usersCreate.mockResolvedValue({
            id: 'user1',
            email: 'zhangsan@example.com',
            name: '张三',
            role: 'park_user',
            project_id: 'shanghai_park',
            allowed_project_ids: ['shanghai_park'],
            enabled: true,
        });
        mocks.signupUpdate.mockResolvedValue({ id: 'req1', status: 'approved' });

        const { initPocketBase, approveSignupRequest } = await import('../pocketbaseService');
        initPocketBase('http://127.0.0.1:8090');

        const result = await approveSignupRequest('req1');

        expect(result.success).toBe(true);
        const updatePayload = mocks.signupUpdate.mock.calls[0][1];
        expect(updatePayload).toMatchObject({
            status: 'approved',
            approved_user_id: 'user1',
        });
        expect(updatePayload).not.toHaveProperty('password_plain');
    });

    it('rejects a pending signup request without touching users', async () => {
        mocks.signupGetOne.mockResolvedValue({
            id: 'req2',
            applicant_name: '李四',
            email: 'lisi@example.com',
            password_plain: 'password123',
            requested_project_ids: ['shanghai_park'],
            status: 'pending',
        });
        mocks.signupUpdate.mockResolvedValue({ id: 'req2', status: 'rejected' });

        const { initPocketBase, rejectSignupRequest } = await import('../pocketbaseService');
        initPocketBase('http://127.0.0.1:8090');

        const result = await rejectSignupRequest('req2', '园区不匹配');

        expect(result.success).toBe(true);
        expect(mocks.usersCreate).not.toHaveBeenCalled();
        expect(mocks.signupUpdate).toHaveBeenCalledWith('req2', {
            status: 'rejected',
            review_note: '园区不匹配',
        });
    });
});
