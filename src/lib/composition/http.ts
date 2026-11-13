import { redact } from "../checker/url";
import type { Protocol } from "../checker/types";
import type { Mode, RefEndpoint, Vendor } from "./types";

export type WireProtocol = Protocol | "gemini" | "completions";

export const WIRE_LABEL: Record<WireProtocol, string> = {
  chat: "Chat Completions（/v1/chat/completions）",
  responses: "Responses（/v1/responses）",
  messages: "Anthropic Messages（/v1/messages）",
  gemini: "Gemini generateContent",
  completions: "FIM（/beta/completions）",
};

/** Generation protocol a request path belongs to; auxiliary endpoints (/models, balance, tokenizer…) return null. */
export function wireOf(path: string): WireProtocol | null {
  const p = path.replace(/[?#].*$/, "");
  if (/:(generateContent|streamGenerateContent|countTokens)$/.test(p)) return "gemini";
  if (/\/chat\/completions$/.test(p)) return "chat";
  if (/\/responses$/.test(p)) return "responses";
  if (/\/messages(\/count_tokens)?$/.test(p)) return "messages";
  if (/\/completions$/.test(p)) return "completions";
  return null;
}

export class ProtocolLockError extends Error {}

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface SseEvent {
  t: number;
  event?: string;
  data: string;
  json?: Json;
  comment?: boolean;
}

export interface Resp {
  status: number | null;
  ok: boolean;
  json: Json;
  text: string;
  /** Raw response body; survives parsers that reuse `text` for the model's answer. */
  body: string;
  headers: Record<string, string>;
  durationMs: number;
  ttftMs: number | null;
  events: SseEvent[];
  contentType: string;
  error: string | null;
}

export interface SendOpts {
  path: string;
  method?: "GET" | "POST";
  body?: unknown;
  rawBody?: string;
  headers?: Record<string, string>;
  stream?: boolean;
  timeoutMs?: number;
  /** Replaces the default credentials, e.g. to test an invalid key. */
  bearer?: string;
  noAuth?: boolean;
  ref?: boolean;
  /** Absolute base URL override (e.g. the DeepSeek /beta base). */
  base?: string;
}

export interface UsageAudit {
  caseId: string;
  stream: boolean;
  usage: Json | null;
  visibleChars: number;
  reasoningChars: number;
  maxTokens?: number;
  includeUsage?: boolean;
}

export class Ctx {
  readonly nonce = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  readonly state = new Map<string, unknown>();
  readonly audits: UsageAudit[] = [];
  readonly precision: { caseId: string; evidence: "strong" | "weak" | "none" }[] = [];
  requests = 0;
  currentCase = "";

  constructor(
    readonly vendor: Vendor,
    readonly model: string,
    readonly mode: Mode,
    readonly baseUrl: string,
    readonly fetchBase: string,
    readonly apiKey: string,
    readonly limiter: <T>(task: () => Promise<T>) => Promise<T>,
    readonly signal: AbortSignal | undefined,
    readonly ref?: RefEndpoint,
    readonly secondModel?: string,
    /** Explicitly selected protocol that every generation request must use; null when not enforced. */
    readonly lock: Protocol | null = null,
    /** Protocol generic checks should speak (the explicit selection, even when native requests are opted in). */
    readonly preferred: Protocol | null = null,
  ) {}

  get official() {
    return this.mode === "official";
  }

  salt(label = "") {
    return `${this.nonce}${label}`;
  }

  authHeaders(opts: SendOpts): Record<string, string> {
    if (opts.noAuth) return {};
    const key = opts.bearer ?? (opts.ref ? this.ref!.apiKey : this.apiKey);
    if (this.vendor === "claude") return { "x-api-key": key, Authorization: `Bearer ${key}`, "anthropic-version": "2023-06-01" };
    if (this.vendor === "gemini") return { "x-goog-api-key": key, Authorization: `Bearer ${key}` };
    return { Authorization: `Bearer ${key}` };
  }

  url(opts: SendOpts): string {
    const base = opts.base ?? (opts.ref ? this.ref!.fetchBase : this.fetchBase);
    if (/^https?:\/\//.test(opts.path)) return opts.path;
    return base.replace(/\/+$/, "") + opts.path;
  }

  async send(opts: SendOpts): Promise<Resp> {
    const wire = wireOf(opts.path);
    if (this.lock && wire && wire !== this.lock) {
      throw new ProtocolLockError(`协议已锁定为 ${WIRE_LABEL[this.lock]}，拒绝发送 ${WIRE_LABEL[wire]} 请求`);
    }
    return this.limiter(() => this.rawSend(opts));
  }

  private async rawSend(opts: SendOpts): Promise<Resp> {
    this.requests++;
    const started = performance.now();
    const timeoutMs = opts.timeoutMs ?? 150_000;
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = this.signal ? AbortSignal.any([this.signal, timeout]) : timeout;
    const out: Resp = { status: null, ok: false, json: null, text: "", body: "", headers: {}, durationMs: 0, ttftMs: null, events: [], contentType: "", error: null };
    const key = opts.ref ? this.ref?.apiKey ?? "" : this.apiKey;
    try {
      const method = opts.method ?? (opts.body !== undefined || opts.rawBody !== undefined ? "POST" : "GET");
      const response = await fetch(this.url(opts), {
        method,
        headers: {
          ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
          ...this.authHeaders(opts),
          ...opts.headers,
        },
        body: method === "POST" ? opts.rawBody ?? JSON.stringify(opts.body ?? {}) : undefined,
        signal,
        redirect: "manual",
      });
      out.status = response.status;
      out.ok = response.ok;
      response.headers.forEach((value, name) => {
        out.headers[name.toLowerCase()] = value.slice(0, 300);
      });
      out.contentType = response.headers.get("content-type") ?? "";
      if (out.contentType.includes("text/event-stream") && response.body) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        const frame = (raw: string, t: number) => {
          const lines = raw.split(/\r?\n/);
          let event: string | undefined;
          const data: string[] = [];
          let comment = false;
          for (const line of lines) {
            if (line.startsWith(":")) comment = true;
            else if (line.startsWith("event:")) event = line.slice(6).trim();
            else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
          }
          if (!data.length && !comment && !event) return;
          const payload = data.join("\n");
          let json: Json;
          try {
            json = payload && payload !== "[DONE]" ? JSON.parse(payload) : undefined;
          } catch {}
          if (out.ttftMs === null && !comment) out.ttftMs = Math.round(t);
          out.events.push({ t: Math.round(t), event, data: payload, json, comment: comment && !data.length });
        };
        for (;;) {
          const chunk = await reader.read();
          const t = performance.now() - started;
          buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
          let m: RegExpExecArray | null;
          while ((m = /\r?\n\r?\n/.exec(buffer))) {
            frame(buffer.slice(0, m.index), t);
            buffer = buffer.slice(m.index + m[0].length);
          }
          if (chunk.done) {
            if (buffer.trim()) frame(buffer, t);
            break;
          }
          if (out.text.length + buffer.length > 8_000_000) break;
        }
        out.text = out.events.map((e) => e.data).join("\n").slice(0, 2_000_000);
      } else {
        out.text = (await response.text()).slice(0, 4_000_000);
        out.ttftMs = Math.round(performance.now() - started);
        try {
          out.json = JSON.parse(out.text);
        } catch {}
      }
    } catch (error) {
      if (this.signal?.aborted) out.error = "检测已取消";
      else if (timeout.aborted) out.error = `超过 ${Math.round(timeoutMs / 1000)} 秒未完成`;
      else out.error = `网络错误${(error as { cause?: { code?: string } }).cause?.code ? `（${(error as { cause: { code: string } }).cause.code}）` : ""}`;
    }
    out.durationMs = Math.round(performance.now() - started);
    if (out.error) out.error = redact(out.error, key);
    out.text = redact(out.text, key);
    out.body = out.text;
    return out;
  }
}

/** Short description of a non-2xx response, used in case details. */
export function errText(r: Resp): string {
  if (r.error) return r.error;
  const e = r.json?.error;
  const msg = typeof e === "string" ? e : e?.message ?? r.json?.message ?? r.text.slice(0, 160);
  const code = e?.code ?? e?.type ?? r.json?.type ?? "";
  return `HTTP ${r.status}${code ? ` ${code}` : ""}${msg ? `：${String(msg).slice(0, 200)}` : ""}`;
}

export const is400 = (r: Resp) => r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 404 && r.status !== 429;
export const isReject = (r: Resp) => r.status !== null && r.status >= 400 && r.status < 500 && r.status !== 429;
