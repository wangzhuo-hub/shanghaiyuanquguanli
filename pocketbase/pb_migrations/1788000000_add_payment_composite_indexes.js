/// <reference path="../pb_data/types.d.ts" />

// D4 复合索引：双端（前端按年窗口 / OpenClaw 写前验证+写后核对）高频查询模式补齐。
// 已存在的不重复建：
//   - 各集合 (original_id, project_id) 唯一索引：已由建表迁移创建。
//   - pb_payments(date)、pb_payments(tenant_id) 单列索引：已存在，但复合索引对
//     `project_id=X && date>=Y` / `project_id=X && tenant_id=Y && period=Z` 更优，故补建复合。

function addIndexesIfMissing(app, collectionName, wanted) {
  const col = app.findCollectionByNameOrId(collectionName);
  const current = [];
  const src = col.indexes || [];
  for (let i = 0; i < src.length; i++) current.push(String(src[i]));
  let changed = false;
  for (const def of wanted) {
    const m = def.match(/INDEX\s+(\w+)/);
    const name = m ? m[1] : def;
    const exists = current.some((s) => s.indexOf(name) >= 0);
    if (!exists) { current.push(def); changed = true; }
  }
  if (changed) { col.indexes = current; app.save(col); }
}

function removeIndexes(app, collectionName, names) {
  const col = app.findCollectionByNameOrId(collectionName);
  const src = col.indexes || [];
  const next = [];
  for (let i = 0; i < src.length; i++) {
    const s = String(src[i]);
    if (!names.some((n) => s.indexOf(n) >= 0)) next.push(s);
  }
  col.indexes = next;
  app.save(col);
}

migrate((app) => {
  try {
    addIndexesIfMissing(app, 'pb_payments', [
      'CREATE INDEX idx_payments_pid_date ON pb_payments (project_id, date)',
      'CREATE INDEX idx_payments_pid_tenant_period ON pb_payments (project_id, tenant_id, period)',
    ]);
  } catch (e) {
    console.log('[migration] add payment composite indexes skipped:', e);
  }
}, (app) => {
  try {
    removeIndexes(app, 'pb_payments', ['idx_payments_pid_date', 'idx_payments_pid_tenant_period']);
  } catch (_) {}
});
