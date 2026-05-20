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
 * 为 pb_tenants 添加 rent_reductions（固定金额减免）JSON 字段。
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'rent_reductions')) {
      collection.fields.add(
        new Field({
          hidden: false,
          id: 'rentreductions1',
          maxSize: 500000,
          name: 'rent_reductions',
          presentable: false,
          required: false,
          system: false,
          type: 'json',
        })
      );
    }
    app.save(collection);
  },
  () => {
    /* 不回滚删除字段 */
  }
);
