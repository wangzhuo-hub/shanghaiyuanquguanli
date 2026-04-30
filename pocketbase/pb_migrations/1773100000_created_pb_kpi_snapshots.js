/// <reference path="../pb_data/types.d.ts" />

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
  createCollectionIfMissing(app, 'pb_kpi_snapshots', {
    fields: [
      { name: 'project_id', type: 'text', required: true },
      { name: 'year', type: 'number', required: true, onlyInt: true },
      { name: 'summary_json', type: 'json', required: true, maxSize: 500000 },
      { name: 'monthly_trends_json', type: 'json', maxSize: 500000 },
      { name: 'data_version', type: 'number', onlyInt: true },
      { name: 'calculated_at', type: 'text' },
    ],
    indexes: ['CREATE UNIQUE INDEX idx_pb_kpi_snapshots_project_year ON pb_kpi_snapshots (project_id, year)'],
    listRule: PROJECT_RULE,
    viewRule: PROJECT_RULE,
    createRule: PROJECT_RULE,
    updateRule: PROJECT_RULE,
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('pb_kpi_snapshots'));
  } catch (_) {}
});
