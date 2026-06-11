/// <reference path="../pb_data/types.d.ts" />

/** users 集合：管理员可读的明文密码备份（与 PocketBase 改密时的 oldPassword 配合使用） */

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

migrate((app) => {
  try {
    const users = app.findCollectionByNameOrId('users');
    addFieldIfMissing(users, {
      name: 'password_plain',
      type: 'text',
      required: false,
      max: 256,
    });
    app.save(users);
  } catch (_) {}
}, (app) => {
  // 不回滚字段，避免丢数
});
