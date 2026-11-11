import { resolveTarget } from "./target";
import type { CheckOptions, JudgeMode, ProtocolChoice } from "./types";
import { normalizeBaseUrl } from "./url";
import { VISUAL_PRESETS } from "./visual";

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
  const model = String(body.model ?? "").trim();
  if (!model) throw new Error("请填写或选择模型名");
  if (model.length > 200) throw new Error("模型名过长");
  const protocol = PROTOCOLS.includes(body.protocol as ProtocolChoice) ? (body.protocol as ProtocolChoice) : "auto";
  const judgeMode = JUDGE_MODES.includes(body.judgeMode as JudgeMode) ? (body.judgeMode as JudgeMode) : "answer";
  const effort = EFFORTS.includes(String(body.effort ?? "")) ? String(body.effort ?? "") : "";
  const options: CheckOptions = {
    baseUrl: target.baseUrl,
    apiKey: target.apiKey,
    model,
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
  if (!options.fingerprint && !options.degradation) throw new Error("请至少选择一项检测");
  if (!options.fingerprint) options.tokenizer = false;
  return { options, target };
}
