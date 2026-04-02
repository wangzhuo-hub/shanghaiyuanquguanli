/// <reference path="../pb_data/types.d.ts" />

/**
 * 移除遗留整包 JSON 集合 park_backups。
 * 业务数据以 pb_* 结构化集合为准；删除前请自行导出备份。
 */
migrate(
    (db) => {
        const dao = new Dao(db);
        try {
            const col = dao.findCollectionByNameOrId('park_backups');
            dao.deleteCollection(col);
        } catch (_) {
            /* 集合已不存在时忽略 */
        }
    },
    (_db) => {
        /* 不回滚：若需恢复请从整库备份或 JSON 重新导入并自建集合 */
    }
);
