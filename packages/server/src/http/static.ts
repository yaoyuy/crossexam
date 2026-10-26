/**
 * 把已构建的前端挂到同一个端口上。
 *
 * 演示要的是「一条命令打开整个产品」：评委不必开两个终端，也不必知道 5173 与
 * 8787 的区别。npm run preview 先 vite build，再由这个模块把 packages/web/dist
 * 托管到服务端端口；/api 前缀一律放行给接口，不参与静态匹配。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { serveStatic } from '@hono/node-server/serve-static';
import type { Hono } from 'hono';

export function webEntry(distDir: string): string | null {
  const entry = join(distDir, 'index.html');
  return existsSync(entry) ? entry : null;
}

export function mountWebApp(app: Hono, distDir: string): boolean {
  if (webEntry(distDir) === null) return false;

  const files = serveStatic({ root: distDir });
  // 前端路由回退：任何非 /api 的 GET 都回 index.html，刷新子路径不会 404
  const spa = serveStatic({ root: distDir, rewriteRequestPath: () => '/index.html' });
  const isApi = (path: string): boolean => path === '/api' || path.startsWith('/api/');

  app.use('*', async (c, next) => {
    if (isApi(c.req.path)) return next();
    return files(c, next);
  });
  app.get('*', async (c, next) => {
    if (isApi(c.req.path)) return next();
    return spa(c, next);
  });
  return true;
}
