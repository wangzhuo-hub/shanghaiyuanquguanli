import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from './register-tools.js';
import { listRuleResources, readRuleResource } from './resources.js';

export function createParkMcpServer(version = '0.3.0'): McpServer {
  const server = new McpServer({
    name: 'kdpark',
    version,
  });

  for (const rule of listRuleResources()) {
    server.resource(
      rule.name,
      rule.uri,
      { description: rule.description, mimeType: rule.mimeType },
      async (uri) => {
        const { text, mimeType } = await readRuleResource(uri.href);
        return { contents: [{ uri: uri.href, mimeType, text }] };
      },
    );
  }

  registerTools(server);
  return server;
}
