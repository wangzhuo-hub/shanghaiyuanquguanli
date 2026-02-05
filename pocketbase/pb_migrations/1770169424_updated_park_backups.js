/// <reference path="../pb_data/types.d.ts" />
migrate((db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("142ldi62xt30fi2")

  collection.listRule = "@request.auth.id != \"\" || @request.auth.id ?= \"\""
  collection.viewRule = "@request.auth.id != \"\" || @request.auth.id ?= \"\""
  collection.createRule = "@request.auth.id != \"\" || @request.auth.id ?= \"\""
  collection.updateRule = "@request.auth.id != \"\" || @request.auth.id ?= \"\""
  collection.deleteRule = "(@request.auth.id != \"\" && @request.auth.admin = true) || @request.auth.id ?= \"\""

  return dao.saveCollection(collection)
}, (db) => {
  const dao = new Dao(db)
  const collection = dao.findCollectionByNameOrId("142ldi62xt30fi2")

  collection.listRule = "@request.auth.id != \"\""
  collection.viewRule = "@request.auth.id != \"\""
  collection.createRule = "@request.auth.id != \"\""
  collection.updateRule = "@request.auth.id != \"\""
  collection.deleteRule = "@request.auth.id != \"\" && @request.auth.admin = true"

  return dao.saveCollection(collection)
})
