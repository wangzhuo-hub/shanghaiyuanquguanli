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

/** 注册申请增加申请人姓名，供审批与清单展示 */
migrate(
  (app) => {
    try {
      const collection = app.findCollectionByNameOrId('pb_user_signup_requests');
      if (!findField(collection, 'applicant_name')) {
        collection.fields.add(
          new TextField({
            name: 'applicant_name',
            required: false,
            min: null,
            max: 200,
            pattern: '',
          })
        );
      }
      app.save(collection);
    } catch (_) {
      /* 集合不存在时忽略（未启用注册模块的旧库） */
    }
  },
  () => {
    /* 不回滚删除字段，避免已有数据丢失 */
  }
);
