import type ExcelJS from 'exceljs';

export interface BudgetMonthlyExcelExportOptions {
    detailYear: number;
    viewMode: string;
    groups: Record<string, any[]>;
    scenarioLabel: string;
}

const sectionLabel = (x: string) => `【${x}】`;
const fmtNum = (n: number) => (Math.abs(n) < 0.005 ? undefined : Math.round(n * 100) / 100);
const fmtArea = (n: number) => (Math.abs(n) < 0.005 ? undefined : Number(n.toFixed(2)));

const excelVisualWidth = (text: string) => {
    let w = 0;
    for (let i = 0; i < text.length; i++) {
        w += text.charCodeAt(i) > 127 ? 2.1 : 1;
    }
    return w;
};

export async function exportBudgetMonthlyExcel(options: BudgetMonthlyExcelExportOptions): Promise<void> {
    const { detailYear, viewMode, groups, scenarioLabel } = options;
    const ExcelJSModule = await import('exceljs');
    const ExcelJSDefault = ExcelJSModule.default;
    const isExec = viewMode === 'Execution';
    const monthValueCols = isExec ? 24 : 12;
    const totalCols = 7 + monthValueCols + 1;

    const thinSide: ExcelJS.Border = { style: 'thin', color: { argb: 'FFCBD5E1' } };
    const cellBorder: Partial<ExcelJS.Borders> = {
        top: thinSide,
        left: thinSide,
        bottom: thinSide,
        right: thinSide,
    };

    const headerFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1E293B' },
    };
    const sectionFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE2E8F0' },
    };
    const subtotalFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF9C3' },
    };
    const zebraFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF8FAFC' },
    };
    const newSigningFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD1FAE5' },
    };
    const leaseStartFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' },
    };
    const rentFreeFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFEF3C7' },
    };
    const terminatingFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFE4E6' },
    };
    const adjustmentOutFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFEDD5' },
    };
    const adjustmentInFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFF3E8FF' },
    };
    const amountAdjustmentFill: ExcelJS.Fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFCCFBF1' },
    };

    const workbook = new ExcelJSDefault.Workbook();
    workbook.creator = '上海金蝶软件园招商看板';
    const sheetTitle = isExec ? `执行跟踪${detailYear}` : `预算表${detailYear}`;
    const ws = workbook.addWorksheet(sheetTitle, {
        views: [{ state: 'frozen', xSplit: 7, ySplit: isExec ? 5 : 4 }],
        properties: { defaultRowHeight: 20 },
    });

    const setRowBorder = (row: ExcelJS.Row, fromC: number, toC: number) => {
        for (let c = fromC; c <= toC; c++) {
            row.getCell(c).border = { ...cellBorder };
        }
    };
    const addCellNote = (cell: ExcelJS.Cell, lines: string[]) => {
        const text = lines.filter(Boolean).join('\n');
        if (!text) return;
        (cell as any).note = text;
    };

    let r = 1;
    ws.mergeCells(r, 1, r, totalCols);
    const tCell = ws.getCell(r, 1);
    tCell.value = `上海金蝶软件园 ${isExec ? '预算执行跟踪表' : '预算表'}`;
    tCell.font = { bold: true, size: 16, name: 'Calibri', color: { argb: 'FF0F172A' } };
    tCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    setRowBorder(ws.getRow(r), 1, totalCols);
    ws.getRow(r).height = 32;
    r++;

    ws.mergeCells(r, 1, r, totalCols);
    const mCell = ws.getCell(r, 1);
    mCell.value = `预算年度：${detailYear}年\n方案：${scenarioLabel}\n导出时间：${new Date().toLocaleString('zh-CN', { hour12: false })}\n标注说明：绿色=当年新签客户；橙色=起租月/账期调出；红色=退租客户/最后一期应收；紫色=账期调入；青色=金额调整。单元格批注包含详细说明。`;
    mCell.font = { size: 11, name: 'Calibri', color: { argb: 'FF475569' } };
    mCell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true, indent: 1 };
    setRowBorder(ws.getRow(r), 1, totalCols);
    ws.getRow(r).height = 88;
    r++;

    ws.addRow([]);
    ws.getRow(r).height = 6;
    r++;

    const headerRowIndex = r;
    if (isExec) {
        const h1: (string | undefined)[] = Array(totalCols).fill(undefined);
        h1[0] = '客户/单元';
        h1[1] = '房号';
        h1[2] = '所属楼宇';
        h1[3] = '租赁面积(㎡)';
        h1[4] = '类别';
        h1[5] = '签约单价(元/㎡·天)';
        h1[6] = '本年度免租期';
        for (let i = 0; i < 12; i++) {
            h1[7 + i * 2] = `${i + 1}月`;
        }
        h1[totalCols - 1] = '全年合计';
        ws.addRow(h1);
        const h2: (string | undefined)[] = Array(totalCols).fill(undefined);
        for (let i = 0; i < 12; i++) {
            h2[7 + i * 2] = '预算';
            h2[8 + i * 2] = '实收';
        }
        h2[totalCols - 1] = '实收合计';
        ws.addRow(h2);

        for (let c = 1; c <= 7; c++) {
            ws.mergeCells(headerRowIndex, c, headerRowIndex + 1, c);
        }
        for (let i = 0; i < 12; i++) {
            ws.mergeCells(headerRowIndex, 8 + i * 2, headerRowIndex, 9 + i * 2);
        }

        for (const hr of [headerRowIndex, headerRowIndex + 1]) {
            const row = ws.getRow(hr);
            for (let c = 1; c <= totalCols; c++) {
                const cell = row.getCell(c);
                cell.fill = headerFill;
                cell.font = { bold: true, color: { argb: 'FFF1F5F9' }, size: 10, name: 'Calibri' };
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
                cell.border = { ...cellBorder };
            }
        }
    } else {
        const h: (string | undefined)[] = Array(totalCols).fill(undefined);
        h[0] = '客户/单元';
        h[1] = '房号';
        h[2] = '所属楼宇';
        h[3] = '租赁面积(㎡)';
        h[4] = '类别';
        h[5] = '签约单价(元/㎡·天)';
        h[6] = '本年度免租期';
        for (let i = 1; i <= 12; i++) {
            h[6 + i] = `${i}月`;
        }
        h[totalCols - 1] = '全年合计';
        ws.addRow(h);
        const row = ws.getRow(headerRowIndex);
        for (let c = 1; c <= totalCols; c++) {
            const cell = row.getCell(c);
            cell.fill = headerFill;
            cell.font = { bold: true, color: { argb: 'FFF1F5F9' }, size: 10, name: 'Calibri' };
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            cell.border = { ...cellBorder };
        }
    }

    let dataRowIndex = 0;
    Object.entries(groups).forEach(([groupName, rows]: [string, any]) => {
        const vals = Array(totalCols).fill(undefined) as (string | undefined)[];
        vals[0] = sectionLabel(groupName);
        const secRow = ws.addRow(vals);
        ws.mergeCells(secRow.number, 1, secRow.number, totalCols);
        const sc = ws.getCell(secRow.number, 1);
        sc.fill = sectionFill;
        sc.font = { bold: true, size: 11, name: 'Calibri', color: { argb: 'FF334155' } };
        sc.alignment = { vertical: 'middle', horizontal: 'left', indent: 1, wrapText: true };
        setRowBorder(secRow, 1, totalCols);
        secRow.height = 24;

        const groupBudgetSum = Array(12).fill(0);
        const groupActualSum = Array(12).fill(0);

        rows.forEach((rowData: any) => {
            const rowArr: (string | number | undefined)[] = Array(totalCols).fill(undefined);
            rowArr[0] = rowData.name;
            rowArr[1] = rowData.unitNames;
            rowArr[2] = rowData.building;
            rowArr[3] = fmtArea(rowData.area || 0);
            rowArr[4] = rowData.category;
            rowArr[5] =
                rowData.unitPrice != null && rowData.unitPrice > 0
                    ? Math.round(Number(rowData.unitPrice) * 100) / 100
                    : undefined;
            rowArr[6] =
                rowData.rentFreeYearSummary && rowData.rentFreeYearSummary !== '—'
                    ? rowData.rentFreeYearSummary
                    : undefined;
            const lastReceivableMonth = rowData.isTerminatingInYear
                ? rowData.monthlyValues.reduce((last: number | null, v: any, i: number) => (Number(v.amount || 0) > 0 ? i : last), null)
                : null;

            let rowBudgetTotal = 0;
            let rowActualTotal = 0;
            rowData.monthlyValues.forEach((v: any, i: number) => {
                const b = Number(v.amount || 0);
                const a = Number(v.actual || 0);
                rowBudgetTotal += b;
                rowActualTotal += a;
                groupBudgetSum[i] += b;
                groupActualSum[i] += a;

                if (isExec) {
                    rowArr[7 + i * 2] = fmtNum(b);
                    rowArr[8 + i * 2] = fmtNum(a);
                } else {
                    rowArr[7 + i] = fmtNum(b);
                }
            });

            rowArr[totalCols - 1] = fmtNum(isExec ? rowActualTotal : rowBudgetTotal);
            const excelRow = ws.addRow(rowArr);
            const zebra = dataRowIndex % 2 === 1;
            dataRowIndex++;
            const rowNotes = [
                rowData.paymentCycleLabel ? `账期类型：${rowData.paymentCycleLabel}` : '',
                rowData.isNewSigningInYear ? `当年新签；签约日：${rowData.signingDate || '—'}` : '',
                rowData.leaseStart ? `起租日：${rowData.leaseStart}` : '',
                rowData.isTerminatingInYear ? `退租客户；退租日：${rowData.terminationDate || '—'}` : '',
            ];
            for (let c = 1; c <= totalCols; c++) {
                const cell = excelRow.getCell(c);
                cell.border = { ...cellBorder };
                if (zebra) cell.fill = zebraFill;
                if (c <= 7) {
                    if (rowData.isTerminatingInYear) cell.fill = terminatingFill;
                    else if (rowData.isNewSigningInYear) cell.fill = newSigningFill;
                }
                if (c <= 7) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF1E293B' } };
                    if (c === 1) {
                        addCellNote(cell, rowNotes);
                        if (rowData.isTerminatingInYear) {
                            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF9F1239' }, bold: true };
                        } else if (rowData.isNewSigningInYear) {
                            cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF047857' }, bold: true };
                        }
                    }
                    if (c === 4 && typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    }
                    if (c === 5 && typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                        cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    }
                } else {
                    cell.alignment = { horizontal: 'right', vertical: 'middle' };
                    cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF334155' } };
                    if (typeof cell.value === 'number') {
                        cell.numFmt = '#,##0.00';
                    }
                }
            }
            rowData.monthlyValues.forEach((v: any, i: number) => {
                const budgetCol = isExec ? 8 + i * 2 : 8 + i;
                const cols = isExec ? [budgetCol, budgetCol + 1] : [budgetCol];
                const noteLines: string[] = [];
                const isLeaseStartMonth = rowData.leaseStartMonthInYear === i;
                const isLastReceivableMonth = lastReceivableMonth === i;
                const isRentFreeMonth = !!rowData.rentFreeMonthFlags?.[i];
                if (isRentFreeMonth) noteLines.push('合同免租自然月');
                if (isLeaseStartMonth) noteLines.push(`起租月；起租日：${rowData.leaseStart || '—'}`);
                if (isLastReceivableMonth) noteLines.push(`最后一期应收；退租日：${rowData.terminationDate || '—'}`);
                if (v.adjustmentDetail) noteLines.push(`调整说明：${v.adjustmentDetail}`);
                if (v.isAdjustedOut) noteLines.push('账期调整：本月调出');
                if (v.isAdjustedIn) noteLines.push('账期调整：本月调入');

                cols.forEach((col) => {
                    const cell = excelRow.getCell(col);
                    if (v.isAdjustedOut) cell.fill = adjustmentOutFill;
                    else if (v.isAdjustedIn) cell.fill = adjustmentInFill;
                    else if (v.adjustmentDetail) cell.fill = amountAdjustmentFill;
                    if (isLeaseStartMonth) cell.fill = leaseStartFill;
                    if (isRentFreeMonth) cell.fill = rentFreeFill;
                    if (isLastReceivableMonth) cell.fill = terminatingFill;
                    if (noteLines.length) addCellNote(cell, noteLines);
                    if (isLastReceivableMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFBE123C' }, bold: true };
                    } else if (isRentFreeMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FF92400E' }, bold: true };
                    } else if (isLeaseStartMonth) {
                        cell.font = { name: 'Calibri', size: 10, color: { argb: 'FFC2410C' }, bold: true };
                    }
                });
            });
            excelRow.height = 22;
        });

        const subArr: (string | number | undefined)[] = Array(totalCols).fill(undefined);
        subArr[0] = `${groupName} 小计`;
        if (isExec) {
            let actualTotal = 0;
            for (let i = 0; i < 12; i++) {
                subArr[7 + i * 2] = fmtNum(groupBudgetSum[i]);
                subArr[8 + i * 2] = fmtNum(groupActualSum[i]);
                actualTotal += groupActualSum[i];
            }
            subArr[totalCols - 1] = fmtNum(actualTotal);
        } else {
            let budgetTotal = 0;
            for (let i = 0; i < 12; i++) {
                subArr[7 + i] = fmtNum(groupBudgetSum[i]);
                budgetTotal += groupBudgetSum[i];
            }
            subArr[totalCols - 1] = fmtNum(budgetTotal);
        }
        const subRow = ws.addRow(subArr);
        for (let c = 1; c <= totalCols; c++) {
            const cell = subRow.getCell(c);
            cell.fill = subtotalFill;
            cell.font = { bold: true, name: 'Calibri', size: 10, color: { argb: 'FF78350F' } };
            cell.border = { ...cellBorder };
            if (c <= 7) {
                cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            } else {
                cell.alignment = { horizontal: 'right', vertical: 'middle' };
                if (typeof cell.value === 'number') cell.numFmt = '#,##0.00';
            }
        }
        subRow.height = 24;

        const gapAfterGroup = ws.addRow([]);
        gapAfterGroup.height = 10;
    });

    for (let col = 1; col <= totalCols; col++) {
        let maxW = col === 1 ? 14 : 10;
        ws.eachRow({ includeEmpty: true }, (row) => {
            const cell = row.getCell(col);
            let s = '';
            const v = cell.value;
            if (v == null) return;
            if (typeof v === 'object' && v !== null && 'richText' in v) {
                s = String((v as ExcelJS.CellRichTextValue).richText?.map((t) => t.text).join('') ?? '');
            } else if (typeof v === 'number') {
                s = v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
            } else {
                s = String(v);
            }
            maxW = Math.max(maxW, excelVisualWidth(s));
        });
        const cap = col <= 5 ? 52 : 16;
        ws.getColumn(col).width = Math.min(cap, Math.max(col === 1 ? 24 : 9, maxW * 0.65 + 2.5));
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `park_budget_${isExec ? 'execution_' : ''}${detailYear}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
}
