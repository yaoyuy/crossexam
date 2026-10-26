# tools/launcher —— 零门槛启动器

给完全没用过命令行的人用的入口。Windows 双击仓库根的 `启动.cmd`，macOS / Linux 跑 `./启动.sh`，
或者在任何地方 `npm run launch`。

## 它按顺序做什么

| 步骤 | 什么时候走 | 做什么 |
| --- | --- | --- |
| `check-node` | 总是 | 版本低于 22.5 就打印下载页并退出，不静默升级 |
| `install` | 缺 `node_modules` | `npm install` |
| `build` | 缺 `packages/web/dist` | `npm run build` |
| `serve` | 总是（且端口上还没有实例） | `node packages/server/src/bin/serve.ts` |
| `open` | 总是 | 等 `/api/health` 通了再开浏览器 |

**幂等**：已经装好的东西自动跳过。端口上已有一个实例在跑时，不再起第二个——打印
「已经有一个质询室在 8787 端口上跑着，直接打开浏览器」并 exit 0。

## 文件

| 文件 | 说明 |
| --- | --- |
| `src/plan.mjs` | **纯函数、零 IO**：版本解析与比较、该走哪几步、快捷方式脚本、三平台开浏览器、复用文案 |
| `launch.mjs` | 只碰文件与起进程 |
| `test/plan.test.mjs` | 12 条断言（`npx vitest run tools/launcher/test/plan.test.mjs`） |

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `CROSSEXAM_PORT` | 端口，默认 8787 |
| `CROSSEXAM_LAUNCH_NO_BROWSER=1` | 不起浏览器（自动化测试用） |
| `USERPROFILE` / `HOME` | 决定桌面快捷方式建到哪（测试里可以指向临时目录） |

## 两个坑

1. 快捷方式**没给图标就绝不写 `IconLocation`**——写空字符串会让桌面图标显示成一张白纸。
2. 判断「有没有人在跑」用当前进程的 `await fetch`，不要 `spawnSync(node -e fetch)`：
   Windows 上引号与转义一层套一层，稍微动一下就静默失败（findings F47）。

为什么不做成 exe：见 [ADR-0010](../../docs/adr/0010-zero-install-launcher.md)。
