import { defineConfig } from 'vitest/config';

// .tmp 与 dist 里会有便携包解压出来的副本（含 tools/launcher 的测试），
// 不排除的话测试文件数会随临时目录浮动，门禁数字不可信。
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', '**/.tmp/**'],
  },
});
