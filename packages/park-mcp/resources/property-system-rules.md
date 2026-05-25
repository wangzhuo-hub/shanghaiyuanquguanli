# 物业水电费系统 — MCP 说明

## 登录

使用 `park_property_login`，连接 `PARK_PROPERTY_PB_URL`（默认 `http://127.0.0.1:11006`）。

## 只读工具（Phase 2）

- `park_property_utility_list` — `pm_utility_records` 水电费
- `park_property_fees_list` — `pm_property_fees` 物业费

## 注意

- 计算字段（用量、金额合计等）由系统生成，**勿手工写入**。
- 写入类操作 Phase 2 未开放，请使用 sdsf.kdpark.fun 前端。
