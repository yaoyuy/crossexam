# 你在 D:\CZB 仓库里工作（CrossExa

| 项 | 值 |
| --- | --- |
| 会话 ID | `cc1a84f4-a81e-4381-8b50-fb3a22d7a67b` |
| 工作目录 | `D:\CZB` |
| 模型 | aggregate / deepseek-v4-1-flash |
| 起始时间 | 2026-10-27 00:39:06 |
| 结束时间 | 2026-10-27 00:41:52 |
| 真人提问 | 1 次 |
| 事件总数 | 158 |
| Token | 输入 47976 / 输出 20288 / 缓存命中 812672 / 推理 9847 |

---

## Turn 1  <sub>2026-10-27 00:39:07</sub>

### 👤 用户提问

你在 D:\CZB 仓库里工作（CrossExam 质询室，Node 24 + TypeScript）。任务：为「岗位模板库」写一个数据文件。**只创建下面指定的那一个文件，不要改任何别的文件。**

## 先读这两份，照着它们的形状与文风写
- D:\CZB\packages\shared\src\templates\types.ts —— JobTemplate 接口与 TEMPLATE_LIMITS（硬约束都在里面）
- D:\CZB\packages\shared\src\templates\part1.ts —— 已完成的样例，9 条，照它的写法

## 你要产出的文件
路径：D:\CZB\packages\shared\src\templates\part4.ts
内容：`import type { JobTemplate } from './types.ts';` + `export const PART4: JobTemplate[] = [ ... ];`
共 9 条 = 3 个行业 × 每个行业 3 个岗位。行业是：行政文秘 / 法律合规 / 计算机软件。

## 每条模板的字段与硬约束
- id：小写字母/数字/短横线，形如 hr-recruiter；全局唯一
- industry：上面三个行业名之一（逐字相同）
- title：具体岗位名（可带括号补充，如「成本会计（制造业）」）
- jd：**180–260 字**的原创 JD。写清职责 + 硬性要求 + 加分项；不抄任何招聘网站原文；不得出现真实企业名、平台名（BOSS/智联/前程无忧）、链接
- resume：**200–340 字**的该岗位示例简历。要像真人写的：姓名 + 学历 + 时间 + 职责 + 成果数字 + 自我评价。**必须刻意留 2–3 处经不起追问的模糊表述**（例如「下降明显」「深受喜爱」「参与多起」「排名前三」），质询才有东西可问
- hints：2–3 条，每条 8–60 字，写「这类简历常见的坑 + 该问什么」，不要写成通用废话
- presets：正好 2 位内置面试官 id，只能从这五个里选：tech / hr / hiring_manager / stress / domain_expert（可重复组合，但同一条里不能重复）
- custom：一位该行业自建面试官的草稿（InterviewerDraft），字段为 name（1–24 字）、domain（≤40 字）、seniority（junior|mid|senior|principal）、tone（neutral|skeptical|warm|blunt）、blurb（4–60 字）、goal（8–200 字）、tactics（2–5 条，每条 4–120 字）。goal 与 tactics 要写具体的追问动作，不要写「考察综合能力」这种空话

## 文风要求（这一点决定质量）
- 全中文，用「」而不是引号，用全角标点
- 严肃、具体、可验证。不写营销腔，不写感叹号
- 数字要具体（日均审核处方三百余张 / 一次修复率 92%），但都写成示例简历里的说法，不声称真实

## 自检（必须做，做完再回话）
写一个临时脚本 D:\CZB\.tmp\check-PART4.mjs：读入你的文件、逐条打印 JD 字数/简历字数/提示条数/tactics 条数，并对超出范围的项打印 FAIL。
跑法：`node .tmp/check-PART4.mjs`（Node 24 可以直接 import .ts）。
把 FAIL 全部改到 0，然后删掉这个临时脚本。

## 回话
只回三行：文件路径、9 条 id 的列表、自检结论（各字段实测范围）。不要贴文件内容。
Your parent agent id is "session-9791af4a-18f0-4e22-86e6-5dbe200db248". Before you finish, send your result to that agent with send_message({ agent_id: "session-9791af4a-18f0-4e22-86e6-5dbe200db248", message: "<self-contained result>" }). The parent shares your workspace but does not automatically receive your transcript, tool output, or reasoning. Send earlier messages as well when a finding changes what the parent should do next; sending a message does not end your turn.

### 🤖 AI 回复

I'll start by reading the reference files to understand the exact shape and style required.

**🔧 `run_code`** <sub>00:39:14</sub>

- 说明：Read template types and part1 sample
- 代码：
```js
const [types, part1] = await Promise.all([
  tools.read({ file_path: "D:\\CZB\\packages\\shared\\src\\templates\\types.ts" }),
  tools.read({ file_path: "D:\\CZB\\packages\\shared\\src\\templates\\part1.ts" }),
]);
console.log("=== types.ts (" + types.totalLines + " lines) ===");
console.log(types.lines.map(l => l.number + "|" + l.text).join("\n"));
console.log("\n=== part1.ts (" + part1.totalLines + " lines) ===");
console.log(part1.lines.map(l => l.number + "|" + l.text).join("\n"));
```

<details><summary>本次调用内部实际执行了 2 个子操作</summary>

- `read` — 路径：D:\CZB\packages\shared\src\templates\types.ts
- `read` — 路径：D:\CZB\packages\shared\src\templates\part1.ts

</details>

<details><summary>✅ 执行结果（原始 10877 字符，已折叠）</summary>

```text
=== types.ts (46 lines) ===
1|/**
2| * 岗位模板的形状（P9 行业模板库）。
3| *
4| * 只放「一个岗位要能被一键喂进去」所必需的东西：岗位名、JD、示例简历、
5| * 这类简历常见的坑、以及推荐的面试官组合。刻意不放任何渲染信息——
6| * 界面怎么画是前端的事，模板只负责内容。
7| *
8| * 示例简历里都刻意留了两三处经不起细问的表述（「下降明显」「深受喜爱」这类），
9| * 这样一键填充之后立刻能跑出有内容的质询，而不是一片「站得住」。
10| */
11|import type { InterviewerRole } from '../domain.ts';
12|import type { InterviewerDraft } from '../interviewer.ts';
13|
14|export interface JobTemplate {
15|  /** 稳定 id，形如 med-pharmacy-lead；示例简历与面试官草稿的指纹都挂在它上面 */
16|  id: string;
17|  /** 12 个行业之一，界面上按它分组 */
18|  industry: string;
19|  /** 岗位名，填进投料台的「目标岗位」 */
20|  title: string;
21|  /** 原创 JD，180–260 字 */
22|  jd: string;
23|  /** 该岗位的示例简历，200–340 字，含可被追问的模糊表述 */
24|  resume: string;
25|  /** 这类简历常见的坑，2–3 条，界面在模板旁边摊出来 */
26|  hints: string[];
27|  /** 推荐的两位内置面试官 */
28|  presets: InterviewerRole[];
29|  /** 为该行业现配的一位自建面试官草稿（与预设共用同一套契约结构） */
30|  custom: InterviewerDraft;
31|}
32|
33|/** 字数与结构红线。测试与运行时共用同一份，避免文档写一套、断言写另一套。 */
34|export const TEMPLATE_LIMITS = {
35|  jdMin: 180,
36|  jdMax: 260,
37|  resumeMin: 200,
38|  resumeMax: 340,
39|  hintsMin: 2,
40|  hintsMax: 3,
41|  hintMin: 8,
42|  hintMax: 60,
43|  presetsCount: 2,
44|  industryCount: 12,
45|  perIndustry: 3,
46|}
…（此处省略 9677 字符，原始长度 10877）
```

</details>


<details><summary>🧠 思考过程</summary>

I need to check the InterviewerDraft type in the interviewer module.

</details>

### 🤖 AI 回复

Now let me read the `InterviewerDraft` contract and check the existing directory structure.

**🔧 `run_code`** <sub>00:39:17</sub>

- 说明：Read InterviewerDraft and InterviewerRole contracts
- 代码：
```js
const [iv, domain, files] = await Promise.all([
  tools.read({ file_path: "D:\\CZB\\packages\\shared\\src\\interviewer.ts" }),
  tools.read({ file_path: "D:\\CZB\\packages\\shared\\src\\domain.ts" }),
  tools.glob({ pattern: "packages/shared/src/templates/*" }),
]);
console.log("=== templates dir ===");
console.log(JSON.stringify(files.paths, null, 1));
console.log("\n=== interviewer.ts ===");
console.log(iv.lines.map(l => l.number + "|" + l.text).join("\n"));
console.log("\n=== domain.ts ===");
console.log(domain.lines.map(l => l.number + "|" + l.text).join("\n"));
```

<details><summary>本次调用内部实际执行了 3 个子操作</summary>

- `read` — 路径：D:\CZB\packages\shared\src\interviewer.ts
- `read` — 路径：D:\CZB\packages\shared\src\domain.ts
- `glob` — 模式：packages/shared/src/templates/*

</details>

<details><summary>✅ 执行结果（原始 15101 字符，已折叠）</summary>

```text
=== templates dir ===
[
 "packages\\shared\\src\\templates\\part1.ts",
 "packages\\shared\\src\\templates\\types.ts"
]

=== interviewer.ts ===
1|/**
2| * 自定义面试官（P7 第 4 项）。
3| *
4| * 用户的原话是「不能只有技术面试官，要能在页面里自己设置面试官，并通过 API 对自己设置的
5| * 面试官契约进行优化，要求所有专业的人都能用」。这三件事在实现上是三件事：
6| *
7| * 1. 页面里自己设置：自定义面试官也要走 IntentContract，不能退化成一坨自由文本。
8| *    它和五位内置面试官共用同一套渲染、同一套指纹、同一套约束。
9| * 2. 用 API 优化契约：用户写一句人话（「我要面市场营销，简历里全是策划过活动」），
10| *    由模型把它补成结构化契约。模型给的字段一律过 zod，过不了就退回本地规则。
11| * 3. 所有专业都能用：提示词与本地兜底都**不假设候选人是程序员**。
12| *    本地兜底见 localDraftFromText，它是纯规则、可离线、可测试的，不是随便凑三句话。
13| *
14| * 领域无关是这条链路里最容易做砸的地方：一份「技术面试官」的提示词在会计岗上会问出
15| * 「这个税务筹划的架构是怎样的」这种废话。所以本文件里的手法模板按**简历里出现的措辞**触发，
16| * 而不是按行业硬编码。
17| */
18|
19|import { z } from 'zod';
20|import type { Persona } from './domain.ts';
21|import {
22|  COMMON_CONSTRAINTS,
23|  COMMON_FORBIDDEN,
24|  type ContractBudgetView,
25|  type IntentContract,
26|} from './contract.ts';
27|import { shortHash, stableStringify } from './util.ts';
28|
29|export const SENIORITY_VALUES = ['junior', 'mid', 'senior', 'principal'] as const;
30|export const TONE_VALUES = ['neutral', 'skeptical', 'warm', 'blunt'] as const;
31|
32|/**
33| * 模型优化契约时的输出形状。字段偏窄是故意的：
34| * 契约要能
…（此处省略 13901 字符，原始长度 15101）
```

</details>


<details><summary>🧠 思考过程</summary>

Now I understand the shapes. Let me plan the 9 entries:

Industries: 行政文秘 / 法律合规 / 计算机软件

行政文秘 (administrative/secretarial):
1. `adm-executive-assistant` — 总经理助理
2. `adm-office-admin` — 行政专员（办公事务）
3. `adm-document-archivist` — 档案管理员 / 文书档案专员

法律合规 (legal & compliance):
4. `law-legal-counsel` — 企业法务专员
5. `law-compliance-officer` — 合规专员（反商业贿赂）
6. `law-contract-reviewer` — 合同审核专员 / 知识产权专员

计算机软件 (computer software):
7. `sw-frontend-engineer` — 前端开发工程师
8. `sw-backend-engineer` — 后端开发工程师（Java/Node）
9. `sw-qa-engineer` — 软件测试工程师

Wait, need to double check industry names: 行政文秘 / 法律合规 / 计算机软件. Note DOMAIN_ALIASES has '法律与合规' and '软件研发' but the task says to use these exact three industry names verbatim. Fine.

id format: lowercase letters/digits/hyphens, globally unique. Existing ones in part1: med-*, edu-*, fin-*. So mine: adm-*, law-*, sw-* should be fine.

Now, character counting: 字数 is Chinese characters. I need jd 180–260 字, resume 200–340 字, hint 8–60 字, tactics 4–120 字, goal 8–200 字, blurb 4–60 字, name 1–24 字, domain ≤40 字.

Question: what counts as 字数? Let me check the test file to see how they count. There's a reference to `packages/shared/test/templates.test.ts`. Let me check if it exists. The glob showed only part1.ts and types.ts in templates dir. Let me look for the test file to know the exact counting function. Also check if there's an index.ts referencing parts. But the task says only create part4.ts.

Let me check the test file for the counting method — important for accurate self-check. Let me glob.

Actually, I should be careful: the task says "只创建下面指定的那一个文件，不要改任何别的文件". Reading is fine. Let me search for templates.test.ts and any counting helper.

Let me do that, then write the file.

Note: I need to count 字数 the way the test does. Let me find it.

Also note part1's entries: jd around 180-260. Let me count one to calibrate: e.g. the med-pharmacy-lead jd. I'll compute in the script.

Let me first check for the test and any index that aggregates parts.

Also, the task says hints 2-3 each 8-60 字; presets exactly 2 from the five, no repeats within one entry. Custom: name 1-24, domain ≤40, seniority, tone, blurb 4-60, goal 8-200, tactics 2-5 each 4-120.

Style: 「」 instead of quotes, full-width punctuation.

Now let me write content. I need to be careful about character counts. Let me plan to write the file and then iterate with the check script.

Let me think about whether to count 字数 as JS string length (code units) or something else. Chinese chars are 1 code unit each (BMP). Full-width punctuation also 1. The likely test counts [...str].length or str.length. Let me find the test.

Let me search.

</details>

### 🤖 AI 回复

Now let me find how the test counts 字数, so my self-check matches the real assertion.

**🔧 `run_code`** <sub>00:39:29</sub>

- 说明：Locate template test and char-counting logic
- 代码：
```js
const [g1, g2] = await Promise.all([
  tools.glob({ pattern: "packages/shared/test/*" }),
  tools.grep({ pattern: "TEMPLATE_LIMITS|jdMin|resumeMin|countChars|字数", path: "D:\\CZB\\packages" }),
]);
console.log("test files:", JSON.stringify(g1.paths, null, 1));
console.log("\nmatches:");
for (const m of g2.matches) console.log(m.path + ":" + m.lineNumber + "| " + m.line);
```

<details><summary>本次调用内部实际执行了 2 个子操作</summary>

- `glob` — 模式：packages/shared/test/*
- `grep` — 路径：D:\CZB\packages · 模式：TEMPLATE_LIMITS|jdMin|resumeMin|countChars|字数

</details>

<details><summary>✅ 执行结果（原始 3098 字符，已折叠）</summary>

```text
test files: [
 "packages\\shared\\test\\anchor.test.ts",
 "packages\\shared\\test\\segment.test.ts",
 "packages\\shared\\test\\contract.test.ts",
 "packages\\shared\\test\\budget.test.ts",
 "packages\\shared\\test\\schemas.test.ts",
 "packages\\shared\\test\\interviewer.test.ts",
 "packages\\shared\\test\\revise.test.ts"
]

matches:
packages\server\test\http.test.ts:498|   it('文本简历走同一条路，导入的字数与正文一致', async () => {
packages\shared\src\templates.ts:11| import { TEMPLATE_LIMITS } from './templates/types.ts';
packages\shared\src\templates.ts:18| export { TEMPLATE_LIMITS } from './templates/types.ts';
packages\shared\src\templates.ts:55|     if (jd < TEMPLATE_LIMITS.jdMin || jd > TEMPLATE_LIMITS.jdMax) {
packages\shared\src\templates.ts:56|       problems.push(at + '：JD ' + String(jd) + ' 字，应在 ' + String(TEMPLATE_LIMITS.jdMin) + '–' + String(TEMPLATE_LIMITS.jdMax) + ' 字之间');
packages\shared\src\templates.ts:59|     if (resume < TEMPLATE_LIMITS.resumeMin || resume > TEMPLATE_LIMITS.resumeMax) {
packages\shared\src\templates.ts:60|       problems.push(at + '：示例简历 ' + String(resume) + ' 字，应在 ' + String(TEMPLATE_LIMITS.resumeMin) + '–' + String(TEMPLATE_LIMITS.resumeMax) + ' 字之间');
packages\
…（此处省略 1898 字符，原始长度 3098）
```

</details>


<details><summary>🧠 思考过程</summary>

There's a `packages/shared/src/templates.ts` validator. Let me read it to see how `jd` char count is computed (the `at` function / counting function).

</details>

### 🤖 AI 回复

There's a runtime validator at `packages/shared/src/templates.ts`. Let me read it — it defines the exact counting.

**🔧 `run_code`** <sub>00:39:34</sub>

- 说明：Read template validator source
- 代码：
```js
const v = await tools.read({ file_path: "D:\\CZB\\packages\\shared\\src\\templates.ts" });
console.log(v.lines.map(l => l.number + "|" + l.text).join("\n"));
```

<details><summary>本次调用内部实际执行了 1 个子操作</summary>

- `read` — 路径：D:\CZB\packages\shared\src\templates.ts

</details>

<details><summary>✅ 执行结果（原始 4319 字符，已折叠）</summary>

```text
1|/**
2| * 岗位模板库（P9）。
3| *
4| * 12 个行业 × 3 个岗位 = 36 条，全部原创。分四个文件放是为了让每一组的
5| * 文案能被人一次读完，而不是塞进一个两千行的巨型常量。
6| *
7| * 这里不做「模板 → 界面」的加工：服务端把模板原样交给前端（含自定义面试官草稿），
8| * 界面上点一下就把 JD、示例简历、面试官组合三处一起填好。
9| */
10|import type { JobTemplate } from './templates/types.ts';
11|import { TEMPLATE_LIMITS } from './templates/types.ts';
12|import { PART1 } from './templates/part1.ts';
13|import { PART2 } from './templates/part2.ts';
14|import { PART3 } from './templates/part3.ts';
15|import { PART4 } from './templates/part4.ts';
16|import { stableStringify, shortHash } from './util.ts';
17|
18|export { TEMPLATE_LIMITS } from './templates/types.ts';
19|export type { JobTemplate } from './templates/types.ts';
20|
21|export const JOB_TEMPLATES: readonly JobTemplate[] = [...PART1, ...PART2, ...PART3, ...PART4];
22|
23|/** 行业顺序 = 数据里的出现顺序，界面按它分组，不另排 */
24|export const TEMPLATE_INDUSTRIES: readonly string[] = JOB_TEMPLATES.reduce<string[]>((acc, item) => {
25|  if (!acc.includes(item.industry)) acc.push(item.industry);
26|  return acc;
27|}, []);
28|
29|export function templateById(id: string): JobTemplate | null {
30|  return JOB_TEMPLATES.find((item) => item.id === id) ?? null;
31|}
32|
33|export function 
…（此处省略 3119 字符，原始长度 4319）
```

</details>


<details><summary>🧠 思考过程</summary>

The validator uses `.trim().length` — JS string length (code units). Also forbids 有限公司 etc. in jd+resume. So I must avoid "有限公司" in resume JD. Note part1 uses "某制造企业", "某医疗设备公司" — good, no 有限公司.

Also `custom` isn't validated by templateProblems, but the task requires it match InterviewerDraft fields. The actual integration might validate custom via zod. I'll ensure the draft passes interviewerDraftSchema too.

Note: templates.ts imports PART2 and PART3 which don't exist yet — so I can't import templates.ts in my check script (it would fail to resolve part2/part3). I'll write my own standalone validation in the check script mirroring the constraints, OR import types.ts only. types.ts imports '../domain.ts' and '../interviewer.ts' — interviewer.ts imports zod and contract.ts. That should work if deps installed. But simpler: import only my part4.ts and validate directly with my own rules (mirroring). Actually importing part4.ts requires types.ts → interviewer.ts → zod. That's fine if node_modules present. But `import type` is erased, so importing part4.ts only loads types.ts (which imports type-only from domain/interviewer — both `import type`, erased). Wait types.ts has `import type { InterviewerRole }` and `import type { InterviewerDraft }` — both type-only, erased at runtime. And it exports TEMPLATE_LIMITS (a value). So part4.ts → types.ts → no runtime deps. 

But Node 24 running .ts natively: it strips types. Fine.

To be safest and fastest, I can import part4.ts and TEMPLATE_LIMITS from types.ts in my check script.

Now the counting: I'll use `.trim().length`.

Now let me draft the 9 entries with careful length control. This is the hard part. Let me write the content and then measure and adjust.

Let me think about approximate lengths. Chinese: each char = 1. JD 180-260 is a decent paragraph, similar to part1's (~200 chars). Let me aim ~200-230.

Let me now write the 9 entries.

### 行政文秘

**1. adm-executive-assistant — 总经理助理**

jd (aim ~215): 
「协助总经理处理日常经营事务，负责日程安排、会议组织与决议事项的跟踪督办；起草经营报告、会议纪要与对外函件，整理会议材料并归档；对接各部门推进跨部门事项，汇总经营数据并形成周报；负责来访接待与商务活动的后勤安排；要求中文、行政管理或相关专业本科及以上，三年以上总助或行政主管经验，文字功底扎实，熟练使用办公软件；有董秘或大型会议组织经验者优先。」

Count roughly: let me count later in script. This looks ~200.

resume (aim ~260-300):
「林静，汉语言文学本科，2019 年至 2024 年在某民营制造企业任总经理助理。负责总经理日程与会议安排，年均组织经营会议 60 余场，整理会议纪要并跟踪 300 余项决议事项；起草年度经营报告与对外函件，其中两份报告获管理层采纳；统筹年会与客户答谢会各两次，来宾百余人，现场衔接顺畅，深受好评；负责跨部门事项协调，推动多项流程落地；工作细致，抗压能力强，保密意识好。」

Hmm "深受好评" is a vague phrase — good. Need 2-3 vague phrases: 「深受好评」「推动多项流程落地」(vague ownership), 「现场衔接顺畅」. Good.

hints: 2-3, each 8-60:
- 「会议纪要跟踪决议」要问清 300 余项是怎么统计的、闭环率多少 (about 30 chars)
- 「获管理层采纳」要问是哪两份、采纳后改了什么
- 「深受好评」必须要求一个具体场景与反馈来源

presets: ['hr', 'hiring_manager']

custom: 行政人事面试官? Let me name 「总助岗位面试官」. name 1-24 ok. domain '行政与文秘' (≤40). seniority 'senior', tone 'skeptical'. blurb 4-60: 「在民企做过八年总助，只看纪要与督办台账」. goal 8-200: 「核对候选人在会议组织、纪要撰写与决议督办中的实际权限，区分真正的总助与只会订票订会议室的人。」tactics 2-5, each 4-120:
- 「请候选人挑一次经营会议，讲清会前材料收集、会中记录、会后督办各自做了什么。」
- 「追问决议事项的统计口径：谁登记、怎么判定办结、没办结的怎么催。」
- 「对『深受好评』要求给出具体反馈人、反馈场景与反馈原话的大意。」

**2. adm-office-admin — 行政专员（办公事务）**

jd:
「负责公司办公区域的日常行政事务，包括办公用品采购与库存管理、固定资产登记与盘点、快递与车辆调度；负责公司证照年检、工商变更与印章使用的流程办理与台账登记；组织员工活动与节日福利发放，协助新员工入职的后勤安排；负责办公环境与消防安全的日常检查；要求行政管理或相关专业大专及以上，两年以上行政经验，做事有条理，沟通协调能力强；有证照办理或固定资产管理经验者优先。」

resume:
「方晓琳，行政管理大专，2021 年起在某互联网公司任行政专员。负责 300 余人办公区的日常事务，月均处理采购与报销单据 150 余份；建立固定资产台账，覆盖办公设备 800 余件，年度盘点差错率为零；办理营业执照变更与两项资质年检，均在期限内完成；组织员工活动 12 场，参与人数累计 600 余人次，反响热烈；性格开朗，服务意识强，能同时跟进多项事务。」

vague: 「反响热烈」「沟通协调能力强」— wait that's in jd. In resume: 「反响热烈」「均未超期」 hmm. Let me include 「反响热烈」 and 「能同时跟进多项事务」. Also "差错率为零" needs 口径. Good — 3 vague: 反响热烈, 差错率为零, 服务意识强.

hints:
- 「差错率为零」要问盘点范围与谁复核
- 组织活动的「反响热烈」要问反馈怎么收集的
- 证照办理要问本人跑了哪几步、卡在哪

presets: ['hr', 'stress']
custom: name 「行政主管面试官」, domain '行政与文秘', seniority 'mid', tone 'blunt', blurb 「管过园区行政，先问台账再问性格」, goal 「核实候选人对固定资产、证照与采购流程的实际操作，排除只做接待与发福利的行政。」, tactics...

**3. adm-document-archivist — 文书档案管理员**

jd:
「负责公司文书、合同与项目资料的收集、整理、立卷与归档，执行档案分类方案与保管期限规定；负责档案的借阅登记、调阅跟踪与归还核对，定期开展库房温湿度与防火防虫检查；参与档案数字化扫描与目录著录，配合内外部检查提供档案材料；负责涉密文件的保管与销毁流程；要求档案学、图书情报或文秘相关专业大专及以上，两年以上档案管理经验，熟悉档案管理规范；有数字化项目经验者优先。」

resume:
「许文博，档案学大专，2020 年至 2024 年在某国有企业综合部任档案管理员。负责公司 12 个门类的文书档案管理，现存档案 1.8 万卷；年均办理借阅 400 余次，未见遗失；参与档案数字化项目，完成扫描 6 万页并著录目录；修订档案分类方案与保管期限表，通过上级单位检查；组织库房安全检查，多年无事故；严谨细致，保密意识强，参与多起档案专项整理。」

vague: 「未见遗失」「多年无事故」「参与多起档案专项整理」. Good.

hints:
- 「参与多起专项整理」要问本人在哪一次里独立负责什么
- 「1.8 万卷」要问统计口径与是否含未整理件
- 「多年无事故」要问检查频次与发现问题怎么处理

presets: ['domain_expert', 'hr']
custom: name 「档案管理面试官」, domain '档案与文秘', seniority 'senior', tone 'neutral' ...

### 法律合规

**4. law-legal-counsel — 企业法务专员**

jd:
「负责公司日常合同的起草、审核与修订，出具法律意见并提示履约风险；处理合同纠纷、劳动争议与知识产权维权等诉讼与非诉事务，对接外部律师；参与公司规章制度的合规审查，开展法律培训与风险排查；负责诉讼案件的材料准备、进度跟踪与结案归档；要求法学专业本科及以上，通过法律职业资格考试，两年以上法务或律所经验，文字与沟通能力扎实；有制造业或互联网行业经验者优先。」

resume:
「沈亦舟，法学本科，已通过法律职业资格考试，2021 年至 2024 年在某科技公司任法务专员。年均审核合同 600 余份，覆盖采购、销售与技术服务；处理合同纠纷与劳动争议案件 20 余起，其中一起标的 180 万元的货款纠纷通过调解结案，回款比例较高；参与修订公司合同管理办法与保密制度；开展法律培训 8 场，覆盖员工 400 余人次；逻辑清晰，抗压能力强，能独立对接外部律师。」

vague: 「回款比例较高」「参与多起」→ I wrote 20 余起 (concrete). Let me make vague: 「回款比例较高」, 「独立对接外部律师」 hmm not vague. Better: 「回款比例较高」and 「其中一起……调解结案，效果良好」. Let me use 「回款比例较高」 and 「深得业务部门信任」. Yes add that.

hints:
- 「回款比例较高」要问具体金额与执行到位的部分
- 「20 余起」要区分本人主办与协助、胜诉与和解
- 制度修订要问本人执笔了哪几条

presets: ['domain_expert', 'stress']
custom: name 「法务面试官」, domain '法律与合规', seniority 'senior', tone 'skeptical'...

**5. law-compliance-officer — 合规专员（反商业贿赂）**

jd:
「负责公司合规体系的日常运行，开展反商业贿赂、反垄断与数据合规的风险识别与排查；审核业务合同与营销活动中的合规条款，出具合规意见；组织合规培训与考试，维护合规举报渠道并参与调查；跟踪法规更新，输出合规提示与整改方案；配合监管检查与内部审计提供材料；要求法学、审计或相关专业本科及以上，两年以上合规、内审或律所经验，熟悉反不正当竞争法与相关监管要求；有第三方管理或尽调经验者优先。」

resume:
「崔明月，法学本科，2022 年起在某医药企业任合规专员。负责销售费用与学术推广活动的合规审核，年均审核 500 余项；参与修订反商业贿赂合规手册与第三方尽调流程，覆盖经销商 300 余家；组织合规培训 15 场，覆盖员工 1200 人次；参与处理举报线索 6 条，均按流程完成调查；跟踪并输出法规提示 20 余份；原则性强，沟通方式灵活，深受业务部门认可。」

vague: 「深受业务部门认可」「均按流程完成调查」 (vague outcome), 「覆盖经销商 300 余家」ok. Add 「处理举报线索 6 条，均按流程完成调查」—vague enough.

hints:
- 「均按流程完成调查」要问结论是什么、有没有移交
- 「覆盖 300 余家经销商」要问尽调谁执行、抽查比例
- 「深受业务部门认可」要问一次被业务投诉或施压的经历

presets: ['domain_expert', 'hiring_manager']
custom: name 「合规面试官」, domain '法律与合规', seniority 'senior', tone 'blunt'...

**6. law-contract-specialist — 合同管理专员** or 知识产权专员. Let's do 「合同审核专员」. Hmm, part1 didn't have a contract role. Let me do 「知识产权专员」 for variety and domain_expert. Actually the industry is 法律合规 — 知识产权专员 fits. But 合同审核 is more core. Let me do 「法务助理（合同管理方向）」? Title should be 具体岗位名. I'll go with 「合同管理专员」.

jd:
「负责公司各类合同的初审与台账管理，核对主体资质、条款完整性与金额一致性，出具初审意见并流转审批；负责合同用印、归档与履约节点的跟踪提醒，处理合同变更、续签与解除的流程办理；维护合同模板库，参与格式条款的更新与优化；配合法务处理合同争议的前期材料准备；要求法学或相关专业大专及以上，两年以上合同管理经验，熟悉合同法基本规则与电子签章系统；有合同管理系统上线经验者优先。」

resume:
「罗晨，法学大专，2021 年起在某工程企业任合同管理专员。负责工程与采购合同的初审与归档，年均处理合同 900 余份，台账准确率高；推动公司合同管理系统上线，完成 3 年历史合同的数据迁移与补录；建立履约节点提醒机制，逾期未回款合同明显减少；参与修订 6 类标准合同模板；工作耐心，注重细节，善于与业务部门沟通，多次获得部门表扬。」

vague: 「台账准确率高」「明显减少」「多次获得部门表扬」. 

hints:
- 「明显减少」要问改善前后的数字与统计周期
- 「900 余份初审」要问哪些是实质审核、哪些只走过场
- 「系统上线」要问本人负责哪一段、谁做需求

presets: ['domain_expert', 'hr']
custom: name 「合同管理面试官」, domain '法律与合规', seniority 'mid', tone 'neutral'...

### 计算机软件

**7. sw-frontend-engineer — 前端开发工程师**

jd:
「负责公司 Web 端与移动端 H5 的功能开发与迭代，与产品、设计、后端协作完成需求交付；负责页面性能优化与兼容性处理，参与前端工程化建设，维护组件库与构建流程；参与需求评审与技术方案设计，编写必要的技术文档；关注线上问题，参与故障排查与修复；要求计算机相关专业本科及以上，三年以上前端开发经验，熟练掌握 JavaScript、TypeScript 与主流框架，熟悉浏览器渲染与网络原理；有跨端或组件库建设经验者优先。」

resume:
「高子航，计算机科学与技术本科，2021 年至 2024 年在某互联网公司任前端开发工程师，负责电商后台管理系统的迭代。主导订单与商品模块重构，首屏加载时间从 2.8 秒降到 1.2 秒；封装通用图表与表单组件 20 余个，被三个业务线复用；参与性能专项，页面白屏率下降明显；修复线上问题 60 余个；熟悉 Vue 与 React，代码规范良好，沟通顺畅，深受团队喜爱。」

vague: 「下降明显」「深受团队喜爱」「被三个业务线复用」(ok concrete). Use 下降明显 + 深受团队喜爱 + 「参与性能专项」ownership vague.

hints:
- 「首屏从 2.8 秒降到 1.2 秒」要问测量环境与指标口径
- 「白屏率下降明显」要问具体数字与归因方式
- 「组件被三条业务线复用」要问使用方是谁、怎么维护的

presets: ['tech', 'hiring_manager']
custom: name 「前端面试官」, domain '软件研发', seniority 'senior', tone 'skeptical'...

**8. sw-backend-engineer — 后端开发工程师**

jd:
「负责公司核心业务系统的后端设计与开发，承担接口设计、数据建模与服务治理工作；参与系统架构演进，处理高并发场景下的性能瓶颈与稳定性问题；编写单元测试与技术文档，参与代码评审；负责线上服务的监控、告警与故障处理，参与值班；要求计算机相关专业本科及以上，三年以上后端开发经验，熟练掌握 Java 或 Go，熟悉关系型数据库、缓存与消息队列；有分布式系统或高并发项目经验者优先。」

resume:
「邓志远，软件工程本科，2020 年至 2024 年在某电商公司任后端开发工程师，负责交易与库存服务。主导库存扣减链路优化，接口平均响应时间从 180 毫秒降到 60 毫秒，支撑日均订单 30 万单；引入缓存与消息队列，数据库压力明显缓解；参与服务拆分，独立完成两个模块的迁移；修复线上故障 30 余起，全年值班无重大事故；技术基础扎实，抗压能力强，能带新人。」

vague: 「数据库压力明显缓解」「无重大事故」「技术基础扎实」.

hints:
- 「降到 60 毫秒」要问压测条件与统计口径
- 「30 万单」要问系统峰值与实际承载
- 「无重大事故」要问什么算重大、有没有漏报

presets: ['tech', 'stress']
custom: name 「后端面试官」, domain '软件研发', seniority 'senior', tone 'blunt'...

**9. sw-qa-engineer — 软件测试工程师**

jd:
「负责公司业务系统的功能测试与回归测试，编写测试用例并执行，跟踪缺陷闭环；参与需求评审，输出测试方案与测试报告；负责接口自动化与 UI 自动化脚本的编写与维护，参与持续集成流程；开展性能与兼容性测试，配合开发定位线上问题；要求计算机相关专业大专及以上，两年以上测试经验，熟悉测试流程与常用工具，能编写简单的 SQL 与脚本；有自动化框架搭建经验者优先。」

resume:
「唐雪，计算机应用技术大专，2021 年起在某软件公司任测试工程师，负责客户管理系统与移动端的测试。年均设计测试用例 3000 余条，提交缺陷 800 余个，缺陷有效率较高；搭建接口自动化脚本 200 余条，回归测试时间从两天缩短到半天；参与性能测试，定位慢接口 10 余个；编写测试报告 30 余份；工作细致，责任心强，与开发沟通顺畅，多次获项目组表扬。」

vague: 「缺陷有效率较高」「多次获项目组表扬」「与开发沟通顺畅」.

hints:
- 「缺陷有效率较高」要问有效率怎么算、谁判定
- 「回归从两天缩到半天」要问覆盖范围是否缩水
- 「搭建自动化脚本」要问维护成本与失败率

presets: ['tech', 'hr']
custom: name 「测试面试官」, domain '软件研发', seniority 'senior', tone 'neutral'...

Now I'll write the file. Then the check script will tell me actual lengths, and I'll adjust.

Let me be careful about the 全角 punctuation and 「」 usage. Avoid straight quotes.

Also note: hints must be 8-60 chars each. My hints ~25-35 chars — fine.

Now, customs: goal 8-200, tactics 2-5 items 4-120 each, blurb 4-60, name 1-24, domain ≤40.

Let me write the file now with a heredoc-free approach — use run_code with tools.write.

Actually I should use the write tool via run_code. Let me construct the content string carefully. Using a JS template literal with backticks; the content contains no backticks. But it contains `${`? No. Good.

Let me write it.

One concern: the file content has 「」 and newlines — fine.

Let me write out the full file.

I'll create D:\CZB\.tmp\ directory first if needed (write tool likely creates parents? Maybe not). I'll handle in the check step.

Let me write part4.ts.

</details>

### 🤖 AI 回复

I have the exact contract: lengths are `trim().length` and the validator forbids `有限公司`/platform names in JD+resume. Now writing the file.

**🔧 `run_code`** <sub>00:40:38</sub>

- 说明：Write part4.ts template data file
- 代码：
```js
const content = `/**
 * 岗位模板 · 第 4 组：行政文秘 / 法律合规 / 计算机软件。
 *
 * 全部为原创文案：不抄任何招聘平台的 JD 原文（见 docs/roadmap-v2.md 第 2 节）。
 * 每份示例简历都刻意留了两三处经不起细问的表述（「下降明显」「深受喜爱」这类），
 * 好让一键填充之后立刻能跑出有内容的质询，而不是一片「站得住」。
 */
import type { JobTemplate } from './types.ts';

export const PART4: JobTemplate[] = [
  {
    id: 'adm-executive-assistant',
    industry: '行政文秘',
    title: '总经理助理',
    jd:
      '协助总经理处理日常经营事务，负责日程安排、会议组织与决议事项的跟踪督办；起草经营报告、会议纪要与对外函件，整理会议材料并归档；对接各部门推进跨部门事项，汇总经营数据形成周报；负责来访接待与商务活动的后勤安排；要求中文、行政管理或相关专业本科及以上，三年以上总助或行政主管经验，文字功底扎实，熟练使用办公软件；有董秘或大型会议组织经验者优先。',
    resume:
      '林静，汉语言文学本科，2019 年至 2024 年在某
…（此处省略 8801 字符，原始长度 9401）
```

<details><summary>本次调用内部实际执行了 1 个子操作</summary>

- `write` — 路径：D:\CZB\packages\shared\src\templates\part4.ts · 正文：/** ⏎ * 岗位模板 · 第 4 组：行政文秘 / 法律合规 / 计算机软件。 ⏎ * ⏎ * 全部为原创文案：不抄任何招聘平台的 JD 原文（见 docs/roadmap-v2.md 第 2 节）。 ⏎ * 每份示例简历都刻意留了两三处经不起细问的表述（「下降明显」「深受喜爱」这类），…

</details>

<details><summary>✅ 执行结果（原始 64 字符）</summary>

```text
create D:\CZB\packages\shared\src\templates\part4.ts bytes: 9208
```

</details>


<details><summary>🧠 思考过程</summary>

Now write the check script and run it. The script should read the file, import it, and validate all constraints including custom draft.

Node 24 can import .ts. But the import of `./types.ts` — types.ts uses `import type` only, so fine. Let me write the script as an .mjs that dynamically imports the .ts file via file URL.

Note: `node .tmp/check-PART4.mjs` run from D:\CZB. Let me write it.

I need to create .tmp dir. The write tool may create parent dirs. Let's try.

The script:
- import { PART4 } from '../packages/shared/src/templates/part4.ts'
- for each: print id, jd len, resume len, hints count, tactics count
- FAIL lines for out of range

Also validate presets membership/uniqueness, id regex, custom fields.

Node 24 type-stripping: importing a .ts from .mjs should work with `--experimental-strip-types` default on in Node 23+. Node 24 has it enabled by default. Let's try.

Let me write and run.

</details>

### 🤖 AI 回复

Now the self-check script.

**🔧 `run_code`** <sub>00:40:47</sub>

- 说明：Create and run PART4 validation script
- 代码：
```js
const script = `import { PART4 } from '../packages/shared/src/templates/part4.ts';
import { TEMPLATE_LIMITS as L } from '../packages/shared/src/templates/types.ts';

const ROLES = ['tech', 'hr', 'hiring_manager', 'stress', 'domain_expert'];
const SENIORITY = ['junior', 'mid', 'senior', 'principal'];
const TONE = ['neutral', 'skeptical', 'warm', 'blunt'];
let fails = 0;
const fail = (m) => { fails++; console.log('  FAIL ' + m); };
const range = (label, n, min, max) => {
  const ok = n >= min && n <= max;
  if (!ok) fail(label + ' = ' + n + '，应在 ' + min + '–' + max);
  return n;
};

console.log(
…（此处省略 2422 字符，原始长度 3022）
```

<details><summary>本次调用内部实际执行了 2 个子操作</summary>

- `write` — 路径：D:\CZB\.tmp\check-PART4.mjs · 正文：import { PART4 } from '../packages/shared/src/templates/part4.ts'; ⏎ import { TEMPLATE_LIMITS as L } from '../packages/shared/src/templates/types.ts'; ⏎ ⏎ const ROL…
- `ops_bash` — 说明：Run PART4 template self-check · 命令：node .tmp/check-PART4.mjs · 工作目录：.

</details>

<details><summary>✅ 执行结果（原始 1611 字符，已折叠）</summary>

```text
exit: 1
共 9 条
--- adm-executive-assistant | 行政文秘 | 总经理助理
  JD 170 字 | 简历 184 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL adm-executive-assistant JD = 170，应在 180–260
  FAIL adm-executive-assistant 简历 = 184，应在 200–340
--- adm-office-admin | 行政文秘 | 行政专员（办公事务）
  JD 179 字 | 简历 178 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL adm-office-admin JD = 179，应在 180–260
  FAIL adm-office-admin 简历 = 178，应在 200–340
--- adm-document-archivist | 行政文秘 | 文书档案管理员
  JD 178 字 | 简历 176 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL adm-document-archivist JD = 178，应在 180–260
  FAIL adm-document-archivist 简历 = 176，应在 200–340
--- law-legal-counsel | 法律合规 | 企业法务专员
  JD 175 字 | 简历 183 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL law-legal-counsel JD = 175，应在 180–260
  FAIL law-legal-counsel 简历 = 183，应在 200–340
--- law-compliance-officer | 法律合规 | 合规专员（反商业贿赂）
  JD 188 字 | 简历 178 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL law-compliance-officer 简历 = 178，应在 200–340
--- law-contract-specialist | 法律合规 | 合同管理专员
  JD 177 字 | 简历 165 字 | 提示 3 条 | presets 2 | tactics 3
  FAIL law-contract-specialist JD = 177，应在 180–260
  FAIL law-contract-specialist 简历 = 165，应在 200–340
--- sw-frontend-engineer | 计算机软件 | 前端开发工程师
  JD 209 字 | 简历 184 字 |
…（此处省略 411 字符，原始长度 1611）
```

</details>


<details><summary>🧠 思考过程</summary>

My estimates were low. I need to lengthen JDs to 180-260 (most are 170-190, need +10 to +30) and resumes to 200-340 (most 165-185, need +20 to +40).

Let me expand each. I'll use edit tool for targeted replacements — or rewrite the whole file with adjustments. Rewriting whole file is cleaner but risk of the same miscalc. Better: make targeted edits adding specific clauses.

Let me plan per entry the additions. I'll aim JD ~205-225 and resume ~250-290 for safety margin.

Entry 1 adm-executive-assistant:
- JD 170 → need +25 to +40. Add a clause. Current JD ends: 「...三年以上总助或行政主管经验，文字功底扎实，熟练使用办公软件；有董秘或大型会议组织经验者优先。」
  Add after 「汇总经营数据形成周报；」 → change to 「汇总经营数据形成周报，起草部门年度工作计划；」 (+11)
  And 「负责来访接待与商务活动的后勤安排；」 → 「负责来访接待、商务活动的后勤安排与差旅预订，管理总经理室的文件与印章使用；」 (+19)
  Total +30 → 200. Good.
- 简历 184 → +30 to +50 (target ~240). Add: after 「保密意识好。」 add 「在职期间连续两年年度考核为优秀。」 (+16) and 「推动多项流程落地」→「推动多项流程落地，其中费用报销流程的审批环节由五级压缩到三级」 (+16). Total ~+32 → 216. Maybe add more: 「年均组织经营会议 60 余场」→ fine. Let's add one more sentence: 「办公用品与接待费用较上年有所下降。」 hmm that adds a vague one too (+17). Then ~233. Good.

Entry 2 adm-office-admin:
- JD 179 → need ≥180. Add more for margin: 「负责办公环境与消防安全的日常检查；」 → 「负责办公环境、绿植与消防安全的日常检查，跟进维修事项的处理时效；」 (+14) → 193. Add another: 「协助新员工入职的后勤安排」 → 「协助新员工入职的后勤安排与工位布置」 (+6) → 199. Good.
- 简历 178 → +40. Add: after 「能同时跟进多项事务。」 add 「年度行政费用控制在预算以内，办公用品采购成本较上年下降约一成。」 (+30) → 208. Add another: 「两次参与办公区搬迁的统筹，均按计划完成。」 (+20) → 228. Good.

Entry 3 adm-document-archivist:
- JD 178 → +15: 「负责涉密文件的保管与销毁流程；」 → 「负责涉密文件的单独保管、借阅审批与销毁流程；」 (+8) → 186. Add: 「配合内外部检查提供档案材料」 → 「配合内外部检查与审计提供档案材料」 (+3) → 189. Add 「熟悉档案管理规范」 → 「熟悉档案管理规范与保密要求」 (+5) → 194. Good.
- 简历 176 → +45: after 「参与多起档案专项整理。」 add 「参与制定公司档案数字化三年计划，负责其中的扫描标准与验收细则。」 (+29) → 205. Add 「在职期间两次获评部门季度之星。」 (+15) → 220. Hmm want more margin, add 「年均整理入库档案约 1500 卷。」 (+16) → 236. Good.

Entry 4 law-legal-counsel:
- JD 175 → +25: 「负责诉讼案件的材料准备、进度跟踪与结案归档；」 → 「负责诉讼案件的材料准备、证据整理、进度跟踪与结案归档，建立案件台账并按月向上汇报；」 (+19) → 194. Add 「开展法律培训与风险排查」 → 「开展法律培训、合规宣讲与风险排查」 (+6) → 200. Good.
- 简历 183 → +40: after 「深得业务部门信任。」 add 「参与公司两起重大合作的尽职调查，负责其中的法律部分。」 (+25) → 208. Add 「起草并修订常用合同模板 10 余份。」 (+16) → 224. Good.

Entry 5 law-compliance-officer:
- JD 188 ok, but let me leave. Actually fine (188 in range).
- 简历 178 → +40: after 「深受业务部门认可。」 add 「参与一次监管检查的准备，负责材料清单与现场应答的协调。」 (+27) → 205. Add 「两次主导合规宣传周的组织。」 (+13) → 218. Good.

Entry 6 law-contract-specialist:
- JD 177 → +20: 「办理合同变更、续签与解除；」 → 「办理合同变更、续签、解除与用印申请；」 (+5) → 182. Add: 「维护合同模板库，参与格式条款的更新与优化；」 → 「维护合同模板库，参与格式条款的更新与优化，每季度输出一次合同风险提示；」 (+16) → 198. Good.
- 简历 165 → +60: after 「多次获得部门表扬。」 add 「负责合同专用章的用印登记，全年用印 2000 余次，未出现漏登。」 (+29) → 194. Add 「参与一次合同纠纷的举证材料整理，协助法务完成开庭准备。」 (+26) → 220. Add 「在职期间通过法律职业资格考试。」 hmm 法学大专 can take? Since 2018 requires bachelor. Avoid. Use 「完成公司内部合规培训 6 次并全部通过考核。」 hmm. Add 「连续三年年度考核良好以上。」 (+13) → 233. Good.

Entry 7 sw-frontend-engineer:
- JD 209 ok.
- 简历 184 → +40: after 「深受团队喜爱。」 add 「负责前端代码评审与新人指导，带过两名实习生。」 (+21) → 205. Add 「整理内部技术分享 5 次，主题涉及构建优化与组件设计。」 (+23) → 228. Good.

Entry 8 sw-backend-engineer:
- JD 185 ok (but close to 180, fine).
- 简历 179 → +45: after 「能带新人。」 add 「参与制定接口规范与数据库变更流程，推动慢查询治理。」 (+24) → 203. Add 「在职期间主导两次大促的容量评估与扩容。」 (+18) → 221. Good.

Entry 9 sw-qa-engineer:
- JD 175 → +20: 「配合开发定位线上问题；」 → 「配合开发定位线上问题并跟进修复验证；」 (+7) → 182. Add 「熟悉测试流程与常用工具」 → 「熟悉测试流程与常用缺陷管理、抓包工具」 (+7) → 189. Add another: 「参与持续集成流程」 → 「参与持续集成流程的日常运行」 (+5) → 194. Good.
- 简历 177 → +45: after 「多次获项目组表扬。」 add 「参与线上问题的复现与验证，全年负责的版本未出现漏测事故。」 (+27) → 204. Add 「整理测试经验文档 10 余份供团队复用。」 (+17) → 221. Good.

Now let me apply these with edit calls. Many edits; I'll do them in one run_code with sequential edit calls (mutations run alone, in submission order — safe).

Wait: edits to the same file in sequence should be fine since they're distinct strings.

Also need to double check no straight quotes introduced. My additions use 「」? No, plain text — fine. Avoid 「」 inside content maybe fine.

Let me also make sure I don't introduce '有限公司'.

Let me write the edits.

For entry1 JD: careful with exact original strings.

Original JD1 full text:
'协助总经理处理日常经营事务，负责日程安排、会议组织与决议事项的跟踪督办；起草经营报告、会议纪要与对外函件，整理会议材料并归档；对接各部门推进跨部门事项，汇总经营数据形成周报；负责来访接待与商务活动的后勤安排；要求中文、行政管理或相关专业本科及以上，三年以上总助或行政主管经验，文字功底扎实，熟练使用办公软件；有董秘或大型会议组织经验者优先。'

Edit A: '汇总经营数据形成周报；负责来访接待与商务活动的后勤安排；' → '汇总经营数据形成周报，起草部门年度工作计划；负责来访接待、商务活动的后勤安排与差旅预订，管理总经理室的文件与印章使用；'
Delta: new segment length vs old: old = "汇总经营数据形成周报；负责来访接待与商务活动的后勤安排；" = let me not compute precisely; roughly +30. Fine, script will verify.

简历1 original: '林静，汉语言文学本科，2019 年至 2024 年在某民营制造企业任总经理助理。负责总经理日程与会议安排，年均组织经营会议 60 余场，整理会议纪要并跟踪 300 余项决议事项；起草年度经营报告与对外函件，其中两份报告获管理层采纳；统筹年会与客户答谢会各两次，来宾百余人，现场衔接顺畅，深受好评；负责跨部门事项协调，推动多项流程落地；工作细致，抗压能力强，保密意识好。'

Edit B: '推动多项流程落地；工作细致，抗压能力强，保密意识好。' → '推动多项流程落地，其中费用报销流程的审批环节由五级压缩到三级；办公用品与接待费用较上年有所下降；工作细致，抗压能力强，保密意识好，在职期间连续两年年度考核为优秀。'

Good.

Entry2:
JD2: '...协助新员工入职的后勤安排；负责办公环境与消防安全的日常检查；要求行政管理...'
Edit: '协助新员工入职的后勤安排；负责办公环境与消防安全的日常检查；' → '协助新员工入职的后勤安排与工位布置；负责办公环境、绿植与消防安全的日常检查，跟进维修事项的处理时效；'

简历2 ends '性格开朗，服务意识强，能同时跟进多项事务。'
Edit: '性格开朗，服务意识强，能同时跟进多项事务。' → '性格开朗，服务意识强，能同时跟进多项事务；年度行政费用控制在预算以内，办公用品采购成本较上年下降约一成；两次参与办公区搬迁的统筹，均按计划完成。'

Entry3:
JD3: '负责涉密文件的保管与销毁流程；要求档案学、图书情报或文秘相关专业大专及以上，两年以上档案管理经验，熟悉档案管理规范；有数字化项目经验者优先。'
Edit → '负责涉密文件的单独保管、借阅审批与销毁流程；要求档案学、图书情报或文秘相关专业大专及以上，两年以上档案管理经验，熟悉档案管理规范与保密要求；有数字化项目经验者优先。'
Also '配合内外部检查提供档案材料' → '配合内外部检查与审计提供档案材料'.

简历3 ends '严谨细致，保密意识强，参与多起档案专项整理。'
Edit → '严谨细致，保密意识强，参与多起档案专项整理；参与制定公司档案数字化三年计划，负责其中的扫描标准与验收细则；年均整理入库档案约 1500 卷，在职期间两次获评部门季度之星。'

Entry4:
JD4: '开展法律培训与风险排查；负责诉讼案件的材料准备、进度跟踪与结案归档；'
Edit → '开展法律培训、合规宣讲与风险排查；负责诉讼案件的材料准备、证据整理、进度跟踪与结案归档，建立案件台账并按月向上汇报；'

简历4 ends '逻辑清晰，抗压能力强，深得业务部门信任。'
Edit → '逻辑清晰，抗压能力强，深得业务部门信任；参与公司两起重大合作的尽职调查，负责其中的法律部分；起草并修订常用合同模板 10 余份。'

Entry5 简历: ends '原则性强，沟通方式灵活，深受业务部门认可。'
Edit → '原则性强，沟通方式灵活，深受业务部门认可；参与一次监管检查的准备，负责材料清单与现场应答的协调；两次主导合规宣传周的组织。'

Entry6:
JD6: '办理合同变更、续签与解除；维护合同模板库，参与格式条款的更新与优化；'
Edit → '办理合同变更、续签、解除与用印申请；维护合同模板库，参与格式条款的更新与优化，每季度输出一次合同风险提示；'

简历6 ends '工作耐心，注重细节，善于与业务部门沟通，多次获得部门表扬。'
Edit → '工作耐心，注重细节，善于与业务部门沟通，多次获得部门表扬；负责合同专用章的用印登记，全年用印 2000 余次，未出现漏登；参与一次合同纠纷的举证材料整理，协助法务完成开庭准备；连续三年年度考核良好以上。'

Entry7 简历 ends '熟悉 Vue 与 React，代码规范良好，沟通顺畅，深受团队喜爱。'
Edit → '熟悉 Vue 与 React，代码规范良好，沟通顺畅，深受团队喜爱；负责前端代码评审与新人指导，带过两名实习生；整理内部技术分享 5 次，主题涉及构建优化与组件设计。'

Entry8 简历 ends '技术基础扎实，抗压能力强，能带新人。'
Edit → '技术基础扎实，抗压能力强，能带新人；参与制定接口规范与数据库变更流程，推动慢查询治理；在职期间主导两次大促的容量评估与扩容。'

Entry9 JD: '开展性能与兼容性测试，配合开发定位线上问题；要求计算机相关专业大专及以上，两年以上测试经验，熟悉测试流程与常用工具，能编写简单的 SQL 与脚本；'
Edit → '开展性能与兼容性测试，配合开发定位线上问题并跟进修复验证；要求计算机相关专业大专及以上，两年以上测试经验，熟悉测试流程与常用缺陷管理、抓包工具，能编写简单的 SQL 与脚本；'
Also '参与持续集成流程' → '参与持续集成流程的日常运行'.

简历9 ends '工作细致，责任心强，与开发沟通顺畅，多次获项目组表扬。'
Edit → '工作细致，责任心强，与开发沟通顺畅，多次获项目组表扬；参与线上问题的复现与验证，全年负责的版本未出现漏测事故；整理测试经验文档 10 余份供团队复用。'

Let me apply all edits.

</details>

### 🤖 AI 回复

Counts came in low across the board. Applying targeted expansions to bring JD/resume inside range.

**🔧 `run_code`** <sub>00:41:15</sub>

- 说明：Expand JD and resume text, re-validate
- 代码：
```js
const F = "D:\\CZB\\packages\\shared\\src\\templates\\part4.ts";
const edits: [string, string][] = [
  // 1 总助
  ['汇总经营数据形成周报；负责来访接待与商务活动的后勤安排；',
   '汇总经营数据形成周报，起草部门年度工作计划；负责来访接待、商务活动的后勤安排与差旅预订，管理总经理室的文件与印章使用；'],
  ['推动多项流程落地；工作细致，抗压能力强，保密意识好。',
   '推动多项流程落地，其中费用报销流程的审批环节由五级压缩到三级；办公用品与接待费用较上年有所下降；工作细致，抗压能力强，保密意识好，在职期间连续两年年度考核为优秀。'],
  // 2 行政专员
  ['协助新员工入职的后勤安排；负责办公环境与消防安全的日常检查；',
   '协助新员工入职的后勤安排与工位布置；负责办公环境、绿植与消防安全的日常检查，跟进维修事项的处理时效；'],
  ['性格开朗，服务意识强，能同时跟进多项事务。',
   '性格开朗，服务意识强，能同时跟进多项事务；年度行政费用控制在预算以内，办公用品采购成本较上年下降约一成；两次参与办公区搬迁的统筹，均按计划完成。'],
  // 3 档案
  ['配合内外部检查提供档案材料', '配合内外部检查与审计提供档案材料'],
…（此处省略 1792 字符，原始长度 2392）
```

<details><summary>本次调用内部实际执行了 19 个子操作</summary>

- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `edit` — 路径：D:\CZB\packages\shared\src\templates\part4.ts
- `ops_bash` — 说明：Re-run PART4 self-check · 命令：node .tmp/check-PART4.mjs · 工作目录：.

</details>

<details><summary>✅ 执行结果（原始 923 字符）</summary>

```text
applied 18 edits
exit: 0
共 9 条
--- adm-executive-assistant | 行政文秘 | 总经理助理
  JD 201 字 | 简历 239 字 | 提示 3 条 | presets 2 | tactics 3
--- adm-office-admin | 行政文秘 | 行政专员（办公事务）
  JD 199 字 | 简历 229 字 | 提示 3 条 | presets 2 | tactics 3
--- adm-document-archivist | 行政文秘 | 文书档案管理员
  JD 193 字 | 简历 239 字 | 提示 3 条 | presets 2 | tactics 3
--- law-legal-counsel | 法律合规 | 企业法务专员
  JD 199 字 | 简历 227 字 | 提示 3 条 | presets 2 | tactics 3
--- law-compliance-officer | 法律合规 | 合规专员（反商业贿赂）
  JD 188 字 | 简历 218 字 | 提示 3 条 | presets 2 | tactics 3
--- law-contract-specialist | 法律合规 | 合同管理专员
  JD 196 字 | 简历 237 字 | 提示 3 条 | presets 2 | tactics 3
--- sw-frontend-engineer | 计算机软件 | 前端开发工程师
  JD 209 字 | 简历 233 字 | 提示 3 条 | presets 2 | tactics 3
--- sw-backend-engineer | 计算机软件 | 后端开发工程师
  JD 185 字 | 简历 223 字 | 提示 3 条 | presets 2 | tactics 3
--- sw-qa-engineer | 计算机软件 | 软件测试工程师
  JD 194 字 | 简历 225 字 | 提示 3 条 | presets 2 | tactics 3
ALL PASS（FAIL 0）

```

</details>


<details><summary>🧠 思考过程</summary>

All pass. Now verify the file parses and matches the real validator semantics. I can't import templates.ts (missing part2/part3). Let me at least check the final file content briefly for style issues and confirm no other files were modified (git status).

Also should verify the file imports cleanly (it did, the check script imported it).

Let me: 
1. git status to confirm only part4.ts added (plus .tmp which we delete).
2. Delete the temp script.
3. Check straight quotes / style once more — my check already tested straight quotes in jd/resume/goal/tactics, but not hints/blurb/name/domain. Let me do a final quick scan for ASCII quotes and "!" anywhere in the file, plus confirm 「」 usage count.

Let me also verify no "有限公司" anywhere (validator only checks jd+resume, but good).

Let me run a final verification + cleanup in one go.

</details>

### 🤖 AI 回复

All green. Final verification of style/grammar across the whole file, confirm no other file changed, then remove the temp script.

**🔧 `run_code`** <sub>00:41:22</sub>

- 说明：Final style scan, git check, delete temp script
- 代码：
```js
// Final full-file style scan + git status before cleanup
const chk = await tools.ops_bash({
  command: "node -e \"const s=require('fs').readFileSync('packages/shared/src/templates/part4.ts','utf8');const bad=[['straight-double-quote',/\\\"/g],['straight-single',/'/g],['excl',/!/g],['ascii-comma',/,/g]];for(const [n,re] of bad){const m=s.match(re);console.log(n+': '+(m?m.length:0));}console.log('bracket-left: '+(s.match(/「/g)||[]).length+' bracket-right: '+(s.match(/」/g)||[]).length);console.log('company-suffix: '+((s.match(/有限公司/g)||[]).length));\"",
  description: "Scan part4 for forbidden p
…（此处省略 723 字符，原始长度 1323）
```

<details><summary>本次调用内部实际执行了 4 个子操作</summary>

- `ops_bash` — 说明：Scan part4 for forbidden punctuation · 命令：node -e "const s=require('fs').readFileSync('packages/shared/src/templates/part4.ts','utf8');const bad=[['straight-double-quote',/\"/g],['straight-single',…
- `ops_bash` — 说明：Check working tree changes · 命令：git status --porcelain · 工作目录：.
- `ops_bash` — 说明：Delete temp check script · 命令：rm -f .tmp/check-PART4.mjs && ls .tmp 2>/dev/null; echo done · 工作目录：.
- `ops_bash` — 说明：Confirm tree state after cleanup · 命令：git status --porcelain · 工作目录：.

</details>

<details><summary>✅ 执行结果（原始 3512 字符，已折叠）</summary>

```text
straight-double-quote: 0
straight-single: 344
excl: 0
ascii-comma: 207
bracket-left: 32 bracket-right: 32
company-suffix: 0
 
--- git status ---
 M packages/shared/src/index.ts
?? packages/shared/src/templates.ts
?? packages/shared/src/templates/
?? packages/shared/test/templates.test.ts

--- cleanup ---
App.full.tsx
ab
api-matrix.mjs
build.log
c1.txt
c2.txt
c3.txt
c4.txt
check-PART2.mjs
check-PART3.mjs
check-export.mjs
check-export2.mjs
commit-docs.sh
commit-live.sh
commit-orch1.sh
commit-orch2.sh
commit-p1a-rest.sh
commit-p1a.sh
commit-p2.sh
commit-p2b.sh
commit-p4a.sh
commit-p4b.sh
commit-resume.sh
commit-server-llm.sh
commit-store.sh
dbinspect.mjs
demo-resume.txt
doc
doc-stats.mts
docpdf.log
docs-pdf-8.log
docs-pdf.log
docshot.mjs
docspdf.log
drive.mjs
dump-contract.mts
dump-demo.mjs
e2e
e2e-8.log
e2e-browser.mjs
e2e-f.log
e2e-final.log
e2e-import.log
e2e-import2.log
e2e-mode.log
e2e-run1.log
e2e-run2.log
e2e-timeout.log
e2e-ui
e2e-ui.log
e2e.log
e2e12.log
e2e2.log
edge-docshot
edge-docshot-1793004656321
edge-docshot-1793004722014
edge-fixture
edge-fixture.log
edge-pdf2
edge-pdf3
edge-pdf4
edge-pdfview-1793004741542
edge-pdfview2-1793004770345
edge-pdfview3-1793004805123
edge-p
…（此处省略 2312 字符，原始长度 3512）
```

</details>


<details><summary>🧠 思考过程</summary>

The temp script is deleted (it's no longer in the .tmp listing).

The "straight-single: 344" and "ascii-comma: 207" are from my regex escaping gone wrong in the shell — `/'/g` in the node -e within double quotes... Actually the shell may have mangled it. 344 straight singles seems implausible; likely the regex matched everything (e.g., empty pattern match behavior is not global-empty... hmm `/'/g` would match only apostrophes). Let me re-verify properly — the issue is the shell double-quote escaping mangled the regexes. `\"/g` worked (0), but `/'/g` — inside double-quoted bash string, `'` is literal, so regex is /'/g. That should match only literal apostrophes. 344 matches... Actually wait: the node -e code itself contains quotes; when bash processing, `s=require('fs')` etc. Hmm, the whole thing is wrapped in `"..."`. Inside, `'` are literal. So `/\\\"/g` became `/\"/g`? Bash converts `\\\"` → `\"`? Within double quotes, `\\` → `\`, `\"` → `"`. So `\\\"` → `\"`. Regex `/\"/g` = literal `"`. OK 0.

`/'/g` stays `/'/g` = literal `'`. That gives 344? That's suspicious. Unless... the match was on... no wait. Hmm, actually maybe the issue: `,` /,/g = 207 — that's plausible for code with array separators, object separators. Yes! ascii-comma 207 is entirely from the TypeScript syntax (commas between object fields). Similarly straight-single 344 — hmm, apostrophes in a TS file? There are none... unless the regex became something else.

Oh! I see: in bash double quotes, `'` is literal, fine. But I wrote `/'/g` — the shell gives node `/'/g`. Matches only `'`. There shouldn't be 344.

Wait — maybe the shell interpreted differently and the actual regex was empty or `.`? If `/./g` it'd match every char except newlines (~9200). 344 is odd.

Let me just re-run the scan properly with a file-based script or escaped safely, since this matters for style compliance (the task demands 「」 not quotes). Let me use a clean approach: read the file and count via run_code (Node fs inside run_code? run_code has process/paths — it says direct filesystem access follows sandbox policy; danger-full-access). I can use await import('fs').

Let me do the scan in run_code directly.

Also note git status: `packages/shared/src/templates/` is untracked as a whole directory (contains part1.ts, types.ts, part4.ts) — so I can't distinguish. But I only wrote part4.ts. The other changes (index.ts modified, templates.ts, templates.test.ts) were pre-existing from the parent's work, not mine. Good.

Let me do a clean style scan.

</details>

### 🤖 AI 回复

Let me redo the style scan cleanly (the shell escaping made the quote counts unreliable).

**🔧 `run_code`** <sub>00:41:33</sub>

- 说明：Clean scan of part4 punctuation and forbidden strings
- 代码：
```js
const fs = await import('node:fs');
const p = 'D:\\CZB\\packages\\shared\\src\\templates\\part4.ts';
const s = fs.readFileSync(p, 'utf8');
const count = (re: RegExp) => (s.match(re) ?? []).length;
console.log('直双引号 ": ' + count(/"/g));
console.log("直单引号 ': " + count(/'/g));
console.log('感叹号 !: ' + count(/!/g));
console.log('全角感叹号 ！: ' + count(/！/g));
console.log('「: ' + count(/「/g) + '  」: ' + count(/」/g));
console.log('ASCII 逗号 ,: ' + count(/,/g) + '  （其中多数是 TS 语法，正文用全角，）');
console.log('正文里的半角逗号：' + count(/[\u4e00-\u9fa5],/g) + '（中文字后紧跟半角逗号即为违规）');
console.log('有限公司: ' + count(/有限公司/g) + '  
…（此处省略 240 字符，原始长度 840）
```

<details><summary>✅ 执行结果（原始 179 字符）</summary>

```text
直双引号 ": 0
直单引号 ': 344
感叹号 !: 0
全角感叹号 ！: 0
「: 32  」: 32
ASCII 逗号 ,: 207  （其中多数是 TS 语法，正文用全角，）
正文里的半角逗号：0（中文字后紧跟半角逗号即为违规）
有限公司: 0  BOSS: 0  链接: 0
文件字节数: 21129  行数: 264
临时脚本存在？ false
```

</details>


<details><summary>🧠 思考过程</summary>

344 single quotes is real. Where do they come from? My file uses single quotes for TS string literals! Yes — all string values are wrapped in 'single quotes' in TypeScript (following part1.ts style: `id: 'med-pharmacy-lead'`). So 344 = TS string delimiters. That's exactly the same as part1.ts style. Good, not a style violation.

So: no straight quotes inside prose content (the 「」 count 32/32 balanced), no ASCII comma after Chinese chars, no exclamation marks. All good.

Everything checks out. Now send the result to parent. The reply must be three lines: file path, list of 9 ids, self-check conclusion (measured ranges).

Let me compose per-entry measured values to report ranges:
- JD: 185–209 字 (limit 180–260)
- 简历: 218–239 字 (limit 200–340)
- hints: 3 条 each (limit 2–3); hint lengths — I printed counts but not individual hint ranges. Let me compute the actual min/max across measured fields to report accurately. Let me quickly compute: hints length range, tactics range, blurb range, goal range, name, domain.

Let me run one more quick computation to get exact ranges for the report.

</details>

### 🤖 AI 回复

344 single quotes are the TypeScript string delimiters (same as part1.ts), not prose quotes — prose uses 「」 (32/32 balanced). Let me compute exact measured ranges for the report.

**🔧 `run_code`** <sub>00:41:41</sub>

- 说明：Compute measured field ranges for report
- 代码：
```js
const mod = await import('file:///D:/CZB/packages/shared/src/templates/part4.ts');
const P = mod.PART4;
const rng = (a: number[]) => Math.min(...a) + '–' + Math.max(...a);
const jd = P.map(t => t.jd.trim().length);
const rv = P.map(t => t.resume.trim().length);
const hints = P.flatMap(t => t.hints.map(h => h.trim().length));
const tac = P.flatMap(t => t.custom.tactics.map(x => x.trim().length));
const goal = P.map(t => t.custom.goal.trim().length);
const blurb = P.map(t => t.custom.blurb.trim().length);
const name = P.map(t => t.custom.name.length);
const dom = P.map(t => t.custom.domain.lengt
…（此处省略 539 字符，原始长度 1139）
```

<details><summary>✅ 执行结果（原始 567 字符）</summary>

```text
ids: adm-executive-assistant, adm-office-admin, adm-document-archivist, law-legal-counsel, law-compliance-officer, law-contract-specialist, sw-frontend-engineer, sw-backend-engineer, sw-qa-engineer
JD 185–209 | 简历 218–239
hints 条数 3–3，单条 19–33
tactics 条数 3–3，单条 18–37
goal 33–46 | blurb 15–20 | name 5–7 | domain 4–5
industry: ["行政文秘","法律合规","计算机软件"]
presets: [["hr","hiring_manager"],["hr","stress"],["domain_expert","hr"],["domain_expert","stress"],["domain_expert","hiring_manager"],["domain_expert","hr"],["tech","hiring_manager"],["tech","stress"],["tech","hr"]]
```

</details>


<details><summary>🧠 思考过程</summary>

Everything verified. Now send the result message to parent, then give the 3-line reply.

The message must be self-contained. Let me include the file path, ids, self-check ranges, and note that no other files were touched, and the temp script was deleted.

Then final answer: only three lines.

</details>

**🔧 `run_code`** <sub>00:41:48</sub>

- 说明：Send PART4 result to parent agent
- 代码：
```js
const msg = [
  '【PART4 岗位模板库 · 完成】',
  '',
  '文件：D:\\CZB\\packages\\shared\\src\\templates\\part4.ts（新建，21129 字节 / 264 行）。仅创建该文件，未改任何其他文件。',
  '结构：import type { JobTemplate } from \'./types.ts\'; + export const PART4: JobTemplate[]（9 条 = 3 行业 × 3 岗位，行业 行政文秘 / 法律合规 / 计算机软件，逐字与要求一致）。',
  '',
  '9 条 id：',
  '1. adm-executive-assistant（总经理助理）',
  '2. adm-office-admin（行政专员（办公事务））',
  '3. adm-document-archivist（文书档案管理员）',
  '4. law-legal-counsel（企业法务专员）',
  '5. law-compliance-officer（合规专员（反商业贿赂））',
  '6. law-contract-specialist（合同管理专员）',
  '7. sw-frontend-engineer（前端开发工程师）',
  '8. sw-backend-engine
…（此处省略 927 字符，原始长度 1527）
```

<details><summary>本次调用内部实际执行了 1 个子操作</summary>

- `send_message` — ```json · { "agent_id": "session-9791af4a-18f0-4e22-86e6-5dbe200db248", "message": "【PART4 岗位模板库 · 完成】\n\n文件：D:\\CZB\\packages\\shared\\src\\templates\\part4.ts（新建，21 …（此处省略 1168 字符，原始长度 1328） · ```

</details>

<details><summary>✅ 执行结果（原始 42 字符）</summary>

```text
sent: 9f9e389e-d920-49be-9441-1da380f2b657
```

</details>


### 🤖 AI 回复

文件：`D:\CZB\packages\shared\src\templates\part4.ts`（新建，仅此一个文件；临时脚本 `.tmp/check-PART4.mjs` 已删除）

9 条 id：adm-executive-assistant、adm-office-admin、adm-document-archivist、law-legal-counsel、law-compliance-officer、law-contract-specialist、sw-frontend-engineer、sw-backend-engineer、sw-qa-engineer

自检结论：`node .tmp/check-PART4.mjs` exit 0 / FAIL 0 —— JD 185–209 字（限 180–260）、简历 218–239 字（限 200–340）、hints 均 3 条且单条 19–33 字（限 2–3 条 / 8–60 字）、presets 均 2 位无重复、custom 各字段实测 name 5–7、domain 4–5、blurb 15–20、goal 33–46、tactics 均 3 条单条 18–37，全部落在限内；且无链接/企业名/平台名/感叹号，正文标点全角、「」32 对。

---
