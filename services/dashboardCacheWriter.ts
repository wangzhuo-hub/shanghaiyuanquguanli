export const DASHBOARD_CACHE_DERIVED_KEYS = [
    'monthlyTrends',
    'prevYearMonthlyTrends',
    'currentMonthBilling',
    'recentSignings',
    'expiringSoon',
    'parkingStats',
    'budgetAnalysis',
    'parkAreaMetrics',
    'leaseStats',
] as const;

export const stripDashboardCacheDerivedFields = (data: unknown): unknown => {
    if (!data || typeof data !== 'object') return data;
    const copy = { ...(data as Record<string, unknown>) };
    for (const key of DASHBOARD_CACHE_DERIVED_KEYS) delete copy[key];
    return copy;
};

export type DashboardCacheWriterOptions = {
    cachePut: (key: string, value: string) => Promise<boolean>;
    fallbackPut?: (key: string, value: string) => boolean | void;
    fallbackRemove?: (key: string, value: string, primaryWriteStartedAtMs?: number) => void;
    schedule?: (flush: () => void) => void;
    retryFailedFlushDelayMs?: number;
    maxFailedFlushRetries?: number;
};

type PendingCacheWrite = {
    value: unknown;
    jsonStr?: string;
};

const defaultSchedule = (flush: () => void): void => {
    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(flush, { timeout: 500 });
        return;
    }
    setTimeout(flush, 0);
};

export class DashboardCacheWriter {
    private pending = new Map<string, PendingCacheWrite>();
    private scheduled = false;
    private flushing: Promise<void> | null = null;
    private lastPersistedJson = new Map<string, string>();
    private lastFallbackJson = new Map<string, string>();
    private failedFlushRetries = 0;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;

    constructor(private readonly options: DashboardCacheWriterOptions) {}

    putObject(key: string, value: unknown): void {
        this.clearRetryTimer();
        this.failedFlushRetries = 0;
        this.pending.set(key, { value });
        if (this.scheduled || this.flushing) return;
        this.scheduled = true;
        (this.options.schedule || defaultSchedule)(() => {
            void this.flush();
        });
    }

    private clearRetryTimer(): void {
        if (!this.retryTimer) return;
        clearTimeout(this.retryTimer);
        this.retryTimer = null;
    }

    private scheduleFailedFlushRetry(): void {
        const delayMs = this.options.retryFailedFlushDelayMs;
        if (typeof delayMs !== 'number' || delayMs < 0 || this.retryTimer) return;
        const maxRetries = this.options.maxFailedFlushRetries ?? 3;
        if (this.failedFlushRetries >= maxRetries) return;
        this.failedFlushRetries += 1;
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (this.pending.size > 0) {
                void this.flush();
            }
        }, delayMs);
    }

    private serializePending(item: PendingCacheWrite): string {
        if (item.jsonStr !== undefined) return item.jsonStr;
        item.jsonStr = JSON.stringify(stripDashboardCacheDerivedFields(item.value));
        return item.jsonStr;
    }

    flushFallbackSync(): void {
        if (this.pending.size === 0 || !this.options.fallbackPut) return;
        const entries = Array.from(this.pending.entries());
        for (const [key, item] of entries) {
            const jsonStr = this.serializePending(item);
            if (this.lastPersistedJson.get(key) === jsonStr) continue;
            try {
                const fallbackResult = this.options.fallbackPut(key, jsonStr);
                if (fallbackResult !== false) {
                    this.lastFallbackJson.set(key, jsonStr);
                }
            } catch {
                // Fallback is best-effort; keep pending so async cachePut can still retry.
            }
        }
    }

    async flush(): Promise<void> {
        if (this.flushing) return this.flushing;
        this.scheduled = false;
        this.clearRetryTimer();

        const run = async (): Promise<void> => {
            let failedThisFlush = false;
            while (this.pending.size > 0) {
                const entries = Array.from(this.pending.entries());
                this.pending.clear();
                const failedEntries = new Map<string, PendingCacheWrite>();
                for (const [key, item] of entries) {
                    const jsonStr = this.serializePending(item);
                    if (this.lastPersistedJson.get(key) === jsonStr) {
                        continue;
                    }
                    const primaryWriteStartedAtMs = Date.now();
                    const ok = await this.options.cachePut(key, jsonStr);
                    let fallbackOk = false;
                    if (!ok) {
                        if (this.lastFallbackJson.get(key) === jsonStr) {
                            fallbackOk = true;
                        } else {
                            try {
                                const fallbackResult = this.options.fallbackPut?.(key, jsonStr);
                                fallbackOk = fallbackResult !== false && !!this.options.fallbackPut;
                                if (fallbackOk) {
                                    this.lastFallbackJson.set(key, jsonStr);
                                }
                            } catch {
                                fallbackOk = false;
                            }
                        }
                    }
                    if (ok) {
                        try {
                            this.options.fallbackRemove?.(key, jsonStr, primaryWriteStartedAtMs);
                        } catch {
                            // Local fallback cleanup failure should not mark the primary write as failed.
                        }
                    }
                    if (ok || fallbackOk) {
                        this.lastPersistedJson.set(key, jsonStr);
                        if (ok) {
                            this.lastFallbackJson.delete(key);
                        }
                    } else {
                        failedEntries.set(key, item);
                    }
                }
                if (failedEntries.size > 0) {
                    failedThisFlush = true;
                    for (const [key, item] of failedEntries) {
                        if (!this.pending.has(key)) {
                            this.pending.set(key, item);
                        }
                    }
                    break;
                }
            }
            if (failedThisFlush) {
                this.scheduleFailedFlushRetry();
            } else {
                this.failedFlushRetries = 0;
            }
        };

        this.flushing = run().finally(() => {
            this.flushing = null;
        });
        return this.flushing;
    }
}
