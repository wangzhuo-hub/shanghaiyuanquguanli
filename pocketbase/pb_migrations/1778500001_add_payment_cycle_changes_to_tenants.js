/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("jg9742yyh9versc")

  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "json3721849982",
    "maxSize": 0,
    "name": "payment_cycle_changes",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("jg9742yyh9versc")
  collection.fields.removeById("json3721849982")
  return app.save(collection)
})
