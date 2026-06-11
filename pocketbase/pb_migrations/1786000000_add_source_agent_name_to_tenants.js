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
 * 为租户集合新增「招商客户经理/中介名称」字段 source_agent_name。
 * 用于追踪每个客户的来源，便于后期分析各来源客户的稳定性。
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'source_agent_name')) {
      collection.fields.add(
        new TextField({
          name: 'source_agent_name',
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
