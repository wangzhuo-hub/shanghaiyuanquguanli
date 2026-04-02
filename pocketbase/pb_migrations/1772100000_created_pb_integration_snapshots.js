/// <reference path="../pb_data/types.d.ts" />

/**
 * 集成用全量快照：存看板同源运算结果（含 KPI 子对象），供 OpenClaw / 外部系统只读。
 * 由前端 recalculateMetrics 防抖 upsert；payload 结构见 services/integrationSnapshot.ts。
 */
migrate(
    (db) => {
        const coll = new Collection({
            name: 'pb_integration_snapshots',
            type: 'base',
            system: false,
            schema: [
                {
                    name: 'project_id',
                    type: 'text',
                    required: true,
                    options: { min: null, max: null, pattern: '' },
                },
                {
                    name: 'snapshot_kind',
                    type: 'text',
                    required: true,
                    options: { min: null, max: null, pattern: '' },
                },
                {
                    name: 'payload',
                    type: 'json',
                    required: true,
                    options: { maxSize: 15000000 },
                },
            ],
            indexes: [
                'CREATE UNIQUE INDEX idx_integration_snapshots_pid_kind ON pb_integration_snapshots (project_id, snapshot_kind)',
            ],
            listRule: '',
            viewRule: '',
            createRule: '',
            updateRule: '',
            deleteRule: '',
            options: {},
        });
        Dao(db).saveCollection(coll);
    },
    (db) => {
        const dao = new Dao(db);
        try {
            const col = dao.findCollectionByNameOrId('pb_integration_snapshots');
            dao.deleteCollection(col);
        } catch (_) {}
    }
);
