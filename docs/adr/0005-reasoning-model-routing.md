# ADR-0005：思考模型按阶段路由，模型名不进卡带指纹

- 状态：已采纳（2026-10-26）
- 相关：ADR-0004（分片不进事件日志）、packages/server/src/llm/routing.ts、packages/server/src/llm/index.ts

## 背景

赛题的用户体验一项点名「流式、思考可视化」。但默认的 deepseek-chat 不吐思考内容（实测 reasoning 恒为 0 字符），
只有思考模型（如 deepseek-reasoner）才会给 `reasoning_content`。而一次会话要打 20–40 次模型调用：
追问是高频步骤（一轮就是面试官数量次调用），判定才是真正需要「权衡证据强弱」的环节。

## 决策

1. 新增 `llm/routing.ts` 的 `withStageModels(inner, routes)`：**装配层**按 `req.purpose` 换成思考模型，
   编排层的五个阶段一个字不改（它们只关心「问什么」，不关心「谁答」）。
2. `LlmRequest.model` 与 `channel` 同理，**刻意不参与卡带指纹**（cassette.ts 的 `shapeOf` 只看 system / messages / temperature / maxTokens / json）。
   所以已经录好的 29 盘演示卡带不必重录——换模型不会让素材失效。
3. 默认只把 **verdict** 交给思考模型（`CROSSEXAM_REASONING_STAGES` 可改），模型名由 `CROSSEXAM_REASONING_MODEL` 给；
   没配就完全不包装（返回原对象，测试用 `toBe` 断言这一点）。
4. 思考分片与正文分片走同一路 SSE 的 `event: stream`，用 `kind`（`reasoning` / `text`）区分；
   界面把它渲染成「斜体一行（思考）+ 正下方一行（正文）」，两者各走各的累积缓冲。
5. 离线演示也要看得见：合成脚本把 `reasoning` 写进卡带（同一个通道），
   因此没有 Key 的机器上「思考可视化」照样成立；卡带 `model` 字段固定为 `scripted-demo`，一眼可辨是合成内容。

## 理由

- 判定环节才需要「停下来想」：判据是责任在谁（简历的写法问题 vs 候选人答不上来），
  而追问要快（一轮并发多个面试官）。全交给思考模型会把一场从十几秒拉成几分钟。
- 换模型是**装配决策**，不是提示词内容。把模型写在请求上而不是提示词里，提示词保持逐字节确定，
  卡带指纹不失效，`npm run seed:demo` 的重跑结果也不受影响。
- 界面上的「思考」不是装饰：真实联网时它是模型的 `reasoning_content` 原文，离线时是脚本写的中文思考，
  两种情况都能在卡带/账本里查证来源（录制的卡带 `model` 字段记的是**真正用过的模型**）。

## 代价

- 思考文本通常是**英文**（实测 deepseek-reasoner 的回答是 “The user asks: …”），界面上会出现中英混排。
  这是模型侧行为；硬翻译会失真，所以只在文档与界面说明里讲清楚。
- 思考分片比正文更多：实测一场 2355 片思考 / 5814 片正文，SSE 流量与前端累积缓冲的压力都变大
  （缓冲上限 `STREAM_CAP = 1200` 字符，超了只留尾巴）。
- 只路由 verdict 意味着 extract / probe / suggest 仍然是快模型；想全流程思考就得改 `CROSSEXAM_REASONING_STAGES`，并接受耗时。

## 备选

- **全局换思考模型**：实现最简单，但一场调用数不变而每次调用都更慢更贵，追问环节尤其不划算。
- **把思考塞进正文 JSON**（让模型输出 `reasoning` 字段）：污染结构化输出，还与 `response_format: json_object` 打架。
- **思考单独走一路 SSE 事件类型**：前端要多一条分流分支，而 `kind` 已经能区分，没必要。