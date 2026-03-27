/// <reference path="../pb_data/types.d.ts" />

/**
 * 租金应收按月备注（工作台 / 财务表），按 project_id 存一条 JSON 映射
 */
migrate((db) => {
  const coll = new Collection({
    name: 'pb_billing_period_notes',
    type: 'base',
    system: false,
    schema: [
      {
        name: 'original_id',
        type: 'text',
        required: true,
        options: { min: null, max: null, pattern: '' },
      },
      {
        name: 'notes_json',
        type: 'json',
        required: false,
        options: { maxSize: 2000000 },
      },
      {
        name: 'project_id',
        type: 'text',
        required: false,
        options: { min: null, max: null, pattern: '' },
      },
    ],
    indexes: [
      'CREATE UNIQUE INDEX idx_bpn_oid ON pb_billing_period_notes (original_id, project_id)',
    ],
    listRule: '',
    viewRule: '',
    createRule: '',
    updateRule: '',
    deleteRule: '',
    options: {},
  });
  Dao(db).saveCollection(coll);
}, (db) => {
  const dao = new Dao(db);
  try {
    const col = dao.findCollectionByNameOrId('pb_billing_period_notes');
    dao.deleteCollection(col);
  } catch (_) {}
});
