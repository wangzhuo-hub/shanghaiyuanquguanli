#!/bin/bash

# 创建 park_backups collection (无认证规则)
# 使用 PocketBase API 创建 collection

POCKETBASE_URL="http://127.0.0.1:8090"

echo "正在创建 park_backups collection..."

# 创建 collection (不带认证规则)
curl -X POST "$POCKETBASE_URL/api/collections" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "park_backups",
    "type": "base",
    "system": false,
    "schema": [
      {
        "name": "project_id",
        "type": "text",
        "required": true,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      },
      {
        "name": "data",
        "type": "json",
        "required": true,
        "options": {}
      },
      {
        "name": "note",
        "type": "text",
        "required": false,
        "options": {
          "min": null,
          "max": null,
          "pattern": ""
        }
      }
    ],
    "indexes": [
      "CREATE INDEX idx_project_id ON park_backups (project_id)"
    ],
    "listRule": null,
    "viewRule": null,
    "createRule": null,
    "updateRule": null,
    "deleteRule": null,
    "options": {}
  }'

echo ""
echo "Collection 创建完成！"
echo ""
echo "提示：如果出现错误，可能需要："
echo "1. 访问 http://127.0.0.1:8090/_/ 打开 PocketBase 管理后台"
echo "2. 手动创建 park_backups collection"
echo "3. 确保所有 API Rules 为空"
