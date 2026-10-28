/**
 * 便携包专用：把 @crossexam/* 指回 packages/ 下的真实文件。
 *
 * 为什么要这一步：Node 的原生类型剥离**拒绝处理 node_modules 里的 .ts**
 * （ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING）。开发时工作区把 packages/* 软链进
 * node_modules，真实路径在 node_modules 之外，所以能跑；便携包里没有软链，
 * 一旦把 @crossexam/shared 放进 node_modules，服务端就起不来了。
 *
 * 与其把包打进 node_modules，不如在解析阶段把它们指回 packages/：
 * 路径仍在 node_modules 之外，类型剥离照常工作，包内布局也与仓库一致。
 */
import { registerHooks } from 'node:module';

const prefix = '@crossexam/';
const root = new URL('../../', import.meta.url);

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (!specifier.startsWith(prefix)) return nextResolve(specifier, context);
    const rest = specifier.slice(prefix.length);
    const parts = rest.split('/');
    const pkg = parts[0];
    const tail = parts.slice(1).join('/');
    const target = tail.length === 0 ? 'index.ts' : tail;
    return { url: new URL('packages/' + pkg + '/src/' + target, root).href, shortCircuit: true };
  },
});