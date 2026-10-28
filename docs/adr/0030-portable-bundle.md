# ADR-0030：便携包是「自带运行时」，不是安装包

- 状态：已采纳（2026-10-28）
- 相关：ADR-0010（零安装启动器）、ADR-0028（桌面端是浏览器应用窗口）、ADR-0029（视觉令牌层）

## 背景

用户问：「有没有打包成安装包，别人安装之后就可以直接使用？」

当时的分发方式是 `git clone` + 双击 `启动.cmd`，前提是机器上已经有 Node ≥ 22.5.0（`package.json` 的 `engines.node`）。
在开发机上这不是问题，但评委或朋友的机器上大概率没有 Node——「十分钟复现」会在第一步就断掉，
而这恰好是本作品最想保住的东西。

三条路摆在那里：

1. **做 exe / msi 安装包**：需要 Inno Setup 或 electron-builder 这类要本地编译或要下载大包的工具链。
   这既打破 ADR-0028（桌面形态是浏览器应用窗口，不是原生壳），也撞上 AGENTS.md §6——引入需要本地编译的依赖是明确禁止的。
2. **做 Docker 镜像**：要求对方装 Docker。对「评审在 Windows 上点两下」这个场景，门槛比装 Node 还高。
3. **做「自带 node.exe 的 zip」**：不编译、不写注册表、不装服务、不改 PATH，卸载就是删文件夹。

## 决策

选第三种。`tools/portable/build.mjs` 生成
`dist/portable/crossexam-portable-<版本>-win-x64.zip`，里面是：

- `node/node.exe`——构建机上 `process.execPath` 的原样拷贝（本机 Node v24.14.0）；
- `packages/server/src` 与 `packages/shared/src`——TypeScript 源码，靠 Node 的原生类型剥离直接跑，不预编译；
- `packages/web/dist`——已构建好的前端；
- `fixtures/llm`——149 盘离线演示卡带（968 KB），所以**不需要 API Key**；
- `tools/launcher`——复用既有的零门槛启动器，不另写一套；
- `node_modules` 里只有四个运行时依赖：`@hono/node-server`、`hono`、`unpdf`、`zod`（依赖闭包实测就这四个，无传递依赖、无原生模块）；
- 生成的 `启动.cmd` 与 `使用说明.txt`（CRLF 换行）。

`启动.cmd` 只做三件事：挂上 `NODE_OPTIONS=--import ./tools/portable/register.mjs`、调 `node\node.exe tools\launcher\launch.mjs`、
关掉窗口就是停服务。服务仍是本机回环地址上的一个进程，界面仍是系统 Edge/Chrome 的 `--app=` 窗口。

## 为什么不把工作区包放进 node_modules

第一版图省事，把 `@crossexam/server`、`@crossexam/shared` 复制进包里 `node_modules`，结果服务端一启动就崩：

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING: Stripping types is currently unsupported for files
under node_modules, for ".../node_modules/@crossexam/shared/src/index.ts"
```

Node 的类型剥离**明确不处理 node_modules 下的文件**（防止有人把 TS 源码当发布包发出去）。仓库里能跑，是因为
npm workspaces 把 `packages/*` 软链进 node_modules、真实路径在 node_modules 之外；便携包里没有软链
（zip 不能可靠保存符号链接），一旦复制进去就踩到红线。

修法不是改包名也不是加 `NODE_PATH`（ESM 不认），而是用 `tools/portable/register.mjs` 注册一个解析钩子
（`registerHooks` + `shortCircuit`），把 `@crossexam/<pkg>/<rest>` 重写到 `packages/<pkg>/src/<rest>`——
路径仍在 node_modules 之外，类型剥离照常工作，包内目录也与仓库保持一致。细节见 findings F96。

## 代价与边界

- **只出 Windows x64**：`node.exe` 是构建机拷贝，跨平台要另出（同一份脚本改一个 `execPath` 即可，本轮没做）。
- **36.0 MB 里约 24 MB 是 node.exe 本身**，这是「免装 Node」的直接代价，换来的是零前置条件。
- **不做自动更新、不做代码签名、不写注册表、不装服务**；因此也不会有证书警告——它不是 exe。
- **zip 不进仓库**（`dist/` 已在 .gitignore 里）。需要时 `npm run portable:build` 现做；
  `npm run portable:verify` 会把 zip 解压到 `.tmp/` 用包里的 node 真启动一遍，八项验收。
- **与「十分钟复现」并存**：要证据链（提交历史、Prompt 链、门禁数字）就 clone 仓库走方式一；
  要让人试用就发 zip。两者不是替代关系，是两种读者。

## 验收（2026-10-28 实测）

- 产物 `crossexam-portable-0.1.0-win-x64.zip`，36.0 MB，
  sha256 `e6365d1971cb5a2f389871bd205383ebc7a19042d6b51c1e205a380759a8dbc6`。
- `npm run portable:verify` **8/8**：包里的 node 能独立运行（v24.14.0）→ 启动.cmd 起服务 → 同一端口打开界面 →
  历史仪表盘接口 → 一键示例建档 → 不带 API Key 跑完一场（走包里的卡带，71 656 字节事件流）→ 读回 5 条主张 → 报告可导出。
- 断言口径的一次修正：最初用 `/run?panel=tech` 找 `event: result`，实测那批卡带并没有录单面板，开发机上同样返回
  「回放模式找不到这一条记录」——这不是便携包的问题。改成默认面板（三位面试官）后 `event: result` 出现、claims 5、verdicts 5。
