import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// https://vite.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      '/api/research': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/research/, '/api'),
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.error('[vite:proxy] error:', err.message);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('[vite:proxy]', req.method, req.url, '->', proxyReq.path);
          });
        },
      },
    },
  },
  // 确保静态资源正确处理
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
  },
});
