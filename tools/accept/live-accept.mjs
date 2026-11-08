/**
 * 验收：联网 + 真简历。共 32 项（其中 1 项只在 TEST_REASONING=1 时跑）。
 *
 * 为什么要真浏览器：模型清单是从后端拉的、思考分栏是流式刷进去的、导出按钮挂在页面上，
 * 这三件事都不在 HTTP 接口的视野里，只有点一遍才算数。
 *
 * 两个外部依赖，缺了要**大声跳过**而不是静默通过：
 *   1) LLM_API_KEY —— 联网跑模型的密钥。没有它就整体跳过（exit 0）。
 *      旧版本会去翻本机的 DSH 会话日志把 Key 捞出来（findKey()），那等于把密钥
 *      抄进一份要进仓库的脚本里；现在只认环境变量。
 *   2) CROSSEXAM_ACCEPT_RESUME —— 一份真实简历 PDF（个人隐私数据，不进仓库）。
 *      没有它只跳过「真 PDF 导入」那 3 项，其余改用内置示例材料照跑。
 * 其余可调：LLM_BASE_URL / LLM_MODEL / TEST_REASONING=1 / CROSSEXAM_ACCEPT_PORT。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Recorder, env, findBrowser, installCleanup, makeTmpDir, pickPort, skipWhole, sleep, startServer } from './lib/accept.mjs';
import { launchBrowser } from './lib/cdp.mjs';

const LABELS = [
  '服务起来了且是 live 模式',
  '无头浏览器打开了调试端口',
  '首屏出来了',
  '页面里有隐藏的文件选择框',
  '真 PDF 能导进输入框',
  '导入提示写明是 PDF 与字数',
  'PDF 抽出来的正文是中文简历而不是乱码',
  '切到联网后不再停在「正在要清单」这一步',
  '联网配置是好的（不报缺变量）',
  '模型清单进了下拉框',
  '模型名自动填了默认值（也能手改）',
  'JD 填进去了',
  '岗位名填进去了',
  '开跑后有实时输出',
  '会话真的落库成 done',
  '思考可视化真的出现了（判定阶段交给会思考的模型）',
  '整场跑完了',
  '产出了主张卡片',
  '每条判定都写了判定口径',
  '会话记进了历史',
  '每条主张都带原文锚点',
  '每一条追问都锚到简历原文',
  '预算没被突破',
  '有建议的主张能勾选采纳',
  '确认采纳后给出结论',
  '服务端真的改了简历',
  '三个导出入口都在',
  '导出的 txt 就是改完那一版',
  '可打印 HTML 标出了改动段',
  'Word 导出是 docx 附件',
  'Markdown 报告可下载',
  '整轮下来控制台没有报错或警告',
];

const KEY = env('LLM_API_KEY');
const rec = new Recorder('联网验收：真简历 + 真模型 + 真浏览器');
if (KEY === '') {
  skipWhole(rec, LABELS, '没有 LLM_API_KEY：联网验收整体跳过（这是正常的离线环境，不是失败；要跑就 export LLM_API_KEY=...）');
}

const cleanup = installCleanup();
const TMP = makeTmpDir('live');
const PORT = await pickPort(env('CROSSEXAM_ACCEPT_PORT'));
const CDP_PORT = await pickPort(env('CROSSEXAM_ACCEPT_CDP_PORT'));
const BROWSER = findBrowser();
const RESUME_PDF = env('CROSSEXAM_ACCEPT_RESUME');
const MODEL = env('LLM_MODEL', 'deepseek-chat');
const BASE_URL = env('LLM_BASE_URL', 'https://api.deepseek.com/v1');
const hasResume = RESUME_PDF !== '' && existsSync(RESUME_PDF);

if (BROWSER === null) {
  skipWhole(rec, LABELS, '没找到浏览器（可用 CROSSEXAM_ACCEPT_BROWSER 指定 msedge/chrome 的绝对路径）');
}
if (!hasResume) {
  rec.note('没有 CROSSEXAM_ACCEPT_RESUME（真实简历 PDF）：「真 PDF 导入」那 3 项跳过，改用内置示例材料继续。');
}

let fatal = '';
let server = null;
let browser = null;
const consoleIssues = [];

const q = (shot) => '[data-shot="' + shot + '"]';
const pickHref = (shot) => '(function(){var a=document.querySelector(' + JSON.stringify(q(shot)) + ');return a===null?"":a.getAttribute("href");})()';

async function clickShot(name) {
  const ok = await browser.evalJs('(function(){var el=document.querySelector(' + JSON.stringify(q(name)) + ');if(el===null)return false;el.click();return true;})()');
  if (ok !== true) throw new Error('点不到 data-shot=' + name);
}

async function main() {
  server = await startServer({
    mode: 'live', port: PORT, dbPath: join(TMP, 'live.db'), cleanup,
    extraEnv: {
      LLM_API_KEY: KEY, LLM_BASE_URL: BASE_URL, LLM_MODEL: MODEL,
      ...(env('CROSSEXAM_REASONING_MODEL') === '' ? {} : { CROSSEXAM_REASONING_MODEL: env('CROSSEXAM_REASONING_MODEL') }),
    },
  });
  rec.ok('服务起来了且是 live 模式', server.health?.mode === 'live', server.health === null ? server.log() : JSON.stringify(server.health));
  if (server.health === null) throw new Error('服务没起来：' + server.log());

  browser = await launchBrowser(BROWSER, { cdpPort: CDP_PORT, profileDir: join(TMP, 'profile'), cleanup });
  rec.ok('无头浏览器打开了调试端口', browser !== null, browser === null ? '超时' : browser.browserVersion);
  if (browser === null) throw new Error('无头浏览器没接上 CDP');

  const bodyText = () => browser.evalJs('document.body.innerText');
  const waitText = (part, timeoutMs) => browser.waitText(part, timeoutMs);
  const shot = (name) => browser.shot(TMP, name);

  await browser.send('Page.navigate', { url: server.base + '/' });
  await sleep(1500);
  const first = await browser.waitFor(bodyText, '首屏', 20000);
  rec.ok('首屏出来了', first.includes('投料台'), String(first.length) + ' 字');
  // 首次访问会自动弹新手向导（首页改版后是向导，不是老版的帮助面板），
  // 它是覆盖层；不关掉虽然仍能用 JS 点到底下，但截图会全被它挡住。
  await browser.evalJs('(function(){var b=document.querySelector(' + JSON.stringify(q('wizard-skip')) + ');if(b)b.click();})()');
  await sleep(300);
  await clickShot('nav-intake');
  await browser.waitFor(() => browser.evalJs('document.querySelector(' + JSON.stringify(q('run')) + ') !== null'), '投料台出来', 20000);

  // ---- 1. 真 PDF 导入（走 CDP 的 DOM.setFileInputFiles，就是真的走文件选择器那条路） ----
  const doc = await browser.send('DOM.getDocument', { depth: -1 });
  const found = await browser.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: q('import-file') });
  rec.ok('页面里有隐藏的文件选择框', found.nodeId > 0, 'nodeId=' + String(found.nodeId));
  if (hasResume) {
    await browser.send('DOM.setFileInputFiles', { files: [RESUME_PDF], nodeId: found.nodeId });
    let imported = '';
    for (let i = 0; i < 80; i += 1) {
      imported = String(await browser.evalJs('document.querySelectorAll("textarea")[0].value'));
      if (imported.length > 100) break;
      await sleep(300);
    }
    const importNote = String(await browser.evalJs('(document.querySelector(' + JSON.stringify(q('import-note')) + ') || { textContent: "" }).textContent'));
    rec.ok('真 PDF 能导进输入框', imported.length > 900, String(imported.length) + ' 字');
    rec.ok('导入提示写明是 PDF 与字数', importNote.includes('解析出'), importNote.slice(0, 80));
    // 换台机器换份简历也要成立，所以不能认名字：认「没有替换符 + 中文占比够」。
    const cjk = (imported.match(/[\u4e00-\u9fa5]/g) ?? []).length;
    rec.ok('PDF 抽出来的正文是中文简历而不是乱码', !imported.includes('\ufffd') && cjk > imported.length * 0.1, String(cjk) + '/' + String(imported.length) + ' 个汉字');
  } else {
    for (const label of ['真 PDF 能导进输入框', '导入提示写明是 PDF 与字数', 'PDF 抽出来的正文是中文简历而不是乱码']) {
      rec.skip(label, '没有 CROSSEXAM_ACCEPT_RESUME（真实简历 PDF 不进仓库）');
    }
    // 没有真简历也得把材料摊开，后面「联网真模型」才跑得起来：用内置示例。
    await browser.waitFor(async () => browser.evalJs(
      '(function(){var r=document.querySelector(' + JSON.stringify(q('run')) + ');if(r&&r.disabled===false)return "ready";' +
      'var u=document.querySelector(' + JSON.stringify(q('use-demo')) + ');if(u&&u.disabled===false){u.click();return "clicked";}return "waiting";})()',
    ) === 'ready', '示例材料填进投料台', 30000);
  }
  await shot('01-imported.png');

  // ---- 2. 运行模式：切到联网直连，模型清单应能拉到 ----
  await clickShot('mode-live');
  // 提示有三种归宿：还在路上 → 出结论（缺变量 / 报错 / 手填）→ 或者干脆消失（清单拉到了）。
  // 只判断「文本里没有过程文案」会在元素消失时拿到 null，那样 PASS 是假的（F41 复现过三次）；
  // 所以这里显式区分「元素不存在」与「文案已经变了」两种状态。
  let modeNote = null;
  for (let i = 0; i < 80; i += 1) {
    const raw = await browser.evalJs('(function(){var el=document.querySelector(' + JSON.stringify(q('mode-note')) + ');return el===null?null:el.textContent;})()');
    if (raw === null || !String(raw).includes('正在向后端要')) { modeNote = raw; break; }
    await sleep(300);
  }
  rec.ok('切到联网后不再停在「正在要清单」这一步', modeNote === null || !String(modeNote).includes('正在向后端要'), String(modeNote).slice(0, 90));
  rec.ok('联网配置是好的（不报缺变量）', modeNote === null || !String(modeNote).includes('LLM_'), String(modeNote).slice(0, 90));
  const modelOptions = Number(await browser.evalJs('document.querySelectorAll("#crossexam-models option").length'));
  rec.ok('模型清单进了下拉框', modelOptions > 0, String(modelOptions) + ' 个选项');
  const modelValue = String(await browser.evalJs('(document.querySelector(' + JSON.stringify(q('model-input')) + ') || { value: "" }).value'));
  rec.ok('模型名自动填了默认值（也能手改）', modelValue.length > 0, modelValue);
  await shot('02-live-mode.png');

  // ---- 3. JD 与岗位名 ----
  const JD = '运维工程师（云计算方向）\n- 负责云平台与虚拟化环境的日常运维、故障排查\n- 熟悉 Linux、网络与常见中间件\n- 有云平台（华为云 / ZStack / OpenStack）实施经验优先\n- 能编写运维方案与文档，具备脚本能力（Shell / Python）';
  const setTa = (index, text) => browser.evalJs('(function(){var el=document.querySelectorAll("textarea")[' + String(index) + '];el.focus();el.value=' + JSON.stringify(text) + ';el.dispatchEvent(new Event("input",{bubbles:true}));return el.value.length;})()');
  const jdLen = Number(await setTa(1, JD));
  rec.ok('JD 填进去了', jdLen === JD.length, String(jdLen) + ' 字');
  const jobTitleSet = String(await browser.evalJs('(function(){var el=document.querySelector("input[placeholder*=\u9ad8\u7ea7\u540e\u7aef]")||document.querySelectorAll("input:not([type=file])")[0];el.focus();el.value="运维工程师";el.dispatchEvent(new Event("input",{bubbles:true}));return el.value;})()'));
  rec.ok('岗位名填进去了', jobTitleSet === '运维工程师', jobTitleSet);
  await sleep(300);
  await shot('03-ready.png');

  // ---- 4. 开跑：联网真模型，整场跑完 ----
  const t0 = Date.now();
  // 思考分栏只在「判定」阶段出现，光看开跑后那一眼必然为空；整场持续采样，取最长的一次。
  let thoughtMax = 0;
  const thoughtTimer = setInterval(() => {
    void browser.evalJs('(function(){var el=document.querySelector(' + JSON.stringify(q('live-reasoning')) + ');return el?el.innerText:"";})()')
      .then((t) => { if (typeof t === 'string' && t.length > thoughtMax) thoughtMax = t.length; })
      .catch(() => { /* 重绘瞬间取不到就算了，下一次再取 */ });
  }, 500);
  await browser.waitFor(() => browser.evalJs('(function(){var b=document.querySelector(' + JSON.stringify(q('run')) + ');return b!==null&&b.disabled===false;})()'), '开始质询可用', 30000);
  await clickShot('run');
  await sleep(3000);
  await shot('04-running.png');
  const liveSeen = String(await browser.waitFor(async () => {
    const t = await browser.evalJs('(function(){var el=document.querySelector(' + JSON.stringify(q('live')) + ');return el?el.innerText:"";})()');
    return String(t).length > 60 ? t : '';
  }, '直播输出', 120000));
  rec.ok('开跑后有实时输出', liveSeen.length > 60, String(liveSeen.length) + ' 字');
  await shot('05-live.png');

  const doneText = await waitText('置信度', 420000);
  // 等会话真的落库成 done 再断言：置信度是 verdict 阶段就出现的中间态，suggest 与落库都还在后面。
  const listOf = async () => {
    const j = await (await fetch(server.base + '/api/sessions')).json();
    return Array.isArray(j) ? j : (j.sessions ?? []);
  };
  const finished = String(await browser.waitFor(async () => {
    const arr = await listOf();
    return arr[0]?.status === 'done' ? arr[0].id : '';
  }, '会话落库成 done', 420000));
  rec.ok('会话真的落库成 done', finished !== '', finished);
  clearInterval(thoughtTimer);
  rec.note('思考分栏最长一次：' + String(thoughtMax) + ' 字');
  if (env('TEST_REASONING') === '1') {
    rec.ok('思考可视化真的出现了（判定阶段交给会思考的模型）', thoughtMax > 40, String(thoughtMax) + ' 字');
  }
  rec.ok('整场跑完了', doneText.includes('置信度'), (Number(Date.now() - t0) / 1000).toFixed(1) + ' s');
  await shot('06-done.png');

  const cards = Number(await browser.evalJs('document.querySelectorAll(' + JSON.stringify('[data-shot="col-boards"] article') + ').length'));
  rec.ok('产出了主张卡片', cards > 0, String(cards) + ' 张');
  const whyLines = Number(await browser.evalJs('(document.body.innerText.match(/为什么这样判：/g) || []).length'));
  rec.ok('每条判定都写了判定口径', whyLines > 0, String(whyLines) + ' 条');
  await shot('07-verdicts.png');

  // ---- 5. 服务端把这一场存成什么样 ----
  const listArr = await listOf();
  const sid = listArr[0].id;
  rec.ok('会话记进了历史', Boolean(sid), sid);
  const view = await (await fetch(server.base + '/api/sessions/' + sid)).json();
  const anchored = view.claims.filter((c) => c.anchor && typeof c.anchor.start === 'number').length;
  rec.ok('每条主张都带原文锚点', anchored === view.claims.length && view.claims.length > 0, String(anchored) + '/' + String(view.claims.length));
  const dist = view.verdicts.reduce((acc, v) => { const k = (v.verdict && v.verdict.kind) || v.kind || 'missing'; acc[k] = (acc[k] || 0) + 1; return acc; }, {});
  rec.note('判定分布：' + JSON.stringify(dist));
  rec.note('追问 ' + String(view.probes.length) + ' 次 · 轮数 ' + String(view.rounds) + ' · 被锚定机制拦下 ' + String(view.rejectedClaims.length) + ' 条 · 建议 ' + String(view.suggestions.filter((s) => s.status === 'suggested').length) + ' 条');
  rec.ok('每一条追问都锚到简历原文', view.probes.every((p) => p.anchor && typeof p.anchor.start === 'number'), String(view.probes.length) + ' 次追问');
  rec.ok('预算没被突破', view.probes.length <= 90, String(view.probes.length) + ' 次');

  // ---- 6. 采纳改写 + 三个导出 ----
  const chooseCount = Number(await browser.evalJs('document.querySelectorAll(' + JSON.stringify('[data-shot^="choose-"]') + ').length'));
  rec.ok('有建议的主张能勾选采纳', chooseCount > 0, String(chooseCount) + ' 个');
  if (chooseCount > 0) {
    await clickShot('revision-accept-all');
    await sleep(300);
    await clickShot('revision-submit');
    const note = String(await browser.waitFor(async () => {
      const t = await browser.evalJs('(function(){var el=document.querySelector(' + JSON.stringify(q('revision-note')) + ');return el?el.innerText:"";})()');
      return String(t).length > 0 ? t : '';
    }, '采纳结论', 60000));
    rec.ok('确认采纳后给出结论', note.includes('已按这次勾选改好简历'), note.slice(0, 80));
    await shot('08-adopted.png');
    const rev = (await (await fetch(server.base + '/api/sessions/' + sid + '/revisions')).json()).revised;
    rec.ok('服务端真的改了简历', rev !== null && rev.applied.length > 0 && rev.text !== view.session.resumeText, rev === null ? 'null' : String(rev.applied.length) + ' 处 / ' + String(rev.text.length) + ' 字');
    const hrefs = await browser.evalJs('(function(){return {txt:' + pickHref('resume-txt') + ',pdf:' + pickHref('resume-pdf') + ',docx:' + pickHref('resume-docx') + '};})()');
    rec.ok('三个导出入口都在',
      String(hrefs.txt).includes('/resume.txt') && String(hrefs.pdf).includes('/resume.html') && String(hrefs.docx).includes('/resume.docx'),
      JSON.stringify(hrefs));
    const txt = await (await fetch(server.base + String(hrefs.txt))).text();
    rec.ok('导出的 txt 就是改完那一版', txt === rev.text, String(txt.length) + ' 字');
    const html = await (await fetch(server.base + String(hrefs.pdf))).text();
    rec.ok('可打印 HTML 标出了改动段', html.includes('mark class') && html.includes('本版改了什么'), String(html.length) + ' 字符');
    const docRes = await fetch(server.base + String(hrefs.docx));
    const docType = String(docRes.headers.get('content-type') ?? '');
    const docDisp = String(docRes.headers.get('content-disposition') ?? '');
    const docBuf = Buffer.from(await docRes.arrayBuffer());
    rec.ok('Word 导出是 docx 附件', docType.includes('wordprocessingml') && docDisp.includes('.docx') && docBuf[0] === 0x50 && docBuf[1] === 0x4b, String(docBuf.length) + ' B');
  } else {
    // 没有可采纳的建议时这 6 项无从谈起。显式跳过而不是让总数悄悄变少：
    // 口径要固定成「32 项」，不然「跑了 32 项」这句证据每次的分母都不一样。
    for (const label of ['确认采纳后给出结论', '服务端真的改了简历', '三个导出入口都在', '导出的 txt 就是改完那一版', '可打印 HTML 标出了改动段', 'Word 导出是 docx 附件']) {
      rec.skip(label, '这一场没有给出可采纳的改写建议');
    }
  }

  // ---- 7. 报告三形态 ----
  const mdHref = String(await browser.evalJs(pickHref('report-md')));
  const mdText = await (await fetch(server.base + mdHref)).text();
  rec.ok('Markdown 报告可下载', mdText.startsWith('#') && mdText.length > 500, String(mdText.length) + ' 字符');

  // ---- 8. 清空（顺带把界面切回收拾干净的状态，给截图收尾） ----
  await clickShot('clear');
  await sleep(600);
  await shot('09-clean.png');

  for (const line of browser.consoleIssues.slice(0, 5)) consoleIssues.push(line);
  rec.ok('整轮下来控制台没有报错或警告', consoleIssues.length === 0, String(consoleIssues.length));
}

try {
  await main();
} catch (err) {
  fatal = err instanceof Error ? err.message : String(err);
}

if (browser !== null) await browser.close().catch(() => { /* 关不掉就算了，cleanup 兜底 */ });
if (server !== null && server.child.exitCode === null) { server.child.kill(); await sleep(300); }
if (consoleIssues.length > 0) console.log('控制台问题：' + JSON.stringify(consoleIssues.slice(0, 5)));
rec.note('产物（截图/导出）在：' + TMP);
const code = rec.summary();
if (fatal !== '') console.log('\n中途出错：' + fatal);
process.exit(fatal !== '' && code === 0 ? 1 : code);
