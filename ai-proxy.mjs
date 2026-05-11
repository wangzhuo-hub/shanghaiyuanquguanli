// AI API代理服务器 - 使用原生 http + Node 18+ 全局 fetch
import http from 'http';
import os from 'os';

const PORT = 3010;
const MAX_BODY_SIZE = 5 * 1024 * 1024; // 5MB
const UPSTREAM_TIMEOUT_MS = 120_000; // 2 min
const QWEN_BASE_URL = 'https://coding.dashscope.aliyuncs.com/v1';

const QWEN_API_KEY =
  process.env.QWEN_API_KEY ||
  process.env.DASHSCOPE_API_KEY ||
  process.env.QWEN_KEY ||
  '';

if (!QWEN_API_KEY) {
  console.error(
    [
      '[Proxy] 缺少 API Key，AI 代理服务无法启动。',
      '请在启动前设置环境变量之一：',
      '  - QWEN_API_KEY（推荐）',
      '  - DASHSCOPE_API_KEY',
      '',
      '示例：',
      '  export QWEN_API_KEY="your_key_here"',
      '  node ai-proxy.mjs',
    ].join('\n')
  );
  process.exit(1);
}

const DEFAULT_ALLOWED_ORIGINS = [
  'https://kdpark.fun',
  'https://wyxj.kdpark.fun',
  'https://contents.kdpark.fun',
  'http://localhost:1001',
  'http://localhost:5173',
  'http://127.0.0.1:1001',
  'http://127.0.0.1:5173',
];
const ALLOWED_ORIGINS = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(s => s.trim())
  : DEFAULT_ALLOWED_ORIGINS;

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '';
  const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', allowOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Only handle POST /api/chat
  if (req.method === 'POST' && req.url === '/api/chat') {
    let body = '';
    let bodyLength = 0;

    req.on('data', chunk => {
      bodyLength += chunk.length;
      if (bodyLength > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: '请求体过大' }));
        req.destroy();
        return;
      }
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

        const response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${QWEN_API_KEY}`
          },
          body: JSON.stringify(requestData),
          signal: controller.signal,
        });
        clearTimeout(timer);

        const data = await response.json();

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (error) {
        const message = error.name === 'AbortError' ? '上游请求超时' : error.message;
        console.error('[Proxy] 错误:', message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

function firstLanIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return null;
}

server.listen(PORT, '0.0.0.0', () => {
  const lan = firstLanIPv4();
  console.log(`\n✅ AI代理服务器已启动`);
  console.log(`   本地: http://127.0.0.1:${PORT}`);
  if (lan) console.log(`   局域网: http://${lan}:${PORT}`);
  console.log(`   端点: POST /api/chat\n`);
});

process.on('SIGINT', () => {
  console.log('\n正在关闭服务器...');
  server.close();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n正在关闭服务器...');
  server.close();
  process.exit(0);
});
