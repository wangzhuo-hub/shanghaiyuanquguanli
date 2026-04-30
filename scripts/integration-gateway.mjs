#!/usr/bin/env node
/**
 * OpenClaw / 飞书受控写入网关。
 *
 * 环境变量：
 *   PB_URL=http://127.0.0.1:8090
 *   PB_ADMIN_EMAIL=admin@example.com
 *   PB_ADMIN_PASSWORD=xxx
 *   INTEGRATION_GATEWAY_PORT=8787
 *
 * POST /api/integration/write
 * Headers:
 *   x-integration-source-type: feishu_group | feishu_form | openclaw_agent | webhook
 *   x-integration-source-key:  来源唯一标识
 *   x-integration-token:      可选，若 pb_integration_sources.secret_hash 有值则校验 sha256
 * Body:
 *   {
 *     "collection": "pb_payments",
 *     "action": "upsert",
 *     "original_id": "payment_xxx",
 *     "project_id": "可选；若与来源绑定不一致会拒绝",
 *     "data": { "...": "业务字段，不需要 project_id" }
 *   }
 */

import crypto from 'node:crypto';
import express from 'express';
import PocketBase from 'pocketbase';

const PB_URL = process.env.PB_URL || 'http://127.0.0.1:8090';
const ADMIN_EMAIL = process.env.PB_ADMIN_EMAIL || '';
const ADMIN_PASSWORD = process.env.PB_ADMIN_PASSWORD || '';
const PORT = Number(process.env.INTEGRATION_GATEWAY_PORT || 8787);

const WRITABLE_COLLECTIONS = new Set([
  'pb_buildings',
  'pb_units',
  'pb_tenants',
  'pb_payments',
  'pb_invoices',
  'pb_yearly_targets',
  'pb_monthly_init_data',
  'pb_budget_assumptions',
  'pb_budget_adjustments',
  'pb_budget_scenarios',
  'pb_billing_period_notes',
]);

const pb = new PocketBase(PB_URL);

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex');
}

function escapeFilter(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

async function auth() {
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) throw new Error('PB_ADMIN_EMAIL / PB_ADMIN_PASSWORD is required');
  try {
    await pb.collection('_superusers').authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  } catch (_) {
    await pb.admins.authWithPassword(ADMIN_EMAIL, ADMIN_PASSWORD);
  }
}

async function audit(entry) {
  try {
    await pb.collection('pb_integration_audit_logs').create(entry);
  } catch (e) {
    console.warn('[audit] failed:', e?.message || e);
  }
}

async function resolveSource(req) {
  const sourceType = String(req.headers['x-integration-source-type'] || req.body?.source_type || '').trim();
  const sourceKey = String(req.headers['x-integration-source-key'] || req.body?.source_key || '').trim();
  if (!sourceType || !sourceKey) {
    return { ok: false, status: 400, message: '缺少来源标识 source_type/source_key', sourceType, sourceKey };
  }

  const filter = `source_type="${escapeFilter(sourceType)}" && source_key="${escapeFilter(sourceKey)}"`;
  let source;
  try {
    source = await pb.collection('pb_integration_sources').getFirstListItem(filter);
  } catch (e) {
    if (e?.status === 404) return { ok: false, status: 403, message: '来源未注册', sourceType, sourceKey };
    throw e;
  }
  if (source.enabled === false) return { ok: false, status: 403, message: '来源已禁用', sourceType, sourceKey };
  if (!source.project_id) return { ok: false, status: 403, message: '来源未绑定园区', sourceType, sourceKey };

  if (source.secret_hash) {
    const token = String(req.headers['x-integration-token'] || '').trim();
    if (!token || sha256(token) !== source.secret_hash) {
      return { ok: false, status: 401, message: '来源签名校验失败', sourceType, sourceKey, projectId: source.project_id };
    }
  }

  return { ok: true, sourceType, sourceKey, projectId: source.project_id };
}

function buildOriginalIdFilter(collection, body, projectId) {
  if (collection === 'pb_yearly_targets') return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)}`;
  if (collection === 'pb_monthly_init_data') {
    return `project_id="${escapeFilter(projectId)}" && year=${Number(body.data?.year)} && month=${Number(body.data?.month)}`;
  }
  const originalId = String(body.original_id || body.data?.original_id || '').trim();
  if (!originalId) throw new Error('缺少 original_id');
  return `project_id="${escapeFilter(projectId)}" && original_id="${escapeFilter(originalId)}"`;
}

async function writeBusinessRecord(body, projectId) {
  const collection = String(body.collection || '').trim();
  const action = String(body.action || 'upsert').trim();
  if (!WRITABLE_COLLECTIONS.has(collection)) throw new Error(`不允许写入集合 ${collection}`);
  if (!['create', 'update', 'upsert', 'delete'].includes(action)) throw new Error(`不支持的 action: ${action}`);

  const requestedProject = String(body.project_id || body.data?.project_id || '').trim();
  if (requestedProject && requestedProject !== projectId) {
    throw new Error(`禁止跨园区写入：来源绑定 ${projectId}，请求目标 ${requestedProject}`);
  }

  const payload = { ...(body.data || {}), project_id: projectId };
  const filter = buildOriginalIdFilter(collection, body, projectId);
  const existing = await pb.collection(collection).getList(1, 1, { filter, fields: 'id' });
  const current = existing.items[0];

  if (action === 'delete') {
    if (current) await pb.collection(collection).delete(current.id);
    return { collection, action, id: current?.id || null };
  }
  if (action === 'create') {
    const created = await pb.collection(collection).create(payload);
    return { collection, action, id: created.id };
  }
  if (current) {
    const updated = await pb.collection(collection).update(current.id, payload);
    return { collection, action: 'update', id: updated.id };
  }
  const created = await pb.collection(collection).create(payload);
  return { collection, action: 'create', id: created.id };
}

async function main() {
  await auth();
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, pb: PB_URL }));

  app.post('/api/integration/write', async (req, res) => {
    const source = await resolveSource(req);
    if (!source.ok) {
      await audit({
        source_type: source.sourceType || 'unknown',
        source_key: source.sourceKey || '',
        project_id: source.projectId || 'unknown',
        status: 'rejected',
        message: source.message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      return res.status(source.status).json({ success: false, message: source.message });
    }

    try {
      const result = await writeBusinessRecord(req.body, source.projectId);
      await audit({
        source_type: source.sourceType,
        source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: result.collection,
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: result.action,
        status: 'success',
        message: '写入成功',
        payload_summary: { collection: result.collection, action: result.action, record_id: result.id },
      });
      return res.json({ success: true, project_id: source.projectId, result });
    } catch (e) {
      const message = e?.data?.message || e?.message || String(e);
      await audit({
        source_type: source.sourceType,
        source_key: source.sourceKey,
        project_id: source.projectId,
        target_collection: req.body?.collection || '',
        target_original_id: req.body?.original_id || req.body?.data?.original_id || '',
        action: req.body?.action || 'upsert',
        status: 'error',
        message,
        payload_summary: { collection: req.body?.collection, action: req.body?.action },
      });
      return res.status(400).json({ success: false, message });
    }
  });

  app.listen(PORT, () => {
    console.log(`[integration-gateway] listening on http://127.0.0.1:${PORT}`);
    console.log(`[integration-gateway] PocketBase: ${PB_URL}`);
  });
}

main().catch((err) => {
  console.error('[integration-gateway] failed:', err?.data || err);
  process.exit(1);
});
