/**
 * 计费真实性（基准对照）：用逐字节固定的 Claude Code 形态请求、逐字固定的输出，
 * 把渠道上报的 usage 与预先采集的官方计费基准比对，算出上下文 / output 的膨胀倍数和账单倍数。
 * 不需要官方 Key：基准数据随仓库提供（src/data/billing-baseline）。
 */
import opus55 from "@/data/billing-baseline/claude-opus-5.5.json";
import { normalizeModelId } from "../../checker/model-id";
import { type CaseSpec, fail, info, ok, skip, warn } from "../engine";
import { type Ctx, errText } from "../http";
import { messages } from "../protocols";
import type { Outcome } from "../types";
import { type Fixture, buildBody, expectedText, nonce, normalizeText, seedFrom, templateSha256 } from "./spec";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

interface Stat {
  median: number;
  min: number;
  max: number;
  n: number;
}
interface Split {
  input: number;
  cache_write_5m: number;
  cache_write_1h: number;
  cache_read: number;
}
interface BaseFixture {
  fixture: Fixture;
  context: Stat;
  output: Stat;
  thinking: Stat;
  split: Record<string, Split>;
}
export interface Baseline {
  spec_version: string;
  model: string;
  captured_at: string;
  system_prefix_tokens: number;
  pricing_usd_per_mtok: { input: number; output: number; cache_write_5m: number; cache_write_1h: number; cache_read: number };
  fixtures: Record<string, BaseFixture>;
}

export const BASELINES: Record<string, Baseline> = { "claude-opus-5.5": opus55 as unknown as Baseline };
const baselineFor = (c: Ctx) => BASELINES[normalizeModelId(c.model)];

export interface BillingSample {
  label: string;
  role: string;
  output: string;
  valid: boolean;
  note?: string;
  context: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
  trueContext: number;
  trueOut: number;
  /** 基准实测范围（同一请求多次采集的最小～最大值）。 */
  ctxRange: [number, number];
  outRange: [number, number];
  cost: number;
  trueCost: number;
  /** 官方在同样缓存状态下的缓存写入 / 读取占上下文的比例。 */
  expWrite: number;
  expRead: number;
  maxTokensViolated: boolean;
}

/** 与基准逐字节一致的请求序列（顺序决定缓存状态）。 */
const CODE_LEVELS: Record<string, number> = { "0": 0, "10k": 26600, "30k": 79800, "60k": 159600, "100k": 266000, "160k": 425600 };
const TYPE_LEVELS: Record<string, number> = { zh: 26800, en: 102000, json: 60000 };
type Step = { fx: Fixture; role: string };
const code = (lv: string, extra: Fixture = {}): Fixture => ({ corpus: "code", extra_chars: CODE_LEVELS[lv], stream: true, cache: "5m", ...extra });

const GROUPS = {
  base: (): Step[] => [
    { fx: code("0", { output: "medium" }), role: "cold" },
    { fx: code("0", { output: "medium" }), role: "warm" },
    { fx: code("0", { output: "tiny" }), role: "prefix" },
    { fx: code("0", { output: "short" }), role: "prefix" },
    { fx: code("0", { output: "long", max_tokens: 32000 }), role: "prefix" },
    { fx: code("0", { output: "trunc", max_tokens: 512 }), role: "prefix" },
  ],
  ladder: (lv: string): Step[] => [
    { fx: code(lv, { output: "medium" }), role: "cold" },
    { fx: code(lv, { output: "medium" }), role: "warm" },
    { fx: code(lv, { output: "tiny" }), role: "prefix" },
  ],
  type: (kind: keyof typeof TYPE_LEVELS): Step[] => {
    const fx: Fixture = { corpus: kind as Fixture["corpus"], extra_chars: TYPE_LEVELS[kind], stream: true, cache: "5m", output: "medium" };
    return [
      { fx, role: "cold" },
      { fx, role: "warm" },
    ];
  },
  nocache: (): Step[] => [
    { fx: code("0", { cache: "none", output: "medium" }), role: "cold" },
    { fx: code("0", { cache: "none", output: "medium" }), role: "repeat" },
  ],
  nonstream: (): Step[] => [
    { fx: code("0", { stream: false, output: "medium" }), role: "cold" },
    { fx: code("0", { stream: false, output: "medium" }), role: "warm" },
  ],
  ttl1h: (): Step[] => [
    { fx: code("60k", { cache: "1h", output: "medium" }), role: "cold" },
    { fx: code("60k", { cache: "1h", output: "medium" }), role: "warm" },
  ],
  agent: (): Step[] => Array.from({ length: 9 }, (_, k) => ({ fx: { agent_turn: k, stream: true, cache: "5m", output: "tiny" } as Fixture, role: "turn" })),
};

function price(u: Json, p: Baseline["pricing_usd_per_mtok"]): number {
  const cc = u?.cache_creation ?? {};
  let c5 = cc.ephemeral_5m_input_tokens ?? 0;
  const c1h = cc.ephemeral_1h_input_tokens ?? 0;
  if (!c5 && !c1h) c5 = u?.cache_creation_input_tokens ?? 0;
  return ((u?.input_tokens ?? 0) * p.input + c5 * p.cache_write_5m + c1h * p.cache_write_1h + (u?.cache_read_input_tokens ?? 0) * p.cache_read + (u?.output_tokens ?? 0) * p.output) / 1e6;
}
const priceSplit = (s: Split, out: number, p: Baseline["pricing_usd_per_mtok"]) =>
  (s.input * p.input + s.cache_write_5m * p.cache_write_5m + s.cache_write_1h * p.cache_write_1h + s.cache_read * p.cache_read + out * p.output) / 1e6;

const x = (a: number, b: number) => (b ? `${(a / b).toFixed(2)}×` : "—");
const n = (v: number) => v.toLocaleString("en-US");

async function runGroup(c: Ctx, label: string, steps: Step[]): Promise<{ samples: BillingSample[]; details: string[]; problem?: string }> {
  const b = baselineFor(c);
  const nz = nonce(seedFrom(c.salt(`bill-${label}`)));
  const samples: BillingSample[] = [];
  const details: string[] = [];
  for (const [i, s] of steps.entries()) {
    const sha = templateSha256(s.fx);
    const bf = b.fixtures[sha];
    if (!bf) return { samples, details, problem: `第 ${i + 1} 个请求不在基准中（素材或构造规范被改动，sha256 ${sha.slice(0, 12)}）` };
    const body = buildBody(s.fx, nz, c.model);
    const r = await messages(c, body, { timeoutMs: 900_000 });
    const tag = `${label}#${i + 1} ${s.role}/${s.fx.output}`;
    if (!r.ok || !r.usage) {
      details.push(`${tag}：请求失败 ${errText(r)}`);
      continue;
    }
    const u = r.usage;
    const context = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    const out = u.output_tokens ?? 0;
    const exp = expectedText(s.fx.output!);
    const maxTokensViolated = s.fx.output === "trunc" && (r.stop !== "max_tokens" || out > (s.fx.max_tokens ?? 0));
    const valid = exp === null ? true : normalizeText(r.text) === normalizeText(exp);
    let split = bf.split[s.role] ?? bf.split.cold;
    // 冷启动时官方可能命中 system + tools 的缓存；渠道如实上报了这一点时，按同样的缓存状态计算真实账单
    const prefix = b.system_prefix_tokens;
    if (s.role === "cold" && s.fx.cache !== "none" && Math.abs((u.cache_read_input_tokens ?? 0) - prefix) <= 20) {
      const w = split.cache_write_5m + split.cache_write_1h - prefix;
      split = { ...split, cache_read: prefix, cache_write_5m: split.cache_write_5m ? w : 0, cache_write_1h: split.cache_write_1h ? w : 0 };
    }
    const sample: BillingSample = {
      label,
      role: s.role,
      output: s.fx.output!,
      valid,
      note: valid ? undefined : `输出与基准不一致（${r.text.length} 字符），样本作废`,
      context,
      out,
      cacheWrite: u.cache_creation_input_tokens ?? 0,
      cacheRead: u.cache_read_input_tokens ?? 0,
      trueContext: bf.context.median,
      trueOut: bf.output.median,
      ctxRange: [bf.context.min, bf.context.max],
      outRange: [bf.output.min, bf.output.max],
      cost: price(u, b.pricing_usd_per_mtok),
      trueCost: priceSplit(split, bf.output.median, b.pricing_usd_per_mtok),
      expWrite: (split.cache_write_5m + split.cache_write_1h) / bf.context.median,
      expRead: split.cache_read / bf.context.median,
      maxTokensViolated,
    };
    samples.push(sample);
    details.push(
      `${tag}：上下文 ${n(context)} / 基准 ${n(bf.context.median)}（${x(context, bf.context.median)}），output ${n(out)} / 基准 ${n(bf.output.median)}（${x(out, bf.output.median)}），` +
        `缓存 写 ${n(sample.cacheWrite)} 读 ${n(sample.cacheRead)}，账单 $${sample.cost.toFixed(4)} / 基准 $${sample.trueCost.toFixed(4)}（${x(sample.cost, sample.trueCost)}）` +
        (maxTokensViolated ? `，未遵守 max_tokens=${s.fx.max_tokens}（stop_reason=${r.stop}）` : "") +
        (sample.note ? `，${sample.note}` : ""),
    );
  }
  return { samples, details };
}

const store = (c: Ctx, s: BillingSample[]) => c.state.set("billing", [...((c.state.get("billing") as BillingSample[]) ?? []), ...s]);

/** 超出基准实测范围多少（已扣除容差）；容差：上下文 0.5% + 10 token，output 3% + 30 token（思考 token 的自然波动）。 */
const beyond = (v: number, [lo, hi]: [number, number], tol: number) => Math.max(0, lo - tol - v, v - hi - tol);
export const ctxExcess = (s: BillingSample) => beyond(s.context, s.ctxRange, s.trueContext * 0.005 + 10);
export const outExcess = (s: BillingSample) => beyond(s.out, s.outRange, s.trueOut * 0.03 + 30);

function judge(samples: BillingSample[], details: string[], what: string): Outcome {
  // 未遵守 max_tokens 的请求是真的多生成了内容，单独判失败，不计入膨胀与账单倍数
  const v = samples.filter((s) => s.valid && !s.maxTokensViolated);
  const trunc = samples.filter((s) => s.maxTokensViolated);
  if (!v.length && !trunc.length) return warn("没有可比对的有效样本（输出与基准不一致或请求失败）", details);
  const ctxDev = Math.max(0, ...v.map(ctxExcess));
  const outDev = Math.max(0, ...v.map(outExcess));
  const tot = (k: "context" | "trueContext" | "out" | "trueOut" | "cost" | "trueCost") => v.reduce((a, s) => a + s[k], 0);
  const ctxRatio = tot("context") / Math.max(1, tot("trueContext"));
  const outRatio = tot("out") / Math.max(1, tot("trueOut"));
  const costRatio = tot("cost") / Math.max(1e-9, tot("trueCost"));
  const head = `${what}：上下文 ${ctxRatio.toFixed(2)}×，output ${outRatio.toFixed(2)}×，账单 ${costRatio.toFixed(2)}×（合计上报 ÷ 合计基准）`;
  if (trunc.length) return fail(`${v.length ? `${head}；` : ""}${trunc.length} 个请求未遵守 max_tokens（未计入倍数）`, details, { flags: ["usage_fake"] });
  if (!ctxDev && !outDev) return ok(`与官方计费基准一致（${head.split("：")[1]}）`, details);
  const severe = v.some((s) => ctxExcess(s) > s.trueContext * 0.02 || outExcess(s) > Math.max(50, s.trueOut * 0.1)) || costRatio > 1.1;
  return severe ? fail(`usage 与官方基准不符，${head}`, details, { flags: ["usage_fake"] }) : warn(`usage 与官方基准有小幅偏差，${head}`, details);
}

const NO_BASELINE = (c: Ctx) => skip(`暂无模型 ${normalizeModelId(c.model)} 的计费基准（目前提供：${Object.keys(BASELINES).join("、")}）`);

async function groupCase(c: Ctx, parts: [string, Step[]][], what: string): Promise<Outcome> {
  if (!baselineFor(c)) return NO_BASELINE(c);
  const all: BillingSample[] = [];
  const details: string[] = [];
  for (const [label, steps] of parts) {
    const g = await runGroup(c, label, steps);
    if (g.problem) return skip(g.problem, g.details);
    all.push(...g.samples);
    details.push(...g.details);
  }
  store(c, all);
  return judge(all, details, what);
}

// ---------------------------------------------------------------- 汇总与场景推算
const WORKLOADS = [
  { name: "Claude Code 写代码", context: 60_000, hit: 0.9, out: 400 },
  { name: "长文档问答", context: 100_000, hit: 0, out: 300 },
];

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : NaN;
}

/** 汇总本次所有计费样本并推算场景账单倍数（纯函数，便于离线复核）。 */
export function billingSummary(samples: BillingSample[], b: Baseline): { summary: string; details: string[] } | null {
  const all = samples.filter((s) => s.valid && !s.maxTokensViolated);
  if (!all.length) return null;
  const p = b.pricing_usd_per_mtok;
  const sum = (S: BillingSample[], k: "cost" | "trueCost") => S.reduce((a, s) => a + s[k], 0);
  const cold = all.filter((s) => s.role === "cold");
  const warm = all.filter((s) => s.role === "warm" || s.role === "prefix" || s.role === "turn");
  const d = [
    `有效样本 ${all.length} 个；上下文膨胀中位数 ${median(all.map((s) => s.context / s.trueContext)).toFixed(2)}×，output 膨胀中位数 ${median(all.map((s) => s.out / Math.max(1, s.trueOut))).toFixed(2)}×`,
    `账单倍数（按官方价折算）：冷启动 ${(sum(cold, "cost") / Math.max(1e-9, sum(cold, "trueCost"))).toFixed(2)}×，缓存命中 ${(sum(warm, "cost") / Math.max(1e-9, sum(warm, "trueCost"))).toFixed(2)}×`,
  ];
  // 缓存拆分是否如实：逐条与官方在同样缓存状态下的拆分比较（误差 ≤ 5 个百分点）
  const fw = (s: BillingSample) => s.cacheWrite / Math.max(1, s.context);
  const fr = (s: BillingSample) => s.cacheRead / Math.max(1, s.context);
  const faithfulShare = all.filter((s) => Math.abs(fw(s) - s.expWrite) <= 0.05 && Math.abs(fr(s) - s.expRead) <= 0.05).length / all.length;
  const faithful = faithfulShare >= 0.8;
  const W = median(all.map(fw));
  const Rr = median(all.map(fr));
  d.push(
    faithful
      ? `缓存拆分：${Math.round(faithfulShare * 100)}% 的样本与官方在同样缓存状态下的拆分一致，按官方缓存规则推算`
      : `缓存拆分与缓存状态无关（中位数 input ${((1 - W - Rr) * 100).toFixed(1)}% / 写入 ${(W * 100).toFixed(1)}% / 读取 ${(Rr * 100).toFixed(1)}%，只有 ${Math.round(faithfulShare * 100)}% 的样本与官方一致），按该比例推算`,
  );
  // 分段插值：每个上下文档位上拟合 上报 output = a·真实 output + b，上报上下文 = r·真实上下文
  const levels = new Map<number, BillingSample[]>();
  for (const s of all.filter((s) => s.label.startsWith("ctx-") || s.label === "base")) {
    const k = Math.round(s.trueContext / 1000) * 1000;
    levels.set(k, [...(levels.get(k) ?? []), s]);
  }
  const L = [...levels.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([T, S]) => {
      const pts = S.filter((s) => s.output !== "trunc");
      const xs = pts.map((s) => s.trueOut);
      const ys = pts.map((s) => s.out);
      const mx = xs.reduce((a, v) => a + v, 0) / xs.length;
      const my = ys.reduce((a, v) => a + v, 0) / ys.length;
      const vx = xs.reduce((a, v) => a + (v - mx) ** 2, 0);
      const slope = vx > 0 ? xs.reduce((a, v, i) => a + (v - mx) * (ys[i] - my), 0) / vx : NaN;
      return { T, rc: median(S.map((s) => s.context / s.trueContext)), a: slope, b: my - slope * mx };
    })
    .filter((l) => Number.isFinite(l.a));
  if (L.length) {
    const at = (C: number, k: "rc" | "a" | "b") => {
      if (C <= L[0].T) return L[0][k];
      if (C >= L[L.length - 1].T) return L[L.length - 1][k];
      const i = L.findIndex((l) => l.T >= C);
      const t = (C - L[i - 1].T) / (L[i].T - L[i - 1].T);
      return L[i - 1][k] + t * (L[i][k] - L[i - 1][k]);
    };
    for (const w of WORKLOADS) {
      const truth = (w.context * (w.hit * p.cache_read + (1 - w.hit) * p.cache_write_5m) + w.out * p.output) / 1e6;
      const pc = at(w.context, "rc") * w.context;
      const po = Math.max(0, at(w.context, "a") * w.out + at(w.context, "b"));
      const [cw, cr] = faithful ? [1 - w.hit, w.hit] : [W, Rr];
      const rep = (pc * (cw * p.cache_write_5m + cr * p.cache_read + Math.max(0, 1 - cw - cr) * p.input) + po * p.output) / 1e6;
      const outside = w.context < L[0].T || w.context > L[L.length - 1].T;
      d.push(`场景「${w.name}」（上下文 ${n(w.context)}、缓存命中 ${Math.round(w.hit * 100)}%、输出 ${w.out}）：账单约 ${(rep / truth).toFixed(2)}×${outside ? "（超出实测档位，外推）" : ""}`);
    }
    if (L.length < 3) d.push("勾选「上下文梯度」可得到更准确的场景推算");
  }
  const ratio = sum(warm.length ? warm : all, "cost") / Math.max(1e-9, sum(warm.length ? warm : all, "trueCost"));
  return { summary: `计费汇总：缓存命中状态下账单约为官方的 ${ratio.toFixed(2)} 倍`, details: d };
}

function summary(c: Ctx): Outcome {
  const b = baselineFor(c);
  if (!b) return NO_BASELINE(c);
  const r = billingSummary((c.state.get("billing") as BillingSample[]) ?? [], b);
  return r ? info(r.summary, r.details) : skip("没有计费基准样本可汇总");
}

const COST = "（按官方价约";
export const BILLING_SPECS: CaseSpec[] = [
  [
    "bill_base",
    "计费真实性",
    "基准对照：基础上下文",
    4,
    [],
    `按 Claude Code 请求形态（约 1.8 万 token 的系统提示词与工具定义）发送 6 个与官方基准逐字节一致的请求：冷启动、原样重发、同前缀的极短 / 短 / 长（约 8,700 token）输出、max_tokens=512 截断。输出逐字固定，比对上报的上下文、output、缓存字段与官方基准，算出膨胀倍数与账单倍数${COST} $0.4）。`,
    (c) => groupCase(c, [["base", GROUPS.base()]], "基础上下文"),
  ],
  [
    "bill_nocache",
    "计费真实性",
    "基准对照：不带缓存标记",
    2,
    [],
    `同一请求去掉全部 cache_control 连发两次。官方两次都按全价输入计费、缓存字段为 0；出现缓存 token 说明缓存数据是编造的${COST} $0.2）。`,
    (c) => groupCase(c, [["nocache", GROUPS.nocache()]], "不带缓存标记"),
  ],
  [
    "bill_nonstream",
    "计费真实性",
    "基准对照：非流式",
    1,
    [],
    `基础请求改为非流式发送两次（冷启动 + 重发），检查非流式路径的 usage 是否与流式、与官方一致${COST} $0.2）。`,
    (c) => groupCase(c, [["nonstream", GROUPS.nonstream()]], "非流式"),
  ],
  [
    "bill_ladder",
    "计费真实性",
    "基准对照：上下文梯度 1 万～16 万",
    3,
    [],
    `额外附加 1 万 / 3 万 / 6 万 / 10 万 / 16 万 token 的代码上下文，每档冷启动、重发、同前缀极短输出各一次。用于发现随上下文变化的膨胀（例如 output 按上下文比例虚报、上下文封顶）${COST} $3）。`,
    (c) => groupCase(c, (["10k", "30k", "60k", "100k", "160k"] as const).map((lv) => [`ctx-${lv}`, GROUPS.ladder(lv)]), "上下文梯度"),
  ],
  [
    "bill_types",
    "计费真实性",
    "基准对照：内容类型",
    2,
    [],
    `约 3 万 token 的中文散文、英文散文、JSON 数据各发一次冷启动 + 重发，检查膨胀是否随内容类型变化（部分渠道按字符数估算 token）${COST} $1）。`,
    (c) => groupCase(c, (["zh", "en", "json"] as const).map((k) => [`type-${k}`, GROUPS.type(k)]), "内容类型"),
  ],
  [
    "bill_ttl1h",
    "计费真实性",
    "基准对照：1 小时缓存",
    1,
    [],
    `6 万 token 上下文、cache_control.ttl=1h 的冷启动 + 重发。官方第一次写入记在 ephemeral_1h_input_tokens、按 2 倍输入价计费${COST} $0.7）。`,
    (c) => groupCase(c, [["ttl1h", GROUPS.ttl1h()]], "1 小时缓存"),
  ],
  [
    "bill_agent",
    "计费真实性",
    "基准对照：多轮 Agent 会话",
    3,
    [],
    `固定的 8 轮工具调用历史（读文件、搜索、编辑、跑测试），逐轮增长并命中前缀缓存，共 9 个请求，每轮只回复 OK。对应 Claude Code 写代码时最常见的计费形态${COST} $0.6）。`,
    (c) => groupCase(c, [["agent", GROUPS.agent()]], "多轮 Agent 会话"),
  ],
  [
    "bill_summary",
    "计费真实性",
    "计费汇总与场景推算",
    0,
    ["final", "unscored"],
    "汇总本次所有计费基准样本：上下文 / output 膨胀中位数、冷启动与缓存命中的账单倍数，并按实测档位分段插值推算「Claude Code 写代码」「长文档问答」场景的账单倍数。只记录，不计分。",
    async (c) => summary(c),
    { protocols: [] },
  ],
];
