/**
 * 把 DSH 事件流还原成「一次对话到底发生了什么」的时间线。
 *
 * 关键点一：user/message 里混着真人输入和系统注入（runtime-context、skill-catalog、
 * plugin:hindsight、time-context、agent-instructions…）。参赛要求的是 **Prompt 链**，
 * 也就是「我提了什么 -> AI 怎么答 -> 我怎么纠」，所以只有 source.kind === 'user'
 * 才算真人提问；其余默认丢弃（可显式保留用于调试）。
 *
 * 关键点二：工具调用的 名称/参数 同时出现在 assistant/message 的 tool-call 内容块和
 * 独立的 tool/call 事件里。用 callId 归并，谁先到谁先建条目，tool/call 事件更权威。
 */
const toolEntriesByCall = new Map();

function textOf(content) {
  if (!Array.isArray(content)) return '';
  return content
    .filter((p) => p && p.type === 'text' && typeof p.text === 'string')
    .map((p) => p.text)
    .join('\n');
}

function argsToRaw(a) {
  if (a === undefined || a === null) return '';
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a, null, 2); } catch { return String(a); }
}

/**
 * @param {any[]} events
 * 注意：工具结果在这里**不截断**，只记录原始长度；截断是呈现层的事。
 * 早先在两层各截一次，导致输出里出现「已省略…（原始长度 N）」套娃。
 * @param {{ keepInjected?: boolean }} [opts]
 */
export function buildTimeline(events, opts) {
  const o = opts || {};
  const keepInjected = !!o.keepInjected;

  const turns = [];
  let current = null;
  const usage = { calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0 };

  const ensureTurn = (n) => {
    const idx = typeof n === 'number' ? n : (current ? current.index : 1);
    if (!current || current.index !== idx) {
      current = { index: idx, startedAt: null, endedAt: null, entries: [] };
      turns.push(current);
    }
    return current;
  };

  const toolEntries = new Map();
  const ptcByRoot = new Map();

  const upsertTool = (turn, callId, name, rawArgs) => {
    let entry = callId ? toolEntries.get(callId) : null;
    if (!entry) {
      entry = {
        kind: 'tool', at: null, callId: callId || null, name: name || 'unknown',
        rawArgs: rawArgs || '', result: null, isError: false, subCalls: [],
      };
      turn.entries.push(entry);
      if (callId) toolEntries.set(callId, entry);
    } else {
      if (name) entry.name = name;
      if (rawArgs) entry.rawArgs = rawArgs;
    }
    return entry;
  };

  for (const ev of events) {
    const d = ev.data || {};
    switch (ev.type) {
      case 'turn/start':
        ensureTurn(d.turn).startedAt = ev.time ?? null;
        break;

      case 'turn/end': {
        const t = ensureTurn(d.turn);
        t.endedAt = ev.time ?? null;
        break;
      }

      case 'user/message': {
        const kind = d.source && d.source.kind;
        const isHuman = kind === 'user';
        if (!isHuman && !keepInjected) break;
        ensureTurn(d.turn).entries.push({
          kind: 'user', at: ev.time ?? null, text: textOf(d.content),
          sourceKind: kind || 'unknown', isHuman,
        });
        break;
      }

      case 'assistant/message': {
        const t = ensureTurn(d.turn);
        usage.calls++;
        const u = d.usage || {};
        usage.inputTokens += u.inputTokens || 0;
        usage.outputTokens += u.outputTokens || 0;
        usage.cacheReadTokens += u.cacheReadTokens || 0;
        usage.reasoningTokens += u.reasoningTokens || 0;
        for (const part of (d.message && d.message.content) || []) {
          if (!part || typeof part !== 'object') continue;
          if (part.type === 'reasoning' && part.text) {
            t.entries.push({ kind: 'reasoning', at: ev.time ?? null, text: part.text });
          } else if (part.type === 'text' && part.text) {
            t.entries.push({ kind: 'assistant', at: ev.time ?? null, text: part.text });
          } else if (part.type === 'tool-call') {
            const e = upsertTool(t, part.id, part.name, argsToRaw(part.arguments));
            if (e.at === null) e.at = ev.time ?? null;
          }
        }
        break;
      }

      case 'tool/call': {
        const t = ensureTurn(d.turn);
        const e = upsertTool(t, d.callId, d.name, argsToRaw(d.arguments));
        if (e.at === null) e.at = ev.time ?? null;
        break;
      }

      case 'tool/result': {
        const m = d.message || {};
        const entry = toolEntries.get(m.toolCallId);
        if (entry) {
          const full = textOf(m.content);
          entry.result = { text: full, fullLength: full.length };
          entry.isError = !!m.isError;
        }
        break;
      }

      case 'tool/ptc-dispatch': {
        // run_code 内部真正执行的每一个子工具调用——过程证据里最有价值的一层
        const root = d.rootCallId;
        if (!ptcByRoot.has(root)) ptcByRoot.set(root, []);
        ptcByRoot.get(root).push({
          name: d.name,
          rawArgs: argsToRaw(d.arguments),
          isError: !!d.isError,
        });
        break;
      }

      default:
        break;
    }
  }

  for (const [root, subs] of ptcByRoot) {
    const entry = toolEntries.get(root);
    if (entry) entry.subCalls = subs;
  }

  return { turns, usage };
}

/** 从事件流里取元信息（标题、模型、工作目录、时间范围） */
export function extractMeta(events) {
  const header = events.find((e) => e.type === 'session') || {};
  const titles = events.filter((e) => e.type === 'session/title' && e.data && e.data.title);
  const ctxs = events.filter((e) => e.type === 'request/context' && e.data);
  const lastCtx = ctxs.length ? ctxs[ctxs.length - 1].data : {};
  const human = events.filter(
    (e) => e.type === 'user/message' && e.data && e.data.source && e.data.source.kind === 'user',
  );
  const times = events.map((e) => e.time).filter((t) => typeof t === 'number' && t > 0);
  return {
    id: header.id || null,
    cwd: header.cwd || null,
    version: header.version ?? null,
    agentPreset: header.agentPreset || null,
    createdAt: header.createdAt || (times.length ? times[0] : null),
    updatedAt: times.length ? times[times.length - 1] : null,
    title: titles.length ? titles[titles.length - 1].data.title : null,
    provider: lastCtx.provider || null,
    model: lastCtx.model || null,
    contextWindow: lastCtx.contextWindow ?? null,
    humanMessageCount: human.length,
    eventCount: events.length,
  };
}
