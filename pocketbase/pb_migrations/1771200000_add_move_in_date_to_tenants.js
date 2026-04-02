/// <reference path="../pb_data/types.d.ts" />

/**
 * 为租户集合新增入驻时间字段 move_in_date
 */
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_tenants");

  if (!collection.schema.getFieldByName("move_in_date")) {
    collection.schema.addField(new SchemaField({
      "system": false,
      "id": "txt_move_in_date",
      "name": "move_in_date",
      "type": "text",
      "required": false,
      "presentable": false,
      "unique": false,
      "options": {
        "min": null,
        "max": null,
        "pattern": ""
      }
    }));
    dao.saveCollection(collection);
  }
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_tenants");

  if (collection.schema.getFieldByName("move_in_date")) {
    collection.schema.removeField("txt_move_in_date");
    dao.saveCollection(collection);
  }
});
