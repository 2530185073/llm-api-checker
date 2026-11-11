import type { CallResult, DegradationTestResult, JudgeMode, TestStatus, VisualCheck } from "./types";

/**
 * HTML/SVG animation prompts, sent with the system instruction below.
 */
export const VISUAL_INSTRUCTIONS =
  "Return a complete, self-contained HTML document for the user's request. Include all SVG, CSS and JavaScript inline. Do not use external resources. Return only HTML, without Markdown fences or explanations.";

export interface VisualPreset {
  key: string;
  name: string;
  prompt: string;
  /** Each group must match at least once; terms are matched case-insensitively against the HTML source. */
  subjects: { label: string; terms: RegExp }[];
}

export const VISUAL_PRESETS: VisualPreset[] = [
  {
    key: "pelican",
    name: "鹈鹕骑自行车",
    prompt: "创建一个 HTML，内容是用 SVG 绘制一个鹈鹕骑自行车的 2D 动画。你不需要任何测试。",
    subjects: [
      { label: "鹈鹕（喙 / 喉囊 / 翅膀）", terms: /pelican|鹈鹕|beak|bill|pouch|wing|喙|喉囊|翅/i },
      { label: "自行车（车轮 / 踏板 / 车架）", terms: /bicycle|bike|wheel|pedal|spoke|crank|chain|自行车|车轮|踏板|辐条/i },
    ],
  },
  {
    key: "polarbear",
    name: "北极熊骑自行车",
    prompt:
      "创建一个 HTML，用 SVG 绘制一只北极熊骑自行车的 2D 动画：北极熊体型圆润、白色毛发、黑鼻子，坐在一辆两轮自行车上，双腿随踏板做圆周蹬踏，车轮持续转动并带辐条，背景是雪地与远处的冰山，雪花缓缓飘落。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "北极熊", terms: /bear|熊/i },
      { label: "自行车", terms: /bicycle|bike|wheel|pedal|spoke|自行车|车轮/i },
      { label: "雪景", terms: /snow|iceberg|雪|冰山/i },
    ],
  },
  {
    key: "ultraman",
    name: "奥特曼骑摩托车",
    prompt:
      "创建一个 HTML，用 SVG 绘制奥特曼骑摩托车的 2D 动画：奥特曼为银红配色、头顶有鳍状冠、胸口有闪烁的计时器，跨坐在一辆流线型摩托车上向右疾驰，车轮高速旋转、尾部拖出速度线，背景是横向滚动的城市楼群，天上偶尔有怪兽剪影掠过。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "奥特曼", terms: /ultraman|奥特曼|hero|timer|crest|计时器/i },
      { label: "摩托车", terms: /motor|bike|wheel|摩托|车轮/i },
      { label: "城市背景", terms: /city|building|楼|城市/i },
    ],
  },
  {
    key: "octopus",
    name: "章鱼打架子鼓",
    prompt:
      "创建一个 HTML，用 SVG 绘制一只章鱼打架子鼓的 2D 动画：章鱼有 8 条可辨的触手，分别握着鼓棒，同时敲击底鼓、军鼓、镲片等至少 5 件鼓组部件，敲击节奏要稳定循环，被击中的部件有震动或闪光反馈，章鱼头部随节拍轻微点动。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "章鱼 / 触手", terms: /octopus|tentacle|章鱼|触手/i },
      { label: "鼓组", terms: /drum|cymbal|snare|kick|hi-?hat|鼓|镲/i },
    ],
  },
  {
    key: "giraffe",
    name: "长颈鹿踩滑板",
    prompt:
      "创建一个 HTML，用 SVG 绘制一只长颈鹿踩滑板的 2D 动画：长颈鹿脖子明显修长、带棕色斑块，四蹄站在一块滑板上从左向右滑行，滑板轮子转动，途中遇到一个小坡道时做起跳与落地动作，脖子随动作前后摆动，背景是热带草原与移动的云。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "长颈鹿", terms: /giraffe|neck|长颈鹿|脖子/i },
      { label: "滑板", terms: /skate|board|ramp|滑板|坡道/i },
    ],
  },
  {
    key: "mooncat",
    name: "宇航猫月球钓鱼",
    prompt:
      "创建一个 HTML，用 SVG 绘制一只穿宇航服的猫在月球上钓鱼的 2D 动画：猫戴着透明头盔、尾巴从宇航服后面伸出，坐在月面环形山边缘，鱼竿伸向一片漂浮的星星湖，钓线末端不时钓起一颗闪光的星星，背景是漆黑太空、缓慢自转的地球与散布的星点，猫会偶尔甩尾。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "宇航猫", terms: /cat|helmet|astronaut|tail|猫|头盔|宇航/i },
      { label: "月球 / 钓鱼", terms: /moon|crater|rod|fish|line|月|鱼竿|钓/i },
      { label: "星空 / 地球", terms: /star|earth|星|地球/i },
    ],
  },
  {
    key: "clock",
    name: "模拟时钟 · 实时走针",
    prompt:
      "创建一个 HTML，用 SVG 绘制一个模拟时钟：有表盘刻度、时针、分针、秒针，读取浏览器本地时间实时走针，秒针平滑扫动，时针随分钟联动偏移。表盘下方用数字显示当前时间。所有样式与脚本内联，不引用外部资源。你不需要任何测试。",
    subjects: [
      { label: "时针 / 分针 / 秒针", terms: /hour|minute|second|hand|时针|分针|秒针/i },
      { label: "读取本地时间", terms: /new Date\(|Date\.now\(|getHours|getMinutes|getSeconds|toLocaleTimeString/i },
    ],
  },
  {
    key: "solar",
    name: "太阳系轨道动画",
    prompt:
      "创建一个 HTML，用 SVG 绘制太阳系动画：太阳居中，至少包含水星、金星、地球、火星、木星、土星六颗行星沿各自轨道公转，公转周期按真实比例缩放（地球 1 圈时水星约 4 圈、土星约 1/29 圈），地球带一颗绕转的月球，土星有光环，每颗行星标注中文名称。深色星空背景带闪烁星点。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "太阳", terms: /sun|太阳/i },
      { label: "六颗行星中文名", terms: /水星[\s\S]*金星|金星[\s\S]*地球/ },
      { label: "土星 / 月球", terms: /土星|月球|ring|moon/i },
    ],
  },
  {
    key: "balls",
    name: "弹跳小球物理模拟",
    prompt:
      "创建一个 HTML，用 Canvas 或 SVG 实现弹跳小球物理模拟：初始生成 8 个不同颜色和半径的小球，受重力作用下落，碰到容器四壁反弹并有能量损耗，小球之间发生碰撞时按动量守恒交换速度，不允许相互穿透或卡在墙内。点击画面任意位置新增一个小球。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "重力与速度", terms: /gravity|vy|velocity|重力/i },
      { label: "碰撞处理", terms: /collid|collision|bounce|restitution|碰撞|反弹/i },
      { label: "点击新增", terms: /addEventListener\(\s*['"](click|pointerdown|mousedown)|onclick/i },
    ],
  },
  {
    key: "gears",
    name: "齿轮传动机构",
    prompt:
      "创建一个 HTML，用 SVG 绘制一组相互啮合的齿轮传动动画：至少 4 个齿轮，齿数分别为 12、24、36、18，齿形要真实可辨，相邻齿轮的齿必须正确啮合而不重叠或穿透，转速与齿数成反比，转向相邻相反。用不同颜色区分齿轮，并在每个齿轮中心标注齿数。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "齿轮", terms: /gear|teeth|tooth|齿轮/i },
      { label: "齿数 12/24/36/18", terms: /36[\s\S]*18|18[\s\S]*36/ },
    ],
  },
  {
    key: "city",
    name: "城市夜景视差滚动",
    prompt:
      "创建一个 HTML，用 SVG 绘制一幅横向无限滚动的城市夜景：至少三层视差（远景山脉与月亮、中景楼群、近景马路），层速由远到近递增；楼窗随机点亮熄灭，马路上有汽车往返行驶并带车灯，天空偶尔划过流星。画面循环时不能出现接缝或跳变。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "楼群 / 窗户", terms: /building|window|楼|窗/i },
      { label: "汽车 / 马路", terms: /car|road|headlight|汽车|马路|车灯/i },
      { label: "视差层", terms: /parallax|layer|far|near|mid|视差|远景|近景/i },
    ],
  },
  {
    key: "strokes",
    name: "汉字笔顺书写动画",
    prompt:
      "创建一个 HTML，用 SVG 路径动画演示汉字「永」的书写过程：按正确笔顺逐笔书写，共 5 笔（点、横折钩、横撇、撇、捺），每一笔用 stroke-dashoffset 动画呈现毛笔运笔效果，笔画粗细有提按变化，写完一笔再写下一笔，全部写完后暂停两秒重新开始。旁边列出笔顺编号。所有样式与脚本内联。你不需要任何测试。",
    subjects: [
      { label: "「永」字与笔画名", terms: /永|横折钩|捺/ },
      { label: "stroke-dashoffset 动画", terms: /stroke-?dashoffset|strokeDashoffset/i },
    ],
  },
];

export const VISUAL_OUTPUT_LIMIT = 1024 * 1024;

/** Extraction order: fenced full document, fenced fragment, then raw text. */
export function extractHtml(output: string): string {
  const blocks = [...output.matchAll(/```(?:html|svg|xml)?[^\S\r\n]*\r?\n([\s\S]*?)```/gi)];
  const candidate =
    blocks.find((b) => /<!doctype\s+html|<html[\s>]/i.test(b[1]))?.[1] ??
    blocks.find((b) => /<(?:svg|div|style|main|body)[\s>]/i.test(b[1]))?.[1] ??
    output.replace(/^\s*```(?:html|svg|xml)?\s*\r?\n/i, "").replace(/\s*```\s*$/, "");
  const start = candidate.search(/<!doctype\s+html|<html[\s>]|<(?:svg|div|style|main|body|section|canvas)[\s>]/i);
  if (start < 0) return "";
  const html = candidate.slice(start).trim();
  const end = html.toLowerCase().lastIndexOf("</html>");
  return end >= 0 ? html.slice(0, end + 7) : html;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

/** Checks that every `<svg>` element nests and closes properly, using an XML-style tag stack. */
export function svgWellFormed(html: string): { ok: boolean; detail: string; svgCount: number } {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, "");
  const svgs: string[] = [];
  const opener = /<svg[\s>]/gi;
  let m: RegExpExecArray | null;
  while ((m = opener.exec(stripped))) {
    let depth = 0;
    const tag = /<(\/?)svg(?=[\s>/])[^>]*?(\/?)>/gi;
    tag.lastIndex = m.index;
    let t: RegExpExecArray | null;
    let end = -1;
    while ((t = tag.exec(stripped))) {
      if (t[2]) continue;
      depth += t[1] ? -1 : 1;
      if (depth === 0) {
        end = tag.lastIndex;
        break;
      }
    }
    if (end < 0) return { ok: false, detail: "存在未闭合的 <svg> 元素（输出可能被截断）", svgCount: svgs.length + 1 };
    svgs.push(stripped.slice(m.index, end));
    opener.lastIndex = end;
  }
  if (!svgs.length) return { ok: false, detail: "没有 <svg> 元素", svgCount: 0 };
  for (const svg of svgs) {
    const body = svg.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
    const stack: string[] = [];
    const tag = /<(\/?)([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
    let t: RegExpExecArray | null;
    while ((t = tag.exec(body))) {
      const name = t[2].toLowerCase();
      if (t[4] || VOID_TAGS.has(name)) continue;
      if (!t[1]) stack.push(name);
      else if (stack.pop() !== name) return { ok: false, detail: `标签嵌套错误：</${t[2]}> 与开标签不匹配`, svgCount: svgs.length };
    }
    if (stack.length) return { ok: false, detail: `有 ${stack.length} 个元素未闭合（如 <${stack[stack.length - 1]}>）`, svgCount: svgs.length };
  }
  return { ok: true, detail: `${svgs.length} 个 <svg>，标签嵌套与闭合正确`, svgCount: svgs.length };
}

const SHAPES = /<(path|circle|ellipse|rect|line|polyline|polygon|use)\b/gi;
const ANIMATION =
  /<animate(Transform|Motion)?\b|@keyframes|requestAnimationFrame|setInterval\(|\.animate\(|animation\s*:|transition\s*:|stroke-?dashoffset/i;

export function analyzeVisual(preset: VisualPreset, call: CallResult): { html: string; checks: VisualCheck[]; autoScore: number } {
  const html = extractHtml(call.text.slice(0, VISUAL_OUTPUT_LIMIT));
  const bytes = new TextEncoder().encode(html).length;
  const svg = html ? svgWellFormed(html) : { ok: false, detail: "未提取到 HTML", svgCount: 0 };
  const usesCanvas = /<canvas[\s>]/i.test(html) && preset.key === "balls";
  const shapes = (html.match(SHAPES) ?? []).length;
  const scripted = /createElementNS\([^)]*svg/i.test(html);
  const truncated = call.finishReason === "length" || call.finishReason === "max_tokens" || call.finishReason === "max_output_tokens";
  const closed = /<\/html>\s*$/i.test(html) || /<\/svg>\s*$/i.test(html) || /<\/body>\s*$/i.test(html);
  const subjects = preset.subjects.map((s) => ({ ...s, hit: s.terms.test(html) }));
  const checks: VisualCheck[] = [
    {
      key: "html",
      label: "返回了可渲染的 HTML / SVG",
      passed: !!html && (svg.svgCount > 0 || usesCanvas),
      weight: 2,
      detail: html ? `提取到 ${(bytes / 1024).toFixed(1)} KB 文档` : "回答中没有 HTML 文档",
    },
    { key: "svg-valid", label: "SVG 结构有效", passed: svg.ok || usesCanvas, weight: 2, detail: usesCanvas && !svg.ok ? "使用 Canvas 实现（题目允许）" : svg.detail },
    {
      key: "complete",
      label: "输出完整未截断",
      passed: !!html && !truncated && closed,
      weight: 2,
      detail: truncated ? `结束原因 ${call.finishReason}，输出被长度上限截断` : closed ? "文档正常闭合" : "文档结尾缺少 </html> 或 </svg>",
    },
    {
      key: "shapes",
      label: "图形足够丰富",
      passed: shapes >= 15 || (scripted && shapes >= 3) || usesCanvas,
      weight: 1,
      detail: `${shapes} 个基本图形元素${scripted ? "（另有脚本动态生成的图形）" : ""}，阈值 15`,
    },
    { key: "animation", label: "包含动画", passed: ANIMATION.test(html), weight: 2, detail: ANIMATION.test(html) ? "检测到 SMIL / CSS / JS 动画" : "未发现动画代码" },
    {
      key: "subject",
      label: "画面元素符合题意",
      passed: subjects.every((s) => s.hit),
      weight: 2,
      detail: subjects.map((s) => `${s.hit ? "✓" : "✗"} ${s.label}`).join("；"),
    },
    {
      key: "size",
      label: "体积合理（2 KB – 512 KB）",
      passed: bytes >= 2048 && bytes <= 512 * 1024,
      weight: 1,
      detail: bytes < 2048 ? `只有 ${bytes} 字节，过于简陋` : bytes > 512 * 1024 ? `${(bytes / 1024).toFixed(0)} KB，异常庞大` : `${(bytes / 1024).toFixed(1)} KB`,
    },
    {
      key: "self-contained",
      label: "不引用外部资源",
      passed: !/<(script|link|img)\b[^>]*(src|href)\s*=\s*["']https?:/i.test(html),
      weight: 1,
      detail: "预览在隔离沙箱中运行，外部资源会被拦截",
    },
  ];
  const total = checks.reduce((sum, c) => sum + c.weight, 0);
  const autoScore = Math.round((checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0) / total) * 100);
  return { html, checks, autoScore };
}

export const VISUAL_PASS_SCORE = 75;

export function gradeVisual(preset: VisualPreset, call: CallResult, mode: JudgeMode, maxDurationMs: number, weight: number): DegradationTestResult {
  const { html, checks, autoScore } = call.text ? analyzeVisual(preset, call) : { html: "", checks: [], autoScore: 0 };
  const answerPassed = call.ok && autoScore >= VISUAL_PASS_SCORE && checks.find((c) => c.key === "html")!.passed;
  const latencyPassed = call.ok && call.durationMs < maxDurationMs;
  let status: TestStatus = "error";
  if (call.ok) {
    const pass = mode === "answer" ? answerPassed : mode === "latency" ? latencyPassed : answerPassed && latencyPassed;
    status = pass ? "normal" : "degraded";
  }
  const generationMs = call.ttftMs !== null ? call.durationMs - call.ttftMs : null;
  return {
    id: `visual-${preset.key}`,
    kind: "visual",
    name: `${preset.name}（动画题）`,
    category: "HTML/SVG 动画",
    weight,
    status,
    answerPassed,
    latencyPassed,
    expected: `自动检查得分 ≥ ${VISUAL_PASS_SCORE}，并请目测预览`,
    output: html ? `${(new TextEncoder().encode(html).length / 1024).toFixed(1)} KB HTML，自动检查 ${autoScore} 分` : call.text.slice(0, 500),
    maxDurationMs,
    durationMs: call.durationMs,
    ttftMs: call.ttftMs,
    usage: call.usage,
    responseModel: call.responseModel,
    finishReason: call.finishReason,
    tokensPerSecond:
      call.usage.output && generationMs && generationMs > 50 ? Math.round((call.usage.output / generationMs) * 10000) / 10 : null,
    reasoningSeen: call.reasoningText,
    error: call.ok ? null : call.error,
    artifact: call.text ? { preset: preset.key, html, bytes: new TextEncoder().encode(html).length, checks, autoScore } : undefined,
  };
}
