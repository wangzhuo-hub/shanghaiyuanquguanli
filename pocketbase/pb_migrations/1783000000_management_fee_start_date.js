/// <reference path="../pb_data/types.d.ts" />

/** 物业费起算日：是否同合同入驻时间 + 自定义起算日 */

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
  if (field.type === 'bool') collection.fields.add(new BoolField(field));
}

migrate((app) => {
  const tenants = app.findCollectionByNameOrId('pb_tenants');
  addFieldIfMissing(tenants, { name: 'management_fee_start_with_occupancy', type: 'bool' });
  addFieldIfMissing(tenants, { name: 'management_fee_start_date', type: 'text' });
  app.save(tenants);
}, () => {});
