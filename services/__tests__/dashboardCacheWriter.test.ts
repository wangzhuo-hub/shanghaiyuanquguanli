import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardCacheWriter, stripDashboardCacheDerivedFields } from '../dashboardCacheWriter';

describe('DashboardCacheWriter', () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.clearAllMocks();
    });

    it('strips derived dashboard fields before persistence', () => {
        const stripped = stripDashboardCacheDerivedFields({
            buildings: [{ id: 'b1' }],
            tenants: [{ id: 't1' }],
            monthlyTrends: [{ month: '1月' }],
            currentMonthBilling: [{ tenantId: 't1' }],
            budgetAnalysis: { total: 100 },
            leaseStats: { newLeasesYear: 1 },
        }) as Record<string, unknown>;

        expect(stripped.buildings).toEqual([{ id: 'b1' }]);
        expect(stripped.tenants).toEqual([{ id: 't1' }]);
        expect(stripped.monthlyTrends).toBeUndefined();
        expect(stripped.currentMonthBilling).toBeUndefined();
        expect(stripped.budgetAnalysis).toBeUndefined();
        expect(stripped.leaseStats).toBeUndefined();
    });

    it('coalesces multiple writes for the same key until the scheduled flush', async () => {
        const scheduled: Array<() => void> = [];
        const cachePut = vi.fn(async (_key: string, _value: string) => true);
        const writer = new DashboardCacheWriter({
            cachePut,
            schedule: (flush) => {
                scheduled.push(flush);
            },
        });

        writer.putObject('park:a', { tenants: [{ id: 'old' }] });
        writer.putObject('park:a', { tenants: [{ id: 'new' }] });

        expect(cachePut).not.toHaveBeenCalled();
        const flush = scheduled[0];
        if (!flush) throw new Error('flush was not scheduled');
        flush();
        await Promise.resolve();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(cachePut.mock.calls[0][0]).toBe('park:a');
        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'new' }] });
    });

    it('uses fallback storage only when IndexedDB write fails', async () => {
        const fallbackPut = vi.fn((_key: string, _value: string) => undefined);
        const writer = new DashboardCacheWriter({
            cachePut: vi.fn(async (_key: string, _value: string) => false),
            fallbackPut,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', { tenants: [] });
        await Promise.resolve();
        await Promise.resolve();

        expect(fallbackPut).toHaveBeenCalledTimes(1);
        expect(fallbackPut.mock.calls[0][0]).toBe('park:a');
        expect(JSON.parse(fallbackPut.mock.calls[0][1])).toEqual({ tenants: [] });
    });

    it('can synchronously write pending fallback without clearing async cache work', async () => {
        const cachePut = vi.fn(async (_key: string, _value: string) => true);
        const fallbackPut = vi.fn((_key: string, _value: string) => true);
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'pending' }] });
        writer.flushFallbackSync();

        expect(fallbackPut).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fallbackPut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'pending' }] });
        expect(cachePut).not.toHaveBeenCalled();

        await writer.flush();

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'pending' }] });
    });

    it('does not write fallback twice when synchronous fallback already persisted the same payload', async () => {
        const cachePut = vi.fn(async (_key: string, _value: string) => false);
        const fallbackPut = vi.fn((_key: string, _value: string) => true);
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'pending' }] });
        writer.flushFallbackSync();
        await writer.flush();

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(fallbackPut).toHaveBeenCalledTimes(1);
        expect(JSON.parse(fallbackPut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'pending' }] });
    });

    it('still retries fallback during async flush when synchronous fallback reports failure', async () => {
        const cachePut = vi.fn(async (_key: string, _value: string) => false);
        const fallbackPut = vi
            .fn((_key: string, _value: string) => false)
            .mockReturnValueOnce(false)
            .mockReturnValueOnce(true);
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'pending' }] });
        writer.flushFallbackSync();
        await writer.flush();

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(fallbackPut).toHaveBeenCalledTimes(2);
    });

    it('reuses fallback serialization during the following primary flush', async () => {
        const stringifySpy = vi.spyOn(JSON, 'stringify');
        const cachePut = vi.fn(async (_key: string, _value: string) => true);
        const fallbackPut = vi.fn((_key: string, _value: string) => true);
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'pending' }] });
        const callsBeforeFallback = stringifySpy.mock.calls.length;
        writer.flushFallbackSync();
        const callsAfterFallback = stringifySpy.mock.calls.length;
        await writer.flush();
        const callsAfterFlush = stringifySpy.mock.calls.length;

        stringifySpy.mockRestore();

        expect(callsAfterFallback - callsBeforeFallback).toBe(1);
        expect(callsAfterFlush).toBe(callsAfterFallback);
        expect(cachePut).toHaveBeenCalledTimes(1);
    });

    it('removes matching fallback storage after primary cache write succeeds', async () => {
        const fallbackRemove = vi.fn((_key: string, _value: string, _startedAt?: number) => undefined);
        const writer = new DashboardCacheWriter({
            cachePut: vi.fn(async (_key: string, _value: string) => true),
            fallbackRemove,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        expect(fallbackRemove).toHaveBeenCalledTimes(1);
        expect(fallbackRemove.mock.calls[0][0]).toBe('park:a');
        expect(JSON.parse(fallbackRemove.mock.calls[0][1])).toEqual({ tenants: [{ id: 't1' }] });
        expect(typeof fallbackRemove.mock.calls[0][2]).toBe('number');
    });

    it('skips persisted-equivalent writes when only derived fields changed', async () => {
        const cachePut = vi.fn(async (_key: string, _value: string) => true);
        const writer = new DashboardCacheWriter({
            cachePut,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', {
            tenants: [{ id: 't1' }],
            monthlyTrends: [{ month: '1月', revenueTarget: 1 }],
        });
        await Promise.resolve();
        await Promise.resolve();

        writer.putObject('park:a', {
            tenants: [{ id: 't1' }],
            monthlyTrends: [{ month: '1月', revenueTarget: 999 }],
            currentMonthBilling: [{ tenantId: 't1' }],
        });
        await Promise.resolve();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 't1' }] });
    });

	    it('retries the same payload after a failed write without fallback storage', async () => {
	        const cachePut = vi
	            .fn()
	            .mockResolvedValueOnce(false)
	            .mockResolvedValueOnce(true);
        const writer = new DashboardCacheWriter({
            cachePut,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();
	
	        expect(cachePut).toHaveBeenCalledTimes(2);
	    });

	    it('keeps a failed cache write pending for the next explicit flush', async () => {
	        const cachePut = vi
	            .fn()
	            .mockResolvedValueOnce(false)
	            .mockResolvedValueOnce(true);
	        const writer = new DashboardCacheWriter({
	            cachePut,
	            schedule: () => undefined,
	        });

	        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
	        await writer.flush();
	        expect(cachePut).toHaveBeenCalledTimes(1);

	        await writer.flush();

	        expect(cachePut).toHaveBeenCalledTimes(2);
	        expect(JSON.parse(cachePut.mock.calls[1][1])).toEqual({ tenants: [{ id: 't1' }] });
	    });

	    it('does not requeue an older failed payload over a newer pending value', async () => {
	        let writer: DashboardCacheWriter;
	        const cachePut = vi.fn(async (_key: string, _value: string) => {
	            if (cachePut.mock.calls.length === 1) {
	                writer.putObject('park:a', { tenants: [{ id: 'newer' }] });
	                return false;
	            }
	            return true;
	        });
	        writer = new DashboardCacheWriter({
	            cachePut,
	            schedule: () => undefined,
	        });

	        writer.putObject('park:a', { tenants: [{ id: 'older' }] });
	        await writer.flush();
	        expect(cachePut).toHaveBeenCalledTimes(1);

	        await writer.flush();

	        expect(cachePut).toHaveBeenCalledTimes(2);
	        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'older' }] });
	        expect(JSON.parse(cachePut.mock.calls[1][1])).toEqual({ tenants: [{ id: 'newer' }] });
	    });

	    it('automatically retries a failed pending write when retry policy is enabled', async () => {
	        vi.useFakeTimers();
	        const scheduled: Array<() => void> = [];
	        const cachePut = vi
	            .fn()
	            .mockResolvedValueOnce(false)
	            .mockResolvedValueOnce(true);
	        const writer = new DashboardCacheWriter({
	            cachePut,
	            schedule: (flush) => {
	                scheduled.push(flush);
	            },
	            retryFailedFlushDelayMs: 50,
	            maxFailedFlushRetries: 2,
	        });

	        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
	        scheduled[0]?.();
	        await Promise.resolve();
	        await Promise.resolve();
	        expect(cachePut).toHaveBeenCalledTimes(1);

	        await vi.advanceTimersByTimeAsync(50);

	        expect(cachePut).toHaveBeenCalledTimes(2);
	        expect(JSON.parse(cachePut.mock.calls[1][1])).toEqual({ tenants: [{ id: 't1' }] });
	    });

	    it('stops automatic cache retry after the configured retry limit', async () => {
	        vi.useFakeTimers();
	        const scheduled: Array<() => void> = [];
	        const cachePut = vi.fn(async (_key: string, _value: string) => false);
	        const writer = new DashboardCacheWriter({
	            cachePut,
	            schedule: (flush) => {
	                scheduled.push(flush);
	            },
	            retryFailedFlushDelayMs: 50,
	            maxFailedFlushRetries: 2,
	        });

	        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
	        scheduled[0]?.();
	        await Promise.resolve();
	        await Promise.resolve();
	        expect(cachePut).toHaveBeenCalledTimes(1);

	        await vi.advanceTimersByTimeAsync(50);
	        await vi.advanceTimersByTimeAsync(50);
	        await vi.advanceTimersByTimeAsync(50);

	        expect(cachePut).toHaveBeenCalledTimes(3);
	    });

	    it('retries the same payload when fallback storage reports failure', async () => {
	        const cachePut = vi.fn(async (_key: string, _value: string) => false);
	        const fallbackPut = vi.fn((_key: string, _value: string) => false);
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(2);
        expect(fallbackPut).toHaveBeenCalledTimes(2);
    });

    it('retries the same payload when fallback storage throws', async () => {
        const cachePut = vi.fn(async (_key: string, _value: string) => false);
        const fallbackPut = vi.fn(() => {
            throw new Error('quota exceeded');
        });
        const writer = new DashboardCacheWriter({
            cachePut,
            fallbackPut,
            schedule: (flush) => flush(),
        });

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        writer.putObject('park:a', { tenants: [{ id: 't1' }] });
        await Promise.resolve();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(2);
        expect(fallbackPut).toHaveBeenCalledTimes(2);
    });

    it('serializes concurrent flush calls without duplicate writes', async () => {
        let resolveWrite: ((ok: boolean) => void) | undefined;
        const cachePut = vi.fn((_key: string, _value: string) => new Promise<boolean>((resolve) => {
            resolveWrite = resolve;
        }));
        const writer = new DashboardCacheWriter({
            cachePut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'only' }] });
        const firstFlush = writer.flush();
        const secondFlush = writer.flush();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(1);
        resolveWrite?.(true);
        await Promise.all([firstFlush, secondFlush]);

        expect(cachePut).toHaveBeenCalledTimes(1);
        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'only' }] });
    });

    it('flushes writes queued while a flush is in progress with latest value per key', async () => {
        let releaseFirstWrite: (() => void) | undefined;
        let writer: DashboardCacheWriter;
        const cachePut = vi.fn(async (_key: string, _value: string) => {
            if (cachePut.mock.calls.length === 1) {
                writer.putObject('park:a', { tenants: [{ id: 'queued-old' }] });
                writer.putObject('park:a', { tenants: [{ id: 'queued-new' }] });
                await new Promise<void>((resolve) => {
                    releaseFirstWrite = resolve;
                });
            }
            return true;
        });
        writer = new DashboardCacheWriter({
            cachePut,
            schedule: () => undefined,
        });

        writer.putObject('park:a', { tenants: [{ id: 'initial' }] });
        const flushPromise = writer.flush();
        await Promise.resolve();

        expect(cachePut).toHaveBeenCalledTimes(1);
        releaseFirstWrite?.();
        await flushPromise;

        expect(cachePut).toHaveBeenCalledTimes(2);
        expect(JSON.parse(cachePut.mock.calls[0][1])).toEqual({ tenants: [{ id: 'initial' }] });
        expect(JSON.parse(cachePut.mock.calls[1][1])).toEqual({ tenants: [{ id: 'queued-new' }] });
    });
});
