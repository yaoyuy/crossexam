import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// 开发时前端跑在 5173，接口交给 8787 的本地服务；
// 演示只需一条命令时，服务端会直接托管构建产物，不用起两个进程。
const serverOrigin = process.env['CROSSEXAM_SERVER_ORIGIN'] ?? 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: serverOrigin, changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
