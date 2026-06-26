import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import {
    mergeBudgetTotalsIntoInitData,
    readImportedBudgetTable,
    writeImportedBudgetTable,
    clearImportedBudgetTable,
    importedBudgetTableKey,
    importedBudgetRowKey,
    listImportedBudgetYears,
    readBudgetCustomerNameLinks,
    writeBudgetCustomerNameLinks,
    updateImportedBudgetTableRowMonth,
    normalizeEffectiveBudgetTableFromBackup,
    buildBudgetRowKeyLookup,
    tenantImportedBudgetRowKey,
    type BudgetTableSnapshot,
} from '../budgetTableImport';
import { parseBudgetTableExcel } from '../budgetTableExcelParser';
import type { MonthlyInitData } from '../../types';

describe('mergeBudgetTotalsIntoInitData', () => {
    it('replaces 12 month entries for the target year and keeps other years intact', () => {
        const existing: MonthlyInitData[] = [
            { year: 2025, month: 12, revenueTarget: 100, revenueCollected: 80, occupancyRate: 95, accumulatedArrears: 12 },
            { year: 2026, month: 1, revenueTarget: 0, revenueCollected: 200, occupancyRate: 90, accumulatedArrears: 5 },
            { year: 2026, month: 2, revenueTarget: 0, revenueCollected: 250, occupancyRate: 91, accumulatedArrears: 6 },
        ];
        const totals = Array.from({ length: 12 }, (_, i) => (i + 1) * 1000);
        const merged = mergeBudgetTotalsIntoInitData(existing, 2026, totals);
        // 其它年份保留
        expect(merged.find((d) => d.year === 2025 && d.month === 12)).toMatchObject({ revenueTarget: 100, revenueCollected: 80 });
        // 2026 共 12 条
        expect(merged.filter((d) => d.year === 2026)).toHaveLength(12);
        // 月份合并：1 月 = 1000；revenueCollected 等其它字段保留
        const jan = merged.find((d) => d.year === 2026 && d.month === 1)!;
        expect(jan.revenueTarget).toBe(1000);
        expect(jan.revenueCollected).toBe(200);
        const feb = merged.find((d) => d.year === 2026 && d.month === 2)!;
        expect(feb.revenueTarget).toBe(2000);
        expect(feb.revenueCollected).toBe(250);
        // 没有原数据的月份 revenueTarget 写入，其它字段为 0
        const nov = merged.find((d) => d.year === 2026 && d.month === 11)!;
        expect(nov.revenueTarget).toBe(11000);
        expect(nov.revenueCollected).toBe(0);
        expect(nov.occupancyRate).toBe(0);
        expect(nov.accumulatedArrears).toBe(0);
    });

    it('treats undefined existing as empty', () => {
        const totals = Array(12).fill(500);
        const merged = mergeBudgetTotalsIntoInitData(undefined, 2026, totals);
        expect(merged).toHaveLength(12);
        expect(merged.every((d) => d.year === 2026 && d.revenueTarget === 500)).toBe(true);
    });

    it('floors negative input to zero', () => {
        const totals = Array(12).fill(-3);
        const merged = mergeBudgetTotalsIntoInitData(undefined, 2026, totals);
        expect(merged.every((d) => d.revenueTarget === 0)).toBe(true);
    });
});

describe('imported budget table snapshot helpers', () => {
    const sampleSnapshot: BudgetTableSnapshot = {
        importedAt: '2026-04-29T07:00:00.000Z',
        sourceSheet: '2026年',
        rows: [
            { customer: 'A', unit: '1F', building: '3号楼', area: 100, category: '存量客户', unitPrice: 3, rentFreeText: '', months: Array(12).fill(0), total: 0 },
        ],
        monthlyTotals: Array.from({ length: 12 }, (_, i) => i),
        annualTotal: 66,
    };

    it('reads/writes/clears snapshot via billingPeriodNotes', () => {
        const start: Record<string, string> = { '__rent_remark__t1__202601__': 'foo' };
        const wrote = writeImportedBudgetTable(start, 2026, sampleSnapshot);
        expect(Object.keys(wrote)).toContain(importedBudgetTableKey(2026));
        expect(start[importedBudgetTableKey(2026)]).toBeUndefined();

        const read = readImportedBudgetTable(wrote, 2026);
        expect(read).not.toBeNull();
        expect(read?.rows).toHaveLength(1);
        expect(read?.annualTotal).toBe(66);
        expect(read?.sourceSheet).toBe('2026年');

        const withLinks = writeBudgetCustomerNameLinks(wrote, 2026, [
            { importKey: importedBudgetRowKey('A', '1F', '3号楼'), tenantId: 't99' },
        ]);
        expect(readBudgetCustomerNameLinks(withLinks, 2026)).toHaveLength(1);

        const cleared = clearImportedBudgetTable(withLinks, 2026);
        expect(Object.keys(cleared)).not.toContain(importedBudgetTableKey(2026));
        expect(readBudgetCustomerNameLinks(cleared, 2026)).toHaveLength(0);
        expect(cleared['__rent_remark__t1__202601__']).toBe('foo');
    });

    it('listImportedBudgetYears collects years from snapshot keys', () => {
        const notes = writeImportedBudgetTable({}, 2025, sampleSnapshot);
        const notes2 = writeImportedBudgetTable(notes, 2027, { ...sampleSnapshot, annualTotal: 1 });
        expect(listImportedBudgetYears(notes2)).toEqual([2025, 2027]);
    });

    it('updates one imported row month and recomputes row/month/year totals', () => {
        const snapshot: BudgetTableSnapshot = {
            importedAt: '2026-04-29T07:00:00.000Z',
            sourceSheet: '2026年',
            rows: [
                {
                    customer: 'A',
                    unit: '101',
                    building: '1号楼',
                    area: 100,
                    category: '存量客户',
                    unitPrice: 3,
                    rentFreeText: '',
                    months: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
                    total: 780,
                },
                {
                    customer: 'B',
                    unit: '201',
                    building: '2号楼',
                    area: 80,
                    category: '续签客户',
                    unitPrice: 4,
                    rentFreeText: '',
                    months: Array(12).fill(5),
                    total: 60,
                },
            ],
            monthlyTotals: [15, 25, 35, 45, 55, 65, 75, 85, 95, 105, 115, 125],
            annualTotal: 840,
        };

        const updated = updateImportedBudgetTableRowMonth(
            snapshot,
            importedBudgetRowKey('A', '101', '1号楼'),
            1,
            200.4,
            '2026-06-24T12:00:00.000Z',
        );

        expect(updated).not.toBe(snapshot);
        expect(updated.updatedAt).toBe('2026-06-24T12:00:00.000Z');
        expect(updated.rows[0].months[1]).toBe(200);
        expect(updated.rows[0].total).toBe(960);
        expect(updated.monthlyTotals[1]).toBe(205);
        expect(updated.annualTotal).toBe(1020);
        expect(snapshot.rows[0].months[1]).toBe(20);
    });

    it('readImportedBudgetTable returns null for missing/invalid entries', () => {
        expect(readImportedBudgetTable(undefined, 2026)).toBeNull();
        expect(readImportedBudgetTable({}, 2026)).toBeNull();
        expect(readImportedBudgetTable({ [importedBudgetTableKey(2026)]: 'not json' }, 2026)).toBeNull();
        expect(readImportedBudgetTable({ [importedBudgetTableKey(2026)]: '{}' }, 2026)).toBeNull(); // no rows
    });

    it('rejects invalid imported row month updates', () => {
        expect(() =>
            updateImportedBudgetTableRowMonth(
                sampleSnapshot,
                importedBudgetRowKey('A', '1F', '3号楼'),
                12,
                100,
            )
        ).toThrow(/monthIndex/);
        expect(() =>
            updateImportedBudgetTableRowMonth(
                sampleSnapshot,
                importedBudgetRowKey('A', '1F', '3号楼'),
                0,
                -1,
            )
        ).toThrow(/non-negative/);
        expect(() =>
            updateImportedBudgetTableRowMonth(
                sampleSnapshot,
                importedBudgetRowKey('missing', '1F', '3号楼'),
                0,
                100,
            )
        ).toThrow(/not found/);
    });

    it('clearImportedBudgetTable returns same notes when key missing', () => {
        const notes = { foo: 'bar' };
        const out = clearImportedBudgetTable(notes, 2026);
        expect(out).toBe(notes); // same ref → 没有任何变更
    });

    it('normalizes legacy effectiveBudgetTables rows with monthlyValues', () => {
        const restored = normalizeEffectiveBudgetTableFromBackup({
            year: 2026,
            scenarioId: 'scenario_legacy',
            scenarioName: '2026年预算',
            monthlyTotalsYuan: [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120],
            rows: [
                {
                    name: '客户A',
                    unitNames: '101',
                    building: '1号楼',
                    area: 100,
                    category: '存量客户',
                    unitPrice: 3,
                    rentFreeYearSummary: '2月',
                    monthlyValues: Array.from({ length: 12 }, (_, i) => ({ amount: i + 1 })),
                },
            ],
        }, '2026-04-29T00:00:00.000Z');

        expect(restored?.year).toBe(2026);
        expect(restored?.snapshot.sourceSheet).toBe('备份恢复:2026年预算');
        expect(restored?.snapshot.rows[0]).toMatchObject({
            customer: '客户A',
            unit: '101',
            building: '1号楼',
            rentFreeText: '2月',
        });
        expect(restored?.snapshot.rows[0].months).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
        expect(restored?.snapshot.monthlyTotals).toEqual([10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120]);
    });

    it('builds tenant import keys from an indexed building/unit lookup', () => {
        const buildings = [
            {
                id: 'b1',
                name: 'A座',
                units: [{ id: 'same-unit-id', name: '101' }],
            },
            {
                id: 'b2',
                name: 'B座',
                units: [{ id: 'same-unit-id', name: '201' }],
            },
        ] as any;
        const tenant = { name: '客户 A', buildingId: 'b2', unitIds: ['same-unit-id'] };

        const lookup = buildBudgetRowKeyLookup(buildings);

        expect(tenantImportedBudgetRowKey(tenant, lookup)).toBe(importedBudgetRowKey('客户 A', '201', 'B座'));
        expect(tenantImportedBudgetRowKey(tenant, lookup.buildingById)).toBe(importedBudgetRowKey('客户 A', '201', 'B座'));
    });
});

const SAMPLE_BUDGET_XLSX = '/Users/wangzhuo/Downloads/park_budget_2026-24.xlsx';

const itIfFileExists = existsSync(SAMPLE_BUDGET_XLSX) ? it : it.skip;

describe('parseBudgetTableExcel (real template file)', () => {
    it('parses a generated budget workbook and ignores section/subtotal rows', async () => {
        const XLSX = await import('xlsx');
        const months = Array.from({ length: 12 }, (_, i) => i + 1);
        const subtotal = ['存量客户 小计', '', '', '', '', '', '', ...months, months.reduce((a, b) => a + b, 0)];
        const worksheet = XLSX.utils.aoa_to_sheet([
            ['上海金蝶软件园 2027 年预算表'],
            [],
            ['客户/单元', '房号', '所属楼宇', '租赁面积', '类别', '签约单价', '本年度免租期', ...months.map((m) => `${m}月`), '全年合计'],
            ['【存量客户】'],
            ['客户A', '101', 'A座', 100, '存量客户', 3.5, '2月', ...months, months.reduce((a, b) => a + b, 0)],
            subtotal,
        ]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, '2027预算');
        const written = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
        const ab = written instanceof ArrayBuffer
            ? written
            : written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength);

        const parsed = await parseBudgetTableExcel(ab);

        expect(parsed.year).toBe(2027);
        expect(parsed.sheetName).toBe('2027预算');
        expect(parsed.rows).toHaveLength(1);
        expect(parsed.rows[0]).toMatchObject({
            customer: '客户A',
            unit: '101',
            building: 'A座',
            area: 100,
            category: '存量客户',
            unitPrice: 3.5,
            rentFreeText: '2月',
            total: 78,
        });
        expect(parsed.monthlyTotals).toEqual(months);
        expect(parsed.annualTotal).toBe(78);
    });

    itIfFileExists('parses 上海金蝶软件园 预算表 2026 template', async () => {
        const buf = readFileSync(SAMPLE_BUDGET_XLSX);
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const parsed = await parseBudgetTableExcel(ab);
        expect(parsed.year).toBe(2026);
        expect(parsed.rows.length).toBeGreaterThan(0);
        // 月度合计 = 全年合计
        const sum = parsed.monthlyTotals.reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - parsed.annualTotal)).toBeLessThanOrEqual(parsed.rows.length); // 允许逐行四舍五入误差
        // 不应误把分组标题/小计当作行
        expect(parsed.rows.some((r) => r.customer.startsWith('【'))).toBe(false);
        expect(parsed.rows.some((r) => /(小计|合计)$/.test(r.customer))).toBe(false);
    });
});
