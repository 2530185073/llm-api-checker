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
  good: "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400",
  warn: "bg-amber-500/10 text-amber-700 border-amber-500/25 dark:text-amber-400",
  bad: "bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400",
  muted: "bg-muted text-muted-foreground border-border",
};

export const TONE_TEXT: Record<Tone, string> = {
  good: "text-emerald-600 dark:text-emerald-400",
  warn: "text-amber-600 dark:text-amber-400",
  bad: "text-red-600 dark:text-red-400",
  muted: "text-muted-foreground",
};

export const TONE_STROKE: Record<Tone, string> = {
  good: "stroke-emerald-500",
  warn: "stroke-amber-500",
  bad: "stroke-red-500",
  muted: "stroke-muted-foreground/40",
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
