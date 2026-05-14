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
 * 部分退租：为 pb_tenants 添加 parent_contract_id 字段
 * 当合同被拆分退租时，子合同通过此字段指向原合同
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'parent_contract_id')) {
      collection.fields.add(
        new TextField({
          name: 'parent_contract_id',
          required: false,
          min: null,
          max: null,
          pattern: '',
        })
      );
    }
    app.save(collection);
  },
  () => {
    /* 不回滚删除字段 */
  }
);
