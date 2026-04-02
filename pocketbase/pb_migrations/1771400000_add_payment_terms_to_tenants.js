/// <reference path="../pb_data/types.d.ts" />

/**
 * 为租户集合新增付款周期时间线字段 payment_terms
 */
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_tenants");

  if (!collection.schema.getFieldByName("payment_terms")) {
    collection.schema.addField(new SchemaField({
      "system": false,
      "id": "json_payment_terms",
      "name": "payment_terms",
      "type": "json",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "maxSize": 2000000
      }
    }));
    dao.saveCollection(collection);
  }
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_tenants");

  if (collection.schema.getFieldByName("payment_terms")) {
    collection.schema.removeField("json_payment_terms");
    dao.saveCollection(collection);
  }
});
