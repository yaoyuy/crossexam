# ADR-0003 前端独立成包、直播与历史共用一套折叠逻辑、单端口演示

- 状态：已采纳
- 日期：2026-10-26
- 相关：ADR-0001、ADR-0002、packages/web/、packages/server/src/http/static.ts

## 背景

省赛与国赛的评分权重里，用户体验与产品精细度占 15%，且赛题明文点名要「流式、思考可视化」。
同时提交物要求一份 10 分钟极速复现指南——评审大概率只跑一次，第一条命令就得看到完整产品。
两条要求叠在一起，前端不只是「画个页面」，它必须证明四件机制（证据锚定、追问预算、
意图契约、可复现回放）在用户眼前真的发生了。

## 决策

1. **前端独立成包** packages/web（Vite + React 19 + Tailwind v4），服务端零构建只跑 .ts（ADR-0001）。
2. **不把 @crossexam/shared 引进浏览器包**：shared 经由 util.ts 依赖 node:crypto，一旦被 Vite 打进
   浏览器产物就会直接崩。前端消费的是 JSON，所以线上契约在 packages/web/src/api.ts 重新声明。
   但**中文标签不抄**：判定与类别的标签通过子路径 `@crossexam/shared/domain.ts` 直接复用
   （domain.ts 零依赖，可被浏览器打包）；只有人设文案因为来自 contract.ts 不得不抄一份，
   由 packages/web/test/labels.test.ts 的漂移测试看守。
3. **直播与翻历史共用同一个纯函数折叠器**（packages/web/src/state.ts）：SSE 与事件表只是同一串
   事件的两种来源，界面不会出现「看着一样、其实两套逻辑」的偏差。
4. **不用 EventSource**：开跑一场质询是 POST，而 EventSource 只能发 GET。改用 fetch 读
   response.body 手写 SSE 解析（api.ts 的 parseSseBlock / readSseStream）。
5. **main.tsx 不包 StrictMode**：开跑是有副作用的 POST，同一会话只能跑一次；
   StrictMode 的双次挂载会发两次请求、第二次被 409 挡回。这条理由写在文件注释里。
6. **单端口演示**：服务端托管 packages/web/dist（@hono/node-server/serve-static），/api 前缀放行给
   接口，其余请求先找静态资源、找不到回退 index.html。npm run preview = build + start。

## 后果

**收益**

- 界面、报告、接口用同一套中文词，不会出现「报告里写站得住、界面上写可靠」。
- 历史会话与直播走同一条代码路径，回看老会话不需要第二套渲染逻辑，也不会两处各修一遍。
- 评审一条命令（npm run preview）打开 http://127.0.0.1:8787 就是完整产品，不必知道 5173 与 8787 的区别。
- 前端自带 31 条断言（文案漂移、字符区间切分、事件折叠），且被纳入统一门禁 npm run verify。

**代价**

- web 侧的类型是重声明的，字段增删要靠人同步；漂移测试只覆盖标签与人设，不覆盖全部字段。
- 前端无法复用 shared 里的锚定与预算逻辑（当前不需要，它只消费服务端算好的结果）。
- 前端有自己的 tsconfig，根配置要显式 exclude 掉 packages/web，否则根 tsc 会去解析 .tsx 而报错。

## 备选方案

- **把 shared 拆成 core（零依赖）与 node 两部分**：更干净，但会牵动 P1 已提交的包结构，
  收益只在「前端也要跑锚定算法」时才兑现；留待有真实需求时再做，先记为技术债。
- **前端也走 EventSource（GET 触发跑沙盘）**：省掉手写 SSE 解析，但把「开始质询」变成 GET，
  与 HTTP 语义相悖，也让浏览器预取/刷新可能重复触发一次真实跑批。
- **两个端口（Vite 5173 + 服务端 8787）**：开发期可以，但演示给评审时多一步、多一个失败点。
