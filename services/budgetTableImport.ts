/**
 * services/budgetTableImport.ts —— 「预算表」导入快照读写与合并辅助。
 *
 * 模板结构（与 BudgetManager.exportToExcel 输出对齐）：
 *   - 第 1 行：标题（如「上海金蝶软件园 预算表」）
 *   - 第 2 行：元信息（如「预算年度：2026年\n方案：xxx」）
 *   - 第 4 行：表头（含「1月」～「12月」「全年合计」等列）
 *   - 之后是分组与数据行：
 *     -【存量客户】/【续签客户】/【到期退租招商】/【空置去化】 等分组标题行
 *     - 数据行（客户/单元、房号、所属楼宇、租赁面积、类别、签约单价、免租期、1月～12月、合计）
 *     - 「xxx 小计」/「xxx 合计」
 *
 * 导入策略（MVP）：
 *   - 数据行月份金额按列汇总 → 可写入 `initializationData` 或经 `billingPeriodNotes` 供 `readImportedBudgetTable` 使用。
 *   - 「预算执行」月度目标：某月初始化 `revenueTarget`＞0 时优先用初始化，否则用导入表合计或生效方案滚动应收（见 `calculateTrends`）。
 *
 * 同时返回每行的明细（客户、房号、楼宇、单价、月度金额）便于做预览与冲突排查。
 *
 * 注意：本服务不直接修改业务状态，只负责 **解析 + 合并提示**；最终写库由调用方决定。
 */
import type { MonthlyInitData } from '../types';
import { importedBudgetRowKey } from './budgetRowKey';
export {
    buildBudgetRowKeyLookup,
    importedBudgetRowKey,
    normalizeBudgetRowKeyPart,
    tenantImportedBudgetRowKey,
} from './budgetRowKey';

/** 与 `importedBudgetTableKey` 一致的前缀，供列举已导入年度等使用 */
export const IMPORTED_BUDGET_TABLE_PREFIX = '__budget_table_';

/** 预算表「导入行」与合同 tenantId 的手动关联（解决导入后客户改名导致键对不上的问题） */
export interface BudgetCustomerNameLink {
    /** `importedBudgetRowKey(客户, 房号, 楼宇)`，与导入快照中该行一致 */
    importKey: string;
    tenantId: string;
}

const BUDGET_CUSTOMER_LINKS_PREFIX = '__budget_customer_links_';

export const budgetCustomerNameLinksKey = (year: number): string => `${BUDGET_CUSTOMER_LINKS_PREFIX}${year}__`;

export function listImportedBudgetYears(notes: Record<string, string> | undefined): number[] {
    if (!notes) return [];
    const prefix = IMPORTED_BUDGET_TABLE_PREFIX;
    const years: number[] = [];
    for (const k of Object.keys(notes)) {
        if (!k.startsWith(prefix) || !k.endsWith('__')) continue;
        const inner = k.slice(prefix.length, -2);
        const y = Number(inner);
        if (Number.isFinite(y) && y >= 2000 && y <= 2100) years.push(y);
    }
    return Array.from(new Set(years)).sort((a, b) => a - b);
}

export function readBudgetCustomerNameLinks(
    notes: Record<string, string> | undefined,
    year: number
): BudgetCustomerNameLink[] {
    if (!notes) return [];
    const raw = notes[budgetCustomerNameLinksKey(year)];
    if (!raw || typeof raw !== 'string') return [];
    try {
        const parsed = JSON.parse(raw) as { links?: unknown };
        const arr = Array.isArray(parsed?.links) ? parsed.links : [];
        const out: BudgetCustomerNameLink[] = [];
        for (const item of arr) {
            if (!item || typeof item !== 'object') continue;
            const importKey = String((item as any).importKey || '').trim();
            const tenantId = String((item as any).tenantId || '').trim();
            if (importKey && tenantId) out.push({ importKey, tenantId });
        }
        return out;
    } catch {
        return [];
    }
}

export function writeBudgetCustomerNameLinks(
    notes: Record<string, string> | undefined,
    year: number,
    links: BudgetCustomerNameLink[]
): Record<string, string> {
    return {
        ...(notes || {}),
        [budgetCustomerNameLinksKey(year)]: JSON.stringify({ links }),
    };
}

export interface BudgetTableRow {
    customer: string;
    unit: string;
    building: string;
    area: number | null;
    category: string;
    unitPrice: number | null;
    rentFreeText: string;
    months: number[]; // 长度 12，元素为该月预算金额（单位：元）
    total: number;
}

/**
 * 把解析得到的「每月预算」合并进 `initializationData`：
 *   - 删除目标年的所有现有 12 条记录（避免半月覆盖留尾巴）；
 *   - 追加 12 条新记录，`revenueTarget` 用解析出的月度合计；
 *   - 其它字段（实收/出租率/累计欠款）若原本存在则保留。
 */
/** 在 billingPeriodNotes 中存放「已导入预算表明细」的特殊键（按年区分）。
 *  形如：__budget_table_2026__。值为 JSON.stringify(BudgetTableSnapshot)。
 *  这样导入的整张预算表会随 saveIncrementalToCloud 自动落库到 pb_billing_period_notes，
 *  跨设备/重新登录都可见，BudgetManager 顶部也能感知并展示「已导入 / 清除」状态条。
 */
export interface BudgetTableSnapshot {
    /** 数据导入时间，便于审计 */
    importedAt: string;
    /** 手工编辑时间，便于区分原始导入与后续微调 */
    updatedAt?: string;
    /** 来源工作表名（取自 Excel sheetName） */
    sourceSheet?: string;
    /** 行级明细（与预算表解析结果 rows 同结构） */
    rows: BudgetTableRow[];
    /** 每月合计，长度 12 */
    monthlyTotals: number[];
    /** 全年合计 */
    annualTotal: number;
}

export interface RestoredBudgetTableSnapshot {
    year: number;
    snapshot: BudgetTableSnapshot;
}

export const importedBudgetTableKey = (year: number): string =>
    `${IMPORTED_BUDGET_TABLE_PREFIX}${year}__`;

/** 在已导入快照中解析某 importKey 对应的一行（不存在则 undefined） */
export function findImportedRowByKey(
    snapshot: BudgetTableSnapshot | null | undefined,
    importKey: string
): BudgetTableRow | undefined {
    if (!snapshot?.rows?.length) return undefined;
    return snapshot.rows.find((r) => importedBudgetRowKey(r.customer, r.unit, r.building) === importKey);
}

const normalizeBackupBudgetMonths = (row: any): number[] => {
    const explicitMonths = Array.isArray(row?.months) ? row.months : null;
    if (explicitMonths) {
        return Array.from({ length: 12 }, (_, i) => Math.round(Number(explicitMonths[i] || 0)));
    }

    const legacyMonthlyValues = Array.isArray(row?.monthlyValues) ? row.monthlyValues : [];
    return Array.from({ length: 12 }, (_, i) => {
        const cell = legacyMonthlyValues[i];
        if (cell && typeof cell === 'object') return Math.round(Number(cell.amount || 0));
        return Math.round(Number(cell || 0));
    });
};

const normalizeBackupBudgetRows = (rows: any[]): BudgetTableRow[] =>
    rows
        .map((row) => {
            if (!row || typeof row !== 'object') return null;
            const months = normalizeBackupBudgetMonths(row);
            return {
                customer: String(row.customer || row.name || ''),
                unit: String(row.unit || row.unitNames || ''),
                building: String(row.building || ''),
                area: row.area == null ? null : Number(row.area),
                category: String(row.category || ''),
                unitPrice: row.unitPrice == null ? null : Number(row.unitPrice),
                rentFreeText: String(row.rentFreeText || row.rentFreeYearSummary || ''),
                months,
                total: Math.round(Number(row.total || months.reduce((a, b) => a + b, 0))),
            } satisfies BudgetTableRow;
        })
        .filter((row): row is BudgetTableRow => !!row);

const monthlyTotalsFromRows = (rows: BudgetTableRow[]): number[] => {
    const totals = Array(12).fill(0);
    rows.forEach((row) => {
        for (let i = 0; i < 12; i++) totals[i] += Number(row.months[i] || 0);
    });
    return totals.map((v) => Math.round(v));
};

const normalizeBudgetMonthAmount = (amount: number): number => {
    const value = Math.round(Number(amount));
    if (!Number.isFinite(value) || value < 0) {
        throw new Error('budget month amount must be a non-negative finite number');
    }
    return value;
};

export function updateImportedBudgetTableRowMonth(
    snapshot: BudgetTableSnapshot,
    importKey: string,
    monthIndex: number,
    amount: number,
    updatedAt = new Date().toISOString()
): BudgetTableSnapshot {
    if (!snapshot || typeof snapshot !== 'object' || !Array.isArray(snapshot.rows)) {
        throw new Error('budget table snapshot is required');
    }
    const key = String(importKey || '').trim();
    if (!key) {
        throw new Error('importKey is required');
    }
    if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11) {
        throw new Error('monthIndex must be 0-11');
    }
    const nextAmount = normalizeBudgetMonthAmount(amount);
    let matched = false;
    const rows = snapshot.rows.map((row) => {
        const rowKey = importedBudgetRowKey(row.customer, row.unit, row.building);
        if (rowKey !== key) return row;
        matched = true;
        const months = Array.from({ length: 12 }, (_, i) =>
            i === monthIndex ? nextAmount : normalizeBudgetMonthAmount(Number(row.months?.[i] || 0))
        );
        return {
            ...row,
            months,
            total: months.reduce((sum, value) => sum + value, 0),
        };
    });
    if (!matched) {
        throw new Error('imported budget row not found');
    }
    const monthlyTotals = monthlyTotalsFromRows(rows);
    return {
        ...snapshot,
        rows,
        monthlyTotals,
        annualTotal: monthlyTotals.reduce((sum, value) => sum + value, 0),
        updatedAt,
    };
}

/**
 * 兼容旧版 JSON 备份里的 effectiveBudgetTables：
 * 旧格式行明细使用 `monthlyValues[].amount`，新版导入存档使用 `months[]`。
 */
export function normalizeEffectiveBudgetTableFromBackup(
    table: unknown,
    importedAt = new Date().toISOString()
): RestoredBudgetTableSnapshot | null {
    if (!table || typeof table !== 'object') return null;
    const raw = table as any;
    const year = Number(raw.year);
    if (!Number.isFinite(year) || year < 2000 || year > 2100) return null;

    const rows = normalizeBackupBudgetRows(Array.isArray(raw.rows) ? raw.rows : []);
    const totalsRaw = Array.isArray(raw.monthlyTotalsYuan)
        ? raw.monthlyTotalsYuan
        : (Array.isArray(raw.monthlyTotals) ? raw.monthlyTotals : []);
    const monthlyTotals = totalsRaw.length >= 12
        ? Array.from({ length: 12 }, (_, i) => Math.round(Number(totalsRaw[i] || 0)))
        : monthlyTotalsFromRows(rows);
    const annualTotalRaw = raw.annualTotalYuan ?? raw.annualTotal;
    const annualTotal = Number.isFinite(Number(annualTotalRaw))
        ? Math.round(Number(annualTotalRaw))
        : monthlyTotals.reduce((sum, x) => sum + x, 0);

    return {
        year,
        snapshot: {
            importedAt,
            sourceSheet: `备份恢复:${String(raw.scenarioName || raw.scenarioId || `${year}年`)}`,
            rows,
            monthlyTotals,
            annualTotal,
        },
    };
}

export function readImportedBudgetTable(
    notes: Record<string, string> | undefined,
    year: number
): BudgetTableSnapshot | null {
    if (!notes) return null;
    const raw = notes[importedBudgetTableKey(year)];
    if (!raw || typeof raw !== 'string') return null;
    try {
        const parsed = JSON.parse(raw) as BudgetTableSnapshot;
        if (!parsed || typeof parsed !== 'object') return null;
        if (!Array.isArray(parsed.rows)) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeImportedBudgetTable(
    notes: Record<string, string> | undefined,
    year: number,
    snapshot: BudgetTableSnapshot
): Record<string, string> {
    return { ...(notes || {}), [importedBudgetTableKey(year)]: JSON.stringify(snapshot) };
}

export function clearImportedBudgetTable(
    notes: Record<string, string> | undefined,
    year: number
): Record<string, string> {
    if (!notes) return {};
    const key = importedBudgetTableKey(year);
    const linksKey = budgetCustomerNameLinksKey(year);
    if (!(key in notes) && !(linksKey in notes)) return notes;
    const next = { ...notes };
    delete next[key];
    delete next[linksKey];
    return next;
}

export function mergeBudgetTotalsIntoInitData(
    existing: MonthlyInitData[] | undefined,
    year: number,
    monthlyTotals: number[],
    projectId?: string
): MonthlyInitData[] {
    const others = (existing || []).filter((d) => d.year !== year);
    const oldByMonth = new Map<number, MonthlyInitData>();
    (existing || []).filter((d) => d.year === year).forEach((d) => oldByMonth.set(d.month, d));
    const next: MonthlyInitData[] = [];
    const isShanghai = projectId === 'shanghai_park';
    for (let m = 1; m <= 12; m++) {
        const prev = oldByMonth.get(m);
        const rounded = Math.max(0, Math.round(monthlyTotals[m - 1] || 0));
        next.push({
            year,
            month: m,
            revenueTarget: isShanghai ? (prev?.revenueTarget ?? 0) : rounded,
            revenueCollected: prev?.revenueCollected ?? 0,
            occupancyRate: prev?.occupancyRate ?? 0,
            accumulatedArrears: prev?.accumulatedArrears ?? 0,
            initialBudget: isShanghai ? rounded : prev?.initialBudget,
        });
    }
    return [...others, ...next];
}
