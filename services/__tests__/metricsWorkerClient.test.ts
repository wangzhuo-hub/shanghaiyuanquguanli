import { afterEach, describe, expect, it, vi } from 'vitest';

describe('metricsWorkerClient', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.resetModules();
        vi.useRealTimers();
    });

    it('rejects hung worker requests after the configured timeout', async () => {
        vi.useFakeTimers();
        let workerInstance: { onmessage?: (event: MessageEvent) => void } | null = null;
        class HangingWorker {
            onmessage?: (event: MessageEvent) => void;
            onerror?: () => void;
            postMessage = vi.fn();

            constructor() {
                workerInstance = this;
            }
        }
        vi.stubGlobal('Worker', HangingWorker);

        const { computeMetricsInWorker } = await import('../metricsWorkerClient');
        const promise = computeMetricsInWorker({} as any, {} as any, 10);
        const rejection = expect(promise).rejects.toThrow('metrics worker timeout');

        await vi.advanceTimersByTimeAsync(10);
        await rejection;

        expect(() => {
            workerInstance?.onmessage?.({
                data: {
                    reqId: 1,
                    processedData: {},
                    fullYearMonthlyTrends: [],
                },
            } as MessageEvent);
        }).not.toThrow();
    });
});
