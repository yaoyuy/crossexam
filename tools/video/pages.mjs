// 生成 b6–b11 的静态证据页（内容全部取自仓库真实文件与真实命令输出）
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const ROOT = 'D:/CZB/.tmp/video/pages';
mkdirSync(ROOT, { recursive: true });
const read = (p) => readFileSync(p, 'utf8');
const smoke = read('D:/CZB/.tmp/video/smoke.log');
const verify = read('D:/CZB/.tmp/video/verify.log');
const pickSmoke = smoke.split('\n').filter((l) => l.includes('[ok]'));
const pickVerify = verify.split('\n').filter((l) => /Tests |Test Files|modules transformed|性能预算通过|冒烟通过/.test(l));

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; background: radial-gradient(1200px 700px at 12% -8%, #1a2030 0%, #0b0f14 55%, #080b0f 100%);
  color: #e6e9f0; font-family: 'Microsoft YaHei UI', 'Microsoft YaHei', sans-serif;
  width: 1920px; min-height: 1080px; padding: 88px 96px 120px;
}
.kicker { display: inline-flex; align-items: center; gap: 12px; font-size: 22px; letter-spacing: .06em;
  color: #f6b45f; border: 1px solid rgba(246,180,95,.36); background: rgba(246,180,95,.08);
  padding: 10px 18px; border-radius: 999px; }
h1 { font-size: 62px; line-height: 1.16; margin: 30px 0 18px; font-weight: 700; letter-spacing: -.01em; }
.lead { font-size: 27px; line-height: 1.7; color: #9aa4b2; max-width: 1260px; margin: 0 0 54px; }
.lead b { color: #e6e9f0; font-weight: 600; }
.cols { display: grid; grid-template-columns: 1fr 1fr; gap: 44px; align-items: start; }
.panel { border: 1px solid #222a36; border-radius: 18px; background: linear-gradient(180deg, #11161d, #0d1218); padding: 34px 36px; }
.panel h2 { font-size: 26px; margin: 0 0 20px; color: #cfd6e2; font-weight: 600; }
.panel .tag { font-size: 19px; color: #7c8797; margin-top: 18px; line-height: 1.7; }
pre { font-family: 'Cascadia Mono', Consolas, 'Microsoft YaHei UI', monospace; font-size: 22px; line-height: 1.66;
  margin: 0; white-space: pre-wrap; color: #d7dde8; }
.code { background: #0a0e13; border: 1px solid #1b2230; border-radius: 14px; padding: 24px 26px; }
.k { color: #7dd3fc; } .s { color: #86efac; } .c { color: #6b7684; } .bad { color: #fda4af; } .good { color: #86efac; }
.term { background: #05080c; border: 1px solid #1b2230; border-radius: 16px; padding: 26px 30px; }
.term .bar { display: flex; gap: 9px; margin-bottom: 18px; }
.term .dot { width: 13px; height: 13px; border-radius: 50%; background: #2b3441; }
.term .cmd { color: #93a1b4; font-family: 'Cascadia Mono', Consolas, monospace; font-size: 21px; margin-bottom: 14px; }
.term .line { font-family: 'Cascadia Mono', Consolas, monospace; font-size: 21px; line-height: 1.72; color: #b9c3d1; }
.term .line.err { color: #fda4af; }
.term .line.ok { color: #86efac; }
.foot { margin-top: 52px; font-size: 30px; color: #f6b45f; letter-spacing: .01em; }
.stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 26px; margin: 42px 0 46px; }
.stat { border: 1px solid #222a36; border-radius: 18px; padding: 28px 30px; background: #0e1319; }
.stat .n { font-size: 58px; font-weight: 700; color: #f6b45f; line-height: 1.1; }
.stat .l { font-size: 21px; color: #8b96a6; margin-top: 10px; }
.big { font-size: 76px; line-height: 1.3; font-weight: 700; letter-spacing: -.01em; }
.four { display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px; margin-top: 56px; }
.four div { border-left: 3px solid rgba(246,180,95,.7); padding: 10px 0 10px 22px; font-size: 30px; color: #e6e9f0; }
.four span { display: block; font-size: 20px; color: #7c8797; margin-top: 10px; }
`;

const page = (title, body) => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title><style>${CSS}</style></head><body>${body}</body></html>`;

const files = {};

files.b6 = page('证据锚定', `
<div class="kicker">六 · AI 协同：证据锚定</div>
<h1>坐标不信模型，只信引文能不能回原文</h1>
<p class="lead">Prompt 链快照 <b>64 份</b>（其中 <b>58 份分片</b>），由 <code>npm run export:prompt</code> 从会话日志自动导出，不是事后补写。</p>
<div class="cols">
  <div class="panel">
    <h2>模型返回的锚点</h2>
    <div class="code"><pre><span class="c">// 期望：把引文与坐标一起给回来</span>
{
  <span class="k">"claim"</span>: <span class="s">"首屏加载从 2.4s 降到 0.8s"</span>,
  <span class="k">"start"</span>: 407,
  <span class="k">"end"</span>: 431
}</pre></div>
    <p class="tag"><span class="bad">实测</span>：引文常常抄对了，坐标却差几十个字——模型算不准字符偏移。</p>
  </div>
  <div class="panel">
    <h2>程序实际采信的</h2>
    <div class="code"><pre><span class="c">// packages/shared/src/anchor.ts:68</span>
<span class="k">export function</span> locateQuote(source, quote) {
  <span class="k">const</span> q = quote.trim();
  <span class="k">const</span> at = source.indexOf(q);
  <span class="k">if</span> (at &gt;= 0) <span class="k">return</span> { start: at, end: at + q.length, exact: <span class="k">true</span> };
  <span class="k">const</span> hit = src.norm.indexOf(qn);
  <span class="k">if</span> (hit &lt; 0) <span class="k">return null</span>;
}</pre></div>
    <p class="tag"><span class="good">坐标一律以引文回原文重新定位</span>；模型的 start/end 只当提示。</p>
  </div>
</div>
<div class="foot">锚定是地基，不是加权项。</div>
`);

files.b7 = page('claimId', `
<div class="kicker">七 · AI 协同：一个真 Bug</div>
<h1>离线全绿，真跑一场才报错</h1>
<p class="lead">用户只说了两句：<b>「整体过一遍流程，跑一遍看看能不能用，测试每一个功能」</b>。AI 真跑一场，第一条修改建议就报错。</p>
<div class="cols">
  <div class="panel">
    <h2>live 实测：9 条建议全部失败</h2>
    <div class="term">
      <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      <div class="line err">修改建议返回不符合约定格式：claimId: Required</div>
      <div class="line err">修改建议返回不符合约定格式：claimId: Required</div>
      <div class="line err">……（同样一条 × 9）</div>
      <div class="line err">修改建议返回不符合约定格式：claimId: Required</div>
    </div>
    <p class="tag">提示词从没要求模型输出 claimId，<b>schema 却把它设成必填</b>。</p>
  </div>
  <div class="panel">
    <h2>为什么演示与单测都是绿的</h2>
    <div class="code"><pre><span class="c">// findings.md F23</span>
合成卡带的剧本恰好写了 claimId，
于是 29 盘演示素材与测试夹具一起，
把「提示词没要求、schema 却要求」
这个矛盾 <span class="bad">完整地掩盖</span>了。</pre></div>
    <p class="tag">处置：<span class="good">schema 的 claimId 改为 optional</span>，补两条回归；提交 <b>c8a6e90</b>。</p>
  </div>
</div>
<div class="foot">夹具照抄提示词，不要照抄 schema。</div>
`);

files.b8 = page('唯一约束', `
<div class="kicker">八 · AI 协同：唯一约束</div>
<h1>真实模型撞出来的 500</h1>
<p class="lead">同一轮里，一位面试官对同一条主张问了<b>两条</b>：先追口径，再追条件。编排器允许，数据库不允许。</p>
<div class="cols">
  <div class="panel">
    <h2>schema v2 的那一行</h2>
    <div class="code"><pre><span class="c">// 追问表</span>
<span class="bad">UNIQUE (session_id, claim_id, round, interviewer_id)</span>

<span class="c">// 编排器侧：MAX_PROBES_PER_TURN = 2</span></pre></div>
    <p class="tag">产品语义允许两条，约束却写死了只准一条。</p>
  </div>
  <div class="panel">
    <h2>撞上之后发生的事</h2>
    <div class="term">
      <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      <div class="line err">UNIQUE constraint failed: probe.session_id,</div>
      <div class="line err">  probe.claim_id, probe.round, probe.interviewer_id</div>
      <div class="line">persistResult → 整场事务回滚</div>
      <div class="line err">HTTP 500</div>
    </div>
    <p class="tag">处置：<span class="good">schema v3 走正式迁移去掉约束</span>，去重仍由 probe.ts 的 seenQuestions 负责（D20）。</p>
  </div>
</div>
<div class="foot">约束描述的是产品语义，不是我见过的数据形状。</div>
`);

files.b9 = page('真进程冒烟', `
<div class="kicker">九 · AI 协同：验证手段</div>
<h1>同进程测试全绿，真起进程第一次写入就崩</h1>
<p class="lead">单元测试用同进程的 <code>app.request</code>，看不见进程边界上的坑：表没建、端口没监听、SSE 不结束。</p>
<div class="cols">
  <div class="panel">
    <h2>第一次跑冒烟</h2>
    <div class="term">
      <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      <div class="line cmd">$ npm run smoke</div>
      <div class="line err">SqliteError: no such table: session</div>
      <div class="line">（同进程测试：全绿）</div>
    </div>
    <p class="tag">findings.md F11：进程边界上的坑，只有真起服务才看得见。</p>
  </div>
  <div class="panel">
    <h2>现在的冒烟：起真端口，走一遍关键路径</h2>
    <div class="term">
      <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
      ${pickSmoke.map((l) => '<div class="line ok">' + l.replace('[ok]', '✓').replace(/</g, '&lt;') + '</div>').join('\n      ')}
    </div>
  </div>
</div>
<div class="foot">四次迭代，四次都是先有证据、再改代码。</div>
`);

files.b10 = page('工程门禁', `
<div class="kicker">十 · 工程门禁</div>
<h1>全绿才允许提交</h1>
<div class="stats">
  <div class="stat"><div class="n">73</div><div class="l">测试文件</div></div>
  <div class="stat"><div class="n">765</div><div class="l">条断言</div></div>
  <div class="stat"><div class="n">9</div><div class="l">项真进程冒烟</div></div>
  <div class="stat"><div class="n">14</div><div class="l">项性能预算</div></div>
</div>
<div class="term">
  <div class="bar"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
  <div class="line cmd">$ npm run verify</div>
  ${pickVerify.map((l) => '<div class="line">' + l.trim().replace(/</g, '&lt;') + '</div>').join('\n  ')}
</div>
<div class="foot">没有 API Key 也能看到完整效果：149 盘合成卡带按提示词指纹寻址，缺哪盘就响亮报错。</div>
`);

files.b11 = page('结语', `
<div class="kicker">十一 · 结语</div>
<div style="margin-top:96px" class="big">在你投出去之前，<br>先把它拷问一遍。</div>
<div class="four">
  <div>提问有锚点<span>没有原文引文的提问，前端直接拒绝</span></div>
  <div>追问有预算<span>每人、每主张、每轮都有额度上限</span></div>
  <div>判定有收敛<span>拿不出证据就降级，编的主张整条丢弃</span></div>
  <div>过程可回放<span>整场事件可离线重放，不需要 API Key</span></div>
</div>
<div class="foot" style="margin-top:86px">CrossExam 质询室 · 多 Agent 对抗式面试沙盘 · 传智杯参赛作品</div>
`);

for (const [id, html] of Object.entries(files)) {
  writeFileSync(ROOT + '/' + id + '.html', html, 'utf8');
  console.log(id, html.length);
}
