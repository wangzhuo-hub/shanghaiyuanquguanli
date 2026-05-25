/** 插件默认连接生产看板；运维可在 MCP env 覆盖，终端用户无需配置 */
export const PB_URL = (
  process.env.KDPARK_PB_URL || process.env.PARK_PB_URL || process.env.PB_URL || 'https://kdpark.fun/api/pb'
).replace(/\/$/, '');

export const FACILITY_PB_URL = (
  process.env.KDPARK_FACILITY_URL || process.env.PARK_FACILITY_PB_URL || 'https://wyxj.kdpark.fun/api'
).replace(/\/$/, '');

export const PROPERTY_PB_URL = (
  process.env.KDPARK_PROPERTY_URL || process.env.PARK_PROPERTY_PB_URL || 'https://sdsf.kdpark.fun/api'
).replace(/\/$/, '');

/** 本地开发：自动用隧道端口 */
export const IS_LOCAL = process.env.KDPARK_LOCAL === '1';

/** 同步到 park-mcp 读取的环境变量（插件侧统一入口） */
process.env.PARK_PB_URL = PB_URL;
process.env.PARK_FACILITY_PB_URL = FACILITY_PB_URL;
process.env.PARK_PROPERTY_PB_URL = PROPERTY_PB_URL;
