#!/usr/bin/env node
/**
 * 初始化多园区基础数据。
 *
 * 用法：
 *   PB_URL=http://127.0.0.1:8090 PB_ADMIN_EMAIL=admin@example.com PB_ADMIN_PASSWORD=xxx \
 *   INIT_DEFAULT_PASSWORD='请替换为强密码' node scripts/init-multi-park.mjs
 */

import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || process.argv[2] || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || process.argv[3] || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || process.argv[4] || '';
const DEFAULT_PASSWORD = process.env.INIT_DEFAULT_PASSWORD || '';

const parks = [
  {
    project_id: 'shanghai_park',
    name: '上海园区',
    city: '上海',
    enabled: true,
    sort_order: 10,
    metadata: { managementFeeBilling: false, receivableMonthOffset: -1 },
  },
  {
    project_id: 'shenzhen_park',
    name: '深圳园区',
    city: '深圳',
    enabled: true,
    sort_order: 20,
    metadata: { managementFeeBilling: true, receivableMonthOffset: 0 },
  },
  {
    project_id: 'beijing_park',
    name: '北京园区',
    city: '北京',
    enabled: true,
    sort_order: 30,
    metadata: { managementFeeBilling: false, receivableMonthOffset: -1 },
  },
];

const sourceTemplates = [
  { source_type: 'feishu_group', source_key: 'feishu_shanghai_group', project_id: 'shanghai_park', display_name: '上海园区飞书群', enabled: true },
  { source_type: 'feishu_group', source_key: 'feishu_shenzhen_group', project_id: 'shenzhen_park', display_name: '深圳园区飞书群', enabled: true },
  { source_type: 'feishu_group', source_key: 'feishu_beijing_group', project_id: 'beijing_park', display_name: '北京园区飞书群', enabled: true },
  { source_type: 'openclaw_agent', source_key: 'openclaw_shanghai', project_id: 'shanghai_park', display_name: 'OpenClaw 上海', enabled: true },
  { source_type: 'openclaw_agent', source_key: 'openclaw_shenzhen', project_id: 'shenzhen_park', display_name: 'OpenClaw 深圳', enabled: true },
  { source_type: 'openclaw_agent', source_key: 'openclaw_beijing', project_id: 'beijing_park', display_name: 'OpenClaw 北京', enabled: true },
];

const users = [
  { email: 'shanghai.admin@example.com', name: '上海园区管理员', project_id: 'shanghai_park', role: 'park_admin', allowed_project_ids: ['shanghai_park'], enabled: true },
  { email: 'shenzhen.admin@example.com', name: '深圳园区管理员', project_id: 'shenzhen_park', role: 'park_admin', allowed_project_ids: ['shenzhen_park'], enabled: true },
  { email: 'beijing.admin@example.com', name: '北京园区管理员', project_id: 'beijing_park', role: 'park_admin', allowed_project_ids: ['beijing_park'], enabled: true },
  { email: 'group.admin@example.com', name: '总部管理员', project_id: 'shanghai_park', role: 'group_admin', allowed_project_ids: parks.map(p => p.project_id), enabled: true },
];

async function auth(pb) {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('请提供 PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD');
  }
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
}

async function upsertByFilter(pb, collection, filter, payload) {
  try {
    const existing = await pb.collection(collection).getFirstListItem(filter);
    await pb.collection(collection).update(existing.id, payload);
    return 'updated';
  } catch (e) {
    if (e?.status !== 404) throw e;
    await pb.collection(collection).create(payload);
    return 'created';
  }
}

async function main() {
  const pb = new PocketBase(PB_URL);
  await auth(pb);

  console.log(`[init] PocketBase: ${PB_URL}`);

  for (const park of parks) {
    const action = await upsertByFilter(pb, 'pb_parks', `project_id="${park.project_id}"`, park);
    console.log(`[park] ${action}: ${park.name} (${park.project_id})`);
  }

  for (const source of sourceTemplates) {
    const filter = `source_type="${source.source_type}" && source_key="${source.source_key}"`;
    const action = await upsertByFilter(pb, 'pb_integration_sources', filter, source);
    console.log(`[source] ${action}: ${source.source_type}/${source.source_key} -> ${source.project_id}`);
  }

  if (!DEFAULT_PASSWORD) {
    console.log('[users] 跳过用户创建：未设置 INIT_DEFAULT_PASSWORD');
    return;
  }

  for (const user of users) {
    const payload = {
      ...user,
      password: DEFAULT_PASSWORD,
      passwordConfirm: DEFAULT_PASSWORD,
      password_plain: DEFAULT_PASSWORD,
      emailVisibility: true,
      verified: true,
    };
    const action = await upsertByFilter(pb, 'users', `email="${user.email}"`, payload);
    console.log(`[user] ${action}: ${user.email} -> ${user.project_id}`);
  }
}

main().catch((err) => {
  console.error('[init] failed:', err?.data || err);
  process.exit(1);
});
