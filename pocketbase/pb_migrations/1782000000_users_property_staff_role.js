/// <reference path="../pb_data/types.d.ts" />

/** users.role 增加「物业人员」选项（隐藏租金价格，默认仅物业费核销） */

function findField(collection, name) {
  const fields = collection.fields || collection.schema || [];
  for (let i = 0; i < fields.length; i += 1) {
    if (fields[i].name === name) return fields[i];
  }
  return null;
}

function ensureRoleIncludesPropertyStaff(collection) {
  const roleField = findField(collection, 'role');
  if (!roleField || !Array.isArray(roleField.values)) return;
  if (!roleField.values.includes('property_staff')) {
    roleField.values = [...roleField.values, 'property_staff'];
  }
}

migrate((app) => {
  try {
    const users = app.findCollectionByNameOrId('users');
    ensureRoleIncludesPropertyStaff(users);
    app.save(users);
  } catch (_) {}
}, (app) => {
  // 不回滚 role 枚举，避免已有物业人员账号无法保存
});
