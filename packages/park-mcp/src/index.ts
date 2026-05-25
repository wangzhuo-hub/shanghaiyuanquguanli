#!/usr/bin/env node
/**
 * 金蝶园区招商 MCP Server
 *   stdio  — Cursor / Claude Desktop 本地（默认）
 *   serve  — HTTP Streamable MCP + Bearer 登录
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  adminComputeAvailable,
  FACILITY_PB_URL,
  MCP_HTTP_HOST,
  MCP_HTTP_PORT,
  PB_URL,
  PROPERTY_PB_URL,
} from './config.js';
import { createParkMcpServer } from './create-server.js';
import { startHttpServer } from './http-server.js';
import { tryAutoLoginAll } from './register-tools.js';

async function startStdio(): Promise<void> {
  await tryAutoLoginAll();
  const server = createParkMcpServer('0.3.0');
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[park-mcp] stdio v0.3.0 dashboard=${PB_URL} facility=${FACILITY_PB_URL} property=${PROPERTY_PB_URL} admin_compute=${adminComputeAvailable()}`,
  );
}

async function main(): Promise<void> {
  const mode = process.argv[2] || 'stdio';
  if (mode === 'serve' || mode === '--serve') {
    await startHttpServer();
    return;
  }
  await startStdio();
}

main().catch((err) => {
  console.error('[park-mcp] fatal:', err);
  process.exit(1);
});
