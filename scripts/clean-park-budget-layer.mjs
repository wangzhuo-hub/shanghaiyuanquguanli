#!/usr/bin/env node
/**
 * 清理指定园区预算「方案层 / 根级」脏数据，只保留合同层级调整（租户上的 payment_period_adjustments、
 * payment_period_shift_months 等，本脚本不修改 pb_tenants）。
 *
 * 将执行：
 *   - 删除该项目下全部 pb_budget_assumptions（含存量/空置/续签等假设）
 *   - 删除该项目下全部 pb_budget_adjustments（账期平移、金额增减等预算调账）
 *   - 将该项目下每条 pb_budget_scenarios 的 assumptions、adjustments 置为空数组（保留方案元数据、快照）
 *   - 从 pb_billing_period_notes（original_id=billing_period_notes）的 notes_json 中移除
 *     Excel 导入预算表键（__budget_table_*、__budget_customer_links_*）
 *
 * 不会修改：合同条款、初始化月度实收、缓缴备注、手工应收 JSON、租户账期调整字段等。
 *
 * 用法：
 *   PB_URL=https://你的PB PB_ADMIN_EMAIL=... PB_ADMIN_PASSWORD=... \
 *   PROJECT_ID=shanghai_park node scripts/clean-park-budget-layer.mjs --dry-run
 *
 * 确认输出后，将 --dry-run 换成 --execute 执行写库。
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
/** 默认上海园区（见 scripts/init-multi-park.mjs）；生产环境请显式传入 PROJECT_ID */
const PROJECT_ID = process.env.PROJECT_ID || 'shanghai_park';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run') || !args.includes('--execute');

function escFilter(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function auth(pb) {
    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        throw new Error('请设置 PB_ADMIN_EMAIL、PB_ADMIN_PASSWORD');
    }
    try {
        await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    } catch {
        await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
    }
}

async function main() {
    const pb = new PocketBase(PB_URL);
    await auth(pb);

    const pid = escFilter(PROJECT_ID);
    const filter = `project_id="${pid}"`;

    console.log(`[clean] PocketBase: ${PB_URL}`);
    console.log(`[clean] project_id: ${PROJECT_ID}`);
    console.log(`[clean] 模式: ${dryRun ? '演练 (--dry-run)，不写库' : '执行 (--execute)'}`);

    try {
        const park = await pb.collection('pb_parks').getFirstListItem(`project_id="${pid}"`);
        console.log(`[clean] 匹配园区名称: ${park.name || '(无)'}`);
    } catch {
        console.warn('[clean] 未在 pb_parks 中找到该 project_id，仍按结构化表过滤继续');
    }

    const assumptions = await pb.collection('pb_budget_assumptions').getFullList({ filter });
    const adjustments = await pb.collection('pb_budget_adjustments').getFullList({ filter });
    const scenarios = await pb.collection('pb_budget_scenarios').getFullList({ filter });

    console.log(`[clean] pb_budget_assumptions 待删除: ${assumptions.length}`);
    console.log(`[clean] pb_budget_adjustments 待删除: ${adjustments.length}`);
    console.log(`[clean] pb_budget_scenarios 待清空 assumptions/adjustments: ${scenarios.length}`);
    if (scenarios.length > 0) {
        for (const s of scenarios) {
            const an = Array.isArray(s.assumptions) ? s.assumptions.length : 0;
            const ad = Array.isArray(s.adjustments) ? s.adjustments.length : 0;
            if (an + ad > 0) {
                console.log(`       - ${s.original_id || s.id} (${s.name || ''}) 当前假设 ${an} 条、调整 ${ad} 条`);
            }
        }
    }

    let billingNotesRecord = null;
    try {
        billingNotesRecord = await pb.collection('pb_billing_period_notes').getFirstListItem(
            `project_id="${pid}" && original_id="billing_period_notes"`,
        );
    } catch {
        console.log('[clean] 无 billing_period_notes 主记录，跳过导入预算表键清理');
    }

    let keysToRemove = [];
    if (billingNotesRecord?.notes_json && typeof billingNotesRecord.notes_json === 'object') {
        keysToRemove = Object.keys(billingNotesRecord.notes_json).filter(
            (k) => k.startsWith('__budget_table_') || k.startsWith('__budget_customer_links_'),
        );
        console.log(`[clean] notes_json 中将删除的导入预算键 (${keysToRemove.length}):`, keysToRemove);
    }

    if (dryRun) {
        console.log('\n[clean] 演练结束。确认无误后使用: node scripts/clean-park-budget-layer.mjs --execute');
        process.exit(0);
    }

    for (const row of assumptions) {
        await pb.collection('pb_budget_assumptions').delete(row.id, { requestKey: null });
    }
    for (const row of adjustments) {
        await pb.collection('pb_budget_adjustments').delete(row.id, { requestKey: null });
    }
    for (const row of scenarios) {
        await pb.collection('pb_budget_scenarios').update(
            row.id,
            { assumptions: [], adjustments: [] },
            { requestKey: null },
        );
    }

    if (billingNotesRecord && keysToRemove.length > 0) {
        const next = { ...billingNotesRecord.notes_json };
        for (const k of keysToRemove) delete next[k];
        await pb.collection('pb_billing_period_notes').update(
            billingNotesRecord.id,
            { notes_json: next },
            { requestKey: null },
        );
    }

    console.log('\n[clean] ✅ 写库完成（租户合同级账期字段未改动）');
}

main().catch((e) => {
    console.error('[clean] 失败:', e?.message || e);
    process.exit(1);
});
