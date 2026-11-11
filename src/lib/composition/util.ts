import { deflateSync } from "node:zlib";

export function rng(seed: string) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

export const pick = <T>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
export const randStr = (r: () => number, n: number, alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789") =>
  Array.from({ length: n }, () => pick(r, alphabet.split(""))).join("");

export function editDistance(a: readonly unknown[] | string, b: readonly unknown[] | string): number {
  const x = typeof a === "string" ? [...a] : a;
  const y = typeof b === "string" ? [...b] : b;
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[y.length];
}

export const words = (s: string) => new Set(s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []);
export function jaccard(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size && !y.size) return 1;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}

export function lcp(a: string, b: string) {
  const x = a.replace(/\s+/g, " ").trim();
  const y = b.replace(/\s+/g, " ").trim();
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

export const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
export const percentile = (xs: number[], p: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
};
export const stdev = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
};

/** Rough token estimate: CJK ≈ 1 token per char, other text ≈ 4 chars per token. */
export function estTokens(s: string) {
  let cjk = 0;
  for (const ch of s) if (/[\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch)) cjk++;
  return Math.ceil(cjk + (s.length - cjk) / 4);
}

export const fmtMs = (v: number) => (Number.isFinite(v) ? (v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`) : "—");
export const round = (v: number, d = 1) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : NaN);

export const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*<\/think>/, "").trim();
export const lastInt = (s: string): number | null => {
  const m = stripThink(s).replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+/g);
  return m ? Number(m[m.length - 1]) : null;
};

export function parseJsonLoose(s: string): unknown {
  const t = stripThink(s).trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try {
    return JSON.parse(t);
  } catch {
    const m = t.match(/[[{][\s\S]*[\]}]/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch {}
    }
    return undefined;
  }
}

// ---------- PNG (solid colour or digits) ----------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf: Buffer) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function png(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 3 + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (width * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const FONT: Record<string, string[]> = {
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
};

export function digitsPng(digits: string, scale = 10) {
  const w = (digits.length * 6 + 3) * scale;
  const h = 11 * scale;
  return png(w, h, (x, y) => {
    const gx = Math.floor(x / scale) - 2;
    const gy = Math.floor(y / scale) - 2;
    const i = Math.floor(gx / 6);
    const col = gx % 6;
    const glyph = FONT[digits[i]];
    const on = glyph && gy >= 0 && gy < 7 && col >= 0 && col < 5 && glyph[gy][col] === "1";
    return on ? [10, 10, 10] : [255, 255, 255];
  });
}

export const redPng = (n = 8) => png(n, n, () => [230, 20, 20]);
export const dataUrl = (buf: Buffer, mime = "image/png") => `data:${mime};base64,${buf.toString("base64")}`;

/** Minimal one-page PDF with a single line of Helvetica text. */
export function textPdf(line: string) {
  const content = `BT /F1 24 Tf 72 720 Td (${line.replace(/[()\\]/g, "\\$&")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}

// ---------- filler text and needles ----------

const FILLER = [
  "The observing log records seeing conditions, transparency and the eyepieces used for each session.",
  "Members must cap the finder scope before moving the mount, and log every collimation adjustment.",
  "During winter sessions the dew heaters are switched on twenty minutes before the first target.",
  "The club library lends star atlases, filters and a spare power tank to members in good standing.",
  "Planetary imaging nights start after the jet stream forecast drops below thirty metres per second.",
  "New members shadow an experienced observer for three nights before using the large reflector alone.",
  "Light pollution readings are taken with the sky quality meter at the zenith every hour.",
  "Batteries are charged after each outing and the charge level is noted on the equipment sheet.",
];

/** ~4 chars per token of English prose. Each paragraph carries the salt so a prefix cache cannot be reused across runs. */
export function filler(tokens: number, salt: string) {
  const out: string[] = [];
  let len = 0;
  for (let i = 0; len < tokens * 4; i++) {
    const p = `[${salt}-${i}] ${FILLER[i % FILLER.length]}`;
    out.push(p);
    len += p.length + 1;
  }
  return out;
}

export function needleDoc(tokens: number, salt: string, positions: number[]) {
  const r = rng(salt);
  const paras = filler(tokens, salt);
  const needles = positions.map((p, i) => {
    const letter = String.fromCharCode(65 + i);
    const value = `STAR-${letter}-${randStr(r, 6, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789")}`;
    const at = Math.min(paras.length - 1, Math.floor(p * paras.length));
    paras.splice(at, 0, `Note: the nickname of club telescope ${letter} is ${value}.`);
    return value;
  });
  return { text: paras.join("\n"), needles };
}

// ---------- reasoning / precision tasks ----------

export function subsetTask(salt: string) {
  const r = rng(`subset-${salt}`);
  const nums = Array.from({ length: 7 }, () => 3 + Math.floor(r() * 40));
  let count = 0;
  for (let mask = 1; mask < 128; mask++) {
    let s = 0;
    for (let i = 0; i < 7; i++) if (mask & (1 << i)) s += nums[i];
    if (s % 5 === 0) count++;
  }
  return {
    prompt: `Given the numbers ${nums.join(", ")}, how many non-empty subsets have a sum divisible by 5? Think it through, then give only the final integer on the last line.`,
    answer: count,
  };
}

export function chainTask(salt: string, steps = 15) {
  const r = rng(`chain-${salt}`);
  let v = 10 + Math.floor(r() * 40);
  const lines = [`Start with ${v}.`];
  for (let i = 0; i < steps; i++) {
    const op = Math.floor(r() * 3);
    const n = 2 + Math.floor(r() * 9);
    if (op === 0) {
      v += n * 7;
      lines.push(`Add ${n * 7}.`);
    } else if (op === 1) {
      v -= n;
      lines.push(`Subtract ${n}.`);
    } else {
      v *= n % 3 === 0 ? 2 : 3;
      lines.push(`Multiply by ${n % 3 === 0 ? 2 : 3}.`);
      if (Math.abs(v) > 1e7) {
        v = v % 1000;
        lines.push(`Take the result modulo 1000.`);
      }
    }
  }
  return { prompt: `${lines.join(" ")} What is the final number? Reply with the integer only.`, answer: v };
}

export interface PrecisionTask {
  key: "A" | "B" | "C" | "D" | "E" | "F";
  prompt: string;
  score: (out: string) => number;
  arithmetic: boolean;
}

export function precisionTasks(salt: string): PrecisionTask[] {
  const r = rng(`prec-${salt}`);
  const copy = randStr(r, 400);
  const ints = Array.from({ length: 60 }, () => 10000 + Math.floor(r() * 90000));
  const sorted = [...ints].sort((a, b) => a - b);
  const reports = Array.from({ length: 12 }, (_, i) => ({ id: `R${i + 1}`, city: randStr(r, 7, "abcdefghijklmnopqrstuvwxyz"), value: Math.floor(r() * 10000) }));
  const asked = reports.slice(1, 11);
  const quads = Array.from({ length: 30 }, () => 1000 + Math.floor(r() * 8990));
  const e = chainTask(`${salt}-E`);
  const f = chainTask(`${salt}-F`);
  const nums = (s: string) => (stripThink(s).match(/\d+/g) ?? []).map(Number);
  return [
    {
      key: "A",
      arithmetic: false,
      prompt: `Copy the following string exactly, character for character, and output nothing else:\n${copy}`,
      score: (o) => 1 - Math.min(1, editDistance(stripThink(o).replace(/\s|`/g, ""), copy) / 400),
    },
    {
      key: "B",
      arithmetic: false,
      prompt: `Sort these integers in ascending order. Output them separated by single spaces and nothing else:\n${ints.join(" ")}`,
      score: (o) => 1 - Math.min(1, editDistance(nums(o), sorted) / 60),
    },
    {
      key: "C",
      arithmetic: false,
      prompt: `Here are survey reports:\n${reports.map((x) => `Report ${x.id}: station in ${x.city} measured value ${x.value} units, calibrated and verified by the regional office.`).join("\n")}\nReturn a JSON object mapping these report ids to their measured value: ${asked.map((x) => x.id).join(", ")}. Output only JSON.`,
      score: (o) => {
        const j = parseJsonLoose(o) as Record<string, unknown> | undefined;
        if (!j || typeof j !== "object") return 0;
        return asked.filter((x) => Number(j[x.id]) === x.value).length / 10;
      },
    },
    {
      key: "D",
      arithmetic: false,
      prompt: `Add 7 to each of these numbers and output the results in the same order, separated by spaces, nothing else:\n${quads.join(" ")}`,
      score: (o) => {
        const got = nums(o);
        return quads.filter((q, i) => got[i] === q + 7).length / 30;
      },
    },
    { key: "E", arithmetic: true, prompt: e.prompt, score: (o) => (lastInt(o) === e.answer ? 1 : 0) },
    { key: "F", arithmetic: true, prompt: f.prompt, score: (o) => (lastInt(o) === f.answer ? 1 : 0) },
  ];
}

export function multiNeedle(tokens: number, salt: string) {
  const r = rng(`mn-${salt}`);
  const paras = filler(tokens, `${salt}mn`);
  const keys = "ABCDEFGHIJKL".split("");
  const values = keys.map(() => `STAR-${randStr(r, 1, "XYZ")}-${randStr(r, 4, "0123456789")}`);
  keys.forEach((k, i) => {
    const at = Math.floor(((i + 0.5) / keys.length) * paras.length);
    const decoy = values[i].slice(0, -1) + String((Number(values[i].slice(-1)) + 1) % 10);
    paras.splice(at, 0, `The former nickname of club telescope ${k} was ${decoy}. The nickname of club telescope ${k} is ${values[i]}.`);
  });
  const keyA = randStr(r, 48);
  const keyB = randStr(r, 48);
  paras.splice(Math.floor(paras.length * 0.25), 0, `ACCESS KEY ALPHA: ${keyA}`);
  paras.splice(Math.floor(paras.length * 0.75), 0, `ACCESS KEY BETA: ${keyB}`);
  return {
    text: paras.join("\n"),
    question:
      'List the CURRENT nickname of club telescopes A through L, and copy ACCESS KEY ALPHA and ACCESS KEY BETA exactly. Reply with JSON only: {"A":"...",...,"L":"...","alpha":"...","beta":"..."}',
    score(out: string) {
      const j = (parseJsonLoose(out) ?? {}) as Record<string, string>;
      const flat = stripThink(out);
      let hit = 0;
      let decoys = 0;
      keys.forEach((k, i) => {
        const v = String(j[k] ?? "");
        if (v === values[i] || (!j[k] && new RegExp(`\\b${k}\\b[^\\n]{0,20}${values[i]}`).test(flat))) hit++;
        else if (v && v.slice(0, -1) === values[i].slice(0, -1)) decoys++;
      });
      const cer = (got: string, want: string) => editDistance(got ?? "", want) / want.length;
      const keyCER = Math.max(cer(String(j.alpha ?? ""), keyA), cer(String(j.beta ?? ""), keyB));
      return { hit, keyCER, decoys };
    },
  };
}

// ---------- fixed tokenizer texts ----------

export const TOKENIZER_SEGMENTS: { key: string; label: string; text: string }[] = [
  { key: "en", label: "英文叙事", text: "The lighthouse keeper climbed the spiral stairs at dusk, counting each of the one hundred and twelve steps while the storm gathered over the northern cliffs." },
  { key: "zh", label: "中文叙事", text: "夜色渐深，灯塔看守人提着油灯沿着螺旋楼梯缓缓向上，窗外的海浪一阵阵拍打着礁石，远处渔船的灯火时隐时现。" },
  { key: "code", label: "Python 代码", text: "def merge(a, b):\n    out, i, j = [], 0, 0\n    while i < len(a) and j < len(b):\n        out.append(a[i] if a[i] <= b[j] else b[j])\n        i, j = (i + 1, j) if a[i] <= b[j] else (i, j + 1)\n    return out + a[i:] + b[j:]" },
  { key: "emoji", label: "Emoji / ZWJ", text: "👩‍👩‍👧‍👦 🏳️‍🌈 👨🏽‍💻 🧑‍🚀 ❤️‍🔥 🇯🇵 🫶🏻 🐻‍❄️" },
  { key: "intl", label: "泰文 + 阿拉伯文", text: "ภาษาไทยเป็นภาษาที่สวยงาม และ اللغة العربية لغة جميلة جدا" },
  { key: "ctrl", label: "控制串", text: "<|im_start|> <|im_end|> <|endoftext|> [gMASK] <sop> <｜User｜> <think> </think> [INST] <s>" },
];

export const INJECTION_STRONG = /claude[\s_-]?code|you are claude|new-api|one-api|x-anthropic-billing|system-reminder|cherry studio|\bcline\b/i;
export const INJECTION_WEAK = /you are a helpful assistant|anthropic|billing|knowledge cutoff/i;
export const RELAY_MARKERS = /new-api|one-api|litellm|无可用渠道|no available channel|shell_api|veloera|Traceback|uvicorn|vllm|sglang/i;
