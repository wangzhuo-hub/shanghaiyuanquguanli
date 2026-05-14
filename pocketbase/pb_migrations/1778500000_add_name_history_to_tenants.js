/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const collection = app.findCollectionByNameOrId("jg9742yyh9versc")

  collection.fields.addAt(collection.fields.length, new Field({
    "hidden": false,
    "id": "json2861745641",
    "maxSize": 0,
    "name": "name_history",
    "presentable": false,
    "required": false,
    "system": false,
    "type": "json"
  }))

  return app.save(collection)
}, (app) => {
  const collection = app.findCollectionByNameOrId("jg9742yyh9versc")
  collection.fields.removeById("json2861745641")
  return app.save(collection)
})
