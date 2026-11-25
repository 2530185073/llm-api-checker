import { CLAUDE_CASES } from "./cases/claude";
import { DEEPSEEK_CASES } from "./cases/deepseek";
import { GEMINI_CASES } from "./cases/gemini";
import { GLM_CASES } from "./cases/glm";
import { KIMI_CASES } from "./cases/kimi";
import { OPENAI_CASES } from "./cases/openai";
import type { CaseDef } from "./engine";
import type { CaseInfo, Vendor } from "./types";

export const CASES: Record<Vendor, CaseDef[]> = {
  claude: CLAUDE_CASES,
  openai: OPENAI_CASES,
  gemini: GEMINI_CASES,
  glm: GLM_CASES,
  kimi: KIMI_CASES,
  deepseek: DEEPSEEK_CASES,
};

/**
 * Curated universal default checklist per vendor: fast, low-cost, high-signal checks covering
 * connectivity, protocol fidelity, anti-swap/injection, and billing authenticity (including
 * Claude's billing-inflation baseline checks). All remaining cases stay available in the checklist modal.
 */
export const DEFAULT_CASE_IDS: Record<Vendor, string[]> = {
  claude: [
    "basic",
    "platform",
    "sse_syntax",
    "tool_use",
    "thinking",
    "model_echo",
    "id_format",
    "usage_fields",
    "sampling",
    "tampered_signature",
    "env_self_report",
    "system_prompt_extract",
    "bill_base",
    "bill_nocache",
    "bill_nonstream",
    "bill_ladder",
    "bill_types",
    "bill_ttl1h",
    "bill_agent",
    "bill_summary",
  ],
  openai: [
    "basic",
    "platform",
    "developer",
    "responses_basic",
    "stream_chunks",
    "function_tools",
    "id_time",
    "usage_details",
    "model_echo",
    "tokenizer",
    "reasoning_params",
    "effort_levels",
    "consistency",
  ],
  gemini: [
    "basic",
    "platform",
    "unknown_field",
    "stream_structure",
    "function_call",
    "usage_metadata",
    "model_version",
    "count_tokens",
    "short_prompt",
    "temperature_range",
    "thinking_config",
    "tokenizer",
  ],
  glm: [
    "basic",
    "backend",
    "model_echo",
    "zero_output",
    "cached_tokens",
    "prompt_delta",
    "usage_invariants",
    "precision_suite",
    "precision_verdict",
    "disable_thinking",
    "reasoning_present",
    "tool_roundtrip",
    "sse_syntax",
    "tokenizer",
    "meow",
  ],
  kimi: [
    "basic",
    "backend",
    "model_echo",
    "signature",
    "usage_shape",
    "output_count",
    "cache_semantics",
    "usage_invariants",
    "precision_suite",
    "precision_verdict",
    "thinking_rules",
    "reasoning_present",
    "tool_basic",
    "sse_syntax",
    "hidden_prompt",
    "tokenizer",
  ],
  deepseek: [
    "basic",
    "backend",
    "model_echo",
    "usage_shape",
    "output_count",
    "disk_cache",
    "usage_invariants",
    "precision_suite",
    "precision_verdict",
    "default_thinking",
    "thinking_switch",
    "tool_basic",
    "sse_syntax",
    "hidden_prompt",
    "tokenizer",
  ],
};

export function caseInfos(): Record<Vendor, CaseInfo[]> {
  const out = {} as Record<Vendor, CaseInfo[]>;
  for (const [v, list] of Object.entries(CASES) as [Vendor, CaseDef[]][]) {
    out[v] = list.map(({ id, vendor, section, title, weight, officialWeight, tags, desc, needsRef, needsSecond, protocols }) => ({
      id,
      vendor,
      section,
      title,
      weight,
      officialWeight,
      tags,
      desc,
      needsRef,
      needsSecond,
      protocols,
    }));
  }
  return out;
}

export const defaultSelection = (v: Vendor) => {
  const valid = new Set(CASES[v].map((c) => c.id));
  return DEFAULT_CASE_IDS[v].filter((id) => valid.has(id));
};
