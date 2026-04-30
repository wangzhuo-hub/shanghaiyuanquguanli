/// <reference path="../pb_data/types.d.ts" />

const PAYMENT_CYCLE_VALUES = ['HalfMonthly', 'Monthly', 'BiMonthly', 'Quarterly', 'SemiAnnual', 'Annual', 'Custom'];

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

function setSelectValues(field, values) {
  if (!field) return;
  field.values = values;
  if (field.options) field.options.values = values;
}

function allowDecimal(field) {
  if (!field) return;
  field.onlyInt = false;
  if (field.options) field.options.noDecimal = false;
}

migrate((app) => {
  const collection = app.findCollectionByNameOrId('pb_tenants');
  setSelectValues(findField(collection, 'payment_cycle'), PAYMENT_CYCLE_VALUES);
  allowDecimal(findField(collection, 'payment_cycle_months'));
  allowDecimal(findField(collection, 'first_payment_months'));
  app.save(collection);
}, (app) => {
  const collection = app.findCollectionByNameOrId('pb_tenants');
  setSelectValues(findField(collection, 'payment_cycle'), ['Monthly', 'Quarterly', 'SemiAnnual', 'Annual']);
  app.save(collection);
});
