// AI API代理服务器 - 使用原生http模块
import http from 'http';
import fetch from 'node-fetch';

const PORT = 3010;
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

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
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
    
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        const requestData = JSON.parse(body);
        console.log('[Proxy] 收到请求:', requestData.model);

        const response = await fetch(`${QWEN_BASE_URL}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${QWEN_API_KEY}`
          },
          body: JSON.stringify(requestData)
        });

        const data = await response.json();
        
        console.log('[Proxy] API响应:', {
          status: response.status,
          model: data.model,
          tokens: data.usage?.total_tokens
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
      } catch (error) {
        console.error('[Proxy] 错误:', error.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
  } else {
    res.writeHead(404);
    res.end('Not Found');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n✅ AI代理服务器已启动`);
  console.log(`   本地地址: http://localhost:${PORT}`);
  console.log(`   局域网地址: http://192.168.0.11:${PORT}`);
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
