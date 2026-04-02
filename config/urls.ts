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
        return `http://localhost:8001${t.startsWith('/') ? t : `/${t}`}`;
    }
    if (typeof window !== 'undefined') {
        return new URL('/api/pb', window.location.origin).href;
    }
    return 'http://localhost:8001';
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

/** 用于错误提示中的代理根地址（不含路径） */
export function getAiProxyBaseForMessage(): string {
    const base = (import.meta.env.VITE_QWEN_PROXY_URL as string | undefined)?.trim();
    if (base) return base.replace(/\/+$/, '');
    if (typeof window !== 'undefined') {
        return window.location.origin;
    }
    return 'http://localhost:3010';
}
