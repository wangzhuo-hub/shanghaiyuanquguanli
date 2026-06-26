#!/usr/bin/env node
/**
 * Backfill pb_sealed_months for historical months.
 *
 * Usage:
 *   npx tsx scripts/backfill-sealed-months.ts --from 2026-01 --to 2026-05 --projects shanghai_park,beijing_park,shenzhen_park --force
 *
 * Default behavior:
 *   - create missing sealed rows;
 *   - update existing sealed rows that lack details_json;
 *   - skip existing sealed rows that already have details_json.
 *
 * Useful flags:
 *   --dry-run               print intended changes without writing
 *   --force                 recompute and overwrite existing rows
 *   --missing-details-only  only patch existing rows that lack details_json; do not create missing months
 */

import PocketBase from 'pocketbase';
import { clearComputeCaches, sealMonth } from './compute-engine.js';
import { decideSealedMonthBackfillAction, hasUsableSealedMonthDetails } from './sealed-month-backfill-policy.js';

type YearMonth = { year: number; month: number };

const DEFAULT_PROJECTS = 'shanghai_park,beijing_park,shenzhen_park';

function escapeFilter(value: string): string {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function parseYearMonth(value: string, label: string): YearMonth {
    const match = String(value || '').trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match) throw new Error(`${label} must be YYYY-MM, got ${value || '(empty)'}`);
    return { year: Number(match[1]), month: Number(match[2]) };
}

function previousMonth(now = new Date()): YearMonth {
    const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return { year: prev.getFullYear(), month: prev.getMonth() + 1 };
}

function compareYearMonth(a: YearMonth, b: YearMonth): number {
    return a.year === b.year ? a.month - b.month : a.year - b.year;
}

function nextYearMonth(value: YearMonth): YearMonth {
    return value.month >= 12
        ? { year: value.year + 1, month: 1 }
        : { year: value.year, month: value.month + 1 };
}

function monthRange(from: YearMonth, to: YearMonth): YearMonth[] {
    if (compareYearMonth(from, to) > 0) {
        throw new Error(`from must be <= to (${from.year}-${from.month} > ${to.year}-${to.month})`);
    }
    const months: YearMonth[] = [];
    for (let cursor = from; compareYearMonth(cursor, to) <= 0; cursor = nextYearMonth(cursor)) {
        months.push(cursor);
    }
    return months;
}

function readArg(name: string): string | undefined {
    const prefix = `--${name}=`;
    const index = process.argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(prefix));
    if (index < 0) return undefined;
    const exact = process.argv[index];
    if (exact.startsWith(prefix)) return exact.slice(prefix.length);
    return process.argv[index + 1];
}

function hasFlag(name: string): boolean {
    return process.argv.includes(`--${name}`);
}

async function readPrevSealedCumulative(pb: PocketBase, projectId: string, year: number, month: number): Promise<number> {
    let prevYear = year;
    let prevMonth = month - 1;
    if (prevMonth < 1) {
        prevYear -= 1;
        prevMonth = 12;
    }
    try {
        const list = await pb.collection('pb_sealed_months').getList(1, 1, {
            filter: `project_id="${escapeFilter(projectId)}" && sealed_year=${prevYear} && sealed_month=${prevMonth}`,
            fields: 'cumulative_arrears',
        });
        const row = list.items[0] as Record<string, unknown> | undefined;
        return row ? Number(row.cumulative_arrears || 0) : 0;
    } catch {
        return 0;
    }
}

async function findExistingSealedMonth(
    pb: PocketBase,
    projectId: string,
    year: number,
    month: number,
): Promise<{ id: string; detailsJson?: unknown } | null> {
    const list = await pb.collection('pb_sealed_months').getList(1, 1, {
        filter: `project_id="${escapeFilter(projectId)}" && sealed_year=${year} && sealed_month=${month}`,
        fields: 'id,details_json',
    });
    const row = list.items[0] as { id?: string; details_json?: unknown } | undefined;
    return row?.id ? { id: row.id, detailsJson: row.details_json } : null;
}

async function main() {
    const pbUrl = process.env.PB_URL || 'http://127.0.0.1:8090';
    const adminEmail = process.env.PB_ADMIN_EMAIL || '';
    const adminPassword = process.env.PB_ADMIN_PASSWORD || '';
    if (!adminEmail || !adminPassword) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD are required');

    const from = parseYearMonth(readArg('from') || '2026-01', '--from');
    const to = parseYearMonth(readArg('to') || `${previousMonth().year}-${String(previousMonth().month).padStart(2, '0')}`, '--to');
    const projects = String(readArg('projects') || process.env.SEAL_PROJECTS || DEFAULT_PROJECTS)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (projects.length === 0) throw new Error('No projects to backfill');

    const force = hasFlag('force');
    const dryRun = hasFlag('dry-run');
    const missingDetailsOnly = hasFlag('missing-details-only');
    const pb = new PocketBase(pbUrl);
    pb.autoCancellation(false);
    await pb.collection('_superusers').authWithPassword(adminEmail, adminPassword);

    const months = monthRange(from, to);
    const summary = {
        ok: true,
        pbUrl,
        projects,
        from,
        to,
        force,
        dryRun,
        missingDetailsOnly,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
        rows: [] as Array<Record<string, unknown>>,
    };

    for (const projectId of projects) {
        for (const { year, month } of months) {
            const label = `${projectId} ${year}-${String(month).padStart(2, '0')}`;
            try {
                const existing = await findExistingSealedMonth(pb, projectId, year, month);
                const action = decideSealedMonthBackfillAction(existing, { force, missingDetailsOnly });
                if (action === 'skip_existing' || action === 'skip_missing_row') {
                    summary.skipped += 1;
                    summary.rows.push({
                        projectId,
                        year,
                        month,
                        status: action === 'skip_existing' ? 'skipped-existing-with-details' : 'skipped-missing-row',
                    });
                    console.log(`[seal-backfill] skip ${label} (${action})`);
                    continue;
                }

                const seal = await sealMonth(projectId, year, month - 1);
                if (!seal.ok) throw new Error(seal.message || 'sealMonth failed');
                const prevCumulative = await readPrevSealedCumulative(pb, projectId, seal.year, seal.month);
                const cumulative = Math.round((prevCumulative + seal.arrearsIncrement) * 100) / 100;
                const record = {
                    project_id: projectId,
                    sealed_year: seal.year,
                    sealed_month: seal.month,
                    receivable_total: seal.receivableTotal,
                    unpaid_sum: seal.unpaidSum,
                    arrears_increment: seal.arrearsIncrement,
                    cumulative_arrears: cumulative,
                    details_json: seal.billingDetails,
                    data_version: seal.dataVersion,
                    sealed_at: seal.computedAt,
                };

                if (!dryRun) {
                    if (existing) {
                        await pb.collection('pb_sealed_months').update(existing.id, record);
                        summary.updated += 1;
                    } else {
                        await pb.collection('pb_sealed_months').create(record);
                        summary.created += 1;
                    }
                    clearComputeCaches(projectId);
                }
                const status = dryRun
                    ? `dry-run-${action}`
                    : action === 'create'
                      ? 'created'
                      : action === 'update_for_missing_details'
                        ? 'updated-missing-details'
                        : 'updated';
                summary.rows.push({
                    projectId,
                    year: seal.year,
                    month: seal.month,
                    status,
                    arrearsIncrement: seal.arrearsIncrement,
                    cumulativeArrears: cumulative,
                    dataVersion: seal.dataVersion,
                    detailsCount: seal.billingDetails.length,
                    previousHadDetails: hasUsableSealedMonthDetails(existing),
                });
                console.log(`[seal-backfill] ${status} ${label}`);
            } catch (e) {
                summary.failed += 1;
                const message = e instanceof Error ? e.message : String(e);
                summary.rows.push({ projectId, year, month, status: 'failed', message });
                console.warn(`[seal-backfill] failed ${label}: ${message}`);
            }
        }
    }

    console.log(JSON.stringify(summary, null, 2));
    if (summary.failed > 0) process.exitCode = 1;
}

main().catch((e) => {
    console.error('[seal-backfill] fatal:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
});
