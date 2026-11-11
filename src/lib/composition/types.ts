export type Vendor = "claude" | "openai" | "gemini" | "glm" | "kimi" | "deepseek";
export type Mode = "equivalent" | "official";

/** pre: runs first; unscored: never scored; ref: reference-only in 官方等价 mode; critical: a fail caps the verdict; final: runs last; optional: off by default. */
export type Tag = "pre" | "unscored" | "ref" | "critical" | "final" | "optional";

export type CaseStatus = "pass" | "warn" | "fail" | "skip" | "info";

export type Flag =
  | "model_swapped"
  | "usage_fake"
  | "context_truncated"
  | "injected_prompt"
  | "protocol_shim"
  | "relay_trace"
  | "non_official_backend"
  | "low_precision"
  | "slow"
  | "cc_reverse";

export type PrecisionEvidence = "strong" | "weak" | "none";

export interface Outcome {
  status: CaseStatus;
  summary: string;
  details?: string[];
  flags?: Flag[];
  precision?: PrecisionEvidence;
}

export interface CaseResult extends Outcome {
  id: string;
  title: string;
  section: string;
  weight: number;
  tags: Tag[];
  durationMs: number;
  requests: number;
}

export interface RefEndpoint {
  baseUrl: string;
  fetchBase: string;
  apiKey: string;
  model: string;
}

export interface CompositionOptions {
  vendor: Vendor;
  mode: Mode;
  selected: string[];
  ref?: RefEndpoint;
  secondModel?: string;
}

export interface CompositionReport {
  vendor: Vendor;
  mode: Mode;
  score: number | null;
  verdict: "official" | "suspect" | "fake" | "unknown";
  verdictText: string;
  flags: Flag[];
  platform: string | null;
  backend: string | null;
  precisionPoints: number;
  passed: number;
  warned: number;
  failed: number;
  skipped: number;
  cases: CaseResult[];
}

export interface CaseInfo {
  id: string;
  vendor: Vendor;
  section: string;
  title: string;
  weight: number;
  officialWeight?: number;
  tags: Tag[];
  desc: string;
  needsRef?: boolean;
  needsSecond?: boolean;
}
