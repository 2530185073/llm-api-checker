import { type Ctx, ProtocolLockError, WIRE_LABEL, type WireProtocol } from "./http";
import type { CaseInfo, CaseResult, CompositionReport, Flag, Mode, Outcome, Tag, Vendor } from "./types";

export interface CaseDef extends CaseInfo {
  needsRef?: boolean;
  needsSecond?: boolean;
  /** Generation protocols the case sends; [] means it sends none (auxiliary endpoints or aggregation only). */
  protocols: WireProtocol[];
  run: (c: Ctx) => Promise<Outcome>;
}

export type CaseSpec = [
  id: string,
  section: string,
  title: string,
  weight: number,
  tags: Tag[],
  desc: string,
  run: (c: Ctx) => Promise<Outcome>,
  extra?: { officialWeight?: number; needsRef?: boolean; needsSecond?: boolean; protocols?: WireProtocol[] },
];

const NATIVE: Record<Vendor, WireProtocol[]> = { claude: ["messages"], gemini: ["gemini"], openai: ["chat"], glm: ["chat"], kimi: ["chat"], deepseek: ["chat"] };

export const defineCases = (vendor: Vendor, specs: CaseSpec[]): CaseDef[] =>
  specs.map(([id, section, title, weight, tags, desc, run, extra]) => ({ id, vendor, section, title, weight, tags, desc, run, ...extra, protocols: extra?.protocols ?? NATIVE[vendor] }));

/** Vendors whose checklist distinguishes 官方等价 from 要求官方链路. */
export const MODE_VENDORS: Vendor[] = ["glm", "kimi", "deepseek"];

export function effectiveWeight(c: CaseInfo, mode: Mode, vendor: Vendor): number {
  const official = mode === "official" || !MODE_VENDORS.includes(vendor);
  if (c.tags.includes("ref")) return official ? c.officialWeight ?? c.weight : 0;
  if (c.tags.includes("unscored")) return official && c.officialWeight !== undefined ? c.officialWeight : 0;
  return c.weight;
}

export const ok = (summary: string, details?: string[], extra?: Partial<Outcome>): Outcome => ({ status: "pass", summary, details, ...extra });
export const warn = (summary: string, details?: string[], extra?: Partial<Outcome>): Outcome => ({ status: "warn", summary, details, ...extra });
export const fail = (summary: string, details?: string[], extra?: Partial<Outcome>): Outcome => ({ status: "fail", summary, details, ...extra });
export const skip = (summary: string, details?: string[]): Outcome => ({ status: "skip", summary, details });
export const info = (summary: string, details?: string[], extra?: Partial<Outcome>): Outcome => ({ status: "info", summary, details, ...extra });

/** In 官方等价 mode an official-link-only finding is reported but never fails. */
export const strictOr = (c: Ctx, o: Outcome): Outcome =>
  c.official || !MODE_VENDORS.includes(c.vendor) || o.status !== "fail" ? o : { ...o, status: "info", flags: o.flags?.filter((f) => f === "model_swapped" || f === "usage_fake" || f === "context_truncated") };

const CAPPING: Flag[] = ["model_swapped", "usage_fake", "context_truncated", "low_precision", "cc_reverse"];
const CAPPING_OFFICIAL: Flag[] = ["non_official_backend", "protocol_shim", "injected_prompt"];

export const FLAG_TEXT: Record<Flag, string> = {
  model_swapped: "模型被替换",
  usage_fake: "usage 造假",
  context_truncated: "上下文被截断",
  injected_prompt: "注入系统提示",
  protocol_shim: "协议转换层",
  relay_trace: "中转痕迹",
  non_official_backend: "非官方后端",
  low_precision: "疑似低精度",
  slow: "性能低于官方",
  cc_reverse: "Claude Code 逆向",
};

export async function runCases(
  c: Ctx,
  cases: CaseDef[],
  onCase: (r: CaseResult | { id: string; running: true }) => void,
): Promise<CaseResult[]> {
  const results: CaseResult[] = [];
  const runOne = async (d: CaseDef) => {
    onCase({ id: d.id, running: true });
    const started = Date.now();
    const before = c.requests;
    let out: Outcome;
    try {
      if (c.lock && d.protocols.length && !d.protocols.includes(c.lock))
        out = { status: "skip", summary: `仅适用于 ${d.protocols.map((p) => WIRE_LABEL[p]).join(" / ")}；协议已锁定为 ${WIRE_LABEL[c.lock]}，按设置跳过` };
      else if (d.needsRef && !c.ref) out = { status: "skip", summary: "需要填写对照官方端点" };
      else if (d.needsSecond && !c.secondModel) out = { status: "skip", summary: "未填写第二模型" };
      else {
        c.currentCase = d.id;
        out = await d.run(c);
      }
    } catch (error) {
      out = error instanceof ProtocolLockError ? { status: "skip", summary: error.message } : { status: "skip", summary: `用例执行异常：${(error as Error).message.slice(0, 200)}` };
    }
    if (out.precision) c.precision.push({ caseId: d.id, evidence: out.precision });
    const r: CaseResult = {
      ...out,
      id: d.id,
      title: d.title,
      section: d.section,
      weight: effectiveWeight(d, c.mode, c.vendor),
      tags: d.tags,
      durationMs: Date.now() - started,
      requests: c.requests - before,
    };
    results.push(r);
    onCase(r);
    return r;
  };
  const pre = cases.filter((d) => d.tags.includes("pre"));
  const final = cases.filter((d) => d.tags.includes("final") && !d.tags.includes("pre"));
  const body = cases.filter((d) => !pre.includes(d) && !final.includes(d));
  for (const d of pre) {
    const r = await runOne(d);
    if (d.id.endsWith("basic") && r.status === "fail" && !(c.lock && d.protocols.length && !d.protocols.includes(c.lock))) {
      for (const rest of [...body, ...final]) {
        const s: CaseResult = { id: rest.id, title: rest.title, section: rest.section, weight: effectiveWeight(rest, c.mode, c.vendor), tags: rest.tags, status: "skip", summary: "基础对话失败，跳过", durationMs: 0, requests: 0 };
        results.push(s);
        onCase(s);
      }
      return order(results, cases);
    }
  }
  await Promise.all(body.map(runOne));
  for (const d of final) await runOne(d);
  return order(results, cases);
}

const order = (results: CaseResult[], cases: CaseDef[]) => cases.map((d) => results.find((r) => r.id === d.id)).filter((r): r is CaseResult => !!r);

export function summarize(c: Ctx, results: CaseResult[]): CompositionReport {
  const val = { pass: 1, warn: 0.5, fail: 0 } as const;
  let num = 0;
  let den = 0;
  for (const r of results) {
    if (r.weight <= 0 || r.status === "skip" || r.status === "info") continue;
    num += r.weight * val[r.status];
    den += r.weight;
  }
  const score = den ? Math.round((num / den) * 100) : null;
  const flags = [...new Set(results.flatMap((r) => (r.status === "fail" || r.status === "warn" ? r.flags ?? [] : [])))];
  const capping = flags.filter((f) => CAPPING.includes(f) || ((c.official || !MODE_VENDORS.includes(c.vendor)) && CAPPING_OFFICIAL.includes(f)));
  const criticalFail = results.some((r) => r.status === "fail" && r.tags.includes("critical") && r.weight > 0);
  let verdict: CompositionReport["verdict"] = "unknown";
  let verdictText = "有效用例不足，无法判断";
  if (score !== null) {
    if (capping.length || criticalFail) {
      verdict = "fake";
      verdictText = `检出关键问题：${(capping.length ? capping.map((f) => FLAG_TEXT[f]) : ["关键用例未通过"]).join("、")}`;
    } else if (score >= 85) {
      verdict = "official";
      verdictText = c.official || !MODE_VENDORS.includes(c.vendor) ? "与官方链路特征一致" : "与官方模型等价";
    } else if (score >= 60) {
      verdict = "suspect";
      verdictText = "部分特征与官方不符，存疑";
    } else {
      verdict = "fake";
      verdictText = "多数特征与官方不符";
    }
  }
  const lockedOut = results.filter((r) => r.status === "skip" && r.summary.includes("协议已锁定为"));
  const lockedWeight = lockedOut.reduce((sum, r) => sum + Math.max(r.weight, 0), 0);
  if (c.lock && lockedOut.length && verdict !== "fake" && lockedWeight > den) {
    verdict = "unknown";
    verdictText = `协议已锁定为 ${WIRE_LABEL[c.lock]}，${lockedOut.length} 项用例不适用被跳过，剩余证据不足以判定；可在成分检测设置中开启「允许厂商原生协议」`;
  }
  return {
    vendor: c.vendor,
    mode: c.mode,
    score,
    verdict,
    verdictText,
    flags,
    platform: (c.state.get("platform") as string) ?? null,
    backend: (c.state.get("backend") as string) ?? null,
    precisionPoints: c.precision.reduce((s, p) => s + (p.evidence === "strong" ? 2 : p.evidence === "weak" ? 1 : 0), 0),
    passed: results.filter((r) => r.status === "pass").length,
    warned: results.filter((r) => r.status === "warn").length,
    failed: results.filter((r) => r.status === "fail").length,
    skipped: results.filter((r) => r.status === "skip").length,
    cases: results,
  };
}
