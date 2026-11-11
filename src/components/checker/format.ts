import type { ClaimStatus, DegradationVerdict, Protocol, TestStatus } from "@/lib/checker/types";

export const PROTOCOL_LABEL: Record<Protocol, string> = {
  chat: "OpenAI Chat Completions",
  responses: "OpenAI Responses",
  messages: "Anthropic Messages",
};

export const CLAIM_LABEL: Record<ClaimStatus, { text: string; tone: Tone }> = {
  match: { text: "一致", tone: "good" },
  family: { text: "同家族不同型号", tone: "warn" },
  mismatch: { text: "不一致", tone: "bad" },
  unlisted: { text: "参考库未收录", tone: "muted" },
  unknown: { text: "无法判断", tone: "muted" },
};

export const VERDICT_LABEL: Record<DegradationVerdict, { text: string; tone: Tone }> = {
  normal: { text: "正常", tone: "good" },
  suspect: { text: "疑似降智", tone: "warn" },
  degraded: { text: "明显降智", tone: "bad" },
  inconclusive: { text: "无法判断", tone: "muted" },
};

export const TEST_LABEL: Record<TestStatus, { text: string; tone: Tone }> = {
  normal: { text: "通过", tone: "good" },
  degraded: { text: "未通过", tone: "bad" },
  error: { text: "请求失败", tone: "muted" },
};

export type Tone = "good" | "warn" | "bad" | "muted";

export const TONE_CLASS: Record<Tone, string> = {
  good: "bg-success-soft text-success border-transparent",
  warn: "bg-warning-soft text-warning border-transparent",
  bad: "bg-danger-soft text-danger border-transparent",
  muted: "bg-fill-3 text-fg-2 border-transparent",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-success",
  warn: "text-warning",
  bad: "text-danger",
  muted: "text-muted-foreground",
};

export const TONE_STROKE: Record<Tone, string> = {
  good: "stroke-success",
  warn: "stroke-warning",
  bad: "stroke-danger",
  muted: "stroke-fg-4",
};

export const TONE_DOT: Record<Tone, string> = {
  good: "bg-success",
  warn: "bg-warning",
  bad: "bg-danger",
  muted: "bg-fg-4",
};

export const ms = (value: number | null | undefined) => {
  if (value === null || value === undefined) return "—";
  return value >= 10_000 ? `${(value / 1000).toFixed(1)} s` : `${Math.round(value)} ms`;
};

export const pct = (p: number | null | undefined, digits = 1) => {
  if (p === null || p === undefined) return "—";
  const v = p * 100;
  if (v > 99.9 && v < 100) return ">99.9%";
  if (v > 0 && v < 0.1) return "<0.1%";
  return `${v.toFixed(digits)}%`;
};

export const tokens = (value: number | null | undefined) => (value === null || value === undefined ? "—" : value.toLocaleString("zh-CN"));
