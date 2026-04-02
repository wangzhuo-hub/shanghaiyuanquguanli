/// <reference path="../pb_data/types.d.ts" />

/**
 * 为预算调整集合新增 adjustment_kind 字段
 * - period_shift: 账期平移
 * - amount_delta: 纯金额增减
 */
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_budget_adjustments");

  if (!collection.schema.getFieldByName("adjustment_kind")) {
    collection.schema.addField(new SchemaField({
      "system": false,
      "id": "sel_adjustment_kind",
      "name": "adjustment_kind",
      "type": "select",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "maxSelect": 1,
        "values": ["period_shift", "amount_delta"]
      }
    }));
    dao.saveCollection(collection);
  }
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_budget_adjustments");

  if (collection.schema.getFieldByName("adjustment_kind")) {
    collection.schema.removeField("sel_adjustment_kind");
    dao.saveCollection(collection);
  }
});
