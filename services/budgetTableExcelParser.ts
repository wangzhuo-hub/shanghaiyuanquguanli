import { loadXlsx } from './xlsxLoader';
import type { BudgetTableRow } from './budgetTableImport';

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

type XlsxCellLike = {
    v?: unknown;
    w?: string;
};

const toCellString = (cell: XlsxCellLike | undefined): string => {
    if (cell === null || cell === undefined) return '';
    const raw = cell.v ?? cell.w;
    if (raw === null || raw === undefined) return '';
    if (typeof raw === 'string') return raw.trim();
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw).trim();
    if (raw instanceof Date) return raw.toISOString();
    return '';
};

const toCellNumber = (cell: XlsxCellLike | undefined): number | null => {
    if (cell === null || cell === undefined) return null;
    const raw = cell.v ?? cell.w;
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
    if (typeof raw === 'string') {
        const s = raw.replace(/[,，\s¥￥]/g, '').trim();
        if (!s) return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
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
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
    const sheetName =
        (sheetNameHint && workbook.SheetNames.includes(sheetNameHint) ? sheetNameHint : '') ||
        workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : null;
    if (!sheet || !sheet['!ref']) {
        throw new Error('Excel 中没有可读取的工作表');
    }
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rowCount = range.e.r + 1;
    const columnCount = range.e.c + 1;
    const cellAt = (row: number, col: number): XlsxCellLike | undefined =>
        sheet[XLSX.utils.encode_cell({ r: row - 1, c: col - 1 })] as XlsxCellLike | undefined;

    const warnings: string[] = [];
    let year: number | null = null;
    if (sheetNameHint) year = yearFromText(sheetNameHint) || null;
    if (!year) year = yearFromText(sheetName);
    if (!year) {
        for (let r = 1; r <= Math.min(rowCount, 6); r++) {
            const text = toCellString(cellAt(r, 1));
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

    let headerRow = -1;
    for (let r = 1; r <= Math.min(rowCount, 12); r++) {
        const cellsText: string[] = [];
        for (let c = 1; c <= columnCount; c++) {
            cellsText.push(toCellString(cellAt(r, c)));
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

    const colIdx: Record<string, number> = {};
    for (let c = 1; c <= columnCount; c++) {
        const t = toCellString(cellAt(headerRow, c));
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

    for (let r = headerRow + 1; r <= rowCount; r++) {
        const customer = toCellString(cellAt(r, colIdx.customer || 1));
        const allEmpty =
            !customer &&
            !toCellString(cellAt(r, colIdx.unit || 2)) &&
            !toCellString(cellAt(r, colIdx.building || 3));
        if (allEmpty) continue;
        if (SECTION_HEADER_RE.test(customer)) continue;
        if (SUBTOTAL_RE.test(customer)) continue;

        const months: number[] = monthCols.map((c) => toCellNumber(cellAt(r, c)) || 0);
        const totalCell = colIdx.total ? toCellNumber(cellAt(r, colIdx.total)) : null;
        const rowTotal = months.reduce((a, b) => a + b, 0);
        if (totalCell !== null && Math.abs(totalCell - rowTotal) > 1) {
            warnings.push(
                `${r} 行 [${customer || '(无客户名)'}] 月度求和 ${rowTotal.toFixed(2)} 与 全年合计 ${totalCell.toFixed(2)} 不一致，已采用月度求和。`
            );
        }

        const area = colIdx.area ? toCellNumber(cellAt(r, colIdx.area)) : null;
        const unitPrice = colIdx.unitPrice ? toCellNumber(cellAt(r, colIdx.unitPrice)) : null;
        const category = colIdx.category ? toCellString(cellAt(r, colIdx.category)) : '';
        const building = colIdx.building ? toCellString(cellAt(r, colIdx.building)) : '';
        const unit = colIdx.unit ? toCellString(cellAt(r, colIdx.unit)) : '';
        const rentFreeText = colIdx.rentFree ? toCellString(cellAt(r, colIdx.rentFree)) : '';

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
        sheetName,
        rows,
        monthlyTotals: monthlyTotals.map((v) => Math.round(v)),
        annualTotal: Math.round(annualTotal),
        warnings,
    };
}
