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

function integrationUrl(path: string): string {
    if (typeof window !== 'undefined') {
        return new URL(path, window.location.origin).pathname;
    }
    const base = (import.meta.env.VITE_INTEGRATION_GATEWAY_URL as string | undefined)?.trim();
    if (base) {
        const b = base.replace(/\/+$/, '');
        return `${b}${path}`;
    }
    return `http://127.0.0.1:8787${path}`;
}

/**
 * 用户态 App API KPI 刷新地址。
 * 前端通过已登录用户 token 调用；内部 Token 只保留在服务端环境。
 */
export function getIntegrationAppComputeRefreshUrl(): string {
    return integrationUrl('/api/integration/app/compute/refresh');
}

/** 用户态 App API 后台计算指定月份应收明细地址。 */
export function getIntegrationAppBillingComputeUrl(): string {
    return integrationUrl('/api/integration/app/compute/billing');
}

/** 用户态 App API 后台计算当前前端草稿指定月份应收明细地址（不落库）。 */
export function getIntegrationAppBillingDraftComputeUrl(): string {
    return integrationUrl('/api/integration/app/compute/billing-draft');
}

/** 用户态 App API 后台推算单合同账单预览地址（不落库）。 */
export function getIntegrationAppBudgetedBillsPreviewUrl(): string {
    return integrationUrl('/api/integration/app/compute/budgeted-bills-preview');
}

/** 用户态 App API 后台批量推算合同账单预览地址（不落库）。 */
export function getIntegrationAppBudgetedBillsPreviewBatchUrl(): string {
    return integrationUrl('/api/integration/app/compute/budgeted-bills-preview-batch');
}

/** 用户态 App API 后台计算预算表合同应收 12 个月汇总地址（不落库）。 */
export function getIntegrationAppContractReceivableMonthlyUrl(): string {
    return integrationUrl('/api/integration/app/compute/contract-receivable-monthly');
}

/** 用户态 App API 后台计算客户来源分析汇总地址（不落库）。 */
export function getIntegrationAppSourceAgentMetricsUrl(): string {
    return integrationUrl('/api/integration/app/compute/source-agent-metrics');
}

/** 用户态 App API 后台计算合同经营分析汇总地址（不落库）。 */
export function getIntegrationAppContractAnalysisMetricsUrl(): string {
    return integrationUrl('/api/integration/app/compute/contract-analysis-metrics');
}

/** 用户态 App API 后台计算客户级历史欠费筛选数据地址（不落库）。 */
export function getIntegrationAppTenantHistoricalArrearsUrl(): string {
    return integrationUrl('/api/integration/app/compute/tenant-historical-arrears');
}

/** 用户态 App API 后台计算完整看板数据地址。 */
export function getIntegrationAppDashboardComputeUrl(): string {
    return integrationUrl('/api/integration/app/dashboard/compute');
}

/** 用户态 App API 启动快照地址：优先读取 pb_integration_snapshots，不阻塞实时计算。 */
export function getIntegrationAppDashboardBootstrapUrl(): string {
    return integrationUrl('/api/integration/app/dashboard/bootstrap');
}

/** 用户态 App API 后台计算当前前端草稿看板数据地址（不落库）。 */
export function getIntegrationAppDashboardDraftComputeUrl(): string {
    return integrationUrl('/api/integration/app/dashboard/compute-draft');
}

/** 用户态 App API 多园区大屏聚合数据地址。 */
export function getIntegrationAppBigScreenUrl(): string {
    return integrationUrl('/api/integration/app/big-screen');
}

/** 用户态 App API 当前用户关注字段偏好地址。 */
export function getIntegrationAppDashboardCustomFieldsPreferenceUrl(): string {
    return integrationUrl('/api/integration/app/preferences/dashboard-custom-fields');
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
