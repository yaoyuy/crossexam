/**
 * 阶段 → 模型 的路由。
 *
 * 为什么做成一层包装、而不是让每个阶段自己挑模型：
 * 编排代码只该关心「这一阶段要问什么」，用哪个模型是装配层的事。
 * 换模型因此不需要动任何提示词，也不会让卡带失效——
 * 指纹只由 system / messages / temperature / maxTokens / json 决定，本来就不含模型名。
 */

import type { LlmClient, LlmRequest } from './types.ts';

export function withStageModels(inner: LlmClient, routes: Record<string, string>): LlmClient {
  if (Object.keys(routes).length === 0) return inner;

  function route(req: LlmRequest): LlmRequest {
    const model = routes[req.purpose];
    if (model === undefined || model === '') return req;
    return { ...req, model: model };
  }

  return {
    mode: inner.mode,
    complete: (req) => inner.complete(route(req)),
    stream: (req) => inner.stream(route(req)),
  };
}
