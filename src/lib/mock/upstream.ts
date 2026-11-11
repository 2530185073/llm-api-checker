import fixtures from "../../../mock/fingerprint-fixtures.json";
import { inflateSync } from "node:zlib";
import { parseNumbers } from "lmfpd-sdk";
import { tokenizerBank } from "../checker/tokenizer";
import type { Vendor } from "../composition/types";
import { estTokens } from "../composition/util";
import { visualAnswer } from "./visual-answers";

/**
 * Demo upstream personas. Honest personas follow each vendor's documented API behaviour; impostors behave like
 * the relays and self-hosted backends the checks are meant to catch. Fingerprint replies replay real samples.
 */
export interface Persona {
  id: string;
  vendor: Vendor;
  ownedBy: string;
  honest: boolean;
  fingerprintSource: keyof typeof fixtures;
  tokenizerClass: string | null;
  smart: boolean;
  selfReport: string;
  thinking: "forced" | "optional" | "none";
  window: number;
  vision: boolean;
  /** Character error rate applied to copy-style answers (quantized impostor). */
  noise: number;
  delayMs: number;
}

export const PERSONAS: Persona[] = [
  { id: "gpt-5.4", vendor: "openai", ownedBy: "openai", honest: true, fingerprintSource: "gpt-5.4", tokenizerClass: "o200k", smart: true, selfReport: "I am GPT-5.4, a model trained by OpenAI.", thinking: "optional", window: 400_000, vision: true, noise: 0, delayMs: 4 },
  { id: "claude-sonnet-4.6", vendor: "claude", ownedBy: "anthropic", honest: true, fingerprintSource: "claude-sonnet-4.6", tokenizerClass: null, smart: true, selfReport: "I'm Claude, an AI assistant made by Anthropic.", thinking: "optional", window: 1_000_000, vision: true, noise: 0, delayMs: 4 },
  { id: "claude-opus-4.8", vendor: "claude", ownedBy: "anthropic", honest: false, fingerprintSource: "deepseek-v4-flash", tokenizerClass: "deepseek-v3", smart: false, selfReport: "I am Claude Code, Anthropic's official CLI for Claude.", thinking: "none", window: 131_072, vision: false, noise: 0.04, delayMs: 8 },
  { id: "gemini-3.6-flash", vendor: "gemini", ownedBy: "google", honest: true, fingerprintSource: "gemini-3.6-flash", tokenizerClass: "gemma3", smart: true, selfReport: "I am Gemini, a large language model trained by Google.", thinking: "forced", window: 1_048_576, vision: true, noise: 0, delayMs: 4 },
  { id: "glm-5.3", vendor: "glm", ownedBy: "z-ai", honest: true, fingerprintSource: "glm-5.3", tokenizerClass: "glm-5", smart: true, selfReport: "我是 GLM-5.3，由智谱 AI（Z.ai）训练的大语言模型。", thinking: "forced", window: 1_048_576, vision: false, noise: 0, delayMs: 4 },
  { id: "kimi-k3", vendor: "kimi", ownedBy: "moonshot", honest: true, fingerprintSource: "kimi-k3", tokenizerClass: "kimi", smart: true, selfReport: "我是 Kimi，由月之暗面（Moonshot AI）开发的 AI 助手。", thinking: "forced", window: 1_048_576, vision: true, noise: 0, delayMs: 4 },
  { id: "deepseek-flash", vendor: "deepseek", ownedBy: "deepseek", honest: true, fingerprintSource: "deepseek-v4-flash", tokenizerClass: "deepseek-v3", smart: true, selfReport: "我是 DeepSeek，由深度求索公司开发的 AI 助手。", thinking: "optional", window: 1_048_576, vision: true, noise: 0, delayMs: 4 },
  { id: "deepseek-v4-pro", vendor: "deepseek", ownedBy: "vllm", honest: false, fingerprintSource: "qwen3.8-27b", tokenizerClass: "qwen2", smart: true, selfReport: "我是 DeepSeek，由深度求索公司开发的 AI 助手。", thinking: "optional", window: 131_072, vision: false, noise: 0.05, delayMs: 6 },
];

export function personaFor(model: string): Persona {
  const id = model.toLowerCase().replace(/^.*\//, "").replace(/^models\//, "");
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS.find((p) => id.startsWith(p.id)) ?? PERSONAS[0];
}

const OVERHEAD = 9;

/** Input token count: tokenizer-bank counts for probe prompts, a rough estimate otherwise. */
export function inputTokens(persona: Persona, prompt: string): number {
  const { prefix, suffix } = tokenizerBank.wrapper;
  const idx = prompt.indexOf(prefix);
  if (idx >= 0 && prompt.endsWith(suffix)) {
    const text = prompt.slice(idx + prefix.length, prompt.length - suffix.length);
    const base = OVERHEAD + 7 + estTokens(prompt.slice(0, idx));
    if (!text) return base;
    const j = tokenizerBank.probes.findIndex((p) => p.text === text);
    const cls = persona.tokenizerClass ? tokenizerBank.classes.find((c) => c.id === persona.tokenizerClass) : null;
    if (j >= 0 && cls) return base + cls.counts[j];
    if (j >= 0) return base + Math.max(1, Math.round(estTokens(text) * 1.37));
  }
  return OVERHEAD + estTokens(prompt);
}

export const outputTokens = (text: string) => (text ? Math.max(1, estTokens(text)) : 0);

function fingerprintReply(persona: Persona, prompt: string): string {
  const count = (prompt.match(/\d+/g) ?? []).map(Number).find((n) => n >= 200 && n <= 340) ?? 300;
  const pool = fixtures[persona.fingerprintSource].map((text) => parseNumbers(text));
  const start = Math.floor(Math.random() * pool.length);
  const numbers: number[] = [];
  for (let i = 0; numbers.length < count && i < pool.length; i++) numbers.push(...pool[(start + i) % pool.length]);
  return `[${numbers.slice(0, count).join(", ")}]`;
}

// ---------- reading our own generated PNG / PDF ----------

const GLYPHS: Record<string, string> = {
  "01110100011001110101110011000101110": "0",
  "00100011000010000100001000010001110": "1",
  "01110100010000100010001000100011111": "2",
  "11110000010000101110000010000111110": "3",
  "00010001100101010010111110001000010": "4",
  "11111100001111000001000011000101110": "5",
  "00110010001000011110100011000101110": "6",
  "11111000010001000100010000100001000": "7",
  "01110100011000101110100011000101110": "8",
  "01110100011000101111000010001001100": "9",
};

export function readPng(b64: string): { kind: "red" | "digits" | "other"; digits?: string } {
  try {
    const buf = Buffer.from(b64, "base64");
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    let idat = Buffer.alloc(0);
    for (let o = 8; o < buf.length; ) {
      const len = buf.readUInt32BE(o);
      const type = buf.toString("ascii", o + 4, o + 8);
      if (type === "IDAT") idat = Buffer.concat([idat, buf.subarray(o + 8, o + 8 + len)]);
      o += 12 + len;
    }
    const raw = inflateSync(idat);
    const px = (x: number, y: number) => raw.subarray(y * (w * 3 + 1) + 1 + x * 3, y * (w * 3 + 1) + 4 + x * 3);
    const [r, g, b] = px(0, 0);
    if (r > 200 && g < 60 && b < 60) return { kind: "red" };
    const scale = h / 11;
    const n = Math.round((w / scale - 3) / 6);
    let digits = "";
    for (let i = 0; i < n; i++) {
      let bits = "";
      for (let gy = 0; gy < 7; gy++)
        for (let gx = 0; gx < 5; gx++) {
          const p = px(Math.floor((2 + i * 6 + gx + 0.5) * scale), Math.floor((2 + gy + 0.5) * scale));
          bits += p[0] < 100 ? "1" : "0";
        }
      digits += GLYPHS[bits] ?? "?";
    }
    return digits && !digits.includes("?") ? { kind: "digits", digits } : { kind: "other" };
  } catch {
    return { kind: "other" };
  }
}

export const readPdf = (b64: string) => Buffer.from(b64, "base64").toString("latin1").match(/\(([^)]*)\) Tj/)?.[1] ?? "";

// ---------- answers ----------

export interface Media {
  images: string[];
  pdfs: string[];
  urlImages: string[];
}

export interface Turn {
  role: string;
  text: string;
}

const words = (n: number, seed = "") => {
  const base = "the lighthouse keeper watched the waves roll across the harbour while gulls circled above the old stone pier and the evening light faded slowly".split(" ");
  return Array.from({ length: n }, (_, i) => base[(i + seed.length) % base.length]).join(" ");
};

function evalChain(prompt: string): number | null {
  const m = prompt.match(/Start with (-?\d+)\.([\s\S]*?)What is the final number/);
  if (!m) return null;
  let v = Number(m[1]);
  for (const step of m[2].split(".").map((s) => s.trim()).filter(Boolean)) {
    const n = Number(step.match(/-?\d+/)?.[0] ?? 0);
    if (step.startsWith("Add")) v += n;
    else if (step.startsWith("Subtract")) v -= n;
    else if (step.startsWith("Multiply")) v *= n;
    else if (step.startsWith("Take")) v = v % 1000;
  }
  return v;
}

function subsetAnswer(prompt: string): number | null {
  const m = prompt.match(/Given the numbers ([\d, ]+), how many non-empty subsets/);
  if (!m) return null;
  const nums = m[1].split(",").map((s) => Number(s.trim()));
  let count = 0;
  for (let mask = 1; mask < 1 << nums.length; mask++) {
    let s = 0;
    nums.forEach((x, i) => {
      if (mask & (1 << i)) s += x;
    });
    if (s % 5 === 0) count++;
  }
  return count;
}

const corrupt = (s: string, rate: number, seed: number) => {
  if (!rate) return s;
  return [...s].map((ch, i) => ((i * 7919 + seed) % Math.round(1 / rate) === 0 ? (ch === "A" ? "B" : "A") : ch)).join("");
};

export interface AnswerOut {
  text: string;
  reasoning?: string;
}

/** Deterministic answer for every prompt the checker sends. `visibleWindow` truncates what an impostor "sees". */
export function answer(persona: Persona, turns: Turn[], system: string, media: Media): AnswerOut {
  const last = turns[turns.length - 1]?.text ?? "";
  let all = `${system}\n${turns.map((t) => t.text).join("\n")}`;
  const allTokens = estTokens(all);
  if (!persona.honest && allTokens > persona.window * 0.95) all = all.slice(-persona.window * 3);
  const smart = persona.smart;
  const p = last;

  if (media.images.length) {
    if (!persona.vision) return { text: "I can't see any image here." };
    const img = readPng(media.images[media.images.length - 1]);
    if (img.kind === "red") return { text: /颜色|colour|color/i.test(p) ? "Red." : "A red square." };
    if (img.kind === "digits") return { text: img.digits! };
    return { text: "An image." };
  }
  if (media.urlImages.length) return { text: media.urlImages.some((u) => /google/.test(u)) ? "Google" : "I could not load the image." };
  if (media.pdfs.length) return { text: readPdf(media.pdfs[0]).replace(/^Invoice number:\s*/, "") };

  if (p.includes("<<<")) return { text: "OK" };
  const visual = visualAnswer(smart, p);
  if (visual) return { text: visual };
  if (/\b1\s*(?:to|到|부터|et|から|and|-|–|~|～)\s*355\b/i.test(p)) return { text: fingerprintReply(persona, p) };

  if (p.includes("糖果")) return { text: smart ? "21" : "15", reasoning: "Worst case: draw every candy that does not complete a matching pair first." };
  if (p.includes("既不能被 2 整除")) return { text: smart ? "266" : "267" };
  if (p.includes("2026 次方")) return { text: smart ? "49" : "43" };
  if (p.includes("除以 3 余 2")) return { text: "23" };
  if (p.includes("sorted(set(x))")) return { text: "1" };
  if (p.includes("banana bandana")) return { text: "9" };
  if (p.includes('"a"') && p.includes('"b"')) return { text: '{"a": 49, "b": 27}' };
  if (p.includes("仓库口令")) {
    const code = all.match(/仓库口令是 (\S+)，/)?.[1];
    return { text: smart && code ? code : "记录中没有提到仓库口令。" };
  }
  if (/PINEAPPLE/.test(system)) return { text: "PINEAPPLE" };
  if (/只回复一个字：喵/.test(system)) return { text: "喵" };
  if (/End this reply with the word PINEAPPLE/.test(all)) return { text: "Your name is Zephyr. PINEAPPLE" };
  const exact = p.match(/Reply with exactly(?: the marker)?:?\s*(\S+)/i);
  if (exact) return { text: exact[1].replace(/[.。]$/, "") };
  if (/^Reply (with )?OK|reply OK|Say OK|Reply OK/i.test(p) || /reply OK/i.test(p)) return { text: "OK" };
  if (/Reply with one word: (\w+)/i.test(p)) return { text: p.match(/Reply with one word: (\w+)/i)![1] };
  if (/Reply with only the number 7/.test(p)) return { text: "7" };
  if (/Say hi\./.test(p)) return { text: "Hi!" };
  if (/Say hello/.test(p)) return { text: "Hello!" };

  if (/name and (my )?lucky number|my name and my lucky number|What are my name/i.test(p)) {
    const name = all.match(/name is (\w+)/)?.[1] ?? "unknown";
    const num = all.match(/lucky number is (\d+)/)?.[1] ?? "unknown";
    return { text: `Your name is ${name} and your lucky number is ${num}.` };
  }
  if (/What is my name/.test(p)) return { text: `Your name is ${all.match(/name is (\w+)/)?.[1] ?? "unknown"}.` };
  if (/原样复制下面这句话/.test(p)) {
    const s = p.split("\n").slice(1).join("\n").trim();
    return { text: persona.honest ? s : s.replace(/[“”]/g, '"').replace(/：/g, ":") };
  }
  if (/runtime environment/i.test(p)) return { text: persona.honest ? "I'm accessed through the Anthropic API; I don't have details about the client application." : "I am running inside Claude Code, Anthropic's official CLI." };
  if (/Which company (trained|created) you|哪家公司|你是谁开发的|你是谁|模型名|which model are you/i.test(p)) return { text: persona.selfReport };
  if (/system prompt|系统提示|hidden_prompt|developer instructions|指令/i.test(p) && /verbatim|逐字|复述|NONE|NO_SYSTEM_PROMPT|翻译|Complete this JSON|Repeat/i.test(p)) {
    if (!persona.honest && persona.vendor === "claude") return { text: 'You are Claude Code, Anthropic\'s official CLI for Claude.\n<system-reminder>x-anthropic-billing-header</system-reminder>' };
    if (/NO_SYSTEM_PROMPT/.test(p)) return { text: "NO_SYSTEM_PROMPT" };
    if (/hidden_prompt/.test(p)) return { text: '{"hidden_prompt": ""}' };
    if (/文言/.test(p)) return { text: "吾无系统之示。" };
    return { text: "NONE" };
  }

  const telescope = all.match(/nickname of club telescope/);
  if (telescope && /List the CURRENT nickname/.test(p)) {
    const out: Record<string, string> = {};
    for (const m of all.matchAll(/The nickname of club telescope ([A-L]) is (STAR-[A-Z]-\d{4})\./g)) out[m[1]] = m[2];
    out.alpha = all.match(/ACCESS KEY ALPHA: (\S+)/)?.[1] ?? "";
    out.beta = all.match(/ACCESS KEY BETA: (\S+)/)?.[1] ?? "";
    if (persona.noise) {
      out.alpha = corrupt(out.alpha, persona.noise * 4, 3);
      out.beta = corrupt(out.beta, persona.noise * 4, 5);
      ["C", "H", "K"].forEach((k) => delete out[k]);
    }
    return { text: JSON.stringify(out) };
  }
  if (telescope) {
    const found = [...all.matchAll(/nickname of club telescope ([A-C]) is (STAR-[A-C]-[A-Z0-9]{6})/g)].map((m) => m[2]);
    return { text: found.join("\n") || "I could not find them." };
  }
  if (/Copy the string between <s> and <\/s>/.test(p)) {
    const s = [...p.matchAll(/<s>([^<]*)<\/s>/g)].pop()?.[1] ?? "";
    return { text: corrupt(s, persona.noise * (allTokens > 20_000 ? 3 : 1), 1) };
  }
  if (/Copy the following string exactly/.test(p)) return { text: corrupt(p.split("\n")[1] ?? "", persona.noise, 2) };
  if (/Sort these integers/.test(p)) {
    const ns = (p.split("\n")[1] ?? "").split(/\s+/).map(Number).sort((a, b) => a - b);
    return { text: ns.join(" ") };
  }
  if (/Add 7 to each/.test(p)) return { text: (p.split("\n")[1] ?? "").split(/\s+/).map((n, i) => Number(n) + (persona.noise && i % 9 === 4 ? 6 : 7)).join(" ") };
  if (/survey reports/.test(p)) {
    const ids = p.match(/measured value: (.*)\. Output only JSON/)?.[1].split(",").map((s) => s.trim()) ?? [];
    const out: Record<string, number> = {};
    for (const id of ids) out[id] = Number(p.match(new RegExp(`Report ${id}: station in \\w+ measured value (\\d+)`))?.[1] ?? 0);
    return { text: JSON.stringify(out) };
  }
  const chain = evalChain(p);
  if (chain !== null) return { text: String(smart ? chain : chain + 1), reasoning: "Let me apply each step in order." };
  const subset = subsetAnswer(p);
  if (subset !== null) return { text: `Counting subsets by residue mod 5.\n${smart ? subset : subset + 2}`, reasoning: "Enumerate the residues of each number modulo 5 and count subsets whose residues sum to 0 mod 5. ".repeat(12) };
  const mul = p.match(/What is (\d+) \* (\d+)/) ?? p.match(/(\d+) \* (\d+)/);
  if (mul) return { text: String(Number(mul[1]) * Number(mul[2])), reasoning: `Multiply ${mul[1]} by ${mul[2]} step by step.` };
  const add = p.match(/What is (\d+) \+ (\d+)/);
  if (add) return { text: String(Number(add[1]) + Number(add[2])) };
  if (/3 for 4 dollars/.test(p)) return { text: "27 pens is 9 groups of 3.\n36", reasoning: "9 groups times 4 dollars." };
  if (/180 km in 2.5 hours/.test(p)) return { text: "72", reasoning: "180 / 2.5 = 72." };
  if (/A box holds 12 apples/.test(p)) {
    const boxes = Number(p.match(/(\d+) boxes/)?.[1] ?? 0);
    return { text: String(boxes * 12 - 5), reasoning: "Multiply boxes by 12 and subtract 5." };
  }
  if (/Count from 1 to (\d+)/.test(p)) {
    const n = Number(p.match(/Count from 1 to (\d+)/)![1]);
    const sep = /comma/.test(p) ? ", " : " ";
    return { text: Array.from({ length: n }, (_, i) => i + 1).join(sep) };
  }
  if (/Count from 1 upward/.test(p)) return { text: Array.from({ length: 400 }, (_, i) => i + 1).join(", ") };
  if (/from one to seven/i.test(p)) return { text: "one two three four five six seven" };
  if (/integers from 1 to 6000/.test(p)) return { text: Array.from({ length: 6000 }, (_, i) => i + 1).join("\n") };
  if (/weekday names/.test(p)) return { text: "Monday blue Tuesday blue Wednesday blue Thursday blue Friday blue Saturday blue Sunday blue January green February green March green April green May green June green July green August green September green October green November green December green" };
  if (/Alice/.test(p) && /JSON|json/.test(p)) return { text: /city/.test(all) ? '{"name":"Alice","age":30,"city":"Paris"}' : '{"name":"Alice","age":30}' };
  if (/Tokyo and its (approximate )?population/i.test(p)) return { text: '{"city":"Tokyo","population":14000000}' };
  if (/capital of Australia/.test(p)) return { text: "Canberra" };
  if (/sum of the first 50 prime/.test(p)) return { text: "The sum is 5117." };
  if (/FIFA World Cup/.test(p)) return { text: "Argentina won the most recent FIFA World Cup." };
  if (/Nobel Prize in Physics/.test(p)) return { text: "The most recent Nobel Prize in Physics was awarded for work on quantum circuits." };
  if (/BBC/.test(p)) return { text: "Today's BBC headline is about the economy." };
  if (/Name a (primary )?colou?r/.test(p)) return { text: "blue" };
  if (/random fruit|Name a fruit/.test(p)) return { text: "Mango" };
  if (/animal/.test(p)) return { text: /fact/.test(p) ? "Otters hold hands while sleeping." : "Otter" };
  if (/Translate into English/.test(p)) return { text: "Before the storm arrived, the lighthouse keeper checked every lamp and then wrote the day's duty log." };
  if (/parse_duration/.test(p)) return { text: 'def parse_duration(s):\n    """\n    >>> parse_duration("1h30m")\n    5400\n    """\n    total, num = 0, ""\n    for ch in s:\n        if ch.isdigit():\n            num += ch\n        else:\n            total += int(num) * {"h": 3600, "m": 60, "s": 1}[ch]\n            num = ""\n    return total' };
  if (/five bullet points/.test(p)) return { text: "- Stronger heart\n- Better mood\n- Healthier weight\n- Deeper sleep\n- More energy" };
  if (/binary search/.test(p)) return { text: "Binary search halves the sorted range each step by comparing the middle element with the target. For 1000 items the worst case needs 10 comparisons." };
  if (/Why is the sky blue|ocean tides|vaccines|leaves change|black hole/.test(p)) return { text: `${words(24, p)}.` };
  if (/Complete the sentence/.test(p) || /capital of France is/.test(all)) return { text: " Paris." };
  if (/squares a number/.test(p)) return { text: "def square(x):\n    return x * x\n" };
  if (/Summarize the handbook/.test(p)) return { text: "The handbook describes how the astronomy club runs its observing sessions." };
  if (/name one item/i.test(p)) return { text: "The dew heaters." };
  if (/answer in French|How are you/.test(p)) return { text: /French/.test(all) ? "Je vais bien, merci." : "I'm fine, thanks." };
  const wc = p.match(/about (\d+) words|(\d+)-word|(\d+) words/);
  if (wc) return { text: words(Number(wc[1] ?? wc[2] ?? wc[3]), p) + "." };
  if (/long essay|long article|写长文/i.test(p)) return { text: words(600, p) + "." };
  if (/one word/i.test(p)) return { text: "Blue." };
  if (/poem/.test(p)) return { text: "The lamp turns slow above the sea,\nIts beam a path for boats like me,\nThe keeper climbs the winding stair,\nAnd lights the dark with patient care." };
  if (/story|paragraph|prose|Describe/i.test(p)) return { text: words(160, p) + "." };
  if (/Hello\.|^hi$|^Hi$/i.test(p)) return { text: "Hello! How can I help?" };
  return { text: smart ? "OK." : "嗯。" };
}

export function weatherReply(toolResult: string) {
  return `According to the tool, the weather is ${toolResult}.`;
}
