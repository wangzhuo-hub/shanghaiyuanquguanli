import { describe, expect, it } from 'vitest';
import {
    assertSourceProject,
    normalizeIntegrationSource,
    resolveSourceProject,
} from '../integrationSource';

describe('integrationSource', () => {
    it('normalizes supported source identity', () => {
        expect(normalizeIntegrationSource({
            sourceType: 'feishu_group',
            sourceKey: ' open_chat_1 ',
        })).toMatchObject({
            sourceType: 'feishu_group',
            sourceKey: 'open_chat_1',
        });
    });

    it('rejects unknown source type', () => {
        expect(normalizeIntegrationSource({
            sourceType: 'unknown',
            sourceKey: 'k',
        })).toBeNull();
    });

    it('resolves enabled source project', () => {
        expect(resolveSourceProject({
            enabled: true,
            projectId: 'shanghai_park',
        })).toEqual({ ok: true, projectId: 'shanghai_park' });
    });

    it('rejects disabled or unbound source', () => {
        expect(resolveSourceProject({
            enabled: false,
            projectId: 'shanghai_park',
        })).toEqual({ ok: false, reason: '来源已禁用' });
        expect(resolveSourceProject({
            enabled: true,
            projectId: '',
        })).toEqual({ ok: false, reason: '来源未绑定园区' });
    });

    it('prevents cross-park writes', () => {
        expect(assertSourceProject('shanghai_park', 'shenzhen_park')).toEqual({
            ok: false,
            reason: '禁止跨园区写入：来源绑定 shanghai_park，请求目标 shenzhen_park',
        });
        expect(assertSourceProject('shanghai_park', 'shanghai_park')).toEqual({
            ok: true,
            projectId: 'shanghai_park',
        });
    });
});
