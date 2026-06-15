/// <reference path="../pb_data/types.d.ts" />

// 每月封账快照：每月 1 日由 integration-gateway 定时任务把「上月」应收/欠款定格成一行。
// 看板与 gateway 读历史月走本表（只实时算当月），使欠款累计成本恒定、不随年限线性膨胀，
// 且双端（前端 + OpenClaw /kpi）历史口径单一。

const PROJECT_RULE =
  '@request.auth.id != "" && @request.auth.enabled != false && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")';

function createCollectionIfMissing(app, name, config) {
  try {
    return app.findCollectionByNameOrId(name);
  } catch (_) {
    const collection = new Collection({ name, type: 'base', system: false, ...config });
    app.save(collection);
    return collection;
  }
}

migrate((app) => {
  createCollectionIfMissing(app, 'pb_sealed_months', {
    fields: [
      { name: 'project_id', type: 'text', required: true },
      { name: 'sealed_year', type: 'number', required: true, onlyInt: true },
      { name: 'sealed_month', type: 'number', required: true, onlyInt: true }, // 自然月 1-12
      { name: 'receivable_total', type: 'number' },     // 当月应收合计
      { name: 'unpaid_sum', type: 'number' },           // 当月未收（欠款增量同口径）
      { name: 'arrears_increment', type: 'number' },    // 当月新增欠款（Unpaid 全额 + Partial 余额）
      { name: 'cumulative_arrears', type: 'number' },   // 截至本月累计欠款
      { name: 'details_json', type: 'json', maxSize: 2000000 }, // 当月 BillingDetail[] 留档（可选审计用）
      { name: 'data_version', type: 'number', onlyInt: true },
      { name: 'sealed_at', type: 'text' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_pb_sealed_months_pid_y_m ON pb_sealed_months (project_id, sealed_year, sealed_month)'],
    listRule: PROJECT_RULE,
    viewRule: PROJECT_RULE,
    createRule: PROJECT_RULE,
    updateRule: PROJECT_RULE,
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('pb_sealed_months'));
  } catch (_) {}
});
