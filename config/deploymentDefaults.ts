import type { CloudConfig } from '../types';

/**
 * 局域网部署默认后端：无 localStorage 的新用户将使用此处配置自动连接。
 * 打包前可修改常量，或建立 .env / .env.production 并设置 VITE_POCKETBASE_*（推荐用环境变量注入密码，避免提交仓库）。
 */
const env = import.meta.env;

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
    provider: 'pocketbase',
    autoSync: false,
    projectId: (env.VITE_POCKETBASE_PROJECT_ID as string) || 'park_data_main',
    pocketbaseUrl: (env.VITE_POCKETBASE_URL as string) || 'http://192.168.0.11:9002',
    pocketbaseEmail: (env.VITE_POCKETBASE_EMAIL as string) || 'admin@example.com',
    pocketbasePassword: (env.VITE_POCKETBASE_PASSWORD as string) || '',
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
