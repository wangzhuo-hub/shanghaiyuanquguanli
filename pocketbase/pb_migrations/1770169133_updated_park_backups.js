/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("142ldi62xt30fi2")

  // update
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bhtmf0wj",
    "name": "data",
    "type": "json",
    "required": true,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("142ldi62xt30fi2")

  // update
  collection.schema.addField(new SchemaField({
    "system": false,
    "id": "bhtmf0wj",
    "name": "data",
    "type": "json",
    "required": false,
    "presentable": false,
    "unique": false,
    "options": {
      "maxSize": 2000000
    }
  }))

  return dao.saveCollection(collection)
})
