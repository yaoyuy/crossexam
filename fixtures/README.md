# fixtures/ — 离线回放记录（卡带）

这里存放 LLM 调用的**记录**，文件名是提示词内容的指纹。

## 为什么要有这个目录

比赛硬要求「10 分钟极速复现」。评委的机器上不会有 API Key，也不该为了看一个
demo 去申请一个。所以 CrossExam 默认跑在 replay 模式：所有模型调用改从本目录
读取当初的响应，一次网络请求都不发。

指纹只由提示词内容决定，**不含模型名**——换模型不会让整盘卡带失效。

## 规则

- 文件名 = digestFor(request) = 提示词内容的 sha256 前 24 位
- 记录里含当时的 usage、purpose、model 与流式分片，供事后追溯
- 缺失记录时回放**绝不静默**：默认交给离线兜底合成、并在会话详情与报告里如实标注；
  设成 strict 则直接报错（两份实现见 packages/server/src/llm/replay.ts 与 synth-demo.ts）
- 用 CROSSEXAM_MODE=record 联网跑一次即可补录

## 这批卡带是怎么来的（重要）

目录里的卡带由 npm run seed:demo 生成，**是脚本合成的演示数据，不是任何真实模型
或真人的输出**。判别方式很简单：卡带里的 model 字段固定为 scripted-demo。

生成过程是：packages/server/src/llm/scripted-demo.ts 里写死一份演示剧本
（谁问什么、候选人怎么答、每条主张怎么判、建议怎么改），它会按真实提示词渲染出
回答，并按提示词指纹写进本目录；随后生成器立刻用只读回放客户端重跑一遍，
**两遍的结果签名必须逐字节相同，否则生成器退出码 1**。

两个必须知道的后果：

1. **改了提示词就必须重跑 npm run seed:demo。** 提示词换一个字，指纹就变，
   旧卡带全部失效：严格模式下会在那一阶段报「找不到记录」，
   默认兜底会合成一条并如实标注（见下一节）。
   packages/server/test/demo-cassette.test.ts 就是这条的自动门禁：
   它用**仓库里已提交的卡带**跑一遍完整沙盘，卡带一漂移它就红。
2. 卡带里的 usage 是**估算值**（按提示词与回答的字符数折半），不是计费数据。
   它足够让用量面板有东西可看，但不能拿来对账。

拿到真实 API Key 之后，可以用 CROSSEXAM_MODE=record 重新录一批真实卡带替换
这一批——替换后记得同步改掉这条说明，别让读者以为真实记录被冒充成了合成数据。

## 隐私红线（必须遵守）

**只允许用仓库里的示例简历录制卡带。**
真实个人简历产生的记录一律不得提交——简历属于个人隐私数据，
本项目的约定是「只落本地 SQLite，不上传任何第三方存储」，
把内容写进公开仓库等于把这条承诺作废。

## 卡带没录过时：离线兜底（CROSSEXAM_REPLAY_FALLBACK）

回放模式命中不到卡带、又没有显式关掉兜底时，服务端会**按提示词内容确定性地合成**这一条响应
（packages/server/src/llm/synth-demo.ts），而不是让整场沙盘断在中途。为什么要有它：
用户随手贴一份自己的简历是常态，「离线只能跑演示简历」这个限制不该由用户跑到一半才发现。

三条纪律：

1. **绝不静默**。合成条数与阶段会进 `GET /api/sessions/:id` 的 `synthetic` 字段
   （`{count, stages}`；没合成时 `count=0`、`stages=[]`），notices 里有一句话说明，
   报告 Markdown 开头插一段「本次运行的合成说明」。合成出的判定一律取最保守口径
   （判定恒为 unsupported）——它不是真实模型的判断，不能当成评价结论。
2. **可判别**。若显式设了 `CROSSEXAM_SYNTH_DIR`，合成卡带的 model 固定为 `scripted-synth`，
   与 `scripted-demo`、真实模型名都不一样。**默认不写盘**：用户简历的提示词会进卡带，
   写进仓库等于把上面那条隐私红线作废。
3. **逐字节确定**。同一份提示词永远合成出同一份响应（无时间戳、无随机数），所以它也能写进测试。

设 `CROSSEXAM_REPLAY_FALLBACK=strict` 恢复旧行为：缺卡带就报错。点测门禁用它，
避免「其实是合成的」被当成「卡带覆盖了」。要补录某一条，仍然用 `CROSSEXAM_MODE=record`。

## 开跑前先问一句：POST /api/preflight

请求体与 POST /api/sessions 一致（resumeText / jdText / jds / useDemo / interviewers / difficulty / style / mode），
返回 `{ mode, coverable, reason }`。它做的是**在内存里空跑一场**（不写库、不落卡带、不联网），
用与回放同一套 digestFor 算指纹——因为后面阶段的提示词含前面阶段的产出，只有真走一遍才算得准。
`coverable=false` 时 reason 会点名缺哪些阶段，并给人话出路（改用演示简历 / 配 API Key 走真实模型）。
界面按 `GET /api/health` 的 `preflight` 字段判断这台机器有没有这条预检。
