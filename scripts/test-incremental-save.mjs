#!/usr/bin/env node
/**
 * scripts/test-incremental-save.mjs
 *
 * 增量保存改造的「真实 PocketBase」端到端集成测试。
 *
 * 验证场景：
 *   1. 同一 project 下，会话 A 改租户 A、会话 B 改租户 B —— 两次增量保存都成功，互不影响
 *   2. 会话 A、会话 B 都改同一个租户 A —— 第二次应返回冲突，且服务端值是会话 A 的
 *
 * 用法：
 *   VITE_POCKETBASE_URL=http://127.0.0.1:8090 \
 *   PB_ADMIN_EMAIL=admin@example.com \
 *   PB_ADMIN_PASSWORD=xxx \
 *   node scripts/test-incremental-save.mjs
 *
 * 退出码：
 *   0 = 全部通过
 *   1 = 任一场景失败
 *   2 = 环境配置/连接失败
 *
 * 注意：脚本会在 project_id="test_incremental_<ts>" 下创建测试数据，结束后自动清理。
 */

import PocketBase from 'pocketbase';

// ---------- 环境读取 ----------
const PB_URL =
    process.env.VITE_POCKETBASE_URL || process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const PB_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const PB_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const PROJECT_ID = `test_incremental_${Date.now()}`;
const COLLECTION = 'pb_tenants';

// ---------- 颜色输出 ----------
const c = {
    g: (s) => `\x1b[32m${s}\x1b[0m`,
    r: (s) => `\x1b[31m${s}\x1b[0m`,
    y: (s) => `\x1b[33m${s}\x1b[0m`,
    b: (s) => `\x1b[34m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const log = (...args) => console.log(...args);
const ok = (msg) => log(c.g('  ✓ ') + msg);
const fail = (msg) => log(c.r('  ✗ ') + msg);
const info = (msg) => log(c.b('  ⓘ ') + msg);

// ---------- 内联实现：与 services/pocketbaseService.ts 的逻辑保持一致 ----------
// 之所以内联，是因为本脚本是 .mjs 而 services 是 TypeScript；这里手写一份
// 增量保存的核心逻辑，专门用于真实 PocketBase 的端到端验证。

const buildOriginalIdFilter = (collection, originalId, projectId) => {
    const pid = String(projectId).replace(/"/g, '\\"');
    if (collection === 'pb_yearly_targets') {
        const y = Number(originalId);
        return `project_id = "${pid}" && year = ${Number.isFinite(y) ? y : 0}`;
    }
    if (collection === 'pb_monthly_init_data') {
        const [yStr, mStr] = String(originalId).split('_');
        return `project_id = "${pid}" && year = ${Number(yStr)} && month = ${Number(mStr)}`;
    }
    const oid = String(originalId).replace(/"/g, '\\"');
    return `project_id = "${pid}" && original_id = "${oid}"`;
};

async function saveIncremental(pb, payload, projectId, recordMeta) {
    const applied = [];
    const conflicts = [];
    const errors = [];

    const findOne = async (collection, originalId) => {
        const list = await pb.collection(collection).getList(1, 1, {
            filter: buildOriginalIdFilter(collection, originalId, projectId),
        });
        return list.items[0] || null;
    };

    const fallbackBaseUpdated = (collection, originalId, provided) => {
        if (provided) return provided;
        return recordMeta?.[collection]?.[originalId] || '';
    };

    for (const [collection, bucket] of Object.entries(payload)) {
        for (const c of bucket.creates || []) {
            try {
                const data = { project_id: projectId, ...c.data };
                if (data.id !== undefined && data.original_id === undefined) {
                    data.original_id = data.id;
                }
                delete data.id;
                if (collection === 'pb_yearly_targets' || collection === 'pb_monthly_init_data') {
                    delete data.original_id;
                }
                const created = await pb.collection(collection).create(data);
                applied.push({ collection, originalId: c.originalId, op: 'create', newUpdated: created.updated });
            } catch (e) {
                errors.push({ collection, originalId: c.originalId, op: 'create', message: e?.message || String(e) });
            }
        }
        for (const u of bucket.updates || []) {
            try {
                const baseUpdated = fallbackBaseUpdated(collection, u.originalId, u.baseUpdated);
                const server = await findOne(collection, u.originalId);
                if (!server) {
                    conflicts.push({ collection, originalId: u.originalId, serverRecord: {}, localChanges: u.changedFields, baseUpdated, serverUpdated: '', op: 'update' });
                    continue;
                }
                if (baseUpdated && server.updated && server.updated !== baseUpdated) {
                    conflicts.push({ collection, originalId: u.originalId, serverRecord: server, localChanges: u.changedFields, baseUpdated, serverUpdated: server.updated, op: 'update' });
                    continue;
                }
                const updated = await pb.collection(collection).update(server.id, u.changedFields);
                applied.push({ collection, originalId: u.originalId, op: 'update', newUpdated: updated.updated });
            } catch (e) {
                errors.push({ collection, originalId: u.originalId, op: 'update', message: e?.message || String(e) });
            }
        }
        for (const d of bucket.deletes || []) {
            try {
                const baseUpdated = fallbackBaseUpdated(collection, d.originalId, d.baseUpdated);
                const server = await findOne(collection, d.originalId);
                if (!server) {
                    applied.push({ collection, originalId: d.originalId, op: 'delete', newUpdated: null });
                    continue;
                }
                if (baseUpdated && server.updated && server.updated !== baseUpdated) {
                    conflicts.push({ collection, originalId: d.originalId, serverRecord: server, localChanges: null, baseUpdated, serverUpdated: server.updated, op: 'delete' });
                    continue;
                }
                await pb.collection(collection).delete(server.id);
                applied.push({ collection, originalId: d.originalId, op: 'delete', newUpdated: null });
            } catch (e) {
                errors.push({ collection, originalId: d.originalId, op: 'delete', message: e?.message || String(e) });
            }
        }
    }

    return { applied, conflicts, errors };
}

async function fetchRecordMeta(pb, projectId) {
    const list = await pb.collection(COLLECTION).getFullList({ filter: `project_id = "${projectId}"` });
    const meta = { [COLLECTION]: {} };
    for (const r of list) {
        meta[COLLECTION][r.original_id] = r.updated;
    }
    return meta;
}

// ---------- 测试主体 ----------

async function authenticate(pb) {
    if (!PB_EMAIL || !PB_PASSWORD) {
        info('未提供 PB_ADMIN_EMAIL/PASSWORD，将以匿名模式运行（确保集合 API Rules 允许操作）');
        return false;
    }
    try {
        await pb.collection('_superusers').authWithPassword(PB_EMAIL, PB_PASSWORD);
        info('已用 _superusers 登录');
        return true;
    } catch (e1) {
        try {
            await pb.admins.authWithPassword(PB_EMAIL, PB_PASSWORD);
            info('已用旧版 admins 端点登录');
            return true;
        } catch (e2) {
            log(c.y('  ⚠ 管理员登录失败，将匿名运行：'), e2?.message || e2);
            return false;
        }
    }
}

async function cleanup(pb, projectId) {
    try {
        const list = await pb.collection(COLLECTION).getFullList({
            filter: `project_id = "${projectId}"`,
            fields: 'id',
        });
        for (const r of list) {
            await pb.collection(COLLECTION).delete(r.id);
        }
        info(`已清理测试数据（project_id=${projectId}，共 ${list.length} 条）`);
    } catch (e) {
        log(c.y('  ⚠ 清理失败（可手动删除）：'), e?.message || e);
    }
}

async function setupSeed(pb, projectId) {
    // 准备两条租户：tenantA / tenantB
    const a = await pb.collection(COLLECTION).create({
        project_id: projectId,
        original_id: 'tenantA',
        name: '租户A',
        contact_info: '13800000000',
        monthly_rent: 1000,
        building_id: 'b_test',
        unit_ids: [],
        lease_start: '2026-01-01',
        lease_end: '2027-01-01',
    });
    const b = await pb.collection(COLLECTION).create({
        project_id: projectId,
        original_id: 'tenantB',
        name: '租户B',
        contact_info: '13900000000',
        monthly_rent: 2000,
        building_id: 'b_test',
        unit_ids: [],
        lease_start: '2026-01-01',
        lease_end: '2027-01-01',
    });
    return { a, b };
}

async function scenario_concurrent_different_rows(pb, projectId) {
    log(c.bold('\n📋 场景 1：A 改租户A月租，B 改租户B电话 —— 两个改动都应成功'));

    // 两个会话都从同一时刻拉取 recordMeta
    const metaA = await fetchRecordMeta(pb, projectId);
    const metaB = JSON.parse(JSON.stringify(metaA));

    // 会话 A：改租户A月租
    const payloadA = {
        [COLLECTION]: {
            creates: [],
            updates: [
                {
                    originalId: 'tenantA',
                    changedFields: { monthly_rent: 1500 },
                    baseUpdated: metaA[COLLECTION]['tenantA'],
                },
            ],
            deletes: [],
        },
    };
    const resA = await saveIncremental(pb, payloadA, projectId, metaA);
    if (resA.conflicts.length === 0 && resA.errors.length === 0 && resA.applied.length === 1) {
        ok('会话 A 保存成功（applied=1, conflicts=0, errors=0）');
    } else {
        fail(`会话 A 保存异常：applied=${resA.applied.length} conflicts=${resA.conflicts.length} errors=${resA.errors.length}`);
        return false;
    }

    // 会话 B：改租户B电话（注意：B 的 baseUpdated 仍是改之前从 metaA 拷的值）
    const payloadB = {
        [COLLECTION]: {
            creates: [],
            updates: [
                {
                    originalId: 'tenantB',
                    changedFields: { contact_info: '13988887777' },
                    baseUpdated: metaB[COLLECTION]['tenantB'],
                },
            ],
            deletes: [],
        },
    };
    const resB = await saveIncremental(pb, payloadB, projectId, metaB);
    if (resB.conflicts.length === 0 && resB.errors.length === 0 && resB.applied.length === 1) {
        ok('会话 B 保存成功（applied=1, conflicts=0, errors=0）');
    } else {
        fail(`会话 B 保存异常：applied=${resB.applied.length} conflicts=${resB.conflicts.length} errors=${resB.errors.length}`);
        return false;
    }

    // 验收：两个改动都落库
    const finalMeta = await fetchRecordMeta(pb, projectId);
    const tenantA = (await pb.collection(COLLECTION).getList(1, 1, { filter: `project_id = "${projectId}" && original_id = "tenantA"` })).items[0];
    const tenantB = (await pb.collection(COLLECTION).getList(1, 1, { filter: `project_id = "${projectId}" && original_id = "tenantB"` })).items[0];
    void finalMeta;

    if (tenantA?.monthly_rent === 1500 && tenantB?.contact_info === '13988887777') {
        ok('落库验证：tenantA.monthly_rent=1500、tenantB.contact_info=13988887777');
        return true;
    }
    fail(`落库验证失败：tenantA.monthly_rent=${tenantA?.monthly_rent}, tenantB.contact_info=${tenantB?.contact_info}`);
    return false;
}

async function scenario_conflict_same_row(pb, projectId) {
    log(c.bold('\n📋 场景 2：A、B 都改租户A月租 —— B 应被检出冲突'));

    // 重置 tenantA 月租到一个已知值，并让 A、B 同时拉一个相同的 baseUpdated
    const meta0 = await fetchRecordMeta(pb, projectId);
    const baseUpdated = meta0[COLLECTION]['tenantA'];

    const metaA = { [COLLECTION]: { tenantA: baseUpdated } };
    const metaB = { [COLLECTION]: { tenantA: baseUpdated } };

    // 会话 A 先保存
    const payloadA = {
        [COLLECTION]: {
            creates: [],
            updates: [
                { originalId: 'tenantA', changedFields: { monthly_rent: 8000 }, baseUpdated: metaA[COLLECTION]['tenantA'] },
            ],
            deletes: [],
        },
    };
    const resA = await saveIncremental(pb, payloadA, projectId, metaA);
    if (resA.applied.length !== 1 || resA.conflicts.length !== 0) {
        fail(`会话 A 保存异常：${JSON.stringify(resA)}`);
        return false;
    }
    ok('会话 A 先保存成功（monthly_rent=8000）');

    // 会话 B 用旧的 baseUpdated 提交，应该被冲突
    const payloadB = {
        [COLLECTION]: {
            creates: [],
            updates: [
                { originalId: 'tenantA', changedFields: { monthly_rent: 9999 }, baseUpdated: metaB[COLLECTION]['tenantA'] },
            ],
            deletes: [],
        },
    };
    const resB = await saveIncremental(pb, payloadB, projectId, metaB);
    if (resB.conflicts.length === 1 && resB.applied.length === 0) {
        ok(`会话 B 被检出冲突（conflicts=1, applied=0）`);
    } else {
        fail(`会话 B 应该冲突但实际：conflicts=${resB.conflicts.length} applied=${resB.applied.length}`);
        return false;
    }

    // 验收：服务端值仍是会话 A 的 8000，没有被会话 B 覆盖
    const tenantA = (await pb.collection(COLLECTION).getList(1, 1, { filter: `project_id = "${projectId}" && original_id = "tenantA"` })).items[0];
    if (tenantA?.monthly_rent === 8000) {
        ok('落库验证：服务端 tenantA.monthly_rent 仍为 8000，B 的并发写入被正确阻止');
        return true;
    }
    fail(`落库验证失败：tenantA.monthly_rent=${tenantA?.monthly_rent}（期望 8000）`);
    return false;
}

async function main() {
    log(c.bold(`\n=== 增量保存集成测试 ===`));
    log(`PocketBase URL : ${PB_URL}`);
    log(`Project ID     : ${PROJECT_ID}`);

    const pb = new PocketBase(PB_URL);
    try {
        await pb.health.check();
        ok('PocketBase 连接正常');
    } catch (e) {
        fail(`PocketBase 连接失败：${e?.message || e}`);
        process.exit(2);
    }

    await authenticate(pb);

    let success = true;
    try {
        info(`准备测试数据（project_id=${PROJECT_ID}）...`);
        await setupSeed(pb, PROJECT_ID);
        ok('已创建 tenantA / tenantB');

        const r1 = await scenario_concurrent_different_rows(pb, PROJECT_ID);
        const r2 = await scenario_conflict_same_row(pb, PROJECT_ID);
        success = r1 && r2;
    } catch (e) {
        log(c.r('\n✗ 测试期间发生异常：'), e);
        success = false;
    } finally {
        log('');
        await cleanup(pb, PROJECT_ID);
    }

    if (success) {
        log(c.g(c.bold('\n✅ 全部场景通过\n')));
        process.exit(0);
    } else {
        log(c.r(c.bold('\n❌ 有场景失败\n')));
        process.exit(1);
    }
}

main().catch((e) => {
    log(c.r('未捕获异常：'), e);
    process.exit(2);
});
