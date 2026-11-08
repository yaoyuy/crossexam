/**
 * 验收一：全接口矩阵（78 项，零 Key，离线回放）。
 *
 * 为什么要有它：单元测试用的是同进程的 app.request，进程边界上的坑（表没建、端口没监听、
 * SSE 不收尾、静态托管没接上）它一个都看不见。这里起一个真进程，把 HTTP 面上每一个接口、
 * 每一条错误分支都真打一遍，包括 SSE 流式路径与报告下载。
 *
 * 可移植性：端口默认现找空的，临时库落在系统临时目录，服务端 cwd 固定仓库根。
 * 前端产物不在 git 里（dist/ 被忽略），没构建过时「静态托管」那 5 项会明确 SKIP 而不是假通过。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Recorder, env, installCleanup, pickPort, portInUse, sleep, startServer, webBuilt } from './lib/accept.mjs';

const PORT = await pickPort(env('CROSSEXAM_ACCEPT_PORT'));
const BASE = 'http://127.0.0.1:' + String(PORT);
const DB_DIR = mkdtempSync(join(tmpdir(), 'crossexam-api-'));
const DB = join(DB_DIR, 'api.db');
const built = webBuilt();
const rec = new Recorder('全接口矩阵（离线回放，零 Key）');
const ok = (label, cond, extra) => rec.ok(label, cond, extra);
async function j(method, path, body) {
  const init = { method, headers: {} };
  if (body !== undefined) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
  const res = await fetch(BASE + path, init);
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = null; }
  return { status: res.status, text, data, headers: res.headers };
}
async function sseRun(sessionId, query) {
  const res = await fetch(BASE + '/api/sessions/' + sessionId + '/run' + query, { method: 'POST' });
  const text = await res.text();
  const events = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('event: ')) events.push(line.slice(7).trim());
  }
  return { status: res.status, text, events };
}

// 端口是显式指定的，就必须干净，否则测的是旧代码
if (env('CROSSEXAM_ACCEPT_PORT') !== '' && (await portInUse(PORT))) {
  console.log('FAIL  端口 ' + PORT + ' 已被占用，拒绝在旧进程上做验收');
  process.exit(1);
}

const cleanup = installCleanup();
const server = await startServer({ mode: 'replay', port: PORT, dbPath: DB, cleanup });
const boot = server.log;

try {
  const health = server.health;
  ok('服务起得来 /api/health', health !== null, boot());
  ok('回放模式报告 mode=replay', health !== null && health.mode === 'replay', health && health.mode);
  ok('健康检查带 runMode 与卡带目录', health !== null && typeof health.runMode === 'string' && typeof health.cassetteDir === 'string');

  // 示例素材
  const demo = await j('GET', '/api/demo');
  ok('GET /api/demo 200', demo.status === 200, demo.status);
  ok('示例简历是合成素材（361 字）', demo.data !== null && demo.data.resume.length === 361, demo.data && demo.data.resume.length);
  ok('示例 JD 非空', demo.data !== null && demo.data.jd.length > 100);
  ok('示例标题带「演示简历」', demo.data !== null && demo.data.title.includes('演示简历'));

  // 契约接口
  const c1 = await j('GET', '/api/contracts');
  ok('GET /api/contracts 默认三条契约', c1.status === 200 && c1.data.contracts.length === 3, c1.status);
  ok('契约默认面板是 tech/hr/hiring_manager', c1.data && c1.data.panel.join(',') === 'tech,hr,hiring_manager', c1.data && c1.data.panel.join(','));
  ok('开跑前契约没有对账记录（storedDigest=null）', c1.data.contracts.every((x) => x.storedDigest === null && x.verified === false));
  ok('契约指纹是 16 位十六进制', c1.data.contracts.every((x) => /^[0-9a-f]{16}$/.test(x.digest)));
  const c2 = await j('GET', '/api/contracts?panel=tech,stress');
  ok('GET /api/contracts?panel=tech,stress 200 且两条', c2.status === 200 && c2.data.contracts.length === 2, c2.status);
  const c3 = await j('GET', '/api/contracts?panel=tech,cto');
  ok('契约接口对未知角色显式 400', c3.status === 400, c3.status);
  ok('400 文案点名 cto 并给出可选值', c3.data !== null && c3.data.error.includes('cto') && c3.data.error.includes('domain_expert'), c3.data && c3.data.error);

  // 会话列表（空）
  const empty = await j('GET', '/api/sessions');
  ok('GET /api/sessions 空库返回空数组', empty.status === 200 && Array.isArray(empty.data.sessions) && empty.data.sessions.length === 0, empty.text.slice(0, 200));

  // 建档：错误分支
  const tooShort = await j('POST', '/api/sessions', { resumeText: '太短了' });
  ok('简历过短 400', tooShort.status === 400, tooShort.status);
  ok('400 文案说明至少要 30 字', tooShort.data !== null && tooShort.data.error.includes('30'), tooShort.data && tooShort.data.error);
  const noBody = await j('POST', '/api/sessions', {});
  ok('既没简历也没示例 400', noBody.status === 400, noBody.status);
  const badJson = await fetch(BASE + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
  ok('请求体不是合法 JSON 时不崩（4xx）', badJson.status >= 400 && badJson.status < 500, badJson.status);

  // 建档：示例
  const made = await j('POST', '/api/sessions', { useDemo: true });
  ok('POST /api/sessions useDemo 201', made.status === 201, made.status + ' ' + made.text.slice(0, 200));
  const sid = made.data && made.data.id;
  ok('返回会话 id 与模式', typeof sid === 'string' && made.data.mode === 'replay', made.data && made.data.mode);

  const detail0 = await j('GET', '/api/sessions/' + sid);
  ok('GET 会话详情 200', detail0.status === 200, detail0.status);
  ok('详情含 session/claims/probes/events/contracts 等字段',
    detail0.data !== null && ['session', 'claims', 'probes', 'events', 'llm', 'verdicts', 'suggestions', 'contracts'].every((k) => k in detail0.data),
    detail0.data && Object.keys(detail0.data).join(','));
  ok('未开跑时会话状态是 draft', detail0.data.session.status === 'draft', detail0.data.session.status);
  ok('未开跑时没有主张', detail0.data.claims.length === 0);
  ok('简历原文在 session 里', typeof detail0.data.session.resumeText === 'string' && detail0.data.session.resumeText.length === 361);

  const miss404 = await j('GET', '/api/sessions/s_nope');
  ok('不存在的会话 404', miss404.status === 404, miss404.status);
  ok('404 是中文文案', miss404.data !== null && miss404.data.error.includes('会话不存在'), miss404.data && miss404.data.error);
  const report404 = await j('GET', '/api/sessions/s_nope/report.md');
  ok('不存在的会话下载报告 404', report404.status === 404, report404.status);
  const run404 = await j('POST', '/api/sessions/s_nope/run?stream=0');
  ok('不存在的会话开跑 404', run404.status === 404, run404.status);

  // 开跑（JSON 路径，走 complete 不流式）
  const ran = await j('POST', '/api/sessions/' + sid + '/run?stream=0');
  ok('POST run?stream=0 200', ran.status === 200, ran.status + ' ' + ran.text.slice(0, 300));
  const s = ran.data || {};
  ok('跑完 3 轮', s.rounds === 3, s.rounds);
  ok('抽到 5 条主张', s.claims === 5, s.claims);
  ok('追问 10 次', s.probes === 10, s.probes);
  ok('判定 5 条', Array.isArray(s.verdicts) && s.verdicts.length === 5, Array.isArray(s.verdicts) ? s.verdicts.length : typeof s.verdicts);
  ok('改写建议 4 条', s.suggestions === 4, s.suggestions);
  ok('被锚定机制拦下 1 条', s.rejectedClaims === 1, s.rejectedClaims);
  ok('通知如实记下被丢弃的主张与空转的一轮', Array.isArray(s.notices) && s.notices.length === 2 && s.notices[1].includes('没有任何新的追问'), JSON.stringify(s.notices));
  // 2267 → 4120：卡带里记的是合成 usage，提示词一改就整批漂移。当前值见 docs/tech/04-reproducibility.md 的表。
  ok('usage 有输出 token', s.usage && s.usage.outputTokens === 4120, s.usage && s.usage.outputTokens);
  const again = await j('POST', '/api/sessions/' + sid + '/run?stream=0');
  ok('同一会话重复开跑 409', again.status === 409, again.status);
  ok('409 文案说明已经跑过', again.data !== null && again.data.error.includes('已经跑过'), again.data && again.data.error);

  const detail1 = await j('GET', '/api/sessions/' + sid);
  ok('跑完状态变 done', detail1.data.session.status === 'done', detail1.data.session.status);
  ok('主张落库 5 条', detail1.data.claims.length === 5, detail1.data.claims.length);
  ok('追问落库 10 条', detail1.data.probes.length === 10, detail1.data.probes.length);
  ok('每条追问都有作答', detail1.data.probes.every((p) => p.answer !== null));
  ok('判定分布含四种', new Set(detail1.data.verdicts.map((v) => v.verdict.kind)).size === 4, detail1.data.verdicts.map((v) => v.verdict.kind).join(','));
  // 18 → 24：后面新增了 jd-extract/jd-merge/jd-match、counter 与一轮 answer 共 6 条阶段事件（分片仍然不进表）。
  ok('事件条数 24', detail1.data.events.length === 24, detail1.data.events.length);
  ok('事件 seq 从 1 连续', detail1.data.events.every((e, i) => e.seq === i + 1));

  ok('账本记录 33 次调用且全是回放', detail1.data.llm.calls === 33 && detail1.data.llm.replayedCalls === 33, JSON.stringify(detail1.data.llm));

  ok('跑完契约对账一致（verified）', detail1.data.contracts.length === 3 && detail1.data.contracts.every((x) => x.verified === true && x.storedDigest === x.digest), JSON.stringify(detail1.data.contracts.map((x) => [x.id, x.digest, x.storedDigest, x.verified])));
  const evs = await j('GET', '/api/sessions/' + sid + '/events?from=10');
  ok('事件续传只给 seq>10 的', evs.status === 200 && evs.data.events.length === 14, evs.data && evs.data.events.length);
  ok('续传信封带 from', evs.data && evs.data.from === 10, evs.data && evs.data.from);
  const evsBad = await j('GET', '/api/sessions/' + sid + '/events?from=abc');
  ok('from 不是数字时退回 0 而不是 500', evsBad.status === 200 && evsBad.data.from === 0, evsBad.status + ' ' + (evsBad.data && evsBad.data.from));

  const rep = await fetch(BASE + '/api/sessions/' + sid + '/report.md');
  const repText = await rep.text();
  ok('报告 200 且是 markdown', rep.status === 200 && (rep.headers.get('content-type') || '').includes('markdown'), rep.status);
  ok('报告带附件下载头', (rep.headers.get('content-disposition') || '').includes('attachment'), rep.headers.get('content-disposition'));
  // 章节表跟着产品走：JD 对照与「轮到你了」是后加的两节，编号因此整体后移。
  ok('报告含六个正文章节与拦下清单',
    ['## 一、主张与判定', '## 二、岗位要求对照', '## 三、追问实录', '## 四、轮到你了', '## 五、简历修改建议', '## 六、复现方式', '### 被锚定机制拦下的主张'].every((k) => repText.includes(k)),
    repText.slice(0, 120));

  const stats = await j('GET', '/api/stats?session=' + sid);
  ok('GET /api/stats 200', stats.status === 200, stats.status);
  ok('统计 calls=33 且回放 33', stats.data.calls === 33 && stats.data.replayedCalls === 33, JSON.stringify(stats.data).slice(0, 200));
  const statsAll = await j('GET', '/api/stats');
  ok('不带 session 也返回全局统计', statsAll.status === 200 && statsAll.data.calls === 33, statsAll.status);

  // 第二场：SSE 流式路径
  const made2 = await j('POST', '/api/sessions', { useDemo: true });
  const sid2 = made2.data.id;
  const sse = await sseRun(sid2, '');
  ok('SSE 开跑 200', sse.status === 200, sse.status);
  ok('SSE 有 stage/claims/probes/answers/verdicts/suggestions/result',
    ['stage', 'claims', 'probes', 'answers', 'verdicts', 'suggestions', 'result'].every((e) => sse.events.includes(e)),
    sse.events.join(','));
  ok('SSE 有实时分片 event: stream', sse.events.includes('stream'));
  ok('SSE 没有 fatal', !sse.events.includes('fatal'));
  ok('分片带 channel 与 kind', sse.text.includes('"channel":"probe:tech"') && sse.text.includes('"kind":"text"') && sse.text.includes('"channel":"extract"'), sse.text.slice(0, 300));
  const detail2 = await j('GET', '/api/sessions/' + sid2);
  ok('分片不进事件表（仍是 24 条）', detail2.data.events.length === 24, detail2.data.events.length);
  ok('默认三位面试官落三条契约', detail2.data.contracts.length === 3, detail2.data.contracts.length);

  // 自建简历
  const mine = await j('POST', '/api/sessions', {
    resumeText: '李雷\n数据工程师\n\n项目经历\n- 用 Flink 把订单宽表延迟从 40 分钟压到 5 分钟。\n- 搭建指标平台，覆盖 60 个核心指标。',
    jdText: '数据工程师，要求熟悉 Flink 与指标体系建设，有实时数仓、湖仓一体项目的落地经验，能独立完成指标口径设计。',
    jobTitle: '数据工程师（自建）',
  });
  ok('自建简历建档 201', mine.status === 201, mine.status + ' ' + mine.text.slice(0, 200));
  ok('自建会话标记来源 user', mine.data !== null);

  // 删除
  const del = await j('DELETE', '/api/sessions/' + sid2);
  ok('DELETE 会话 200', del.status === 200, del.status);
  const afterDel = await j('GET', '/api/sessions/' + sid2);
  ok('删掉后详情 404', afterDel.status === 404, afterDel.status);
  const listAfter = await j('GET', '/api/sessions');
  ok('删掉后列表只剩两场', listAfter.data.sessions.length === 2, listAfter.data.sessions.length);

  // 静态托管与 404（要前端产物，dist/ 不在 git 里）
  rec.group('静态托管（需要 npm run build 的产物）');
  if (!built) {
    for (const label of ['GET / 200 且是 HTML', '首页含 CrossExam', '前端路由回退到 index.html', '首页引用了打包后的 js', '静态资源可下载']) {
      rec.skip(label, '没有 packages/web/dist/index.html，先跑 npm run build');
    }
  } else {
    const home = await fetch(BASE + '/');
    const homeText = await home.text();
    ok('GET / 200 且是 HTML', home.status === 200 && (home.headers.get('content-type') || '').includes('html'), home.status);
    ok('首页含 CrossExam', homeText.includes('CrossExam'));
    const deep = await fetch(BASE + '/some/deep/path');
    const deepText = await deep.text();
    ok('前端路由回退到 index.html', deep.status === 200 && deepText.includes('CrossExam'), deep.status);
    const asset = homeText.match(/\/assets\/[A-Za-z0-9._-]+\.js/);
    ok('首页引用了打包后的 js', asset !== null, asset && asset[0]);
    if (asset !== null) {
      const js = await fetch(BASE + asset[0]);
      ok('静态资源可下载', js.status === 200 && (await js.text()).length > 10000, js.status);
    } else {
      rec.skip('静态资源可下载', '首页没引用打包 js，上一项已经 FAIL');
    }
  }
  const nope = await j('GET', '/api/nope');
  ok('未知接口 404 且中文', nope.status === 404 && nope.data.error.includes('没有这个接口'), nope.status + ' ' + (nope.data && nope.data.error));
  const wrongMethod = await j('GET', '/api/sessions/' + sid + '/run');
  ok('开跑只接受 POST（GET 404）', wrongMethod.status === 404, wrongMethod.status);
} catch (err) {
  rec.ok('脚本跑到底', false, String(err && err.stack ? err.stack : err).slice(0, 400));
} finally {
  if (server.child !== undefined) server.child.kill();
  await sleep(500);
  try { rmSync(DB_DIR, { recursive: true, force: true }); } catch { /* 删不掉就算了，反正落在临时目录 */ }
}

const code = rec.summary();
process.exit(code);
