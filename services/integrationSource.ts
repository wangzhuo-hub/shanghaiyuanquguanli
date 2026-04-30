export type IntegrationSourceType = 'feishu_group' | 'feishu_form' | 'openclaw_agent' | 'webhook';

export interface IntegrationSourceRecord {
    sourceType: IntegrationSourceType;
    sourceKey: string;
    projectId: string;
    enabled: boolean;
}

export interface IncomingIntegrationSource {
    sourceType?: string;
    sourceKey?: string;
}

export function normalizeIntegrationSource(input: IncomingIntegrationSource): IntegrationSourceRecord | null {
    const sourceType = String(input.sourceType || '').trim() as IntegrationSourceType;
    const sourceKey = String(input.sourceKey || '').trim();
    if (!sourceType || !sourceKey) return null;
    if (!['feishu_group', 'feishu_form', 'openclaw_agent', 'webhook'].includes(sourceType)) return null;
    return {
        sourceType,
        sourceKey,
        projectId: '',
        enabled: true,
    };
}

export function resolveSourceProject(
    source: Pick<IntegrationSourceRecord, 'projectId' | 'enabled'> | null | undefined
): { ok: true; projectId: string } | { ok: false; reason: string } {
    if (!source) return { ok: false, reason: '来源未注册' };
    if (source.enabled === false) return { ok: false, reason: '来源已禁用' };
    const projectId = String(source.projectId || '').trim();
    if (!projectId) return { ok: false, reason: '来源未绑定园区' };
    return { ok: true, projectId };
}

export function assertSourceProject(
    sourceProjectId: string,
    requestedProjectId?: string
): { ok: true; projectId: string } | { ok: false; reason: string } {
    const projectId = String(sourceProjectId || '').trim();
    const requested = String(requestedProjectId || '').trim();
    if (!projectId) return { ok: false, reason: '来源未绑定园区' };
    if (requested && requested !== projectId) {
        return { ok: false, reason: `禁止跨园区写入：来源绑定 ${projectId}，请求目标 ${requested}` };
    }
    return { ok: true, projectId };
}
