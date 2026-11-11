import type { Ctx, Resp, SendOpts } from "./http";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface ChatOut extends Resp {
  content: string;
  reasoning: string;
  reasoningField: "reasoning_content" | "reasoning" | null;
  toolCalls: { id?: string; type?: string; name: string; arguments: string; index?: number }[];
  finish: string | null;
  usage: Json | null;
  id: string | null;
  model: string | null;
  created: number | null;
  choices: Json[];
  fingerprint: string | null | undefined;
  /** Arrival time (ms) of the first non-empty content / reasoning delta, and of the last one. */
  firstDeltaMs: number | null;
  lastDeltaMs: number | null;
  firstContentMs: number | null;
  firstReasoningMs: number | null;
  deltaCount: number;
  usageChunks: { index: number; inChoice: boolean; emptyChoices: boolean; finish: boolean; usage: Json }[];
  doneSeen: boolean;
  afterDone: boolean;
}

/** OpenAI-compatible /chat/completions, streaming or not, with the stream aggregated into one result. */
export async function chat(c: Ctx, body: Json, opts: Partial<SendOpts> & { audit?: boolean } = {}): Promise<ChatOut> {
  const stream = body.stream === true;
  const r = await c.send({ path: "/chat/completions", body, stream, ...opts });
  const out: ChatOut = {
    ...r,
    content: "",
    reasoning: "",
    reasoningField: null,
    toolCalls: [],
    finish: null,
    usage: null,
    id: null,
    model: null,
    created: null,
    choices: [],
    fingerprint: undefined,
    firstDeltaMs: null,
    lastDeltaMs: null,
    firstContentMs: null,
    firstReasoningMs: null,
    deltaCount: 0,
    usageChunks: [],
    doneSeen: false,
    afterDone: false,
  };
  if (!r.ok) return out;
  if (!stream || !r.events.length) {
    const j = r.json ?? {};
    const msg = j.choices?.[0]?.message ?? {};
    out.choices = j.choices ?? [];
    out.content = typeof msg.content === "string" ? msg.content : "";
    out.reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
    out.reasoningField = msg.reasoning_content != null ? "reasoning_content" : msg.reasoning != null ? "reasoning" : null;
    out.toolCalls = (msg.tool_calls ?? []).map((t: Json) => ({ id: t.id, type: t.type, name: t.function?.name ?? "", arguments: t.function?.arguments ?? "" }));
    out.finish = j.choices?.[0]?.finish_reason ?? null;
    out.usage = j.usage ?? null;
    out.id = j.id ?? null;
    out.model = j.model ?? null;
    out.created = j.created ?? null;
    out.fingerprint = "system_fingerprint" in j ? j.system_fingerprint : undefined;
  } else {
    const calls = new Map<number, { id?: string; type?: string; name: string; arguments: string; index: number }>();
    r.events.forEach((e, i) => {
      if (e.data === "[DONE]") {
        out.doneSeen = true;
        return;
      }
      if (out.doneSeen && e.data) out.afterDone = true;
      const j = e.json;
      if (!j) return;
      out.id ??= j.id ?? null;
      out.model ??= j.model ?? null;
      out.created ??= j.created ?? null;
      if ("system_fingerprint" in j && out.fingerprint === undefined) out.fingerprint = j.system_fingerprint;
      const ch = j.choices?.[0];
      if (ch) {
        const d = ch.delta ?? {};
        const rc = d.reasoning_content ?? d.reasoning;
        if (d.reasoning_content != null) out.reasoningField = "reasoning_content";
        else if (d.reasoning != null && !out.reasoningField) out.reasoningField = "reasoning";
        if (rc) {
          out.reasoning += rc;
          out.firstReasoningMs ??= e.t;
        }
        if (d.content) {
          out.content += d.content;
          out.firstContentMs ??= e.t;
        }
        if (rc || d.content || d.tool_calls) {
          out.firstDeltaMs ??= e.t;
          out.lastDeltaMs = e.t;
          out.deltaCount++;
        }
        for (const t of d.tool_calls ?? []) {
          const idx = t.index ?? 0;
          const cur: { id?: string; type?: string; name: string; arguments: string; index: number } = calls.get(idx) ?? { index: idx, name: "", arguments: "" };
          if (t.id) cur.id = t.id;
          if (t.type) cur.type = t.type;
          if (t.function?.name) cur.name += t.function.name;
          if (t.function?.arguments) cur.arguments += t.function.arguments;
          calls.set(idx, cur);
        }
        if (ch.finish_reason) out.finish = ch.finish_reason;
        if (ch.usage) out.usageChunks.push({ index: i, inChoice: true, emptyChoices: false, finish: !!ch.finish_reason, usage: ch.usage });
      }
      if (j.usage) out.usageChunks.push({ index: i, inChoice: false, emptyChoices: Array.isArray(j.choices) && j.choices.length === 0, finish: !!ch?.finish_reason, usage: j.usage });
    });
    out.toolCalls = [...calls.values()];
    out.usage = out.usageChunks.length ? out.usageChunks[out.usageChunks.length - 1].usage : null;
  }
  if (opts.audit !== false && !opts.ref) {
    c.audits.push({
      caseId: c.currentCase,
      stream,
      usage: out.usage,
      visibleChars: out.content.length,
      reasoningChars: out.reasoning.length,
      maxTokens: body.max_tokens ?? body.max_completion_tokens,
      includeUsage: !!body.stream_options?.include_usage,
    });
  }
  return out;
}

export interface MsgOut extends Resp {
  content: Json[];
  text: string;
  thinking: { thinking: string; signature?: string }[];
  toolUses: { id: string; name: string; input: Json }[];
  stop: string | null;
  stopSequence: string | null;
  usage: Json | null;
  id: string | null;
  model: string | null;
  type: string | null;
  role: string | null;
  sseNames: string[];
  sseTypeMismatch: boolean;
  ping: boolean;
  firstDeltaMs: number | null;
  lastDeltaMs: number | null;
  inputJsonDeltas: number;
  thinkingDeltas: number;
}

/** Anthropic /messages, aggregating the SSE stream into the same shape as a JSON reply. */
export async function messages(c: Ctx, body: Json, opts: Partial<SendOpts> = {}): Promise<MsgOut> {
  const stream = body.stream === true;
  const r = await c.send({ path: "/messages", body, stream, ...opts });
  const out: MsgOut = {
    ...r,
    content: [],
    text: "",
    thinking: [],
    toolUses: [],
    stop: null,
    stopSequence: null,
    usage: null,
    id: null,
    model: null,
    type: null,
    role: null,
    sseNames: [],
    sseTypeMismatch: false,
    ping: false,
    firstDeltaMs: null,
    lastDeltaMs: null,
    inputJsonDeltas: 0,
    thinkingDeltas: 0,
  };
  if (!r.ok) return out;
  if (!stream || !r.events.length) {
    const j = r.json ?? {};
    out.content = Array.isArray(j.content) ? j.content : [];
    out.stop = j.stop_reason ?? null;
    out.stopSequence = j.stop_sequence ?? null;
    out.usage = j.usage ?? null;
    out.id = j.id ?? null;
    out.model = j.model ?? null;
    out.type = j.type ?? null;
    out.role = j.role ?? null;
  } else {
    const blocks: Json[] = [];
    let usage: Json = {};
    for (const e of r.events) {
      const j = e.json;
      if (!j) continue;
      const name = e.event ?? j.type;
      out.sseNames.push(name);
      if (e.event && j.type && e.event !== j.type) out.sseTypeMismatch = true;
      if (j.type === "ping") out.ping = true;
      if (j.type === "message_start") {
        out.id = j.message?.id ?? null;
        out.model = j.message?.model ?? null;
        out.type = j.message?.type ?? null;
        out.role = j.message?.role ?? null;
        usage = { ...(j.message?.usage ?? {}) };
      } else if (j.type === "content_block_start") {
        blocks[j.index] = { ...j.content_block };
        if (blocks[j.index].type === "tool_use") blocks[j.index]._json = "";
      } else if (j.type === "content_block_delta") {
        const b = (blocks[j.index] ??= { type: "text", text: "" });
        const d = j.delta ?? {};
        out.firstDeltaMs ??= e.t;
        out.lastDeltaMs = e.t;
        if (d.type === "text_delta") b.text = (b.text ?? "") + d.text;
        else if (d.type === "thinking_delta") {
          b.thinking = (b.thinking ?? "") + d.thinking;
          out.thinkingDeltas++;
        } else if (d.type === "signature_delta") {
          b.signature = (b.signature ?? "") + d.signature;
          out.thinkingDeltas++;
        } else if (d.type === "input_json_delta") {
          b._json = (b._json ?? "") + d.partial_json;
          out.inputJsonDeltas++;
        }
      } else if (j.type === "message_delta") {
        out.stop = j.delta?.stop_reason ?? out.stop;
        out.stopSequence = j.delta?.stop_sequence ?? out.stopSequence;
        usage = { ...usage, ...Object.fromEntries(Object.entries(j.usage ?? {}).filter(([, v]) => v !== null)) };
      }
    }
    for (const b of blocks) {
      if (b?.type === "tool_use" && typeof b._json === "string") {
        try {
          b.input = b._json ? JSON.parse(b._json) : b.input;
        } catch {
          b.input = { _unparsed: b._json };
        }
        delete b._json;
      }
    }
    out.content = blocks.filter(Boolean);
    out.usage = usage;
  }
  out.text = out.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("");
  out.thinking = out.content.filter((b) => b.type === "thinking" || b.type === "redacted_thinking").map((b) => ({ thinking: b.thinking ?? "", signature: b.signature }));
  out.toolUses = out.content.filter((b) => b.type === "tool_use").map((b) => ({ id: b.id, name: b.name, input: b.input }));
  return out;
}

export interface GemOut extends Resp {
  text: string;
  thoughts: string;
  parts: Json[];
  finish: string | null;
  usage: Json | null;
  responseId: string | null;
  modelVersion: string | null;
  candidates: Json[];
  chunks: Json[];
}

/** Gemini native generateContent / streamGenerateContent. */
export async function gemini(c: Ctx, body: Json, opts: Partial<SendOpts> & { stream?: boolean; model?: string; method?: "POST" } = {}): Promise<GemOut> {
  const model = opts.model ?? c.model;
  const path = opts.stream ? `/models/${model}:streamGenerateContent?alt=sse` : `/models/${model}:generateContent`;
  const r = await c.send({ path, body, stream: opts.stream, ...opts });
  const out: GemOut = { ...r, text: "", thoughts: "", parts: [], finish: null, usage: null, responseId: null, modelVersion: null, candidates: [], chunks: [] };
  if (!r.ok) return out;
  const docs: Json[] = opts.stream ? r.events.map((e) => e.json).filter(Boolean) : [r.json ?? {}];
  out.chunks = docs;
  for (const d of docs) {
    out.responseId ??= d.responseId ?? null;
    out.modelVersion ??= d.modelVersion ?? null;
    if (d.usageMetadata) out.usage = d.usageMetadata;
    const cand = d.candidates?.[0];
    if (!opts.stream) out.candidates = d.candidates ?? [];
    for (const p of cand?.content?.parts ?? []) {
      out.parts.push(p);
      if (p.thought && typeof p.text === "string") out.thoughts += p.text;
      else if (typeof p.text === "string") out.text += p.text;
    }
    if (cand?.finishReason) out.finish = cand.finishReason;
  }
  return out;
}

export const userMsg = (text: string) => [{ role: "user", content: text }];
