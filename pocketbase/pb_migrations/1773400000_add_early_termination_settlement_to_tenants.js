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
 * 提前退租结算字段：免租扣回覆盖、押金扣款、其它调整（与 Tenant.earlyTermination* 对齐）
 */
migrate(
  (app) => {
    const collection = app.findCollectionByNameOrId('pb_tenants');
    if (!findField(collection, 'early_termination_fr_clawback_override')) {
      collection.fields.add(
        new NumberField({
          name: 'early_termination_fr_clawback_override',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    if (!findField(collection, 'early_termination_deposit_deduction')) {
      collection.fields.add(
        new NumberField({
          name: 'early_termination_deposit_deduction',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    if (!findField(collection, 'early_termination_other_adjustment')) {
      collection.fields.add(
        new NumberField({
          name: 'early_termination_other_adjustment',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    app.save(collection);
  },
  () => {
    /* 不回滚删除字段 */
  }
);
