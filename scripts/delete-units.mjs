#!/usr/bin/env node
/**
 * 从 PocketBase 直接删除指定房源（pb_units 记录）。
 * 用于：界面删除一直删不掉时，用本脚本在后端删除对应数据。
 *
 * 使用前请设置环境变量（或在本文件顶部修改默认值）：
 *   POCKETBASE_URL    例: http://127.0.0.1:8090
 *   POCKETBASE_EMAIL  管理员邮箱
 *   POCKETBASE_PASSWORD  管理员密码
 *   PROJECT_ID        项目ID，与系统设置中一致，例: park_data_main
 *   UNIT_IDS          要删除的房间 original_id，多个用英文逗号分隔，例: 304 或 304,305,306
 *
 * 运行: node scripts/delete-units.mjs
 * 或:   UNIT_IDS=304 node scripts/delete-units.mjs
 */

const POCKETBASE_URL = process.env.POCKETBASE_URL || 'http://127.0.0.1:8090';
const POCKETBASE_EMAIL = process.env.POCKETBASE_EMAIL || '';
const POCKETBASE_PASSWORD = process.env.POCKETBASE_PASSWORD || '';
const PROJECT_ID = process.env.PROJECT_ID || 'park_data_main';
const UNIT_IDS = (process.env.UNIT_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function main() {
  if (UNIT_IDS.length === 0) {
    console.error('请设置环境变量 UNIT_IDS（要删除的房间 original_id，多个用逗号分隔），例如: UNIT_IDS=304 node scripts/delete-units.mjs');
    process.exit(1);
  }
  if (!POCKETBASE_EMAIL || !POCKETBASE_PASSWORD) {
    console.error('请设置 POCKETBASE_EMAIL 和 POCKETBASE_PASSWORD 环境变量');
    process.exit(1);
  }

  const base = POCKETBASE_URL.replace(/\/$/, '');
  const idSet = new Set(UNIT_IDS);

  // 1. 登录
  const authRes = await fetch(`${base}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identity: POCKETBASE_EMAIL,
      password: POCKETBASE_PASSWORD,
    }),
  });
  if (!authRes.ok) {
    const t = await authRes.text();
    console.error('登录失败:', authRes.status, t);
    process.exit(1);
  }
  const authData = await authRes.json();
  const token = authData.token;
  const authHeader = { Authorization: `Bearer ${token}` };

  // 2. 拉取 pb_units 中属于本项目的记录
  const filter = encodeURIComponent(`project_id = "${PROJECT_ID}"`);
  const listRes = await fetch(`${base}/api/collections/pb_units/records?filter=${filter}&fields=id,original_id,name`, {
    headers: authHeader,
  });
  if (!listRes.ok) {
    console.error('拉取房间列表失败:', listRes.status, await listRes.text());
    process.exit(1);
  }
  const list = await listRes.json();
  const toDelete = (list.items || []).filter((r) => idSet.has(String(r.original_id)));

  if (toDelete.length === 0) {
    console.log('未找到要删除的房间（original_id 在 PROJECT_ID 下不存在）:', [...idSet]);
    process.exit(0);
  }

  // 3. 逐个删除
  for (const r of toDelete) {
    const delRes = await fetch(`${base}/api/collections/pb_units/records/${r.id}`, {
      method: 'DELETE',
      headers: authHeader,
    });
    if (delRes.ok) {
      console.log('[已删除] original_id:', r.original_id, 'name:', r.name);
    } else {
      console.error('[删除失败] original_id:', r.original_id, delRes.status, await delRes.text());
    }
  }

  console.log('完成。请回到应用内刷新或重新拉取数据，界面上的对应房源应不再出现。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
