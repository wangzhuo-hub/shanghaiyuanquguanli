/**
 * 统一解析前端访问的后端地址（PocketBase、AI 代理），避免硬编码局域网 IP。
 *
 * - PocketBase：优先 `VITE_POCKETBASE_URL`；未设置时在浏览器内默认走同源 `/api/pb`（由 Vite/Nginx 反代到 PocketBase）。
 * - AI 代理：优先 `VITE_QWEN_PROXY_URL`（仅 base，不含路径）；未设置时默认同源 `/api/chat`。
 */

function normalizePocketbaseUrl(raw: string | undefined): string {
    if (raw && String(raw).trim()) {
        const t = String(raw).trim();
        if (t.startsWith('http://') || t.startsWith('https://')) return t;
        if (typeof window !== 'undefined') {
            return new URL(t.startsWith('/') ? t : `/${t}`, window.location.origin).href;
        }
        return `http://localhost:1002${t.startsWith('/') ? t : `/${t}`}`;
    }
    if (typeof window !== 'undefined') {
        return new URL('/api/pb', window.location.origin).href;
    }
    return 'http://localhost:1002';
}

/** 默认 PocketBase 根 URL（含子路径部署时的完整 URL） */
export function getDefaultPocketbaseUrl(): string {
    return normalizePocketbaseUrl(import.meta.env.VITE_POCKETBASE_URL as string | undefined);
}

/**
 * 千问 AI 代理的 `/api/chat` 完整地址。
 * 生产环境建议走 Nginx 同源 `/api/chat`；本地开发由 Vite 代理到 `ai-proxy`。
 */
export function getAiProxyChatUrl(): string {
    const base = (import.meta.env.VITE_QWEN_PROXY_URL as string | undefined)?.trim();
    if (base) {
        const b = base.replace(/\/+$/, '');
        return `${b}/api/chat`;
    }
    return '/api/chat';
}

/**
 * 集成网关 compute/refresh 地址。
 * 生产：同源 `/api/integration/compute/refresh`（Caddy → :8787）
 * 开发：Vite 代理 `/api/integration` → integration-gateway
 */
export function getIntegrationComputeRefreshUrl(): string {
    if (typeof window !== 'undefined') {
        return new URL('/api/integration/compute/refresh', window.location.origin).pathname;
    }
    const base = (import.meta.env.VITE_INTEGRATION_GATEWAY_URL as string | undefined)?.trim();
    if (base) {
        const b = base.replace(/\/+$/, '');
        return `${b}/api/integration/compute/refresh`;
    }
    return 'http://127.0.0.1:8787/api/integration/compute/refresh';
}

/** 前端保存后通知网关重算 KPI 的内部 Token（与服务器 INTEGRATION_INTERNAL_TOKEN 一致） */
export function getIntegrationInternalToken(): string {
    return String(import.meta.env.VITE_INTEGRATION_INTERNAL_TOKEN || '').trim();
}

/** 用于错误提示中的代理根地址（不含路径） */
export function getAiProxyBaseForMessage(): string {
    const base = (import.meta.env.VITE_QWEN_PROXY_URL as string | undefined)?.trim();
    if (base) return base.replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return 'http://localhost:3010';
}
