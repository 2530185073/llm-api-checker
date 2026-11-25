/**
 * 计费基准请求构造规范 billing-baseline-v1。
 *
 * 与 scripts/billing-baseline/blspec.py（采集基准用的参考实现）逐字节一致：
 * 同一 fixture 在两边构造出的请求体，去掉测试编号后的规范化 JSON 的 sha256（templateSha256）必须相同，
 * 否则基准中的 token 数不再适用。修改本文件、素材文件或 blspec.py 任何一处，都需要重新采集基准。
 */
import { createHash } from "node:crypto";
import agentScript from "@/data/billing-baseline/agent-script.json";
import base from "@/data/billing-baseline/base.json";
import corpusCode from "@/data/billing-baseline/corpus-code.json";
import corpusEn from "@/data/billing-baseline/corpus-en.json";
import corpusJson from "@/data/billing-baseline/corpus-json.json";
import corpusZh from "@/data/billing-baseline/corpus-zh.json";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export const SPEC_VERSION = "billing-baseline-v1";

export type Corpus = "code" | "zh" | "en" | "json";
export type OutputKind = "tiny" | "short" | "medium" | "long" | "trunc";
export type CacheMode = "5m" | "1h" | "none";

export interface Fixture {
  corpus?: Corpus;
  extra_chars?: number;
  output?: OutputKind;
  max_tokens?: number;
  stream?: boolean;
  cache?: CacheMode;
  agent_turn?: number;
}

const CORPUS: Record<Corpus, string> = { code: corpusCode.text, zh: corpusZh.text, en: corpusEn.text, json: corpusJson.text };

/** 每个词带前导空格时都是单个 token，换测试编号几乎不改变 token 数（实测差异 ≤ 2）。 */
const WORDS = (
  "apple river stone cloud table green house water light music paper glass horse field bread chair " +
  "night winter garden summer silver market window letter forest bridge pencil orange planet doctor family " +
  "island mirror rocket school coffee yellow dinner animal engine circle button camera castle dragon finger " +
  "flower hammer jacket ladder magnet needle pepper pillow pocket rabbit saddle shadow spider tunnel wallet " +
  "basket candle travel"
).split(" ");

/** Park–Miller 随机数取 6 个词。 */
export function nonce(seed: number): string {
  let x = seed % 2147483647 || 1;
  const out: string[] = [];
  for (let i = 0; i < 6; i++) {
    x = (x * 48271) % 2147483647;
    out.push(WORDS[x % 64]);
  }
  return out.join(" ");
}

export function seedFrom(s: string): number {
  const h = createHash("sha256").update(s).digest();
  return (h.readUInt32BE(0) % 2147483646) + 1;
}

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
export function words(n: number): string {
  if (n === 1000) return "one thousand";
  const h = Math.floor(n / 100);
  const r = n % 100;
  const p: string[] = [];
  if (h) p.push(`${ONES[h]} hundred`);
  if (r) p.push(r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 === 0 ? "" : ` ${ONES[r % 10]}`));
  return p.join(" ");
}

export const OUTPUT_N: Partial<Record<OutputKind, number>> = { short: 20, medium: 300, long: 1000 };

export function taskText(output: OutputKind): string {
  if (output === "tiny") return "不要调用任何工具。只回复两个字母：OK，不要输出任何其他内容。";
  if (output === "trunc") return "不要调用任何工具。请写一篇关于城市公共交通发展史的中文长文，越长越好，不少于三万字，直接开始正文，不要标题。";
  const n = OUTPUT_N[output]!;
  return (
    `不要调用任何工具，不要写任何解释、标题或代码块。直接输出英文单词形式的数字 one 到 ${words(n)}` +
    `（全部小写，用空格连接的写法如 twenty one，不要用连字符，不要用 and），每行一个，共 ${n} 行，除此之外不输出任何内容。`
  );
}

/** 期望输出（逐字固定）；trunc 档只比较 token 数，没有期望文本。 */
export function expectedText(output: OutputKind): string | null {
  if (output === "tiny") return "OK";
  const n = OUTPUT_N[output];
  return n ? Array.from({ length: n }, (_, i) => words(i + 1)).join("\n") : null;
}

export const normalizeText = (t: string) =>
  t
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");

const INTRO: Record<Corpus, string> = {
  code: "下面是项目里的若干源码文件，仅作为背景上下文，不需要阅读分析，也不需要调用任何工具。\n\n",
  zh: "下面是一些中文参考资料，仅作为背景上下文，不需要阅读分析。\n\n",
  en: "下面是一些英文参考资料，仅作为背景上下文，不需要阅读分析。\n\n",
  json: "下面是一份商品数据导出（JSON），仅作为背景上下文，不需要阅读分析。\n\n",
};

const cacheCtl = (cache: CacheMode): Json =>
  cache === "none" ? {} : cache === "1h" ? { cache_control: { type: "ephemeral", ttl: "1h" } } : { cache_control: { type: "ephemeral" } };

/** Python 按 Unicode 码点切片；素材只含 BMP 字符，因此与 JS 的 UTF-16 切片一致。 */
const slice = (s: string, n: number) => s.slice(0, n);

export function buildBody(fx: Fixture, nonceText: string, model = "claude-opus-5-5"): Json {
  const cc = cacheCtl(fx.cache ?? "5m");
  const system = [
    { type: "text", text: base.system[0] },
    { type: "text", text: base.system[1] },
    { type: "text", text: base.system[2], ...cc },
  ];
  let messages: Json[];
  if (fx.agent_turn !== undefined && fx.agent_turn !== null) {
    const k = fx.agent_turn;
    messages = [{ role: "user", content: [{ type: "text", text: `[测试编号 ${nonceText}]\n${agentScript.task}` }] }];
    agentScript.turns.slice(0, k).forEach((t: Json, i: number) => {
      const tid = `toolu_bl${String(i).padStart(4, "0")}`;
      messages.push({ role: "assistant", content: [{ type: "text", text: "好的，继续。" }, { type: "tool_use", id: tid, name: t.name, input: t.input }] });
      messages.push({ role: "user", content: [{ type: "tool_result", tool_use_id: tid, content: t.result }] });
    });
    messages[messages.length - 1].content.push({ type: "text", text: "（测试指令：本轮不要调用任何工具，只回复两个字母：OK）", ...cc });
  } else {
    let a = `[测试编号 ${nonceText}]\n`;
    if (fx.extra_chars) a += INTRO[fx.corpus!] + slice(CORPUS[fx.corpus!], fx.extra_chars) + "\n";
    messages = [{ role: "user", content: [{ type: "text", text: a, ...cc }, { type: "text", text: taskText(fx.output!), ...cc }] }];
  }
  return {
    model,
    max_tokens: fx.max_tokens ?? 16000,
    stream: fx.stream ?? true,
    output_config: { effort: "low" },
    system,
    tools: base.tools,
    messages,
  };
}

/** 与 Python json.dumps(ensure_ascii=False, sort_keys=True, separators=(",", ":")) 一致。 */
export function canonical(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`)
    .join(",")}}`;
}

export function templateSha256(fx: Fixture, model = "claude-opus-5-5"): string {
  return createHash("sha256").update(canonical(buildBody(fx, "<NONCE>", model)), "utf8").digest("hex");
}
