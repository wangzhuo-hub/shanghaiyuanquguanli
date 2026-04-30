/// <reference path="../pb_data/types.d.ts" />

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
  createCollectionIfMissing(app, 'pb_user_signup_requests', {
    fields: [
      { name: 'email', type: 'text', required: true },
      { name: 'password_plain', type: 'text', required: true },
      { name: 'requested_project_ids', type: 'json', required: true, maxSize: 200000 },
      { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['pending', 'approved', 'rejected'] },
      { name: 'review_note', type: 'text' },
      { name: 'approved_user_id', type: 'text' },
      { name: 'approved_at', type: 'date' },
    ],
    indexes: [
      'CREATE INDEX idx_signup_requests_status ON pb_user_signup_requests (status)',
    ],
    listRule: '@request.auth.role = "platform_admin"',
    viewRule: '@request.auth.role = "platform_admin"',
    createRule: '',
    updateRule: '@request.auth.role = "platform_admin"',
    deleteRule: '@request.auth.role = "platform_admin"',
    options: {},
  });

  try {
    const parks = app.findCollectionByNameOrId('pb_parks');
    parks.listRule = '';
    parks.viewRule = '';
    parks.createRule = '@request.auth.role = "platform_admin"';
    parks.updateRule = '@request.auth.role = "platform_admin"';
    parks.deleteRule = '@request.auth.role = "platform_admin"';
    app.save(parks);
  } catch (_) {}
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('pb_user_signup_requests'));
  } catch (_) {}

  try {
    const parks = app.findCollectionByNameOrId('pb_parks');
    parks.listRule = '@request.auth.id != "" && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")';
    parks.viewRule = '@request.auth.id != "" && (project_id = @request.auth.project_id || @request.auth.allowed_project_ids ?= project_id || @request.auth.role = "platform_admin")';
    parks.createRule = '@request.auth.role = "platform_admin"';
    parks.updateRule = '@request.auth.role = "platform_admin"';
    parks.deleteRule = '@request.auth.role = "platform_admin"';
    app.save(parks);
  } catch (_) {}
});
