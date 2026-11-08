# ADR-0033：把契约③④ 与「禁止升格改写」从提示词承诺升级为程序闸门

- 状态：已采纳（2026-11-08）
- 相关：ADR-0013（无锚点不提问）、ADR-0020（提示词契约）、docs/tech/02-intent-control.md

## 背景

`docs/tech/02-intent-control.md` 与 `packages/shared/src/contract.ts` 一直写着四条契约，
其中③「一次只问一个问题」、④「不得假设简历里没写的事实」标注为「由程序强制校验」，
但评审实测：把「这个 2.4s 是怎么测出来的？口径是什么？在字节跳动主导过的高并发架构又是怎么回事？」
交给 `runProbeRound`，结果是 **accepted=2 / rejected=[]**——两个面试官都放行了。
改写侧同样：把「参与支付网关迁移」改写成「主导支付网关迁移，独立完成全流程」也能过闸，
因为「禁止升格」当时只写在 `packages/shared/src/style.ts` 的提示词里，没有任何代码拦它。

也就是说：**声明与实现之间有一段空档**，而这段空档正好落在评分表「方法创新性与意图控制」上。

## 决策

三条闸门全部落到确定性代码里，都不依赖模型自觉：

1. **契约③ 一次只问一个问题**：`contract.ts` 的 `questionMarkCount` / `MAX_QUESTION_MARKS`，
   问号数超限直接拒收，理由写「违反契约③（一次只问一个问题）：这条提问里有 N 个问号，请拆成多条再问」。
2. **契约④ 不得假设简历没写的事实**：`WELL_KNOWN_ORGS`（30 项机构白名单）+ `assumedFactsIn`，
   题面里出现简历中不存在的机构名、或贡献说法所需的对象词元不在简历里 → 拒收，并在理由里点名是哪一个。
3. **禁止升格改写**：`style.ts` 的 `CONTRIBUTION_HIGH_MARKERS` / `CONTRIBUTION_LOW_MARKERS` 与
   `contributionEscalation(before, after, support)`，依据取**该主张所在的简历原句**（`suggest.ts` 的 `claimLineOf`），
   检出「参与→主导」「协助→独立完成」这类放大即拒，理由写「改写把个人贡献升格了」。
4. **闸门位置**：③④ 挂在 `probe.ts` 的预算闸门之后、锚定之前——**拒收不消耗预算**，
   所以被拦下的提问不会挤占本轮的追问配额。

## 已知边界（写进代码注释，也写在这里）

- ④ 是**词表匹配，不是语义理解**：只认 ≥3 位或带小数点的数字（两位整数、中文数字会漏）；机构名靠 30 项白名单
  （名单外会漏）；贡献断言只认「高阶梯词 + 过/了 + 对象」且对象词元需在简历里（换措辞可能漏）。
- 升格闸门的依据粒度是「该主张所在的简历原句」，代价是同一行里两段经历共用依据。
- 契约文本与 `renderSystemPrompt` **一字未动**：卡带按提示词指纹寻址，改提示词会让全部录制记录失配。
  因此契约里仍写「由程序强制校验」——这句话现在有实现支撑了。

## 后果

- 红队的两个输入现在分别是 `accepted=0 / rejected=2`（③ 与 ④ 各拦一条）与 `accepted=0 / rejected=1`；
  升格改写 `status=rejected`。
- 反例没有误杀：「这个重构是你主导的还是参与的？」等 4 条边界提问全部放行。
- 新增测试：`packages/shared/test/intent-gates.test.ts`（15 例），
  `packages/server/test/orchestrator-probe.test.ts`（16 例）、`orchestrator-suggest.test.ts`（14 例）。
