/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_budget_scenarios");

  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "budget_year",
    "name": "budget_year",
    "type": "number",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "min": null,
      "max": null,
      "noDecimal": true
    }
  }));

  return dao.saveCollection(collection);
}, (db) => {
  const dao = new Dao(db);
  const collection = dao.findCollectionByNameOrId("pb_budget_scenarios");

  collection.schema.removeField("budget_year");

  return dao.saveCollection(collection);
});

