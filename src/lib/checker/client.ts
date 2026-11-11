import type { CallResult, Endpoint, Protocol, Usage } from "./types";
import { endpointUrl, modelsUrl, redact } from "./url";

type Json = Record<string, unknown>;

export interface CallOptions {
  prompt: string;
  system?: string;
  maxTokens?: number;
  timeoutMs?: number;
  stream?: boolean;
  signal?: AbortSignal;
}

const DEFAULT_TIMEOUT_MS = 180_000;
const KEPT_HEADERS = [
  "server",
  "x-request-id",
  "request-id",
  "openai-processing-ms",
  "openai-organization",
  "openai-version",
  "anthropic-organization-id",
  "x-ratelimit-limit-requests",
  "x-ratelimit-limit-tokens",
  "anthropic-ratelimit-requests-limit",
  "x-openrouter-provider",
  "cf-ray",
  "via",
];

export function authHeaders(protocol: Protocol | "any", apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}` };
  if (protocol === "messages" || protocol === "any") {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
  }
  return headers;
}

export function buildBody(endpoint: Endpoint, options: CallOptions): Json {
  const stream = options.stream !== false;
  const { model, effort } = endpoint;
  if (endpoint.protocol === "chat") {
    const messages = options.system ? [{ role: "system", content: options.system }] : [];
    const body: Json = { model, messages: [...messages, { role: "user", content: options.prompt }], stream };
    if (stream) body.stream_options = { include_usage: true };
    if (options.maxTokens) body.max_tokens = options.maxTokens;
    if (effort) body.reasoning_effort = effort;
    return body;
  }
  if (endpoint.protocol === "responses") {
    const body: Json = {
      model,
      input: [{ role: "user", content: [{ type: "input_text", text: options.prompt }] }],
      stream,
      store: false,
    };
    if (options.system) body.instructions = options.system;
    if (options.maxTokens) body.max_output_tokens = Math.max(16, options.maxTokens);
    if (effort) body.reasoning = { effort };
    return body;
  }
  const body: Json = {
    model,
    max_tokens: options.maxTokens ?? 8192,
    messages: [{ role: "user", content: options.prompt }],
    stream,
  };
  if (options.system) body.system = options.system;
  if (effort && effort !== "none") {
    body.thinking = { type: "adaptive" };
    body.output_config = { effort };
  }
  return body;
}

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const str = (value: unknown): string | null => (typeof value === "string" && value ? value : null);
const obj = (value: unknown): Json =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};

function readUsage(protocol: Protocol, raw: unknown, into: Usage) {
  const u = obj(raw);
  if (!Object.keys(u).length) return;
  if (protocol === "chat") {
    into.input = num(u.prompt_tokens) ?? into.input;
    into.output = num(u.completion_tokens) ?? into.output;
    into.reasoning = num(obj(u.completion_tokens_details).reasoning_tokens) ?? into.reasoning;
    into.cached = num(obj(u.prompt_tokens_details).cached_tokens) ?? into.cached;
  } else if (protocol === "responses") {
    into.input = num(u.input_tokens) ?? into.input;
    into.output = num(u.output_tokens) ?? into.output;
    into.reasoning = num(obj(u.output_tokens_details).reasoning_tokens) ?? into.reasoning;
    into.cached = num(obj(u.input_tokens_details).cached_tokens) ?? into.cached;
  } else {
    const base = num(u.input_tokens);
    const cacheWrite = num(u.cache_creation_input_tokens) ?? 0;
    const cacheRead = num(u.cache_read_input_tokens) ?? 0;
    if (base !== null) into.input = base + cacheWrite + cacheRead;
    if (num(u.cache_read_input_tokens) !== null) into.cached = cacheRead;
    into.output = num(u.output_tokens) ?? into.output;
  }
}

interface ParseState {
  text: string;
  reasoningText: boolean;
  usage: Usage;
  responseModel: string | null;
  responseId: string | null;
  finishReason: string | null;
  complete: boolean;
  systemFingerprint: string | null;
  error: string | null;
  firstTokenAt: number | null;
}

function acceptEvent(protocol: Protocol, data: Json, state: ParseState, now: number) {
  if (data.error || data.type === "error") {
    const e = obj(data.error);
    state.error = str(e.message) ?? str(data.message) ?? "上游返回了错误事件";
    return;
  }
  const markToken = () => {
    if (state.firstTokenAt === null) state.firstTokenAt = now;
  };
  if (protocol === "chat") {
    state.responseModel = str(data.model) ?? state.responseModel;
    state.responseId = str(data.id) ?? state.responseId;
    state.systemFingerprint = str(data.system_fingerprint) ?? state.systemFingerprint;
    const choices = Array.isArray(data.choices) ? data.choices : [];
    for (const choice of choices) {
      const c = obj(choice);
      const delta = obj(c.delta ?? c.message);
      const content = typeof delta.content === "string" ? delta.content : "";
      const reasoning = str(delta.reasoning_content) ?? str(delta.reasoning);
      if (content) {
        markToken();
        state.text += content;
      }
      if (reasoning) {
        markToken();
        state.reasoningText = true;
      }
      if (str(c.finish_reason)) {
        state.finishReason = str(c.finish_reason);
        state.complete = true;
      }
    }
    readUsage(protocol, data.usage, state.usage);
    return;
  }
  if (protocol === "responses") {
    const type = str(data.type) ?? "";
    const response = obj(data.response);
    if (type === "response.output_text.delta" && typeof data.delta === "string") {
      markToken();
      state.text += data.delta;
    } else if (type.startsWith("response.reasoning") && type.endsWith(".delta")) {
      markToken();
      state.reasoningText = true;
    }
    if (Object.keys(response).length) {
      state.responseModel = str(response.model) ?? state.responseModel;
      state.responseId = str(response.id) ?? state.responseId;
      readUsage(protocol, response.usage, state.usage);
    }
    if (type === "response.completed") {
      state.complete = true;
      state.finishReason = "completed";
      if (!state.text) state.text = responsesOutputText(response);
    } else if (type === "response.incomplete") {
      state.finishReason = str(obj(response.incomplete_details).reason) ?? "incomplete";
    } else if (type === "response.failed") {
      state.error = str(obj(response.error).message) ?? "上游报告响应失败";
    } else if (!type && str(data.object) === "response") {
      state.responseModel = str(data.model) ?? state.responseModel;
      state.responseId = str(data.id) ?? state.responseId;
      readUsage(protocol, data.usage, state.usage);
      state.text = responsesOutputText(data);
      if (state.text) markToken();
      state.complete = data.status === "completed";
      state.finishReason = str(data.status);
    }
    return;
  }
  const type = str(data.type) ?? "";
  if (type === "message_start") {
    const message = obj(data.message);
    state.responseModel = str(message.model) ?? state.responseModel;
    state.responseId = str(message.id) ?? state.responseId;
    readUsage(protocol, message.usage, state.usage);
  } else if (type === "content_block_delta") {
    const delta = obj(data.delta);
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      markToken();
      state.text += delta.text;
    } else if (delta.type === "thinking_delta") {
      markToken();
      state.reasoningText = true;
    }
  } else if (type === "message_delta") {
    const delta = obj(data.delta);
    state.finishReason = str(delta.stop_reason) ?? state.finishReason;
    readUsage(protocol, data.usage, state.usage);
  } else if (type === "message_stop") {
    state.complete = true;
  } else if (type === "message" || Array.isArray(data.content)) {
    state.responseModel = str(data.model) ?? state.responseModel;
    state.responseId = str(data.id) ?? state.responseId;
    readUsage(protocol, data.usage, state.usage);
    const blocks = Array.isArray(data.content) ? data.content : [];
    for (const block of blocks) {
      const b = obj(block);
      if (b.type === "text" && typeof b.text === "string") state.text += b.text;
      if (b.type === "thinking") state.reasoningText = true;
    }
    if (state.text) markToken();
    state.finishReason = str(data.stop_reason);
    state.complete = !!state.finishReason;
  }
}

function responsesOutputText(response: Json): string {
  if (typeof response.output_text === "string") return response.output_text;
  const output = Array.isArray(response.output) ? response.output : [];
  let text = "";
  for (const item of output) {
    const content = obj(item).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const p = obj(part);
      if ((p.type === "output_text" || p.type === "text") && typeof p.text === "string") text += p.text;
    }
  }
  return text;
}

function httpErrorMessage(status: number, body: string): string {
  const trimmed = body.trim();
  let detail = trimmed.slice(0, 300);
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed) as Json;
      detail = str(obj(data.error).message) ?? str(data.message) ?? str(data.error) ?? detail;
    } catch {}
  } else if (/^<!doctype|^<html/i.test(trimmed)) {
    detail = "返回了网页而不是 API 响应，请检查 Base URL";
  }
  return `HTTP ${status}${detail ? `：${detail}` : ""}`;
}

export async function callModel(endpoint: Endpoint, fetchBase: string, options: CallOptions): Promise<CallResult> {
  const started = performance.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const state: ParseState = {
    text: "",
    reasoningText: false,
    usage: { input: null, output: null, reasoning: null, cached: null },
    responseModel: null,
    responseId: null,
    finishReason: null,
    complete: false,
    systemFingerprint: null,
    error: null,
    firstTokenAt: null,
  };
  const result = (status: number | null, headers: Record<string, string>): CallResult => {
    const ok = !state.error && state.complete && status !== null && status < 400;
    return {
      ok,
      text: state.text,
      reasoningText: state.reasoningText,
      status,
      error: state.error ? redact(state.error, endpoint.apiKey) : ok ? null : "响应未正常结束",
      durationMs: Math.round(performance.now() - started),
      ttftMs: state.firstTokenAt === null ? null : Math.round(state.firstTokenAt - started),
      usage: state.usage,
      responseModel: state.responseModel,
      responseId: state.responseId,
      finishReason: state.finishReason,
      complete: state.complete,
      systemFingerprint: state.systemFingerprint,
      headers,
    };
  };
  let status: number | null = null;
  const headers: Record<string, string> = {};
  try {
    const response = await fetch(endpointUrl(fetchBase, endpoint.protocol), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders(endpoint.protocol, endpoint.apiKey) },
      body: JSON.stringify(buildBody(endpoint, options)),
      signal,
      redirect: "manual",
    });
    status = response.status;
    for (const name of KEPT_HEADERS) {
      const value = response.headers.get(name);
      if (value) headers[name] = value.slice(0, 120);
    }
    if (status >= 300) {
      state.error = httpErrorMessage(status, await response.text().catch(() => ""));
      return result(status, headers);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("text/event-stream")) {
      const body = await response.text();
      try {
        acceptEvent(endpoint.protocol, JSON.parse(body) as Json, state, performance.now());
      } catch {
        state.error = /^\s*</.test(body) ? "返回了网页而不是 API 响应，请检查 Base URL" : "响应不是合法 JSON";
      }
      return result(status, headers);
    }
    if (!response.body) {
      state.error = "流式响应没有内容";
      return result(status, headers);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let done = false;
    const frame = (raw: string) => {
      const payload = raw
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (!payload) return;
      if (payload.trim() === "[DONE]") {
        done = true;
        if (endpoint.protocol === "chat" && state.finishReason) state.complete = true;
        return;
      }
      try {
        acceptEvent(endpoint.protocol, JSON.parse(payload) as Json, state, performance.now());
      } catch {}
      if (endpoint.protocol === "messages" && state.complete) done = true;
      if (endpoint.protocol === "responses" && (state.complete || state.error || state.finishReason)) done = true;
    };
    try {
      while (!done && !state.error) {
        const chunk = await reader.read();
        buffer += chunk.done ? decoder.decode() : decoder.decode(chunk.value, { stream: true });
        let match: RegExpExecArray | null;
        while (!done && (match = /\r?\n\r?\n/.exec(buffer))) {
          frame(buffer.slice(0, match.index));
          buffer = buffer.slice(match.index + match[0].length);
        }
        if (chunk.done) {
          if (buffer.trim()) frame(buffer);
          break;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return result(status, headers);
  } catch (error) {
    if (options.signal?.aborted) state.error = "检测已取消";
    else if (timeout.aborted) state.error = `超过 ${Math.round(timeoutMs / 1000)} 秒未完成`;
    else {
      const cause = (error as { cause?: { code?: string; message?: string } }).cause;
      state.error = `无法连接目标接口${cause?.code ? `（${cause.code}）` : ""}`;
    }
    return result(status, headers);
  }
}

export async function listModels(fetchBase: string, apiKey: string): Promise<string[]> {
  const response = await fetch(modelsUrl(fetchBase), {
    headers: authHeaders("any", apiKey),
    signal: AbortSignal.timeout(20_000),
    redirect: "manual",
  });
  const body = await response.text();
  if (!response.ok) throw new Error(redact(httpErrorMessage(response.status, body), apiKey));
  let data: Json;
  try {
    data = JSON.parse(body) as Json;
  } catch {
    throw new Error("/models 返回的不是 JSON");
  }
  const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
  const ids = list
    .map((item) => (typeof item === "string" ? item : str(obj(item).id) ?? str(obj(item).name)))
    .filter((id): id is string => !!id)
    .map((id) => id.replace(/^models\//, ""));
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
