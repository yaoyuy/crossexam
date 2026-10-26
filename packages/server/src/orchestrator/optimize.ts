/**
 * 「用 AI 优化契约」：把用户的一句人话变成一份**可评审的结构化草稿**。
 *
 * 这里有两条路径，而且**永远有一条能用**：
 *   1. 模型路径：调 LLM 出 JSON，必须逐字段过 zod。过不了就当模型这条路没走通。
 *   2. 本地路径：TACTIC_RULES 规则表生成草稿，纯确定性、不联网、不发送任何请求。
 *
 * 为什么默认要留本地路径？不是因为「模型可能挂了」这种工程谦逊，而是这个产品的前提：
 * 一位非计算机专业的评委在自己机器上克隆下来、没有 API Key、直接离线回放，
 * 也应该能把「自己配一位面试官」这条链路从头走到尾。模型不可用不该变成功能不可用。
 *
 * 又为什么不让本地路径**沉默地**顶替模型？因为用户有权知道刚才那一下到底是谁干的。
 * 顶替一定带 notes 和 fallbackReason，界面上原样显示。
 */

import {
  buildCustomContract,
  contractDigest,
  customInterviewerId,
  diffDrafts,
  interviewerDraftSchema,
  localDraftFromText,
  localDraftNotes,
  parseLlmOutput,
  renderSystemPrompt,
} from '@crossexam/shared';
import type { ContractBudgetView, DraftDiff, IntentContract, InterviewerDraft } from '@crossexam/shared';
import { DEFAULT_BUDGET } from '@crossexam/shared';
import type { LlmClient, LlmUsage } from '../llm/types.ts';
import { EMPTY_USAGE, LlmError } from '../llm/types.ts';
import { budgetView } from './panel.ts';
import { CONTRACT_OPTIMIZER_SYSTEM, buildContractPrompt, stageRequest } from './prompts.ts';

/** 草稿 → id。同一份草稿永远得到同一个 id，所以「优化两次」不会凭空多出一位面试官。 */
export function draftIdOf(draft: InterviewerDraft, salt = ''): string {
  return customInterviewerId(draft.name, salt);
}

export interface ContractBundle {
  id: string;
  version: number;
  digest: string;
  contract: IntentContract;
  systemPrompt: string;
}

/** 草稿 → 可展示、可落库、可开跑的契约。渲染出的 system prompt 与运行时逐字相同。 */
export function bundleOf(
  draft: InterviewerDraft,
  options: { id?: string; salt?: string; version?: number; budget?: ContractBudgetView } = {},
): ContractBundle {
  const id = options.id !== undefined && options.id !== '' ? options.id : draftIdOf(draft, options.salt ?? '');
  const version = options.version ?? 1;
  const contract = buildCustomContract({
    id,
    draft,
    budget: options.budget ?? budgetView(DEFAULT_BUDGET),
    version,
  });
  return { id, version, digest: contractDigest(contract), contract, systemPrompt: renderSystemPrompt(contract) };
}

export interface DraftInput {
  client: LlmClient;
  description: string;
  jobTitle?: string;
  jdText?: string;
  resumeText?: string;
  /** 已经有一份草稿时（「再优化一遍」），界面要能显示 AI 到底改了什么 */
  before?: InterviewerDraft;
  /** 编辑既有面试官时传它的 id：名字改了也不能换人 */
  id?: string;
  /** id 的盐，默认空串（同名即同一位） */
  salt?: string;
  version?: number;
  budget?: ContractBudgetView;
}

export interface DraftOutcome {
  draft: InterviewerDraft;
  /** llm = 模型出的；local = 规则兜底 */
  source: 'llm' | 'local';
  /** 给用户看的说明：命中了哪些规则、为什么没用上模型 */
  notes: string[];
  /** 模型这条路没走通的原因；走通了就是 null */
  fallbackReason: string | null;
  /** 传了 before 才有内容：字段级 diff */
  diff: DraftDiff[];
  bundle: ContractBundle;
  raw: string;
  usage: LlmUsage;
  replayed: boolean;
}

/** 只做本地草稿，不碰网络。页面上的「先用规则生成一版」走它。 */
export function localOutcome(input: Omit<DraftInput, 'client'>): DraftOutcome {
  const draft = localDraftFromText(input.description, input.before ?? {});
  return {
    draft,
    source: 'local',
    notes: localDraftNotes(input.description, draft),
    fallbackReason: null,
    diff: input.before === undefined ? [] : diffDrafts(input.before, draft),
    bundle: bundleOf(draft, input),
    raw: '',
    usage: EMPTY_USAGE,
    replayed: false,
  };
}

function fallback(input: Omit<DraftInput, 'client'>, reason: string): DraftOutcome {
  const outcome = localOutcome(input);
  outcome.fallbackReason = reason;
  outcome.notes = ['模型这条路没有走通：' + reason, ...outcome.notes];
  return outcome;
}
/**
 * 模型路径。任何一步不对就退回本地草稿，并且**把原因说清楚**：
 * 抛错会把用户已经写好的那段描述一起丢掉，那才是真的损失。
 */
export async function optimizeDraft(input: DraftInput): Promise<DraftOutcome> {
  const description = input.description.trim();
  if (description === '') {
    throw new Error('先用一句话说清你要一位什么样的面试官，再让 AI 优化。');
  }
  const request = stageRequest(
    'contract',
    CONTRACT_OPTIMIZER_SYSTEM,
    buildContractPrompt({
      description,
      jobTitle: input.jobTitle,
      jdText: input.jdText,
      resumeText: input.resumeText,
    }),
    'contract',
  );

  let raw = '';
  try {
    const result = await input.client.complete(request);
    raw = result.text;
    const parsed = parseLlmOutput(interviewerDraftSchema, result.text);
    if (!parsed.ok) {
      return { ...fallback(input, '模型输出的字段不合约（' + parsed.error + '）'), raw, usage: result.usage, replayed: result.replayed };
    }
    const draft = parsed.value;
    return {
      draft,
      source: 'llm',
      notes: ['由模型按你的描述生成，字段已逐项校验通过；下面每一条都可以手工改。'],
      fallbackReason: null,
      diff: input.before === undefined ? [] : diffDrafts(input.before, draft),
      bundle: bundleOf(draft, input),
      raw,
      usage: result.usage,
      replayed: result.replayed,
    };
  } catch (err) {
    // 卡带缺失在回放模式里是常态（这份草稿当初没被录过），不该被当成异常吓用户一跳。
    const reason =
      err instanceof LlmError
        ? err.code === 'cassette-missing'
          ? '这一份描述在离线卡带里没有录过，改用本地规则生成'
          : err.message
        : err instanceof Error
          ? err.message
          : String(err);
    return { ...fallback(input, reason), raw, usage: EMPTY_USAGE, replayed: false };
  }
}
