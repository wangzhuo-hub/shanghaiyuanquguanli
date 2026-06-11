/// <reference path="../pb_data/types.d.ts" />

/** users 集合：飞书/微信 openid 绑定字段（与前端 wechatOpenid 对应） */

function findField(collection, name) {
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
}

function ensureUsersAdminRules(collection) {
  collection.listRule = '@request.auth.role = "platform_admin"';
  collection.viewRule = '@request.auth.id = id || @request.auth.role = "platform_admin"';
  collection.createRule = '@request.auth.role = "platform_admin"';
  collection.updateRule = '@request.auth.role = "platform_admin"';
  collection.deleteRule = '@request.auth.role = "platform_admin"';
}

migrate((app) => {
  try {
    const users = app.findCollectionByNameOrId('users');
    addFieldIfMissing(users, { name: 'wechat_openid', type: 'text', required: false, max: 128 });
    ensureUsersAdminRules(users);
    app.save(users);
  } catch (_) {}
}, (app) => {
  // 不回滚字段与规则，避免丢数或锁死管理员
});
