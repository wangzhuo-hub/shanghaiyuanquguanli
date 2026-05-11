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
 * 月度年初预算（元）与年度汇总：与前端 MonthlyInitData.initialBudget / yearlyTargets[].initialBudget 对齐
 */
migrate(
  (app) => {
    const yearly = app.findCollectionByNameOrId('pb_yearly_targets');
    if (!findField(yearly, 'initial_budget')) {
      yearly.fields.add(
        new NumberField({
          name: 'initial_budget',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    app.save(yearly);

    const monthly = app.findCollectionByNameOrId('pb_monthly_init_data');
    if (!findField(monthly, 'initial_budget')) {
      monthly.fields.add(
        new NumberField({
          name: 'initial_budget',
          required: false,
          onlyInt: false,
          min: null,
          max: null,
        })
      );
    }
    app.save(monthly);
  },
  () => {
    /* 不回滚删除字段，避免已有数据丢失 */
  }
);
