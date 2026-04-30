/// <reference path="../pb_data/types.d.ts" />

/**
 * 多园区登录与数据隔离。
 *
 * 设计要点：
 * - 业务数据继续使用同一套 pb_* 集合，通过 project_id 做租户隔离。
 * - users 认证记录持有 project_id / allowed_project_ids / role。
 * - 飞书、OpenClaw、Webhook 等外部入口先映射到 project_id，再写业务集合。
 */

const BUSINESS_COLLECTIONS = [
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
  'pb_integration_snapshots',
];

const PROJECT_RULE =
  '@request.auth.id != "" && @request.auth.enabled != false && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")';

const WRITE_RULE =
  '@request.auth.id != "" && @request.auth.enabled != false && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")';

function findField(collection, name) {
  if (collection.fields && typeof collection.fields.getByName === 'function') {
    try {
      return collection.fields.getByName(name);
    } catch (_) {
      return null;
    }
  }
  const fields = collection.fields || collection.schema || [];
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].name === name) return fields[i];
  }
  return null;
}

function addFieldIfMissing(collection, field) {
  if (findField(collection, field.name)) return;
  if (!collection.fields || typeof collection.fields.add !== 'function') return;
  if (field.type === 'text') collection.fields.add(new TextField(field));
  if (field.type === 'select') collection.fields.add(new SelectField(field));
  if (field.type === 'json') collection.fields.add(new JSONField(field));
  if (field.type === 'bool') collection.fields.add(new BoolField(field));
}

function createCollectionIfMissing(app, name, config) {
  try {
    return app.findCollectionByNameOrId(name);
  } catch (_) {
    const collection = new Collection({ name, type: 'base', system: false, ...config });
    app.save(collection);
    return collection;
  }
}

function ensureProjectRequired(collection) {
  const projectField = findField(collection, 'project_id');
  if (projectField) projectField.required = true;
}

migrate((app) => {
  createCollectionIfMissing(app, 'pb_parks', {
    fields: [
      { name: 'project_id', type: 'text', required: true },
      { name: 'name', type: 'text', required: true },
      { name: 'city', type: 'text' },
      { name: 'enabled', type: 'bool' },
      { name: 'sort_order', type: 'number', onlyInt: true },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_pb_parks_project_id ON pb_parks (project_id)'],
    listRule: '@request.auth.id != "" && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")',
    viewRule: '@request.auth.id != "" && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")',
    createRule: '@request.auth.role = "platform_admin"',
    updateRule: '@request.auth.role = "platform_admin"',
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });

  try {
    const users = app.findCollectionByNameOrId('users');
    addFieldIfMissing(users, { name: 'project_id', type: 'text', required: false });
    addFieldIfMissing(users, { name: 'role', type: 'select', required: false, maxSelect: 1, values: ['park_user', 'park_admin', 'group_admin', 'platform_admin'] });
    addFieldIfMissing(users, { name: 'allowed_project_ids', type: 'json', required: false, maxSize: 200000 });
    addFieldIfMissing(users, { name: 'enabled', type: 'bool', required: false });
    users.listRule = '@request.auth.role = "platform_admin"';
    users.viewRule = '@request.auth.id = id || @request.auth.role = "platform_admin"';
    users.createRule = '@request.auth.role = "platform_admin"';
    users.updateRule = '@request.auth.role = "platform_admin"';
    users.deleteRule = '@request.auth.role = "platform_admin"';
    app.save(users);
  } catch (_) {
    // 标准部署会在 Admin UI 或初始化脚本中创建 users auth collection。
  }

  createCollectionIfMissing(app, 'pb_integration_sources', {
    fields: [
      { name: 'source_type', type: 'select', required: true, maxSelect: 1, values: ['feishu_group', 'feishu_form', 'openclaw_agent', 'webhook'] },
      { name: 'source_key', type: 'text', required: true },
      { name: 'project_id', type: 'text', required: true },
      { name: 'display_name', type: 'text' },
      { name: 'secret_hash', type: 'text' },
      { name: 'enabled', type: 'bool' },
      { name: 'metadata', type: 'json', maxSize: 500000 },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_integration_sources_key ON pb_integration_sources (source_type, source_key)'],
    listRule: '@request.auth.role = "platform_admin"',
    viewRule: '@request.auth.role = "platform_admin"',
    createRule: '@request.auth.role = "platform_admin"',
    updateRule: '@request.auth.role = "platform_admin"',
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });

  createCollectionIfMissing(app, 'pb_integration_audit_logs', {
    fields: [
      { name: 'source_type', type: 'text', required: true },
      { name: 'source_key', type: 'text' },
      { name: 'project_id', type: 'text', required: true },
      { name: 'target_collection', type: 'text' },
      { name: 'target_original_id', type: 'text' },
      { name: 'action', type: 'text' },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['success', 'rejected', 'error'] },
      { name: 'message', type: 'text' },
      { name: 'payload_summary', type: 'json', maxSize: 500000 },
    ],
    indexes: ['CREATE INDEX idx_integration_audit_project ON pb_integration_audit_logs (project_id)'],
    listRule: '@request.auth.role = "platform_admin" || @request.auth.allowed_project_ids ?= project_id || @request.auth.project_id = project_id',
    viewRule: '@request.auth.role = "platform_admin" || @request.auth.allowed_project_ids ?= project_id || @request.auth.project_id = project_id',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.role = "platform_admin"',
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });

  for (const name of BUSINESS_COLLECTIONS) {
    try {
      const collection = app.findCollectionByNameOrId(name);
      ensureProjectRequired(collection);
      collection.listRule = PROJECT_RULE;
      collection.viewRule = PROJECT_RULE;
      collection.createRule = WRITE_RULE;
      collection.updateRule = WRITE_RULE;
      collection.deleteRule = WRITE_RULE;
      app.save(collection);
    } catch (_) {}
  }
}, (app) => {
  for (const name of ['pb_integration_audit_logs', 'pb_integration_sources', 'pb_parks']) {
    try {
      app.delete(app.findCollectionByNameOrId(name));
    } catch (_) {}
  }
  for (const name of BUSINESS_COLLECTIONS) {
    try {
      const collection = app.findCollectionByNameOrId(name);
      collection.listRule = '';
      collection.viewRule = '';
      collection.createRule = '';
      collection.updateRule = '';
      collection.deleteRule = '';
      const projectField = findField(collection, 'project_id');
      if (projectField) projectField.required = false;
      app.save(collection);
    } catch (_) {}
  }
});
