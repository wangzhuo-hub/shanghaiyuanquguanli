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
 * 首期应收自定义：金额 + 覆盖起止（与前端 Tenant.firstReceivable* 对齐）
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'first_receivable_amount')) {
      collection.fields.add(
        new NumberField({
          name: 'first_receivable_amount',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    if (!findField(collection, 'first_receivable_start_date')) {
      collection.fields.add(
        new TextField({
          name: 'first_receivable_start_date',
          required: false,
          min: null,
          max: null,
          pattern: '',
        })
      );
    }
    if (!findField(collection, 'first_receivable_end_date')) {
      collection.fields.add(
        new TextField({
          name: 'first_receivable_end_date',
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
    /* 不回滚删除字段，避免已有数据丢失 */
  }
);
