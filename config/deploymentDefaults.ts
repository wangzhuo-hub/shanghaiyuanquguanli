import type { CloudConfig } from '../types';

/**
 * 默认云端配置。PocketBase 地址优先级：
 * 1. 构建时 VITE_POCKETBASE_URL（Docker / 自定义代理路径）
 * 2. 生产模式 → 同源 /（PocketBase 直接服务前端，或 Caddy 全量反代）
 * 3. 开发模式 → /api/pb（Vite 代理）
 */

const resolvePocketbaseUrl = (): string => {
    const envUrl = (typeof import.meta !== 'undefined'
        && (import.meta as any).env?.VITE_POCKETBASE_URL as string | undefined | false) ?? undefined;
    const trimmed = typeof envUrl === 'string' ? envUrl.trim() : '';
    if (trimmed) return trimmed;
    return typeof import.meta !== 'undefined' && (import.meta as any).env?.PROD ? '/' : '/api/pb';
};

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    projectId: 'shanghai_park',
    pocketbaseUrl: resolvePocketbaseUrl(),
    pocketbaseEmail: '',
    pocketbasePassword: '',
};

export function mergeStoredCloudConfig(raw: string | null): CloudConfig {
    let parsed: Partial<CloudConfig> = {};
    if (raw) {
        try {
            parsed = JSON.parse(raw) as Partial<CloudConfig>;
        } catch {
            parsed = {};
        }
    }
    const d = DEFAULT_CLOUD_CONFIG;
    return {
        provider: 'pocketbase',
        autoSync: parsed.autoSync ?? d.autoSync,
        projectId:
            typeof parsed.projectId === 'string' && parsed.projectId.trim()
                ? parsed.projectId.trim()
                : d.projectId,
        pocketbaseUrl:
            typeof parsed.pocketbaseUrl === 'string' && parsed.pocketbaseUrl.trim()
                ? parsed.pocketbaseUrl.trim()
                : d.pocketbaseUrl,
        pocketbaseEmail:
            parsed.pocketbaseEmail !== undefined ? parsed.pocketbaseEmail : d.pocketbaseEmail,
        pocketbasePassword:
            parsed.pocketbasePassword !== undefined ? parsed.pocketbasePassword : d.pocketbasePassword,
    };
}
