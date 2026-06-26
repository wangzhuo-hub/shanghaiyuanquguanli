import path from 'path';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 单一 Vite 配置（与 start-all.sh / Docker 端口约定一致）。
 * - 开发默认端口：1001
 * - `/api/pb` → 本地 PocketBase（默认 1002）
 * - `/api/chat` → ai-proxy（默认 3010）
 * - `/api/qwen` → DashScope（直连，可选）
 */
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const devPort = Number(env.VITE_DEV_PORT || 1001);
    const pbPort = env.VITE_PB_DEV_PORT || '1002';
    const aiProxyPort = env.VITE_AI_PROXY_PORT || '3010';
    const gatewayPort = env.INTEGRATION_GATEWAY_PORT || env.VITE_INTEGRATION_GATEWAY_PORT || '8787';

    return {
        server: {
            port: devPort,
            strictPort: true,
            host: '0.0.0.0',
            proxy: {
                '/api/pb': {
                    target: `http://127.0.0.1:${pbPort}`,
                    changeOrigin: true,
                    rewrite: (p) => {
                        return p.replace(/^\/api\/pb/, '');
                    },
                },
                '/api/chat': {
                    target: `http://127.0.0.1:${aiProxyPort}`,
                    changeOrigin: true,
                },
                '/api/integration': {
                    target: `http://127.0.0.1:${gatewayPort}`,
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
        preview: {
            port: devPort,
            strictPort: true,
            host: '0.0.0.0',
        },
        plugins: [react()],
        define: {
            // API Keys 仅通过服务端代理使用，不嵌入前端 bundle
        },
        build: {
            outDir: 'dist',
            modulePreload: false,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('vite/preload-helper')) return 'react';
                        if (!id.includes('node_modules')) return undefined;
                        if (
                            id.includes('/react/') ||
                            id.includes('/react-dom/') ||
                            id.includes('/scheduler/')
                        ) {
                            return 'react';
                        }
                        if (id.includes('/recharts/') || id.includes('/d3-')) return 'charts';
                        if (id.includes('/html2canvas/')) return 'html2canvas';
                        if (id.includes('/jspdf/')) return 'jspdf';
                        if (id.includes('/exceljs/')) return 'excel';
                        if (id.includes('/xlsx/')) return 'xlsx';
                        return undefined;
                    },
                },
            },
        },
        resolve: {
            alias: {
                '@': path.resolve(__dirname, '.'),
            },
        },
        test: {
            include: [
                '**/*.{test,spec}.{ts,tsx}',
            ],
            exclude: [
                '**/node_modules/**',
                'dist/**',
                'tmp/**',
                'tmpdir/**',
                '.playwright-cli/**',
            ],
        },
    };
});
