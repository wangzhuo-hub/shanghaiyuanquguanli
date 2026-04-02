import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * 单一 Vite 配置（与 start-all.sh / Docker 端口约定一致）。
 * - 开发默认端口：1001
 * - `/api/pb` → 本地 PocketBase（默认 8001）
 * - `/api/chat` → ai-proxy（默认 3010）
 * - `/api/qwen` → DashScope（直连，可选）
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devPort = Number(env.VITE_DEV_PORT || 1001);
    const pbPort = env.VITE_PB_DEV_PORT || '8001';
    const aiProxyPort = env.VITE_AI_PROXY_PORT || '3010';

    return {
        server: {
            port: devPort,
            host: '0.0.0.0',
            proxy: {
                '/api/pb': {
                    target: `http://127.0.0.1:${pbPort}`,
                    changeOrigin: true,
                    rewrite: (p) => {
                        const stripped = p.replace(/^\/api\/pb/, '');
                        return stripped === '' ? '/' : stripped;
                    },
                },
                '/api/chat': {
                    target: `http://127.0.0.1:${aiProxyPort}`,
                    changeOrigin: true,
                },
                '/api/qwen': {
                    target: 'https://coding.dashscope.aliyuncs.com',
                    changeOrigin: true,
                    rewrite: (p) => p.replace(/^\/api\/qwen/, ''),
                    secure: false,
                },
            },
        },
        plugins: [react()],
        define: {
            'process.env.API_KEY': JSON.stringify(env.API_KEY ?? env.GEMINI_API_KEY),
            'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        },
        build: {
            outDir: 'dist',
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, '.'),
            },
        },
    };
});
