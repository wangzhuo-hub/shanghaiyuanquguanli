let xlsxPromise: Promise<typeof import('xlsx')> | null = null;

export const loadXlsx = (): Promise<typeof import('xlsx')> => {
    if (!xlsxPromise) {
        xlsxPromise = import('xlsx');
    }
    return xlsxPromise;
};

export const excelSerialDateToYMD = (value: number): string | null => {
    if (!Number.isFinite(value) || value <= 0) return null;
    const wholeDays = Math.floor(value);
    const ms = (wholeDays - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

export const writeXlsxRows = async (
    filename: string,
    rows: Record<string, unknown>[],
    sheetName = 'Sheet1',
): Promise<void> => {
    const XLSX = await loadXlsx();
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    const safeSheet = sheetName.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
    XLSX.utils.book_append_sheet(wb, ws, safeSheet);
    XLSX.writeFile(wb, filename);
};

export const writeXlsxWorkbook = async (
    filename: string,
    sheets: { name: string; rows: Record<string, unknown>[] }[],
): Promise<void> => {
    const XLSX = await loadXlsx();
    const wb = XLSX.utils.book_new();
    sheets.forEach(({ name, rows }) => {
        const safeName = name.replace(/[:\\/?*[\]]/g, '_').slice(0, 31) || 'Sheet';
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), safeName);
    });
    XLSX.writeFile(wb, filename);
};

export const readFirstSheetRows = async <T extends Record<string, unknown> = Record<string, unknown>>(
    buffer: ArrayBuffer,
): Promise<T[]> => {
    const XLSX = await loadXlsx();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const first = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json<T>(first, { defval: '' });
};
