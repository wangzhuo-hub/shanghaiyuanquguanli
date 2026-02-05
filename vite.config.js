import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react()],
    server: {
      host: true, // 监听所有网络接口，支持局域网访问
      port: 5173 // 默认端口
    },
    build: {
      outDir: 'dist',
    },
    define: {
      // Vital for using process.env.API_KEY in the browser code
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
    }
  }
})