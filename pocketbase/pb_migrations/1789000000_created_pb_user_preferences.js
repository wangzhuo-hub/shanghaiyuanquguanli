/// <reference path="../pb_data/types.d.ts" />

// 用户级轻量偏好：不进入业务数据版本，也不按 project_id 隔离。
// 当前用于主界面「我的关注字段」跨设备同步，后续可复用到其它个人 UI 偏好。

const USER_PREF_RULE =
  '@request.auth.id != "" && @request.auth.enabled != false && (user_id = @request.auth.id || @request.auth.role = "platform_admin")';

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
  createCollectionIfMissing(app, 'pb_user_preferences', {
    fields: [
      { name: 'user_id', type: 'text', required: true },
      { name: 'preference_key', type: 'text', required: true },
      { name: 'payload', type: 'json', required: true, maxSize: 200000 },
      { name: 'updated_at', type: 'text' },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_pb_user_preferences_user_key ON pb_user_preferences (user_id, preference_key)',
    ],
    listRule: USER_PREF_RULE,
    viewRule: USER_PREF_RULE,
    createRule: USER_PREF_RULE,
    updateRule: USER_PREF_RULE,
    deleteRule: USER_PREF_RULE,
    options: {},
  });
}, (app) => {
  try {
    app.delete(app.findCollectionByNameOrId('pb_user_preferences'));
  } catch (_) {}
});
