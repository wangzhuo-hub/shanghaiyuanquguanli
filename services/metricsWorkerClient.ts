/**
 * 指标 Worker 客户端：管理单例 Worker、按 reqId 派发请求、提供可用性探测与优雅降级。
 * Worker 不可用（非浏览器环境、构造失败、运行期错误）时返回不可用，调用方回退主线程同步计算。
 */
import type { DashboardData } from '../types';
import type { DashboardMetricOptions, DashboardMetricResult } from './dashboardMetrics';

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, { resolve: (v: DashboardMetricResult) => void; reject: (e: unknown) => void }>();

const failAll = (reason: string) => {
    for (const p of pending.values()) p.reject(new Error(reason));
    pending.clear();
};

const ensureWorker = (): Worker | null => {
    if (broken) return null;
    if (worker) return worker;
    if (typeof Worker === 'undefined') {
        broken = true;
        return null;
    }
    try {
        worker = new Worker(new URL('./metricsWorker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (e: MessageEvent) => {
            const { reqId, processedData, fullYearMonthlyTrends, error } = e.data || {};
            const p = pending.get(reqId);
            if (!p) return;
            pending.delete(reqId);
            if (error) p.reject(new Error(String(error)));
            else p.resolve({ processedData, fullYearMonthlyTrends });
        };
        worker.onerror = () => {
            broken = true;
            worker = null;
            failAll('metrics worker error');
        };
        return worker;
    } catch {
        broken = true;
        return null;
    }
};

/** Worker 是否可用（首次调用会尝试构造）。 */
export const isMetricsWorkerAvailable = (): boolean => ensureWorker() != null;

/** 在 Worker 线程计算指标。Worker 不可用或出错时 reject，调用方应回退主线程。 */
export const computeMetricsInWorker = (
    data: DashboardData,
    options: DashboardMetricOptions,
): Promise<DashboardMetricResult> => {
    const w = ensureWorker();
    if (!w) return Promise.reject(new Error('metrics worker unavailable'));
    const reqId = ++seq;
    return new Promise<DashboardMetricResult>((resolve, reject) => {
        pending.set(reqId, { resolve, reject });
        try {
            w.postMessage({ reqId, data, options });
        } catch (e) {
            pending.delete(reqId);
            reject(e);
        }
    });
};
