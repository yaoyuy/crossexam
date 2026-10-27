import { describe, expect, it } from 'vitest';
import type { ClaimCategory, VerdictKind } from '../src/domain.ts';
import type { GrowthSession } from '../src/growth.ts';
import { growthHeadline, growthNote, growthOf, growthPointOf, trailLine } from '../src/growth.ts';

function claim(id: string, text: string, verdict: VerdictKind | null, category: ClaimCategory = 'metric') {
  return { id, text, category, verdict };
}

function session(
  id: string,
  createdAt: string,
  claims: ReturnType<typeof claim>[],
  probes: number | null = 3,
): GrowthSession {
  return { id, createdAt, jobTitle: '后端工程师', claims, probes };
}

const RESUME_V1 = session('s1', '2026-10-20T10:00:00.000Z', [
  claim('C1', '主导订单系统重构，首屏加载从 2.4s 降到 0.8s', 'solid'),
  claim('C2', '主导引入 Redis 缓存，QPS 从 800 提升到 5000', 'overstated'),
  claim('C3', '独立完成 RBAC 权限模块，覆盖 12 个业务线', 'unsupported'),
]);

const RESUME_V2 = session('s2', '2026-10-21T10:00:00.000Z', [
  claim('C1', '主导订单系统重构，首屏加载从 2.4s 降到 0.8s', 'solid'),
  claim('C2', '主导引入 Redis 缓存，QPS 从 800 提升到 5000', 'solid'),
  claim('C3', '独立完成 RBAC 权限模块，覆盖 12 个业务线', 'unsupported'),
]);

describe('成长档案：把相邻两版的配对连成一条链', () => {
  it('一场都没有时不给空框，直接说没有可连的场次', () => {
    const view = growthOf([]);
    expect(view.versions).toEqual([]);
    expect(view.trails).toEqual([]);
    expect(view.headline).toContain('还没有可以连成轨迹的场次');
    expect(view.trailNote).toBeNull();
  });

  it('只有一版时全是单点，并且说明轨迹要等第二版', () => {
    const view = growthOf([RESUME_V1]);
    expect(view.versions.length).toBe(1);
    expect(view.trails.length).toBe(3);
    expect(view.single).toBe(3);
    expect(view.headline).toContain('目前只有 1 版');
    expect(view.trailNote).toContain('再按「改完再跑一遍」跑一版');
    expect(view.trails[0]?.steps.length).toBe(1);
    expect(view.trails[0]?.steps[0]?.shift).toBeNull();
  });

  it('同一条主张改完还在，就接成同一根链并记下判定变化', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    expect(view.versions.length).toBe(2);
    const c2 = view.trails.find((trail) => trail.text.includes('Redis'));
    expect(c2).toBeDefined();
    expect(c2?.versions).toBe(2);
    expect(c2?.steps.map((step) => step.claimId)).toEqual(['C2', 'C2']);
    expect(c2?.steps[1]?.shift).toBe('better');
    expect(c2?.verdict).toBe('solid');
    expect(c2?.presentInLatest).toBe(true);
    expect(c2?.persistent).toBe(false);
  });

  it('改了还在被打回的单独挑出来：出现多版、从来没站住、最新一次仍有判定', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    const c3 = view.trails.find((trail) => trail.text.includes('RBAC'));
    expect(c3?.persistent).toBe(true);
    expect(c3?.versions).toBe(2);
    expect(view.persistent.map((trail) => trail.text.includes('RBAC'))).toEqual([true]);
    // 已经改站住的不会混进「还在被打回」
    expect(view.persistent.some((trail) => trail.text.includes('Redis'))).toBe(false);
  });

  it('改好的那些进【已经改站住】', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    expect(view.fixed.map((trail) => trail.text.includes('Redis'))).toEqual([true]);
  });

  it('改到完全不像了就是两条链：链只连相邻两版，不跳版配对', () => {
    const replaced = session('s2', '2026-10-21T10:00:00.000Z', [
      claim('C1', '拿到普通话二级甲等证书，做过校园广播站播音', 'solid'),
    ]);
    const view = growthOf([RESUME_V1, replaced]);
    expect(view.trails.length).toBe(4);
    const gone = view.trails.filter((trail) => !trail.presentInLatest);
    expect(gone.length).toBe(3);
    // 四条链各只出现过一版（三条停在第一版、一条是新出现的）
    expect(view.single).toBe(4);
  });

  it('中间一版整条不见了、下一版又出现：断成两段，不假装连续', () => {
    const v2 = session('s2', '2026-10-21T10:00:00.000Z', [
      claim('C1', '拿到普通话二级甲等证书，做过校园广播站播音', 'solid'),
    ]);
    const v3 = session('s3', '2026-10-22T10:00:00.000Z', [
      claim('C1', '主导订单系统重构，首屏加载从 2.4s 降到 0.8s', 'unsupported'),
      claim('C2', '主导引入 Redis 缓存，QPS 从 800 提升到 5000', 'solid'),
    ]);
    const view = growthOf([RESUME_V1, v2, v3]);
    const order = view.trails.filter((trail) => trail.text.includes('2.4s')).map((trail) => trail.versions);
    // 第一版那条停在第一版（1），第三版又出现时另起一条（1）——中间断掉就不连
    expect(order).toEqual([1, 1]);
  });

  it('入参顺序不影响结论：先排序再连链', () => {
    const inOrder = growthOf([RESUME_V1, RESUME_V2]);
    const shuffled = growthOf([RESUME_V2, RESUME_V1]);
    expect(shuffled.headline).toBe(inOrder.headline);
    expect(shuffled.trails.map((trail) => trail.key)).toEqual(inOrder.trails.map((trail) => trail.key));
    expect(shuffled.versions.map((point) => point.sessionId)).toEqual(['s1', 's2']);
  });

  it('追问取不到时是 null，不当成 0', () => {
    const noProbes = session('s1', '2026-10-20T10:00:00.000Z', [claim('C1', '写了什么', 'solid')], null);
    const point = growthPointOf(noProbes, 0);
    expect(point.probes).toBeNull();
    expect(point.judged).toBe(1);
    expect(point.solid).toBe(1);
  });

  it('一条链的说明写清楚它改了多狠、现在什么结论', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    const c3 = view.trails.find((trail) => trail.text.includes('RBAC'));
    expect(c3).toBeDefined();
    if (c3 === undefined) return;
    const line = trailLine(c3);
    expect(line).toContain('前后出现 2 版');
    expect(line).toContain('「证据缺失」');
    const c2 = view.trails.find((trail) => trail.text.includes('Redis'));
    expect(c2).toBeDefined();
    if (c2 === undefined) return;
    expect(trailLine(c2)).toContain('「站得住」');
  });

  it('headline 把总数、还在被打回、已经改站住一起说清', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    expect(view.headline).toContain('2 版');
    expect(view.headline).toContain('改了还在被打回 1 条');
    expect(view.headline).toContain('已经改站住 1 条');
  });

  it('growthNote 与 growthHeadline 都是纯函数，同样的输入永远同样的字', () => {
    const view = growthOf([RESUME_V1, RESUME_V2]);
    const base = {
      versions: view.versions,
      trails: view.trails,
      persistent: view.persistent,
      fixed: view.fixed,
      single: view.single,
    };
    expect(growthHeadline(base)).toBe(view.headline);
    expect(growthNote([RESUME_V1, RESUME_V2], view.trails)).toBeNull();
    expect(growthNote([RESUME_V1], [])).toContain('再按「改完再跑一遍」');
  });
});
