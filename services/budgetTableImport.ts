/**
 * services/budgetTableImport.ts —— 「预算表」Excel 直接导入。
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
import type ExcelJS from 'exceljs';
import type { Building, MonthlyInitData } from '../types';

/** 与 `importedBudgetTableKey` 一致的前缀，供列举已导入年度等使用 */
export const IMPORTED_BUDGET_TABLE_PREFIX = '__budget_table_';

/** 与预算表 Excel、合同侧展示对齐：去空白、统一小写，用于「客户+房号+楼宇」匹配键 */
export const normalizeBudgetRowKeyPart = (value: string | undefined | null): string =>
    String(value || '')
        .trim()
        .replace(/\s+/g, '')
        .toLowerCase();

/** 导入预算表一行与合同行共用的匹配键（客户名|房号|楼宇） */
export const importedBudgetRowKey = (customer: string, unit: string, building: string): string =>
    `${normalizeBudgetRowKeyPart(customer)}|${normalizeBudgetRowKeyPart(unit)}|${normalizeBudgetRowKeyPart(building)}`;

/** 由当前合同客户与楼宇资料生成与导入表对齐的匹配键 */
export const tenantImportedBudgetRowKey = (
    tenant: { name: string; buildingId: string; unitIds: string[] },
    buildingById: Map<string, Building>
): string => {
    const building = buildingById.get(tenant.buildingId);
    const unitNames = tenant.unitIds.map((uid) => building?.units.find((u) => u.id === uid)?.name || uid).join(', ');
    return importedBudgetRowKey(tenant.name, unitNames, building?.name || '未知楼宇');
};

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

export interface ParsedBudgetTable {
    year: number;
    sheetName: string;
    rows: BudgetTableRow[];
    /** 每月汇总（仅累加数据行；分组小计/合计行不重复累加），长度 12。 */
    monthlyTotals: number[];
    annualTotal: number;
    warnings: string[];
}

const HEADER_KEYS = ['客户', '房号', '所属楼宇', '租赁面积', '类别', '签约单价', '免租', '1月'];
const SECTION_HEADER_RE = /^【.+】$/;
const SUBTOTAL_RE = /(小计|合计)$/;

const toCellString = (cell: ExcelJS.CellValue): string => {
    if (cell === null || cell === undefined) return '';
    if (typeof cell === 'string') return cell.trim();
    if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell).trim();
    if (cell instanceof Date) return cell.toISOString();
    if (typeof cell === 'object') {
        // ExcelJS rich text / formula
        const anyCell = cell as any;
        if (Array.isArray(anyCell.richText)) {
            return anyCell.richText.map((t: any) => String(t?.text || '')).join('').trim();
        }
        if (anyCell.text != null) return String(anyCell.text).trim();
        if (anyCell.result != null) return String(anyCell.result).trim();
    }
    return '';
};

const toCellNumber = (cell: ExcelJS.CellValue): number | null => {
    if (cell === null || cell === undefined || cell === '') return null;
    if (typeof cell === 'number' && Number.isFinite(cell)) return cell;
    if (typeof cell === 'string') {
        const s = cell.replace(/[,，\s¥￥]/g, '').trim();
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof cell === 'object') {
        const anyCell = cell as any;
        if (typeof anyCell.result === 'number') return anyCell.result;
        if (typeof anyCell.result === 'string') return toCellNumber(anyCell.result);
    }
    return null;
};

const yearFromText = (text: string): number | null => {
    const m = text.match(/(20\d{2})/);
    return m ? Number(m[1]) : null;
};

/**
 * 解析「预算表」Excel。
 * @param buffer 上传的 .xlsx 文件 ArrayBuffer
 * @param sheetNameHint 可选：直接指定某 sheet 名（默认使用首个 sheet）
 */
export async function parseBudgetTableExcel(
    buffer: ArrayBuffer,
    sheetNameHint?: string
): Promise<ParsedBudgetTable> {
    const ExcelJSModule = await import('exceljs');
    const ExcelJSDefault = ExcelJSModule.default;
    const workbook = new ExcelJSDefault.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet =
        (sheetNameHint && workbook.getWorksheet(sheetNameHint)) ||
        workbook.worksheets[0];
    if (!sheet) {
        throw new Error('Excel 中没有可读取的工作表');
    }

    const warnings: string[] = [];
    let year: number | null = null;
    if (sheetNameHint) year = yearFromText(sheetNameHint) || null;
    if (!year) year = yearFromText(sheet.name);
    // 顶部标题行里也能拿到年份
    if (!year) {
        for (let r = 1; r <= Math.min(sheet.rowCount, 6); r++) {
            const text = toCellString(sheet.getCell(r, 1).value as ExcelJS.CellValue);
            const y = yearFromText(text);
            if (y) {
                year = y;
                break;
            }
        }
    }
    if (!year) {
        year = new Date().getFullYear();
        warnings.push(`未能从 Excel 中识别预算年度，按当前年 ${year} 处理。`);
    }

    // 找表头行：包含「1月」且尽量包含「客户」等关键词
    let headerRow = -1;
    for (let r = 1; r <= Math.min(sheet.rowCount, 12); r++) {
        const cellsText: string[] = [];
        for (let c = 1; c <= sheet.columnCount; c++) {
            cellsText.push(toCellString(sheet.getCell(r, c).value as ExcelJS.CellValue));
        }
        const joined = cellsText.join('|');
        if (HEADER_KEYS.every((k) => joined.includes(k))) {
            headerRow = r;
            break;
        }
    }
    if (headerRow < 0) {
        throw new Error('未能识别表头行（应包含「客户/单元、房号、所属楼宇、租赁面积、类别、签约单价、本年度免租期、1月～12月」）');
    }

    // 列索引映射
    const colIdx: Record<string, number> = {};
    for (let c = 1; c <= sheet.columnCount; c++) {
        const t = toCellString(sheet.getCell(headerRow, c).value as ExcelJS.CellValue);
        if (!t) continue;
        if (t.includes('客户')) colIdx.customer = c;
        else if (t === '房号' || t.includes('房号')) colIdx.unit = c;
        else if (t.includes('所属楼宇')) colIdx.building = c;
        else if (t.includes('租赁面积') || t.includes('面积')) colIdx.area = c;
        else if (t === '类别') colIdx.category = c;
        else if (t.includes('签约单价') || t.includes('单价')) colIdx.unitPrice = c;
        else if (t.includes('免租')) colIdx.rentFree = c;
        else if (/^(\d{1,2})月$/.test(t)) {
            const m = Number(t.replace('月', ''));
            if (m >= 1 && m <= 12) colIdx[`m${m}`] = c;
        } else if (t.includes('全年合计') || t === '合计') colIdx.total = c;
    }

    const monthCols: number[] = [];
    for (let m = 1; m <= 12; m++) {
        const c = colIdx[`m${m}`];
        if (!c) {
            throw new Error(`表头缺少 "${m}月" 列`);
        }
        monthCols.push(c);
    }

    const rows: BudgetTableRow[] = [];
    const monthlyTotals = Array(12).fill(0);
    let annualTotal = 0;

    for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
        const customer = toCellString(sheet.getCell(r, colIdx.customer || 1).value as ExcelJS.CellValue);
        // 跳过空行
        const allEmpty =
            !customer &&
            !toCellString(sheet.getCell(r, colIdx.unit || 2).value as ExcelJS.CellValue) &&
            !toCellString(sheet.getCell(r, colIdx.building || 3).value as ExcelJS.CellValue);
        if (allEmpty) continue;
        // 跳过分组标题与小计/合计
        if (SECTION_HEADER_RE.test(customer)) continue;
        if (SUBTOTAL_RE.test(customer)) continue;

        const months: number[] = monthCols.map((c) => toCellNumber(sheet.getCell(r, c).value as ExcelJS.CellValue) || 0);
        const totalCell = colIdx.total ? toCellNumber(sheet.getCell(r, colIdx.total).value as ExcelJS.CellValue) : null;
        const rowTotal = months.reduce((a, b) => a + b, 0);
        // 与 Excel 中「全年合计」做轻量校验
        if (totalCell !== null && Math.abs(totalCell - rowTotal) > 1) {
            warnings.push(
                `${r} 行 [${customer || '(无客户名)'}] 月度求和 ${rowTotal.toFixed(2)} 与 全年合计 ${totalCell.toFixed(2)} 不一致，已采用月度求和。`
            );
        }

        const area = colIdx.area ? toCellNumber(sheet.getCell(r, colIdx.area).value as ExcelJS.CellValue) : null;
        const unitPrice = colIdx.unitPrice ? toCellNumber(sheet.getCell(r, colIdx.unitPrice).value as ExcelJS.CellValue) : null;
        const category = colIdx.category ? toCellString(sheet.getCell(r, colIdx.category).value as ExcelJS.CellValue) : '';
        const building = colIdx.building ? toCellString(sheet.getCell(r, colIdx.building).value as ExcelJS.CellValue) : '';
        const unit = colIdx.unit ? toCellString(sheet.getCell(r, colIdx.unit).value as ExcelJS.CellValue) : '';
        const rentFreeText = colIdx.rentFree ? toCellString(sheet.getCell(r, colIdx.rentFree).value as ExcelJS.CellValue) : '';

        rows.push({
            customer,
            unit,
            building,
            area,
            category,
            unitPrice,
            rentFreeText,
            months,
            total: rowTotal,
        });
        for (let i = 0; i < 12; i++) monthlyTotals[i] += months[i];
        annualTotal += rowTotal;
    }

    if (rows.length === 0) {
        warnings.push('未读取到任何数据行（仅有表头/分组/小计），请核对模板格式。');
    }

    return {
        year,
        sheetName: sheet.name,
        rows,
        monthlyTotals: monthlyTotals.map((v) => Math.round(v)),
        annualTotal: Math.round(annualTotal),
        warnings,
    };
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
    /** 来源工作表名（取自 Excel sheetName） */
    sourceSheet?: string;
    /** 行级明细（与 ParsedBudgetTable.rows 同结构） */
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
    monthlyTotals: number[]
): MonthlyInitData[] {
    const others = (existing || []).filter((d) => d.year !== year);
    const oldByMonth = new Map<number, MonthlyInitData>();
    (existing || []).filter((d) => d.year === year).forEach((d) => oldByMonth.set(d.month, d));
    const next: MonthlyInitData[] = [];
    for (let m = 1; m <= 12; m++) {
        const prev = oldByMonth.get(m);
        next.push({
            year,
            month: m,
            revenueTarget: Math.max(0, Math.round(monthlyTotals[m - 1] || 0)),
            revenueCollected: prev?.revenueCollected ?? 0,
            occupancyRate: prev?.occupancyRate ?? 0,
            accumulatedArrears: prev?.accumulatedArrears ?? 0,
        });
    }
    return [...others, ...next];
}
