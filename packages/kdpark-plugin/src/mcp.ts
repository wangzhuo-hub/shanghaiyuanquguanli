#!/usr/bin/env node
/**
 * 金蝶园区 — 轻量统一 Agent 插件
 */
import './config.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { publicUserProfile } from '../../park-mcp/src/lib/auth.js';
import { adminComputeAvailable } from '../../park-mcp/src/config.js';
import {
  clearSession,
  getAppSession,
  requireDashboardSession,
} from '../../park-mcp/src/session.js';
import { PLUGIN_INSTRUCTIONS } from './instructions.js';
import { unifiedLogin } from './login.js';
import { runQuery, runSubmit } from './router.js';

function text(data: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    isError,
  };
}

function err(e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  const needLogin = /未登录|请先.*login/i.test(message);
  return text(
    {
      ok: false,
      message,
      ...(needLogin
        ? { next_step: '请向用户索取看板邮箱和密码，调用 kdpark_login' }
        : {}),
    },
    true,
  );
}

const paramsSchema = z.record(z.unknown()).optional().describe('可选参数 JSON，如 {"search":"科技","year":2026}');

const server = new McpServer(
  { name: 'kdpark', version: '1.0.0' },
  { instructions: PLUGIN_INSTRUCTIONS },
);

server.resource(
  '数据读写规则',
  'kdpark://rules',
  { description: '招商看板写入铁律与字段规范摘要', mimeType: 'text/markdown' },
  async () => ({
    contents: [{
      uri: 'kdpark://rules',
      mimeType: 'text/markdown',
      text: `# 写入前必读\n\n1. 先 query 楼宇/单元/租户再给用户选项\n2. unit_ids 用 original_id，不用 PB 内部 id\n3. 枚举值必须对照规范\n4. 写入前确认金额与日期\n\n完整规则请联系管理员或访问 kdpark.fun 看板帮助。`,
    }],
  }),
);

server.tool(
  'kdpark_login',
  '【首次必调】使用看板邮箱密码登录；一次登录打通招商/设备/物业（子系统未开通则自动跳过）。登录前不要查数据或写入。',
  {
    email: z.string().describe('看板登录邮箱'),
    password: z.string().describe('看板登录密码'),
  },
  async ({ email, password }) => {
    try {
      return text(await unifiedLogin(email, password));
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  'kdpark_whoami',
  '查看当前登录用户、园区、角色与已连通子系统',
  {},
  async () => {
    try {
      const s = getAppSession();
      if (!s.dashboard) {
        return text(
          {
            ok: false,
            logged_in: false,
            message: '尚未登录',
            next_step: '调用 kdpark_login，向用户索取邮箱和密码',
          },
          true,
        );
      }
      return text({
        ok: true,
        logged_in: true,
        user: publicUserProfile(s.dashboard.user),
        systems: {
          dashboard: true,
          facility: Boolean(s.facility),
          property: Boolean(s.property),
        },
        admin_compute: adminComputeAvailable(),
      });
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  'kdpark_query',
  '查询数据。kind: kpi|tenants|payments|receivables|buildings|units|repairs|utility_bills|property_fees。params 传 JSON 筛选条件。',
  {
    kind: z.string(),
    params: paramsSchema,
  },
  async ({ kind, params }) => {
    try {
      if (!getAppSession().dashboard) {
        return text(
          { ok: false, message: '未登录', next_step: '先 kdpark_login' },
          true,
        );
      }
      const data = await runQuery(kind, params || {});
      return text(data, (data as { ok?: boolean }).ok === false);
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  'kdpark_submit',
  '办理/写入。action: payment(核销)|tenant(合同/租户)|repair(报修)|repair_update|utility_update|property_fee|record(通用)。params 为 JSON 业务字段。',
  {
    action: z.string(),
    params: paramsSchema,
  },
  async ({ action, params }) => {
    try {
      if (!getAppSession().dashboard) {
        return text(
          { ok: false, message: '未登录', next_step: '先 kdpark_login' },
          true,
        );
      }
      const data = await runSubmit(action, params || {});
      return text(data, (data as { ok?: boolean }).ok === false);
    } catch (e) {
      return err(e);
    }
  },
);

server.tool(
  'kdpark_logout',
  '退出登录',
  {},
  async () => {
    clearSession();
    return text({ ok: true, message: '已退出' });
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[kdpark-plugin] ready — 等待 Agent 调用 kdpark_login');
}

main().catch((e) => {
  console.error('[kdpark-plugin] fatal:', e);
  process.exit(1);
});
