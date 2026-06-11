/**
 * KPI 基线对比工具
 *
 * 用法:
 *   npx tsx scripts/compare-kpi-baseline.ts --baseline baseline.json --compare new.json
 *
 * 对比两个 compute-engine 输出的 KPI 结果，报告差异。
 */

import * as fs from 'fs';

interface KpiOutput {
    projectId: string;
    year: number;
    ok: boolean;
    computedAt: string;
    elapsedSec: number;
    dataVersion: number;
    summary: {
        annualRevenueTarget?: number;
        annualRevenueCollected?: number;
        annualInitialBudget?: number;
        annualBudgetTarget?: number;
        annualContractReceivable?: number;
        annualGoalCompletion?: number;
        annualBudgetCompletion?: number;
        occupancyRate?: number;
        annualOccupancyTarget?: number;
        tenantCount?: number;
        totalArea?: number;
        leasedArea?: number;
        vacantArea?: number;
        accumulatedArrears?: number;
        annualManagementFeeCollected?: number;
        annualManagementFeeContractReceivable?: number;
        [key: string]: unknown;
    };
}

const TOLERANCE = 1e-6;

interface DiffItem {
    field: string;
    baseline: number | undefined;
    compare: number | undefined;
    delta: number;
    deltaPct: string;
}

function compareSummaries(
    baseline: KpiOutput,
    compare: KpiOutput,
): DiffItem[] {
    const diffs: DiffItem[] = [];
    const allKeys = new Set([
        ...Object.keys(baseline.summary),
        ...Object.keys(compare.summary),
    ]);

    for (const key of allKeys) {
        const baseVal = baseline.summary[key] as number | undefined;
        const compVal = compare.summary[key] as number | undefined;

        if (typeof baseVal !== 'number' && typeof compVal !== 'number') continue;
        if (typeof baseVal !== 'number') {
            diffs.push({
                field: key,
                baseline: undefined,
                compare: compVal,
                delta: (compVal ?? 0),
                deltaPct: 'NEW',
            });
            continue;
        }
        if (typeof compVal !== 'number') {
            diffs.push({
                field: key,
                baseline: baseVal,
                compare: undefined,
                delta: -(baseVal ?? 0),
                deltaPct: 'MISSING',
            });
            continue;
        }

        const delta = compVal - baseVal;
        if (Math.abs(delta) > TOLERANCE) {
            const pct = baseVal !== 0
                ? ((delta / baseVal) * 100).toFixed(4) + '%'
                : 'baseline=0';
            diffs.push({ field: key, baseline: baseVal, compare: compVal, delta, deltaPct: pct });
        }
    }

    return diffs;
}

function main() {
    const args = process.argv.slice(2);
    let baselinePath = '';
    let comparePath = '';

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--baseline' && args[i + 1]) baselinePath = args[++i];
        else if (args[i] === '--compare' && args[i + 1]) comparePath = args[++i];
    }

    if (!baselinePath || !comparePath) {
        console.error('用法: npx tsx scripts/compare-kpi-baseline.ts --baseline <file> --compare <file>');
        process.exit(1);
    }

    const baseline: KpiOutput = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
    const compare: KpiOutput = JSON.parse(fs.readFileSync(comparePath, 'utf-8'));

    console.log('='.repeat(70));
    console.log(`基线: ${baselinePath}`);
    console.log(`  projectId=${baseline.projectId} year=${baseline.year} ok=${baseline.ok}`);
    console.log(`对比: ${comparePath}`);
    console.log(`  projectId=${compare.projectId} year=${compare.year} ok=${compare.ok}`);
    console.log('='.repeat(70));

    if (baseline.projectId !== compare.projectId) {
        console.log('WARNING: projectId 不一致!');
    }
    if (baseline.year !== compare.year) {
        console.log('WARNING: year 不一致!');
    }

    const diffs = compareSummaries(baseline, compare);

    if (diffs.length === 0) {
        console.log('\n全部一致 — 无差异');
    } else {
        console.log(`\n发现 ${diffs.length} 个差异:\n`);
        console.log(
            '字段'.padEnd(40)
            + '基线值'.padStart(16)
            + '对比值'.padStart(16)
            + '差异'.padStart(14)
            + '差异%'.padStart(12),
        );
        console.log('-'.repeat(98));
        for (const d of diffs) {
            console.log(
                d.field.padEnd(40)
                + (d.baseline?.toFixed(2) ?? 'N/A').padStart(16)
                + (d.compare?.toFixed(2) ?? 'N/A').padStart(16)
                + d.delta.toFixed(2).padStart(14)
                + d.deltaPct.padStart(12),
            );
        }
    }

    process.exit(diffs.length > 0 ? 1 : 0);
}

main();
