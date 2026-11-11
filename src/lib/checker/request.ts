import { resolveTarget } from "./target";
import type { CheckOptions, JudgeMode, ProtocolChoice } from "./types";
import { normalizeBaseUrl } from "./url";
import { VISUAL_PRESETS } from "./visual";
import type { Vendor } from "../composition/types";

const VENDORS: Vendor[] = ["claude", "openai", "gemini", "glm", "kimi", "deepseek"];

const PROTOCOLS: ProtocolChoice[] = ["auto", "chat", "responses", "messages"];
const JUDGE_MODES: JudgeMode[] = ["answer", "latency", "both"];
const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"];

export interface ParsedTarget {
  baseUrl: string;
  fetchBase: string;
  host: string;
  apiKey: string;
}

export async function parseTarget(body: Record<string, unknown>, requestHost: string | null): Promise<ParsedTarget> {
  const baseUrl = normalizeBaseUrl(String(body.baseUrl ?? ""));
  const apiKey = String(body.apiKey ?? "").trim();
  if (!apiKey) throw new Error("请填写 API Key");
  if (apiKey.length > 4096 || /[\r\n]/.test(apiKey)) throw new Error("API Key 格式不正确");
  const fetchBase = await resolveTarget(baseUrl, requestHost);
  return { baseUrl, fetchBase, host: new URL(baseUrl).host, apiKey };
}

export async function parseCheck(body: Record<string, unknown>, requestHost: string | null) {
  const target = await parseTarget(body, requestHost);
  const listed = Array.isArray(body.models) ? (body.models as unknown[]).map((m) => String(m).trim()).filter(Boolean) : [];
  const models = [...new Set(listed.length ? listed : [String(body.model ?? "").trim()].filter(Boolean))];
  const model = models[0] ?? "";
  if (!model) throw new Error("请填写或选择模型名");
  if (models.length > 12) throw new Error("一次最多检测 12 个模型");
  if (models.some((m) => m.length > 200)) throw new Error("模型名过长");
  const comp = (body.composition ?? {}) as Record<string, unknown>;
  const refIn = (comp.ref ?? null) as Record<string, unknown> | null;
  let ref: CheckOptions["composition"]["ref"];
  if (refIn && String(refIn.baseUrl ?? "").trim() && String(refIn.apiKey ?? "").trim()) {
    const t = await parseTarget(refIn, requestHost);
    ref = { baseUrl: t.baseUrl, fetchBase: t.fetchBase, apiKey: t.apiKey, model: String(refIn.model ?? "").trim() || model };
  }
  const selected: CheckOptions["composition"]["selected"] = {};
  if (comp.selected && typeof comp.selected === "object") {
    for (const [v, ids] of Object.entries(comp.selected as Record<string, unknown>)) {
      if (VENDORS.includes(v as Vendor) && Array.isArray(ids)) selected[v as Vendor] = ids.map(String);
    }
  }
  const composition: CheckOptions["composition"] = {
    enabled: comp.enabled === true,
    vendor: VENDORS.includes(comp.vendor as Vendor) ? (comp.vendor as Vendor) : "auto",
    mode: comp.mode === "official" ? "official" : "equivalent",
    selected,
    ladderMax: Math.max(8000, Math.min(1_048_576, Number(comp.ladderMax) || 262_144)),
    ref,
    secondModel: String(comp.secondModel ?? "").trim().slice(0, 200) || undefined,
  };
  const protocol = PROTOCOLS.includes(body.protocol as ProtocolChoice) ? (body.protocol as ProtocolChoice) : "auto";
  const judgeMode = JUDGE_MODES.includes(body.judgeMode as JudgeMode) ? (body.judgeMode as JudgeMode) : "answer";
  const effort = EFFORTS.includes(String(body.effort ?? "")) ? String(body.effort ?? "") : "";
  const options: CheckOptions = {
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    model,
    models,
    repeat: Math.max(1, Math.min(10, Math.round(Number(body.repeat) || 1))),
    concurrency: Math.max(1, Math.min(16, Math.round(Number(body.concurrency) || 4))),
    composition,
    protocol,
    effort,
    judgeMode,
    fingerprint: body.fingerprint !== false,
    tokenizer: body.tokenizer !== false,
    degradation: body.degradation !== false,
    visualPresets: Array.isArray(body.visualPresets)
      ? VISUAL_PRESETS.map((p) => p.key).filter((key) => (body.visualPresets as unknown[]).includes(key))
      : ["pelican"],
    visualTimeoutMin: [10, 20, 30].includes(Number(body.visualTimeoutMin)) ? Number(body.visualTimeoutMin) : 10,
  };
  if (!options.fingerprint && !options.degradation && !composition.enabled) throw new Error("请至少选择一项检测");
  if (!options.fingerprint) options.tokenizer = false;
  return { options, target };
}
