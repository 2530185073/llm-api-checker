import { cheapThinking, geminiFacts } from "./facts";
import type { Ctx, Resp } from "./http";
import { chat, gemini, messages } from "./protocols";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

export interface AskOpts {
  system?: string;
  turns?: { role: "user" | "assistant"; content: string }[];
  prompt?: string;
  maxTokens?: number;
  /** Keep thinking as low as the model allows (default true). */
  cheap?: boolean;
  extra?: Record<string, unknown>;
  stream?: boolean;
  ref?: boolean;
  model?: string;
  timeoutMs?: number;
}

export interface Answer {
  ok: boolean;
  status: number | null;
  text: string;
  reasoning: string;
  finish: string | null;
  usage: { input: number | null; output: number | null; cached: number | null; reasoning: number | null };
  id: string | null;
  model: string | null;
  resp: Resp;
  ttftMs: number | null;
  firstDeltaMs: number | null;
  lastDeltaMs: number | null;
  durationMs: number;
  error: string | null;
}

const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

export async function ask(c: Ctx, o: AskOpts): Promise<Answer> {
  const turns = o.turns ?? [{ role: "user" as const, content: o.prompt ?? "" }];
  const model = o.model ?? (o.ref ? c.ref?.model ?? c.model : c.model);
  if (c.vendor === "claude") {
    const body: Json = { model, max_tokens: o.maxTokens ?? 1024, messages: turns, ...(o.system ? { system: o.system } : {}), ...(o.stream ? { stream: true } : {}), ...o.extra };
    const r = await messages(c, body, { ref: o.ref, timeoutMs: o.timeoutMs });
    const u = r.usage ?? {};
    return {
      ok: r.ok,
      status: r.status,
      text: r.text,
      reasoning: r.thinking.map((t) => t.thinking).join(""),
      finish: r.stop,
      usage: { input: n(u.input_tokens) === null ? null : (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), output: n(u.output_tokens), cached: n(u.cache_read_input_tokens), reasoning: null },
      id: r.id,
      model: r.model,
      resp: r,
      ttftMs: r.ttftMs,
      firstDeltaMs: r.firstDeltaMs,
      lastDeltaMs: r.lastDeltaMs,
      durationMs: r.durationMs,
      error: r.ok ? null : r.error ?? `HTTP ${r.status}`,
    };
  }
  if (c.vendor === "gemini") {
    const body: Json = {
      contents: turns.map((t) => ({ role: t.role === "assistant" ? "model" : "user", parts: [{ text: t.content }] })),
      generationConfig: {
        maxOutputTokens: o.maxTokens ?? 1024,
        ...(o.cheap !== false ? { thinkingConfig: geminiFacts(model).thinkingLevels ? { thinkingLevel: geminiFacts(model).thinkingLevels![0] } : { thinkingBudget: 0 } } : {}),
      },
      ...(o.system ? { systemInstruction: { parts: [{ text: o.system }] } } : {}),
      ...o.extra,
    };
    const r = await gemini(c, body, { stream: o.stream, ref: o.ref, model, timeoutMs: o.timeoutMs });
    const u = r.usage ?? {};
    return {
      ok: r.ok,
      status: r.status,
      text: r.text,
      reasoning: r.thoughts,
      finish: r.finish,
      usage: { input: n(u.promptTokenCount), output: n(u.candidatesTokenCount), cached: n(u.cachedContentTokenCount), reasoning: n(u.thoughtsTokenCount) },
      id: r.responseId,
      model: r.modelVersion,
      resp: r,
      ttftMs: r.ttftMs,
      firstDeltaMs: r.events[0]?.t ?? null,
      lastDeltaMs: r.events[r.events.length - 1]?.t ?? null,
      durationMs: r.durationMs,
      error: r.ok ? null : r.error ?? `HTTP ${r.status}`,
    };
  }
  if (c.vendor === "openai" && c.preferred === "responses") {
    const body: Json = {
      model,
      input: turns.map((t) => ({ role: t.role, content: t.content })),
      ...(o.system ? { instructions: o.system } : {}),
      ...(o.maxTokens ? { max_output_tokens: Math.max(16, o.maxTokens) } : {}),
      ...(o.stream ? { stream: true } : {}),
      store: false,
      ...o.extra,
    };
    const r = await c.send({ path: "/responses", body, stream: o.stream, ref: o.ref, timeoutMs: o.timeoutMs });
    let doc: Json = r.json ?? {};
    let text = "";
    let first: number | null = null;
    let last: number | null = null;
    if (o.stream && r.events.length) {
      for (const e of r.events) {
        const j = e.json;
        if (!j) continue;
        if (j.type === "response.output_text.delta" && typeof j.delta === "string") {
          text += j.delta;
          first ??= e.t;
          last = e.t;
        }
        if (j.type === "response.completed" || j.type === "response.incomplete") doc = j.response ?? {};
      }
    } else {
      for (const item of doc.output ?? []) for (const part of item.content ?? []) if (part.type === "output_text") text += part.text ?? "";
    }
    const u = doc.usage ?? {};
    return {
      ok: r.ok,
      status: r.status,
      text,
      reasoning: "",
      finish: doc.status === "completed" ? "stop" : doc.status === "incomplete" ? "length" : doc.status ?? null,
      usage: { input: n(u.input_tokens), output: n(u.output_tokens), cached: n(u.input_tokens_details?.cached_tokens), reasoning: n(u.output_tokens_details?.reasoning_tokens) },
      id: doc.id ?? null,
      model: doc.model ?? null,
      resp: r,
      ttftMs: r.ttftMs,
      firstDeltaMs: first,
      lastDeltaMs: last,
      durationMs: r.durationMs,
      error: r.ok ? null : r.error ?? `HTTP ${r.status}`,
    };
  }
  const msgs = [...(o.system ? [{ role: "system", content: o.system }] : []), ...turns];
  const body: Json = {
    model,
    messages: msgs,
    ...(o.maxTokens ? { max_tokens: o.maxTokens } : {}),
    ...(o.cheap !== false && c.vendor !== "openai" ? cheapThinking(c.vendor, model) : {}),
    ...(o.stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    ...o.extra,
  };
  if (c.vendor === "openai" && body.max_tokens) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  const r = await chat(c, body, { ref: o.ref, timeoutMs: o.timeoutMs });
  const u = r.usage ?? {};
  return {
    ok: r.ok,
    status: r.status,
    text: r.content,
    reasoning: r.reasoning,
    finish: r.finish,
    usage: {
      input: n(u.prompt_tokens),
      output: n(u.completion_tokens),
      cached: n(u.prompt_tokens_details?.cached_tokens ?? u.prompt_cache_hit_tokens),
      reasoning: n(u.completion_tokens_details?.reasoning_tokens),
    },
    id: r.id,
    model: r.model,
    resp: r,
    ttftMs: r.ttftMs,
    firstDeltaMs: r.firstDeltaMs,
    lastDeltaMs: r.lastDeltaMs,
    durationMs: r.durationMs,
    error: r.ok ? null : r.error ?? `HTTP ${r.status}`,
  };
}

export const failText = (a: Answer) => a.error ?? `HTTP ${a.status}`;
