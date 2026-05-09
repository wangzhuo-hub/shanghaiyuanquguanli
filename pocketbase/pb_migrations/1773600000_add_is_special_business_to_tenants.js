/// <reference path="../pb_data/types.d.ts" />

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

/**
 * 为租户集合新增「特殊业态」标记字段 is_special_business。
 * 该字段为 true 时，租户不再按合同自动产生应收，应收金额需在
 * 「财务报表 → 特殊业态收入录入」按月手动录入。
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'is_special_business')) {
      collection.fields.add(
        new BoolField({
          name: 'is_special_business',
          required: false,
        })
      );
    }
    app.save(collection);
  },
  () => {
    /* 不回滚删除字段 */
  }
);
