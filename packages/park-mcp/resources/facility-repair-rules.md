# 设备设施报修 — MCP 写入规范

## 登录

使用 `park_facility_login`，连接 `PARK_FACILITY_PB_URL`（默认 `http://127.0.0.1:11002`）。

## 创建工单 `park_facility_repair_create`

| 字段 | 必填 | 说明 |
|------|------|------|
| category | ✅ | `REPAIR` 报修 / `MAINTENANCE` 维保 |
| floorName | ✅ | 位置，如「1号楼 3F」 |
| assetName | ✅ | 设备名称 |
| description | ✅ | 故障描述 |
| reporter | ✅ | 报修人 |
| priority | | `LOW` / `MEDIUM` / `HIGH`，默认 MEDIUM |
| systemType | | `HVAC` / `ELEC` / `SAFETY` / `NETWORK` / `ARCH` |

## 状态流转

`PENDING` → `PROCESSING` → `COMPLETED`（或 `REPLACED`）

状态变更请在前端 wyxj.kdpark.fun 操作，或通过后续 MCP 更新工具。
