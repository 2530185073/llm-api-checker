import fixtures from "../../../mock/fingerprint-fixtures.json";
import { parseNumbers } from "lmfpd-sdk";
import { tokenizerBank } from "../checker/tokenizer";
import { visualAnswer } from "./visual-answers";

/**
 * A demo upstream for trying the checker without a real key. Fingerprint replies replay real samples from
 * the fingerprint reference bank, so the numeric fingerprint behaves like it would against the real model.
 */
interface Persona {
  id: string;
  ownedBy: string;
  fingerprintSource: keyof typeof fixtures;
  tokenizerClass: string | null;
  smart: boolean;
  selfReport: string;
  reasoning: boolean;
  delayMs: number;
}

export const PERSONAS: Persona[] = [
  {
    id: "gpt-5.4",
    ownedBy: "openai",
    fingerprintSource: "gpt-5.4",
    tokenizerClass: "o200k",
    smart: true,
    selfReport: "我是 GPT-5.4，由 OpenAI 开发。",
    reasoning: true,
    delayMs: 6,
  },
  {
    id: "claude-sonnet-4.6",
    ownedBy: "anthropic",
    fingerprintSource: "claude-sonnet-4.6",
    tokenizerClass: null,
    smart: true,
    selfReport: "我是 Claude Sonnet 4.6，由 Anthropic 开发。",
    reasoning: true,
    delayMs: 6,
  },
  {
    id: "claude-opus-4.8",
    ownedBy: "anthropic",
    fingerprintSource: "deepseek-v4-flash",
    tokenizerClass: "deepseek-v3",
    smart: false,
    selfReport: "我是 Claude Opus 4.8，由 Anthropic 开发。",
    reasoning: false,
    delayMs: 10,
  },
];

const OVERHEAD_TOKENS = 9;

export function personaFor(model: string): Persona {
  const id = model.toLowerCase().replace(/^.*\//, "");
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[0];
}

export function inputTokens(persona: Persona, prompt: string): number {
  const { prefix, suffix } = tokenizerBank.wrapper;
  if (prompt.startsWith(prefix) && prompt.endsWith(suffix)) {
    const text = prompt.slice(prefix.length, prompt.length - suffix.length);
    if (!text) return OVERHEAD_TOKENS + 7;
    const j = tokenizerBank.probes.findIndex((p) => p.text === text);
    const cls = persona.tokenizerClass ? tokenizerBank.classes.find((c) => c.id === persona.tokenizerClass) : null;
    if (j >= 0 && cls) return OVERHEAD_TOKENS + 7 + cls.counts[j];
    if (j >= 0) return OVERHEAD_TOKENS + 7 + Math.max(1, Math.round(approxTokens(text) * 1.37));
  }
  return OVERHEAD_TOKENS + approxTokens(prompt);
}

function approxTokens(text: string): number {
  let cjk = 0;
  for (const ch of text) if (/[\u3000-\u9fff\uac00-\ud7af]/.test(ch)) cjk++;
  return Math.max(1, Math.ceil(cjk * 0.8 + (text.length - cjk) / 3.6));
}

function fingerprintReply(persona: Persona, prompt: string): string {
  const count = (prompt.match(/\d+/g) ?? []).map(Number).find((n) => n >= 200 && n <= 340) ?? 300;
  const pool = fixtures[persona.fingerprintSource].map((text) => parseNumbers(text));
  const start = Math.floor(Math.random() * pool.length);
  const numbers: number[] = [];
  for (let i = 0; numbers.length < count && i < pool.length; i++) numbers.push(...pool[(start + i) % pool.length]);
  return `[${numbers.slice(0, count).join(", ")}]`;
}

export function answer(persona: Persona, prompt: string): string {
  if (prompt.includes("<<<")) return "OK";
  const visual = visualAnswer(persona.smart, prompt);
  if (visual) return visual;
  if (prompt === "Reply with OK.") return "OK";
  if (prompt.includes("355")) return fingerprintReply(persona, prompt);
  if (prompt.includes("哪个模型")) return persona.selfReport;
  const smart = persona.smart;
  if (prompt.includes("糖果")) return smart ? "21" : "15";
  if (prompt.includes("既不能被 2 整除")) return smart ? "266" : "267";
  if (prompt.includes("2026 次方")) return smart ? "49" : "43";
  if (prompt.includes("除以 3 余 2")) return "23";
  if (prompt.includes("sorted(set(x))")) return "1";
  if (prompt.includes("banana")) return "9";
  if (prompt.includes('"a"')) return '{"a": 49, "b": 27}';
  if (prompt.includes("仓库口令")) {
    const code = prompt.match(/仓库口令是 (\S+)，/)?.[1];
    return smart && code ? code : "记录中没有提到仓库口令。";
  }
  return smart ? "好的。" : "嗯。";
}

export const outputTokens = (text: string) => Math.max(1, Math.ceil(text.length / 2.6));
