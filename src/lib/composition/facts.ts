import { normalizeModelId } from "../checker/model-id";
import type { Vendor } from "./types";

export function detectVendor(model: string): Vendor | null {
  const m = model.toLowerCase().replace(/^.*\//, "");
  if (/claude|anthropic|opus|sonnet|haiku|fable|mythos/.test(m)) return "claude";
  if (/gemini|gemma/.test(m)) return "gemini";
  if (/glm|zhipu|chatglm/.test(m)) return "glm";
  if (/kimi|moonshot/.test(m)) return "kimi";
  if (/deepseek/.test(m)) return "deepseek";
  if (/^(gpt|o\d|chatgpt|codex)/.test(m)) return "openai";
  return null;
}

export const VENDOR_LABEL: Record<Vendor, string> = {
  claude: "Claude（Anthropic Messages）",
  openai: "OpenAI（Chat / Responses）",
  gemini: "Gemini（generateContent）",
  glm: "GLM（智谱 / z.ai）",
  kimi: "Kimi（Moonshot）",
  deepseek: "DeepSeek",
};

/** Expected tokenizer-bank classes per vendor (Anthropic has not published its tokenizer). */
export const TOKENIZER_CLASS: Record<Vendor, string[] | null> = {
  claude: null,
  openai: ["o200k"],
  gemini: ["gemma3"],
  glm: ["glm-5", "glm-4"],
  kimi: ["kimi"],
  deepseek: ["deepseek-v3"],
};

// ---------- Claude ----------

export interface ClaudeFacts {
  known: boolean;
  family: string;
  version: number;
  label: string;
  prefillAllowed: boolean;
  samplingRule: "legacy" | "defaults_only" | "removed";
  effortLevels: string[] | null;
  maxOutput: number;
  budgetTokensRemoved: boolean;
  thinkingDisableable: boolean;
  forcedToolChoiceRemoved: boolean;
  betweenTools: boolean;
  systemRoleInMessages: boolean;
  displayDefault: "summarized" | "omitted";
  fastMode: "ga" | "preview" | "standard" | "none";
  thinkingBinding: boolean;
  perTurnEffort: boolean;
  generationAtLeast47: boolean;
}

export function claudeFacts(model: string): ClaudeFacts {
  const id = normalizeModelId(model).replace(/^anthropic\.|-v\d+:\d+$/g, "");
  const modern = id.match(/(opus|sonnet|haiku|fable|mythos)-(\d+(?:\.\d+)?)/);
  const legacy = id.match(/claude-(\d+(?:\.\d+)?)-(opus|sonnet|haiku)/);
  const family = modern?.[1] ?? legacy?.[2] ?? "";
  const version = Number(modern?.[2] ?? legacy?.[1] ?? 0);
  const known = !!family && version > 0;
  const v = version;
  const fable = family === "fable" || family === "mythos";
  const ge = (x: number) => v >= x - 1e-9;
  const opus = family === "opus";
  const sonnet = family === "sonnet";
  const haiku = family === "haiku";
  const gen47 = fable || (opus && ge(4.7)) || (sonnet && ge(5)) || (haiku && ge(5.5));
  const effortLevels =
    (haiku && !ge(5.5)) || (sonnet && !ge(4.6)) || (opus && !ge(4.5))
      ? null
      : opus && v === 4.5
        ? ["low", "medium", "high"]
        : (opus && v === 4.6) || (sonnet && v === 4.6)
          ? ["low", "medium", "high", "max"]
          : ["low", "medium", "high", "xhigh", "max"];
  const maxOutput = fable || (opus && ge(4.6)) || (sonnet && ge(4.6)) || (haiku && ge(5.5)) ? 128000 : opus && v < 4.5 ? 32000 : 64000;
  const latest51 = (fable && ge(5.1)) || (opus && ge(5.5)) || (sonnet && ge(5.5));
  return {
    known,
    family,
    version: v,
    label: known ? `${family} ${v}` : "未知型号",
    prefillAllowed: !(gen47 || (opus && ge(4.6)) || (sonnet && ge(4.6))),
    samplingRule: fable || (opus && ge(4.7)) ? "removed" : (sonnet && ge(5)) || (haiku && ge(5.5)) ? "defaults_only" : "legacy",
    effortLevels,
    maxOutput,
    budgetTokensRemoved: gen47,
    thinkingDisableable: !(fable || (opus && ge(5.5)) || (sonnet && ge(5.5))),
    forcedToolChoiceRemoved: latest51 && !(family === "fable" && v === 5),
    betweenTools: sonnet && v === 5.5,
    systemRoleInMessages: (opus && ge(4.8)) || fable || (sonnet && ge(5.5)) || (haiku && ge(5.5)),
    displayDefault: gen47 ? "omitted" : "summarized",
    fastMode: opus && ge(5.5) ? "ga" : opus && (v === 5 || v === 4.8) ? "preview" : opus && v === 4.6 ? "standard" : "none",
    thinkingBinding: (family === "fable" && ge(5.1)) || (opus && ge(5.5)) || (sonnet && ge(5.5)) || (haiku && ge(5.5)),
    perTurnEffort: (fable && ge(5.1)) || (opus && ge(5)) || (sonnet && ge(5.5)) || (haiku && ge(5.5)),
    generationAtLeast47: gen47,
  };
}

/** Family + version key used to compare model echoes across vendor spellings. */
export function claudeKey(model: string) {
  const f = claudeFacts(model);
  return f.known ? `${f.family}-${f.version}` : null;
}

// ---------- OpenAI ----------

export interface OpenAIFacts {
  known: boolean;
  reasoning: boolean;
  efforts: string[];
  defaultEffort: string;
  maxOutput: number;
  stopSupported: boolean;
  fingerprintNull: boolean;
}

export function openaiFacts(model: string): OpenAIFacts {
  const id = normalizeModelId(model);
  const g = id.match(/^gpt-(\d+(?:\.\d+)?)/);
  const v = g ? Number(g[1]) : 0;
  if (/^gpt-4o|^chatgpt-4o/.test(id)) return { known: true, reasoning: false, efforts: [], defaultEffort: "", maxOutput: 16384, stopSupported: true, fingerprintNull: false };
  if (/^gpt-4\.1/.test(id)) return { known: true, reasoning: false, efforts: [], defaultEffort: "", maxOutput: 32768, stopSupported: true, fingerprintNull: false };
  if (/^o3/.test(id)) return { known: true, reasoning: true, efforts: ["low", "medium", "high", "xhigh"], defaultEffort: "medium", maxOutput: 100003, stopSupported: false, fingerprintNull: true };
  if (v >= 5) {
    const efforts = v === 5 ? ["minimal", "low", "medium", "high"] : v === 5.1 ? ["none", "low", "medium", "high"] : ["none", "low", "medium", "high", "xhigh"];
    const defaultEffort = [5.1, 5.2, 5.4].includes(v) ? "none" : "medium";
    return { known: true, reasoning: true, efforts, defaultEffort, maxOutput: 128000, stopSupported: false, fingerprintNull: true };
  }
  return { known: false, reasoning: true, efforts: ["low", "medium", "high"], defaultEffort: "medium", maxOutput: 128000, stopSupported: false, fingerprintNull: true };
}

// ---------- Gemini ----------

export interface GeminiFacts {
  known: boolean;
  version: number;
  thinkingLevels: string[] | null;
  multiCandidates: boolean;
  prefillAllowed: boolean;
  hiddenPrefix: number;
  cacheMin: number;
}

export function geminiFacts(model: string): GeminiFacts {
  const id = normalizeModelId(model).replace(/^models\//, "");
  const argon = /gemini-4/.test(id);
  const m = id.match(/gemini-(\d+(?:\.\d+)?)/);
  const v = m ? Number(m[1]) : 0;
  return {
    known: v > 0,
    version: v,
    thinkingLevels: v >= 3 ? (argon || v >= 3.8 || /3\.1-pro/.test(id) ? ["low", "medium", "high"] : ["minimal", "low", "medium", "high"]) : null,
    multiCandidates: v > 0 && v < 3,
    prefillAllowed: v > 0 && v < 3.6,
    hiddenPrefix: argon ? 34 : 4,
    cacheMin: v >= 3 ? 4096 : 2048,
  };
}

// ---------- GLM / Kimi / DeepSeek ----------

export interface CompatFacts {
  known: boolean;
  window: number;
  maxOutput: number;
  thinking: "forced" | "optional" | "none";
  efforts: string[];
  vision: boolean;
  /** K3-style series uses reasoning_effort, K2.x uses thinking.type. */
  series: string;
  fixedSampling: boolean;
  officialSpeed: number;
}

export function compatFacts(vendor: Vendor, model: string): CompatFacts {
  const id = normalizeModelId(model);
  if (vendor === "glm") {
    const v = Number(id.match(/glm-(\d+(?:\.\d+)?)/)?.[1] ?? 0);
    const flash = /flash/.test(id);
    return {
      known: v > 0,
      window: v >= 5.2 ? 1_048_576 : v >= 4.5 ? 202_752 : 131_072,
      maxOutput: 131072,
      thinking: v >= 5.3 || v === 4.7 ? "forced" : v > 0 ? "optional" : "none",
      efforts: v >= 5.1 ? ["low", "high", "max"] : [],
      vision: flash || /v$|vision/.test(id),
      series: v >= 5 ? "glm5" : "glm4",
      fixedSampling: false,
      officialSpeed: /flashx/.test(id) ? 200 : 60,
    };
  }
  if (vendor === "kimi") {
    const k3 = /k3/.test(id);
    const k27 = /k2\.7/.test(id);
    return {
      known: /k3|k2\.[67]/.test(id),
      window: k3 ? 1_048_576 : 262_144,
      maxOutput: k3 ? 1_048_576 : 262_144,
      thinking: k3 || k27 ? "forced" : "optional",
      efforts: k3 ? ["low", "high", "max"] : [],
      vision: true,
      series: k3 ? "k3" : k27 ? "k2.7" : "k2.6",
      fixedSampling: true,
      officialSpeed: /highspeed/.test(id) ? 100 : k3 ? 40 : 50,
    };
  }
  return {
    known: /deepseek-(flash|v4)/.test(id),
    window: 1_048_576,
    maxOutput: 393_216,
    thinking: "optional",
    efforts: ["none", "low", "high", "max"],
    vision: /flash/.test(id) && !/pro/.test(id),
    series: /pro/.test(id) ? "pro" : "flash",
    fixedSampling: false,
    officialSpeed: 60,
  };
}

/** Low-cost body fragment for each vendor/model: think as little as the model allows. */
export function cheapThinking(vendor: Vendor, model: string): Record<string, unknown> {
  const f = compatFacts(vendor, model);
  if (vendor === "deepseek") return { thinking: { type: "disabled" } };
  if (vendor === "kimi") return f.series === "k3" ? { reasoning_effort: "low" } : f.series === "k2.6" ? { thinking: { type: "disabled" } } : {};
  if (vendor === "glm") return f.thinking === "forced" ? (f.efforts.includes("low") ? { reasoning_effort: "low" } : {}) : { thinking: { type: "disabled" } };
  return {};
}

export function thinkingOn(vendor: Vendor, model: string): Record<string, unknown> {
  const f = compatFacts(vendor, model);
  if (vendor === "kimi") return f.series === "k3" ? {} : { thinking: { type: "enabled", keep: "all" } };
  if (vendor === "deepseek") return { thinking: { type: "enabled" } };
  return f.thinking === "optional" ? { thinking: { type: "enabled" } } : {};
}
