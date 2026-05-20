/// <reference path="../pb_data/types.d.ts" />

/**
 * 深圳物业费合同字段 + 园区 metadata + 用户核销权限与租金价格脱敏
 */

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
  if (field.type === 'number') collection.fields.add(new NumberField(field));
  if (field.type === 'bool') collection.fields.add(new BoolField(field));
  if (field.type === 'json') collection.fields.add(new JSONField(field));
}

migrate((app) => {
  const tenants = app.findCollectionByNameOrId('pb_tenants');
  addFieldIfMissing(tenants, { name: 'management_fee_enabled', type: 'bool' });
  addFieldIfMissing(tenants, { name: 'management_fee_exempt', type: 'bool' });
  addFieldIfMissing(tenants, { name: 'management_fee_free_periods', type: 'json', maxSize: 500000 });
  addFieldIfMissing(tenants, { name: 'management_fee_unit_price', type: 'number' });
  addFieldIfMissing(tenants, {
    name: 'management_fee_unit_price_mode',
    type: 'select',
    maxSelect: 1,
    values: ['daily', 'monthly'],
  });
  addFieldIfMissing(tenants, { name: 'management_fee_monthly_amount', type: 'number' });
  addFieldIfMissing(tenants, { name: 'management_fee_first_payment_date', type: 'text' });
  app.save(tenants);

  try {
    const parks = app.findCollectionByNameOrId('pb_parks');
    addFieldIfMissing(parks, { name: 'metadata', type: 'json', maxSize: 500000 });
    app.save(parks);
  } catch (_) {}

  try {
    const users = app.findCollectionByNameOrId('users');
    addFieldIfMissing(users, { name: 'receivable_permissions', type: 'json', maxSize: 200000 });
    addFieldIfMissing(users, { name: 'hide_rent_pricing', type: 'bool' });
    app.save(users);
  } catch (_) {}
}, (app) => {
  // 不回滚字段，避免丢数
});
