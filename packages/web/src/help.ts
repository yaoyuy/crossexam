import type { PageId } from './pages.ts';

/**
 * 新手教程与模式说明的文案。
 *
 * 抽成纯数据是为了能测：文案也是产品的一部分，
 * 改坏了应该在测试里红，而不是等用户看错。
 */
export const HELP_SEEN_KEY = 'crossexam.seen-help';

export interface HelpStep {
  title: string;
  body: string;
}

export interface ModeRow {
  mode: 'replay' | 'record' | 'live';
  label: string;
  needsKey: string;
  what: string;
  when: string;
}

/** 四步上手：从「这是干什么的」到「结论怎么带走」 */
export const HELP_STEPS: HelpStep[] = [
  {
    title: '第一步 · 把简历和目标岗位填进去',
    body:
      '左边「投料台」贴上简历正文与目标岗位的 JD；两边都能「从文件导入」（PDF / Word / 文本，JD 一次可以选多份，标题默认取文件名）。手边没有简历就点「一键示例」，用内置的合成简历先看一遍效果。',
  },
  {
    title: '第二步 · 挑面试官、定节奏',
    body:
      '默认三位：技术面试官、HR 面试官、业务主管。想更狠一点就点开「压力面试官」，想抠术语就加「领域专家」。第一次看建议点「慢放」，否则离线回放整场不到一秒就跑完了。' +
      '跑之前还能挑「运行模式」：默认离线回放，也可以当场切成联网真实模型，甚至边跑边把这一场录成新卡带。',
  },
  {
    title: '第三步 · 开始质询，看判定',
    body:
      '中间一栏实时直播：抽出的主张、每位面试官的追问、求职者 Agent 的回答、逐条判定与改写建议。点任何一条引文，右边的简历原文会高亮到那一句。',
  },
  {
    title: '第四步 · 把结论带走，然后回头看有没有变好',
    body:
      '报告有五种带走方式：Markdown 方便归档、PDF 直接打印、Word 能继续编辑、「打包分享」把整场合成一个自带样式的 HTML，断网双击也能看，再加一份「台账 Excel」把判定、追问与被拦下的记录摊成五张表，方便排序筛选、逐条改简历。报告里逐条写明判定理由，以及哪些主张因为锚不到原文而根本没进场。' +
      '右栏「一岗一版」可以按目标岗位筛出一版简历：只去掉对不上的行，一个字都不改。' +
      '采纳改写后点「改完再跑一遍」，顶部「比上次」与「成长档案」会告诉你哪几条主张从站不住变成了站得住。',
  },
];

/** 三种模式的对照：这是用户最常问的一个问题 */
export const MODE_ROWS: ModeRow[] = [
  {
    mode: 'replay',
    label: '离线回放',
    needsKey: '不需要',
    what: '读仓库里已经录好的卡带，全程不联网',
    when: '第一次跑、没有 API Key、断网或内网环境',
  },
  {
    mode: 'record',
    label: '联网录制',
    needsKey: '需要',
    what: '真调模型，并把这一场的提示词与回复存成新卡带',
    when: '要录一批卡带，或者想用自己的模型重录一遍',
  },
  {
    mode: 'live',
    label: '联网直连',
    needsKey: '需要',
    what: '真调模型，什么都不落盘',
    when: '自己用，想看真实模型对你这份简历会怎么问',
  },
];

/**
 * 隐私口径写在界面上，而不是只写在 README 里：
 * 「只落本地 SQLite」与「联网会把简历发给模型服务商」是两件事，不能含糊。
 */
export const PRIVACY_NOTE =
  '简历正文只写进本机的 SQLite 文件（data/crossexam.db），不上传任何第三方存储。离线回放不联网；只有联网录制与联网直连会把简历正文发给你在环境变量里配置的模型服务商，请按自己的隐私要求选择模式。';

export const FAQ: HelpStep[] = [
  {
    title: '为什么不需要 API Key 也能跑完整场？',
    body:
      '仓库里带着 149 盘「卡带」：每一盘是一次模型调用的提示词指纹与回复。回放模式按指纹去查，查得到就照原样重放；查不到会明确报错，而不是假装成功。所以关键路径可以在完全离线的机器上复现。',
  },
  {
    title: '页面上的三种运行模式差在哪？',
    body:
      '离线回放读仓库里已经录好的卡带，不联网也不需要 API Key，评委克隆下来就能跑出同一结果；联网直连真调模型、什么都不落盘，适合自己用；联网录制真调模型并把这一场的提示词与回复存成新卡带，下次就能用回放原样重演。三种模式在投料台上逐场选，模型名既能下拉挑也能手填。',
  },
  {
    title: '判定是模型随便给的吗？',
    body:
      '判定要过两遍：模型给一版，代码再收敛一遍。代码只收两类——需要证据（站得住 / 与原文矛盾）却拿不出可定位证据的，降级为「证据缺失」；对某条主张的追问整场都没答上来、模型还想判「站得住」的，也降级为「证据缺失」（责任在简历写法，不是候选人不会）。被代码改写过的判定会标出「这条判定不是模型直接给的」。',
  },
  {
    title: '面试官为什么一直问同一个数字？',
    body:
      '追问有预算：每条主张最多 3 轮、每位面试官对同一条主张最多 2 次、全场最多 60 次。到顶就停，并且会在过程说明里写明为什么停——不会出现问不完的死循环。',
  },
  {
    title: '我的简历会被存到哪里？',
    body: PRIVACY_NOTE,
  },
  {
    title: '这一场跑得对不对，怎么核对？',
    body:
      '每场会话都把事件按顺序写进本地库，界面上的过程就是这些事件重放出来的；重新打开历史会话走的是同一条代码路径。报告最后还写了复现方式与门禁命令。',
  },
  {
    title: '「改完再跑一遍」与「一岗一版」有什么不一样？',
    body:
      '这是两个动作，刻意分开：改完再跑一遍是改简历（按你勾选的改写建议落笔，改完还能撤销或全部重来），一岗一版是筛简历（按这份岗位的要求决定哪些行留下，一个字都不改）。筛出来的一版不能拿去再质询：它的文本与原文已经对不上，锚点会失效。',
  },
  {
    title: 'JD 也能从文件导入吗？',
    body:
      '能。投料台「目标岗位 JD」右上角有「从文件导入」，一次可以选多份，文件名的去扩展名部分会当作岗位标题（可以改）。导入与手动粘贴可以混着用：1–8 份，每份都按独立岗位读成要求清单。上传的字节同样只在本机解析、不落盘。',
  },
  {
    title: '在别人机器上跑，结果会不一样吗？',
    body:
      '离线回放读的是仓库里的卡带，同一份卡带在谁的机器上都是同一结果；CI 会重跑一遍卡带生成并比对 git diff，指纹对不上就红。真正因机器而变的是耗时（磁盘缓存冷热相差数倍），所以性能预算只拦数量级，不卡具体毫秒数。',
  },
];

function storage(): Storage | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** 第一次打开就自动弹一次教程；看过一次之后不再打扰 */
export function shouldAutoOpenHelp(): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    return store.getItem(HELP_SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markHelpSeen(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(HELP_SEEN_KEY, '1');
  } catch {
    // 无痕模式下写不进去，大不了下次再弹一次
  }
}

/**
 * 多步新手向导的文案。
 *
 * 与教程面板的分工：教程是「随时可查的说明书」，向导是「第一次进来有人牵着你走一遍」。
 * 每一步只讲一件事，并且直接把人送到该去的那一页——
 * 一次把六个页面都摊开讲，等于什么都没讲。
 */
export const WIZARD_SEEN_KEY = 'crossexam.seen-wizard';

export interface WizardStep {
  id: string;
  title: string;
  body: string;
  /** 两三条要点：向导一屏只讲一件事 */
  points: string[];
  /** 点「下一步」时先切到哪一页；不填表示停在当前页 */
  page?: PageId;
}

export const WIZARD_STEPS: WizardStep[] = [
  {
    id: 'welcome',
    title: '欢迎来到质询室',
    body:
      '这是一个面试沙盘：把你简历里的每一句话当成主张，让几位面试官 Agent 围着它追问，再逐条告诉你哪一句站得住、哪一句撑不起来。全程不需要 API Key——仓库里带着录好的卡带。',
    points: [
      '提问必须锚定原文：没有原文出处的问题，界面直接拒收',
      '追问有预算上限：到顶就停，不会出现问不完的循环',
      '判定可以被代码改写：模型说要证据却拿不出来，会被降级',
    ],
  },
  {
    id: 'material',
    title: '第一步 · 把材料放进去',
    page: 'intake',
    body:
      '在投料台贴上简历正文与目标岗位的 JD。两边都能从文件导入（PDF / Word / 文本；JD 一次可以选多份）。手边没有简历，就点「一键示例」用内置的合成简历先看一遍。',
    points: [
      '简历至少 30 个字符；JD 可以留空，也可以给一到八份',
      '行业模板库有 12 个行业 × 3 个岗位，挑一套会连带简历、JD、面试官一起换',
      '上传的字节只在本机解析，不落盘、不外发',
    ],
  },
  {
    id: 'panel',
    title: '第二步 · 挑面试官与强度',
    page: 'intake',
    body:
      '默认三位：技术面试官、HR 面试官、业务主管。想更狠一点就加上压力面试官，想抠术语就加领域专家；也可以自己写一句话生成一位。',
    points: [
      '追问强度只有三档：温和 / 常规 / 挑刺，改的是预算，不是人设',
      '改写风格只管建议改得多狠，不改判定、不许新增事实',
      '第一次看建议点「慢放」，否则离线回放整场不到一秒就结束',
    ],
  },
  {
    id: 'run',
    title: '第三步 · 开始质询',
    page: 'interview',
    body:
      '点「开始质询」之后，质询台会实时直播：抽出的主张、每一位面试官的追问、求职者 Agent 的回答、逐条判定与改写建议。点任何一条引文，右边的原文会高亮到那一句。',
    points: [
      '离线回放读仓库里的卡带，同一份卡带在谁机器上都是同一结果',
      '联网直连真调模型；联网录制会把这一场存成新卡带，下次能原样重演',
      '跑完可以补一句真话、采纳改写，再点「改完再跑一遍」',
    ],
  },
  {
    id: 'takeaway',
    title: '第四步 · 把结论带走',
    page: 'report',
    body:
      '报告页把这一场的结论摊成五种带走方式：Markdown、PDF、真 .docx、单文件打包、台账 Excel。改完的简历还能导出三种格式，也能按目标岗位筛出一版只留得上的行。',
    points: [
      '「比上次」与「成长档案」会告诉你哪几条主张从站不住变成了站得住',
      '同一条版本链跑过的每一场都留在历史里，随时翻回来重看过程',
      '想换一套材料重来：直接再点一次「开始质询」，会新建一场而不是覆盖',
    ],
  },
];

/** 第一次打开就自动走一遍向导；走完或跳过之后不再打扰 */
export function shouldAutoOpenWizard(): boolean {
  const store = storage();
  if (store === null) return false;
  try {
    return store.getItem(WIZARD_SEEN_KEY) !== '1';
  } catch {
    return false;
  }
}

export function markWizardSeen(): void {
  const store = storage();
  if (store === null) return;
  try {
    store.setItem(WIZARD_SEEN_KEY, '1');
  } catch {
    // 无痕模式下写不进去，大不了下次再走一遍
  }
}
