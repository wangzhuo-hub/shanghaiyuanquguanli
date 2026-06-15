/**
 * 指标计算 Web Worker。
 * calculateDashboardMetrics 是纯函数（输入/输出均为可结构化克隆的 JSON），
 * 放到 Worker 线程执行，使工作台打开/编辑时主线程不再被秒级同步计算冻结。
 *
 * 协议：主线程 postMessage({ reqId, data, options }) → 本 worker 回 postMessage({ reqId, processedData, fullYearMonthlyTrends })
 * 出错回 { reqId, error }。主线程 metricsWorkerClient 负责按 reqId 派发与「最新者胜」。
 */
import { calculateDashboardMetrics } from './dashboardMetrics';
import type { DashboardData } from '../types';
import type { DashboardMetricOptions } from './dashboardMetrics';

interface MetricsRequest {
    reqId: number;
    data: DashboardData;
    options: DashboardMetricOptions;
}

// Worker 全局作用域
const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<MetricsRequest>) => {
    const { reqId, data, options } = e.data || ({} as MetricsRequest);
    try {
        const { processedData, fullYearMonthlyTrends } = calculateDashboardMetrics(data, options);
        ctx.postMessage({ reqId, processedData, fullYearMonthlyTrends });
    } catch (err) {
        ctx.postMessage({ reqId, error: (err as Error)?.message || String(err) });
    }
};
