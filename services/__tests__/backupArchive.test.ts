import { describe, expect, it } from 'vitest';
import {
    createDashboardBackupEnvelope,
    parseDashboardBackup,
    sanitizeImportedDashboardData,
    validateBackupTarget,
} from '../backupArchive';

const dashboard = {
    buildings: [{ id: 'b1', name: '1号楼', units: [{ id: 'u1' }] }],
    tenants: [{ id: 't1', name: '客户' }],
    payments: [],
    invoices: [],
};

describe('backupArchive', () => {
    it('wraps backup with project metadata', () => {
        const backup = createDashboardBackupEnvelope(dashboard as any, {
            projectId: 'shanghai_park',
            parkName: '上海园区',
            exportedBy: 'user@example.com',
            exportedAt: new Date('2026-04-29T00:00:00.000Z'),
        });
        expect(backup.project_id).toBe('shanghai_park');
        expect(backup.data.buildings).toHaveLength(1);
    });

    it('accepts matching project envelope', () => {
        const parsed = parseDashboardBackup(createDashboardBackupEnvelope(dashboard as any, {
            projectId: 'shanghai_park',
        }));
        expect(validateBackupTarget(parsed, 'shanghai_park', ['shanghai_park'])).toEqual({
            ok: true,
            warnings: [],
        });
    });

    it('blocks cross-park envelope restore', () => {
        const parsed = parseDashboardBackup(createDashboardBackupEnvelope(dashboard as any, {
            projectId: 'shanghai_park',
        }));
        expect(validateBackupTarget(parsed, 'shenzhen_park', ['shenzhen_park'])).toEqual({
            ok: false,
            message: '备份文件属于 shanghai_park，当前目标园区是 shenzhen_park，已阻止跨园区恢复。',
            warnings: [],
        });
    });

    it('warns legacy backup without project id', () => {
        const parsed = parseDashboardBackup(dashboard);
        const result = validateBackupTarget(parsed, 'shanghai_park', ['shanghai_park']);
        expect(result.ok).toBe(true);
        expect(result.warnings).toContain('旧格式备份文件未声明 project_id，需要人工确认目标园区。');
    });

    describe('sanitizeImportedDashboardData', () => {
        const liveTenants = [
            { id: 't_park', name: '停车场', paymentCycle: 'Monthly' },
            { id: 't_guanyi', name: '上海管易云计算软件有限公司', paymentCycle: 'Monthly' },
        ];

        const baseScenario = (id: string, isActive = false, isReceivableActive = false) => ({
            id,
            name: id,
            isActive,
            isReceivableActive,
            assumptions: [],
            adjustments: [],
            baseDataSnapshot: {
                tenants: [
                    { id: 't_park_old', name: '停车收费', paymentCycle: 'Quarterly' },
                    { id: 't_guanyi', name: '上海管易云计算软件有限公司', paymentCycle: 'Quarterly' },
                ],
                buildings: [],
            },
        });

        it('preserves static baseDataSnapshot for active and receivable-dedicated scenarios', () => {
            const data = {
                tenants: liveTenants,
                budgetScenarios: [
                    baseScenario('scenario_active', true, false),
                    baseScenario('invoice_dedicated_2026', false, true),
                    baseScenario('scenario_frozen_2025', false, false),
                ],
            };
            const cleaned = sanitizeImportedDashboardData(data as any) as any;
            const active = cleaned.budgetScenarios.find((s: any) => s.id === 'scenario_active');
            const dedicated = cleaned.budgetScenarios.find((s: any) => s.id === 'invoice_dedicated_2026');
            const frozen = cleaned.budgetScenarios.find((s: any) => s.id === 'scenario_frozen_2025');
            expect(active.baseDataSnapshot).toBeDefined();
            expect(active.baseDataSnapshot.tenants).toHaveLength(2);
            expect(dedicated.baseDataSnapshot).toBeDefined();
            expect(dedicated.baseDataSnapshot.tenants).toHaveLength(2);
            expect(frozen.baseDataSnapshot).toBeDefined();
            expect(frozen.baseDataSnapshot.tenants).toHaveLength(2);
        });

        it('drops legacy invoice_dedicated scenario without year suffix', () => {
            const data = {
                tenants: liveTenants,
                budgetScenarios: [
                    { id: 'invoice_dedicated', name: '老应收专用方案', baseDataSnapshot: { tenants: [], buildings: [] } },
                    baseScenario('scenario_active', true, false),
                ],
            };
            const cleaned = sanitizeImportedDashboardData(data as any) as any;
            expect(cleaned.budgetScenarios.find((s: any) => s.id === 'invoice_dedicated')).toBeUndefined();
            expect(cleaned.budgetScenarios.find((s: any) => s.id === 'scenario_active')).toBeDefined();
        });

        it('returns input unchanged when no scenarios', () => {
            const empty = sanitizeImportedDashboardData({ tenants: [] } as any) as any;
            expect(empty.tenants).toEqual([]);
        });

        it('normalizes legacy scenario budgetYear=0 to inferred year', () => {
            const data = {
                tenants: liveTenants,
                budgetScenarios: [
                    {
                        id: 'scenario_legacy',
                        name: '2026年预算',
                        budgetYear: 0,
                        createdAt: '2025-12-15T10:14:14.907Z',
                        isActive: true,
                        assumptions: [{ projectedSignDate: '2026-04-01' }],
                        adjustments: null,
                        baseDataSnapshot: { tenants: [{ id: 'old' }], buildings: [] },
                    },
                ],
            };
            const cleaned = sanitizeImportedDashboardData(data as any) as any;
            const scenario = cleaned.budgetScenarios[0];
            expect(scenario.budgetYear).toBe(2026);
            expect(Array.isArray(scenario.assumptions)).toBe(true);
            expect(Array.isArray(scenario.adjustments)).toBe(true);
            // 预算方案快照是静态预算口径的一部分，导入时必须保留。
            expect(scenario.baseDataSnapshot).toBeDefined();
        });
    });

    it('blocks mixed embedded project ids', () => {
        const parsed = parseDashboardBackup({
            buildings: [],
            tenants: [{ id: 'a', project_id: 'shanghai_park' }, { id: 'b', project_id: 'shenzhen_park' }],
        });
        expect(validateBackupTarget(parsed, 'shanghai_park', ['shanghai_park'])).toMatchObject({
            ok: false,
        });
    });
});
