import { describe, expect, it, vi } from 'vitest';
import {
	hasPendingSaveDiff,
	isSaveDiffKnownClean,
	shouldAttemptCloudSaveDuringAutoSave,
	shouldRunSaveDiff,
	shouldScheduleAutoSave,
	shouldWriteDashboardCacheDuringAutoSave,
	shouldWriteDashboardCache,
	validateManualCloudSave,
} from '../saveDiffState';

describe('save diff state', () => {
    it('treats the save state as clean only when there are no dirty collections and the data ref is tracked', () => {
        const data = { id: 'current' };

        expect(isSaveDiffKnownClean({
            dirtyCollectionCount: 0,
            lastTrackedData: data,
            currentData: data,
        })).toBe(true);

        expect(isSaveDiffKnownClean({
            dirtyCollectionCount: 1,
            lastTrackedData: data,
            currentData: data,
        })).toBe(false);

        expect(isSaveDiffKnownClean({
            dirtyCollectionCount: 0,
            lastTrackedData: { id: 'previous' },
            currentData: data,
        })).toBe(false);
    });

    it('skips dashboard cache writes when the tracked data ref is already clean', () => {
        const data = { id: 'current' };

        expect(shouldWriteDashboardCache({
            dirtyCollectionCount: 0,
            lastTrackedData: data,
            currentData: data,
        })).toBe(false);

        expect(shouldWriteDashboardCache({
            dirtyCollectionCount: 1,
            lastTrackedData: data,
            currentData: data,
        })).toBe(true);

        expect(shouldWriteDashboardCache({
            dirtyCollectionCount: 0,
            lastTrackedData: { id: 'previous' },
            currentData: data,
        })).toBe(true);
    });

	it('uses the same clean-state guard before building an incremental save diff', () => {
		const data = { id: 'current' };

        expect(shouldRunSaveDiff({
            dirtyCollectionCount: 0,
            lastTrackedData: data,
            currentData: data,
        })).toBe(false);

        expect(shouldRunSaveDiff({
            dirtyCollectionCount: 1,
            lastTrackedData: data,
            currentData: data,
		})).toBe(true);
	});

	it('does not schedule auto-save when cache and cloud save state are known clean', () => {
		const data = { id: 'current' };

		expect(shouldScheduleAutoSave({
			dirtyCollectionCount: 0,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: false,
			cloudAutoSync: true,
			cloudConnected: true,
		})).toBe(false);
	});

	it('schedules auto-save when dashboard cache has pending writes', () => {
		const data = { id: 'current' };

		expect(shouldScheduleAutoSave({
			dirtyCollectionCount: 0,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: true,
			cloudAutoSync: false,
			cloudConnected: false,
		})).toBe(true);
	});

	it('schedules local cache writes for dirty collections even when cloud sync is disabled', () => {
		const data = { id: 'current' };

		expect(shouldScheduleAutoSave({
			dirtyCollectionCount: 1,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: false,
			cloudAutoSync: false,
			cloudConnected: false,
		})).toBe(true);
	});

	it('conservatively schedules auto-save when the tracked data ref is unknown', () => {
		const data = { id: 'current' };

		expect(shouldScheduleAutoSave({
			dirtyCollectionCount: 0,
			lastTrackedData: { id: 'previous' },
			currentData: data,
			dashboardCacheDirty: false,
			cloudAutoSync: false,
			cloudConnected: false,
		})).toBe(true);
	});

	it('does not schedule auto-save without current data', () => {
		expect(shouldScheduleAutoSave({
			dirtyCollectionCount: 1,
			lastTrackedData: null,
			currentData: null,
			dashboardCacheDirty: true,
			cloudAutoSync: true,
			cloudConnected: true,
		})).toBe(false);
	});

	it('writes local dashboard cache without a cloud baseline when offline and not switching projects', () => {
		const data = { id: 'current' };

		expect(shouldWriteDashboardCacheDuringAutoSave({
			dirtyCollectionCount: 1,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: false,
			cloudAutoSync: true,
			cloudConnected: false,
			isPreview: false,
			isSyncing: false,
			hasBaseline: false,
			currentProjectId: 'park-a',
			scheduledProjectId: 'park-a',
			dataProjectConsistent: true,
		})).toBe(true);
	});

	it('blocks local cache writes without a baseline while a project load is still syncing', () => {
		const data = { id: 'current' };

		expect(shouldWriteDashboardCacheDuringAutoSave({
			dirtyCollectionCount: 1,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: true,
			cloudAutoSync: true,
			cloudConnected: false,
			isPreview: false,
			isSyncing: true,
			hasBaseline: false,
			currentProjectId: 'park-b',
			scheduledProjectId: 'park-b',
			dataProjectConsistent: true,
		})).toBe(false);
	});

	it('blocks local cache writes for preview data, project races, or mismatched project data', () => {
		const data = { id: 'current' };
		const base = {
			dirtyCollectionCount: 1,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: true,
			cloudAutoSync: true,
			cloudConnected: true,
			isPreview: false,
			isSyncing: false,
			hasBaseline: true,
			currentProjectId: 'park-a',
			scheduledProjectId: 'park-a',
			dataProjectConsistent: true,
		};

		expect(shouldWriteDashboardCacheDuringAutoSave({
			...base,
			isPreview: true,
		})).toBe(false);
		expect(shouldWriteDashboardCacheDuringAutoSave({
			...base,
			currentProjectId: 'park-b',
		})).toBe(false);
		expect(shouldWriteDashboardCacheDuringAutoSave({
			...base,
			dataProjectConsistent: false,
		})).toBe(false);
	});

	it('attempts cloud auto-save only with baseline, cloud sync, and real save diff', () => {
		const data = { id: 'current' };
		const base = {
			dirtyCollectionCount: 1,
			lastTrackedData: data,
			currentData: data,
			dashboardCacheDirty: false,
			cloudAutoSync: true,
			cloudConnected: true,
			isPreview: false,
			isSyncing: false,
			hasBaseline: true,
			currentProjectId: 'park-a',
			scheduledProjectId: 'park-a',
			dataProjectConsistent: true,
		};

		expect(shouldAttemptCloudSaveDuringAutoSave(base)).toBe(true);
		expect(shouldAttemptCloudSaveDuringAutoSave({
			...base,
			hasBaseline: false,
		})).toBe(false);
		expect(shouldAttemptCloudSaveDuringAutoSave({
			...base,
			cloudConnected: false,
		})).toBe(false);
		expect(shouldAttemptCloudSaveDuringAutoSave({
			...base,
			isPreview: true,
		})).toBe(false);
		expect(shouldAttemptCloudSaveDuringAutoSave({
			...base,
			currentProjectId: 'park-b',
		})).toBe(false);
		expect(shouldAttemptCloudSaveDuringAutoSave({
			...base,
			dirtyCollectionCount: 0,
		})).toBe(false);
	});

	it('allows manual cloud save only for full data in the current connected project', () => {
		const data = { id: 'current' };

		expect(validateManualCloudSave({
			currentData: data,
			isPreview: false,
			cloudConnected: true,
			currentProjectId: 'park-a',
			dataProjectConsistent: true,
		})).toEqual({ allowed: true });

		expect(validateManualCloudSave({
			currentData: null,
			isPreview: false,
			cloudConnected: true,
			currentProjectId: 'park-a',
			dataProjectConsistent: true,
		}).allowed).toBe(false);

		expect(validateManualCloudSave({
			currentData: data,
			isPreview: true,
			cloudConnected: true,
			currentProjectId: 'park-a',
			dataProjectConsistent: true,
		})).toEqual({
			allowed: false,
			message: '后台正在同步或计算全量业务数据，请等待完成后再保存。当前页面仅展示快照或缓存预览。',
		});

		expect(validateManualCloudSave({
			currentData: data,
			isPreview: false,
			cloudConnected: false,
			currentProjectId: 'park-a',
			dataProjectConsistent: true,
		}).allowed).toBe(false);

		expect(validateManualCloudSave({
			currentData: data,
			isPreview: false,
			cloudConnected: true,
			currentProjectId: '',
			dataProjectConsistent: true,
		}).allowed).toBe(false);

		expect(validateManualCloudSave({
			currentData: data,
			isPreview: false,
			cloudConnected: true,
			currentProjectId: 'park-a',
			dataProjectConsistent: false,
		})).toEqual({
			allowed: false,
			message: '数据一致性校验失败：当前页面数据不属于目标园区，已阻止保存。请切换园区后重新操作。',
		});
	});

	it('skips exact payload diff when the save state is already known clean', async () => {
        const data = { id: 'current' };
        const buildPayload = vi.fn(() => {
            throw new Error('should not build payload');
        });
        let scheduleCalls = 0;
        const schedule = async <T,>(task: () => T): Promise<T> => {
            scheduleCalls += 1;
            return task();
        };

        await expect(hasPendingSaveDiff({
            hasBaseline: true,
            currentData: data,
            projectId: 'park-a',
            dirtyCollectionCount: 0,
            lastTrackedData: data,
            buildPayload,
            schedule,
        })).resolves.toBe(false);

        expect(buildPayload).not.toHaveBeenCalled();
        expect(scheduleCalls).toBe(0);
    });

    it('uses the provided scheduler for exact payload diff when state is unknown', async () => {
        const data = { id: 'current' };
        const buildPayload = vi.fn(() => ({
            pb_tenants: {
                creates: [{ originalId: 'tenant-a', data: { name: 'A' } }],
                updates: [],
                deletes: [],
            },
        }));
        let scheduleCalls = 0;
        const schedule = async <T,>(task: () => T): Promise<T> => {
            scheduleCalls += 1;
            return task();
        };

        await expect(hasPendingSaveDiff({
            hasBaseline: true,
            currentData: data,
            projectId: 'park-a',
            dirtyCollectionCount: 1,
            lastTrackedData: data,
            buildPayload,
            schedule,
        })).resolves.toBe(true);

        expect(scheduleCalls).toBe(1);
        expect(buildPayload).toHaveBeenCalledTimes(1);
    });

    it('treats an unknown state as clean when exact payload diff is empty', async () => {
        const data = { id: 'current' };

        await expect(hasPendingSaveDiff({
            hasBaseline: true,
            currentData: data,
            projectId: 'park-a',
            dirtyCollectionCount: 0,
            lastTrackedData: { id: 'previous' },
            buildPayload: () => ({}),
        })).resolves.toBe(false);
    });

    it('conservatively reports pending changes when exact diff cannot be proven', async () => {
        const data = { id: 'current' };
        const buildPayload = vi.fn(() => {
            throw new Error('diff failed');
        });

        await expect(hasPendingSaveDiff({
            hasBaseline: false,
            currentData: data,
            projectId: 'park-a',
            dirtyCollectionCount: 0,
            lastTrackedData: data,
            buildPayload,
        })).resolves.toBe(true);
        expect(buildPayload).not.toHaveBeenCalled();

        await expect(hasPendingSaveDiff({
            hasBaseline: true,
            currentData: data,
            projectId: 'park-a',
            dirtyCollectionCount: 1,
            lastTrackedData: data,
            buildPayload,
        })).resolves.toBe(true);
        expect(buildPayload).toHaveBeenCalledTimes(1);
    });
});
