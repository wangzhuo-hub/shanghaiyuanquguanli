import type { CloudConfig } from '../types';

/**
 * 默认云端配置（空白）：标准化交付不再预填任何后端地址/账号信息。
 * 用户需要在「系统与备份」里手动填写并保存。
 */

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    projectId: 'park_data_main',
    pocketbaseUrl: '',
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
