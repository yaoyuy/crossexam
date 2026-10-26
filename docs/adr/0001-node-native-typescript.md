# ADR-0001 服务端不设构建步骤，直接用 Node 原生 TypeScript 运行

- 状态：已采纳
- 日期：2026-10-26
- 相关：提交物 #3「README 10 分钟极速复现指南」

## 背景

评分权重里有 25% 是「过程可复现性与演进链路」，提交物硬性要求一份 10 分钟极速复现指南。
任何需要「先 build 再 run」的环节都是复现失败的风险点：评委的 Node 版本、包管理器、
原生模块编译环境都和我们不同。

参照物 ResumeForge 用了 Python 后端 + Node 前端 + 桌面壳的多运行时结构，
复现门槛明显更高。我们不该重蹈覆辙。

## 决策

**服务端不加构建步骤**。整个后端以 `.ts` 源码形态直接被 Node 执行。

实测（Node v24.14.0）：

```
$ node .tmp/probe/b.ts
TS 直接运行 OK: {"start":0,"end":5}
```

其中 `b.ts` 通过 `import { makeAnchor } from './a.ts'` 导入另一个 TS 模块。
Node 24 的类型擦除默认开启，按真实文件扩展名解析，无需任何 loader。

配套约束：

1. 相对导入一律写 `.ts` 扩展名，tsconfig 开 `allowImportingTsExtensions`。
2. tsconfig 开 `erasableSyntaxOnly`，禁止 `enum` / `namespace` / 构造函数参数属性
   这类擦除不掉、Node 无法直接执行的语法。**由编译器强制，不靠自觉。**
3. 类型检查与构建解耦：`npm run typecheck` 是 `tsc --noEmit`，不产出任何文件；
   只有前端走 Vite 的真实构建。

## 后果

**收益**
- 复现步骤从「install → build → run」压到「install → run」，少一个失败环节。
- 改一行后端代码即刻生效，没有 watch/build 往返，8 小时高强度迭代下收益显著。
- 仓库里不存在 `dist/` 与源码不同步的问题，评审看到的代码就是运行的代码。

**代价**
- 生产部署要么依赖 Node 24+，要么在部署前补一次 `tsc` 产出。本项目是本地优先桌面级应用，
  不进生产环境，代价可接受。
- `erasableSyntaxOnly` 会禁掉一些惯用写法，需要团队习惯。以本项目体量，影响很小。

## 备选方案

- **tsx / ts-node**：可行，但引入额外依赖，且 tsx 对类型擦除的语义与 Node 原生不完全一致。
  评委多装一个包就多一个失败面。
- **tsc 全量构建到 dist/**：最保守，但把复现步骤拉长，且开发期需要 watch 进程。
  仅前端保留真正的构建。
