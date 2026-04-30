import type { DashboardData } from '../types';

export const DASHBOARD_BACKUP_SCHEMA_VERSION = 2;
export const DASHBOARD_BACKUP_TYPE = 'park_dashboard_backup';

export type DashboardBackupEnvelope = {
    schema_version: typeof DASHBOARD_BACKUP_SCHEMA_VERSION;
    backup_type: typeof DASHBOARD_BACKUP_TYPE;
    project_id: string;
    park_name?: string;
    exported_at: string;
    exported_by?: string;
    data: Partial<DashboardData>;
};

export type BackupSummary = {
    buildings: number;
    units: number;
    tenants: number;
    payments: number;
    invoices: number;
    yearlyTargets: number;
    initializationData: number;
    budgetAssumptions: number;
    budgetAdjustments: number;
    budgetScenarios: number;
    effectiveBudgetTables: number;
};

export type ParsedBackup = {
    data: Partial<DashboardData>;
    projectId?: string;
    parkName?: string;
    exportedAt?: string;
    exportedBy?: string;
    isEnvelope: boolean;
    embeddedProjectIds: string[];
    summary: BackupSummary;
};

const DATA_KEYS = [
    'buildings',
    'tenants',
    'payments',
    'yearlyTargets',
    'initializationData',
    'invoices',
    'budgetAssumptions',
    'budgetAdjustments',
    'budgetScenarios',
    'effectiveBudgetTables',
    'billingPeriodNotes',
] as const;

export function summarizeDashboardBackup(data: Partial<DashboardData>): BackupSummary {
    const buildings = Array.isArray(data.buildings) ? data.buildings : [];
    return {
        buildings: buildings.length,
        units: buildings.reduce((sum, building: any) => sum + (Array.isArray(building?.units) ? building.units.length : 0), 0),
        tenants: Array.isArray(data.tenants) ? data.tenants.length : 0,
        payments: Array.isArray(data.payments) ? data.payments.length : 0,
        invoices: Array.isArray(data.invoices) ? data.invoices.length : 0,
        yearlyTargets: data.yearlyTargets && typeof data.yearlyTargets === 'object' ? Object.keys(data.yearlyTargets).length : 0,
        initializationData: Array.isArray(data.initializationData) ? data.initializationData.length : 0,
        budgetAssumptions: Array.isArray(data.budgetAssumptions) ? data.budgetAssumptions.length : 0,
        budgetAdjustments: Array.isArray(data.budgetAdjustments) ? data.budgetAdjustments.length : 0,
        budgetScenarios: Array.isArray(data.budgetScenarios) ? data.budgetScenarios.length : 0,
        effectiveBudgetTables: Array.isArray((data as any).effectiveBudgetTables) ? (data as any).effectiveBudgetTables.length : 0,
    };
}

function collectProjectIds(value: unknown, out = new Set<string>()): Set<string> {
    if (!value || typeof value !== 'object') return out;
    if (Array.isArray(value)) {
        value.forEach(item => collectProjectIds(item, out));
        return out;
    }
    const obj = value as Record<string, unknown>;
    const projectId = typeof obj.project_id === 'string' ? obj.project_id.trim() : '';
    if (projectId) out.add(projectId);
    Object.values(obj).forEach(item => collectProjectIds(item, out));
    return out;
}

export function createDashboardBackupEnvelope(
    data: Partial<DashboardData>,
    context: { projectId: string; parkName?: string; exportedBy?: string; exportedAt?: Date }
): DashboardBackupEnvelope {
    const payload: Partial<DashboardData> = {};
    for (const key of DATA_KEYS) {
        const value = (data as any)[key];
        if (value !== undefined) (payload as any)[key] = value;
    }
    return {
        schema_version: DASHBOARD_BACKUP_SCHEMA_VERSION,
        backup_type: DASHBOARD_BACKUP_TYPE,
        project_id: context.projectId,
        park_name: context.parkName,
        exported_at: (context.exportedAt || new Date()).toISOString(),
        exported_by: context.exportedBy,
        data: payload,
    };
}

export function parseDashboardBackup(raw: unknown): ParsedBackup {
    if (!raw || typeof raw !== 'object') {
        throw new Error('备份文件不是有效 JSON 对象');
    }
    const obj = raw as Record<string, any>;
    const isEnvelope = obj.backup_type === DASHBOARD_BACKUP_TYPE && obj.data && typeof obj.data === 'object';
    const data = isEnvelope ? obj.data : obj;
    const projectId = isEnvelope && typeof obj.project_id === 'string' ? obj.project_id.trim() : undefined;
    const embeddedProjectIds = Array.from(collectProjectIds(data)).sort();
    if (!Array.isArray(data.buildings) || !Array.isArray(data.tenants)) {
        throw new Error('文件格式不正确：至少需要 buildings 和 tenants 数据');
    }
    return {
        data,
        projectId,
        parkName: isEnvelope ? obj.park_name : undefined,
        exportedAt: isEnvelope ? obj.exported_at : undefined,
        exportedBy: isEnvelope ? obj.exported_by : undefined,
        isEnvelope,
        embeddedProjectIds,
        summary: summarizeDashboardBackup(data),
    };
}

export function validateBackupTarget(
    parsed: ParsedBackup,
    targetProjectId: string,
    allowedProjectIds: string[]
): { ok: true; warnings: string[] } | { ok: false; message: string; warnings: string[] } {
    const target = targetProjectId.trim();
    const allowed = new Set(allowedProjectIds.map(id => id.trim()).filter(Boolean));
    const warnings: string[] = [];
    if (!target) return { ok: false, message: '请先选择目标园区', warnings };
    if (allowed.size > 0 && !allowed.has(target)) {
        return { ok: false, message: `当前账号未授权恢复到园区 ${target}`, warnings };
    }
    if (parsed.projectId && parsed.projectId !== target) {
        return {
            ok: false,
            message: `备份文件属于 ${parsed.projectId}，当前目标园区是 ${target}，已阻止跨园区恢复。`,
            warnings,
        };
    }
    if (parsed.embeddedProjectIds.length > 1) {
        return {
            ok: false,
            message: `备份文件内部包含多个 project_id：${parsed.embeddedProjectIds.join(', ')}，已阻止恢复。`,
            warnings,
        };
    }
    if (parsed.embeddedProjectIds.length === 1 && parsed.embeddedProjectIds[0] !== target) {
        return {
            ok: false,
            message: `备份记录内部 project_id=${parsed.embeddedProjectIds[0]}，当前目标园区是 ${target}，已阻止恢复。`,
            warnings,
        };
    }
    if (!parsed.projectId) warnings.push('旧格式备份文件未声明 project_id，需要人工确认目标园区。');
    return { ok: true, warnings };
}

/**
 * 修正备份/旧本地缓存中的预算方案结构，兼容历史导出字段。
 *
 * 背景：
 *   - `budgetScenarios[].baseDataSnapshot` 是预算生成时点的合同/楼宇快照，
 *     预算表是静态口径，不应被后续新签合同反向改写。
 *   - 旧备份中 `budgetYear` 可能为 0，`assumptions/adjustments` 也可能为空值。
 *
 * 处理策略：
 *   1. 删除遗留的「无年份后缀」`invoice_dedicated`（旧版本应收专用方案的兜底壳）。
 *   2. 归一化预算年份与数组字段。
 *   3. 保留非空 `baseDataSnapshot`，确保旧版静态预算表可以完整恢复。
 */
export function sanitizeImportedDashboardData<T extends { budgetScenarios?: any[] }>(input: T): T {
    if (!input || typeof input !== 'object') return input;
    const list = Array.isArray(input.budgetScenarios) ? input.budgetScenarios : [];
    if (list.length === 0) return input;
    const inferBudgetYear = (scenario: any): number => {
        const y = Number(scenario?.budgetYear);
        if (Number.isFinite(y) && y >= 2000 && y <= 2100) return y;
        const candidates = [
            String(scenario?.id || ''),
            String(scenario?.name || ''),
            String(scenario?.description || ''),
        ];
        for (const text of candidates) {
            const m = text.match(/(20\d{2})/);
            if (m) {
                const parsed = Number(m[1]);
                if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
            }
        }
        const assumptions = Array.isArray(scenario?.assumptions) ? scenario.assumptions : [];
        for (const asm of assumptions) {
            const signDate = String((asm as any)?.projectedSignDate || '');
            const m = signDate.match(/^(20\d{2})-/);
            if (m) {
                const parsed = Number(m[1]);
                if (Number.isFinite(parsed) && parsed >= 2000 && parsed <= 2100) return parsed;
            }
        }
        const createdAt = String(scenario?.createdAt || '');
        const createdYear = Number(createdAt.slice(0, 4));
        if (Number.isFinite(createdYear) && createdYear >= 2000 && createdYear <= 2100) return createdYear;
        return new Date().getFullYear();
    };
    const cleaned = list
        // 旧版本「应收专用方案」无年份后缀，已被 `invoice_dedicated_${year}` 取代，导入时直接清掉避免与新逻辑冲突
        .filter((s) => !(s && typeof s.id === 'string' && s.id === 'invoice_dedicated'))
        .map((s) => {
            if (!s || typeof s !== 'object') return s;
            return {
                ...(s as any),
                // 兼容旧备份：budgetYear 可能写成 0，导致被当成“当前系统年”而错乱。
                budgetYear: inferBudgetYear(s),
                assumptions: Array.isArray((s as any).assumptions) ? (s as any).assumptions : [],
                adjustments: Array.isArray((s as any).adjustments) ? (s as any).adjustments : [],
            } as any;
        });
    return { ...input, budgetScenarios: cleaned };
}

export function formatBackupSummary(summary: BackupSummary): string {
    return [
        `楼宇/场地 ${summary.buildings} 栋`,
        `房间/单元 ${summary.units} 个`,
        `租户/合同 ${summary.tenants} 条`,
        `收款 ${summary.payments} 条`,
        `发票 ${summary.invoices} 条`,
        `年度目标 ${summary.yearlyTargets} 年`,
        `月度初始化 ${summary.initializationData} 条`,
        `预算假设 ${summary.budgetAssumptions} 条`,
        `预算调整 ${summary.budgetAdjustments} 条`,
        `预算方案 ${summary.budgetScenarios} 套`,
        `静态预算表 ${summary.effectiveBudgetTables} 张`,
    ].join('\n');
}
