import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('integration gateway PocketBase client', () => {
    it('disables PocketBase SDK auto cancellation for backend concurrent refreshes', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('pb.autoCancellation(false)');
    });

    it('keeps compute prewarm separate from scheduler-driven sealing jobs', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('COMPUTE_PREWARM_ENABLED');
        expect(source).toContain('startComputePrewarmJobs()');
        expect(source).toContain('GATEWAY_SCHEDULER_ENABLED=1 开启封账+审计清理');
        expect(source).toContain('COMPUTE_PREWARM_ENABLED=1 开启，不影响封账调度');
    });

    it('clears compute caches and refreshes snapshots after scheduler sealing writes', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('clearComputeCaches(projectId);');
        expect(source).toContain('await runComputeRefresh(projectId, year);');
    });

    it('deploys the gateway scheduler flag into the runtime env file', () => {
        const source = readFileSync(
            new URL('../deploy-app-api-gateway.sh', import.meta.url),
            'utf8',
        );

        expect(source).toContain('GATEWAY_SCHEDULER_ENABLED="${GATEWAY_SCHEDULER_ENABLED:-1}"');
        expect(source).toContain('GATEWAY_SCHEDULER_ENABLED=${GATEWAY_SCHEDULER_ENABLED}');
        expect(source).toContain('scheduler=${GATEWAY_SCHEDULER_ENABLED}');
    });

    it('skips audit retention cleanup when the collection has no created field', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain("fields: 'id,created'");
        expect(source).toContain('typeof sample?.created !==');
        expect(source).toContain('审计日志集合未暴露 created 字段，跳过保留期清理');
    });

    it('uses shared compute data version cache for dashboard bootstrap version reads', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('readComputeDataVersion');
        expect(source).toContain('const version = await readComputeDataVersion(projectId);');
    });

    it('supports lightweight bootstrap without previous-year trends', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('include_prev_year_trends');
        expect(source).toContain('prevYearMonthlyTrends: []');
        expect(source).toContain('includePrevYearTrends,');
    });

    it('reads dashboard bootstrap snapshots through the backend admin client after authorization', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('避免用户态 PB rule 只允许 auth.project_id 时把其它已授权园区误判为 snapshot-miss');
        expect(source).toContain('const snapshotClient = pb;');
    });

    it('accepts draft dirty payloads by applying them to a fresh PocketBase baseline', () => {
        const source = readFileSync(
            new URL('../integration-gateway.ts', import.meta.url),
            'utf8',
        );

        expect(source).toContain('draft_payload');
        expect(source).toContain('resolveDraftComputeInput');
        expect(source).toContain('fetchPocketBaseBackup(projectId, { year })');
        expect(source).toContain('applyDirtyPayloadToDashboardData(baselineData, filteredPayload)');
        expect(source).toContain('draft-payload-compute-engine');
    });
});
