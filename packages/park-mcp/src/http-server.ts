import type { Request, Response, NextFunction } from 'express';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_HTTP_ALLOWED_HOSTS, MCP_HTTP_HOST, MCP_HTTP_PORT } from './config.js';
import { createParkMcpServer } from './create-server.js';
import {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  parseBearer,
} from './http-auth.js';
import { cloneSessionForToken, getTokenEntry } from './token-store.js';
import { runWithSession } from './session.js';

const mcpServer = createParkMcpServer('0.3.0');
const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: undefined,
});

let transportConnected = false;

async function ensureTransport(): Promise<void> {
  if (!transportConnected) {
    await mcpServer.connect(transport);
    transportConnected = true;
  }
}

function bearerAuth(req: Request, res: Response, next: NextFunction): void {
  const entry = getTokenEntry(parseBearer(req));
  if (!entry) {
    res.status(401).json({ ok: false, message: '需要 Authorization: Bearer <token>，请先 POST /auth/login' });
    return;
  }
  const session = cloneSessionForToken(entry);
  runWithSession(session, () => next());
}

export async function startHttpServer(): Promise<void> {
  await ensureTransport();

  const allowedHosts = MCP_HTTP_ALLOWED_HOSTS.length > 0 ? MCP_HTTP_ALLOWED_HOSTS : undefined;
  const app = createMcpExpressApp({
    host: MCP_HTTP_HOST,
    allowedHosts,
  });

  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'kdpark-mcp', version: '0.3.0' });
  });

  app.post('/auth/login', (req, res) => {
    void handleAuthLogin(req, res);
  });
  app.get('/auth/me', handleAuthMe);
  app.post('/auth/logout', handleAuthLogout);

  app.post('/mcp', bearerAuth, (req, res) => {
    void transport.handleRequest(req, res, req.body);
  });

  app.get('/mcp', bearerAuth, (req, res) => {
    void transport.handleRequest(req, res);
  });

  app.listen(MCP_HTTP_PORT, MCP_HTTP_HOST, () => {
    console.error(
      `[park-mcp] HTTP http://${MCP_HTTP_HOST}:${MCP_HTTP_PORT}  (POST /auth/login, POST/GET /mcp)`,
    );
  });
}
