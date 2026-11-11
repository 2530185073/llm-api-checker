import { createHash, randomBytes, randomUUID } from "node:crypto";
import { compatFacts, openaiFacts } from "../composition/facts";
import { estTokens } from "../composition/util";
import { answer, inputTokens, outputTokens, type Media, type Persona, type Turn, weatherReply } from "./upstream";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const hex = (n: number) => randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const b62 = (n: number, len: number) => {
  let s = "";
  for (let i = 0; i < len; i++) {
    s = B62[n % 62] + s;
    n = Math.floor(n / 62);
  }
  return s;
};

const seenPrefixes = new Map<string, number>();
export function cacheLookup(key: string, tokens: number) {
  const h = createHash("sha1").update(key).digest("hex");
  const hit = seenPrefixes.has(h);
  seenPrefixes.set(h, Date.now());
  if (seenPrefixes.size > 5000) seenPrefixes.delete(seenPrefixes.keys().next().value!);
  return hit ? Math.floor(tokens / 64) * 64 : 0;
}

export function err(status: number, body: Json, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers });
}

function chatId(p: Persona, created: number) {
  if (!p.honest) return `chatcmpl-${hex(32)}`;
  if (p.vendor === "openai") return `chatcmpl-${b62(created - 1576800000, 5)}${Array.from({ length: 24 }, () => B62[Math.floor(Math.random() * 62)]).join("")}`;
  if (p.vendor === "glm") {
    const d = new Date(created * 1000);
    const ts = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}${String(d.getUTCHours()).padStart(2, "0")}${String(d.getUTCMinutes()).padStart(2, "0")}${String(d.getUTCSeconds()).padStart(2, "0")}`;
    return `${ts}${hex(16)}`;
  }
  if (p.vendor === "kimi") return `chatcmpl-${created.toString(16).padStart(8, "0")}${hex(16)}`;
  return randomUUID();
}

const flatten = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c === "string" ? c : c?.type === "text" || c?.type === "input_text" ? c.text : "")).join("") : "";

export function extractChat(messages: Json[]): { system: string; turns: Turn[]; media: Media; toolResult: string | null } {
  const media: Media = { images: [], pdfs: [], urlImages: [] };
  let system = "";
  const turns: Turn[] = [];
  let toolResult: string | null = null;
  for (const m of messages ?? []) {
    if (Array.isArray(m.content))
      for (const part of m.content) {
        const url = part?.image_url?.url ?? (typeof part?.image_url === "string" ? part.image_url : null);
        if (url?.startsWith("data:image")) media.images.push(url.split(",")[1]);
        else if (url) media.urlImages.push(url);
      }
    if (m.role === "system" || m.role === "developer") system += `${flatten(m.content)}\n`;
    else if (m.role === "tool") toolResult = flatten(m.content);
    else turns.push({ role: m.role, text: flatten(m.content) });
  }
  if (messages?.[messages.length - 1]?.role !== "tool") toolResult = null;
  return { system, turns, media, toolResult };
}

export interface ToolPlan {
  name: string;
  args: Json;
}

/** Decides whether the persona calls a tool for this request. */
export function planTool(tools: Json[], choice: Json, lastUser: string, all: string): ToolPlan | null {
  if (!tools?.length || choice === "none" || choice?.type === "none") return null;
  const names = tools.map((t: Json) => t.function?.name ?? t.name).filter(Boolean);
  const forced = choice === "required" || choice === "any" || choice?.type === "function" || choice?.type === "tool" || choice?.type === "any" || choice?.mode === "ANY";
  const forcedName = choice?.function?.name ?? choice?.name ?? null;
  const city = /Paris/i.test(lastUser) ? "Paris" : /Japan|Tokyo/i.test(lastUser) ? "Tokyo" : "Tokyo";
  const wants = (n: string) => names.includes(n) && (forced || new RegExp(n === "get_weather" ? "weather|天气|get_weather" : n, "i").test(lastUser));
  const name = forcedName && names.includes(forcedName) ? forcedName : ["run_shell", "calculate", "get_weather", "ping"].find(wants) ?? (forced ? names[0] : null);
  if (!name) return null;
  if (name === "run_shell") return { name, args: { cmd: lastUser.match(/nothing else: (.+)$/)?.[1]?.trim() ?? "echo" } };
  if (name === "calculate") return { name, args: { expression: lastUser.match(/(\d+ \* \d+)/)?.[1] ?? "1+1" } };
  if (name === "get_weather" || /tool_/.test(name)) return { name, args: { city } };
  void all;
  return { name, args: {} };
}

function reasoningFor(p: Persona, body: Json, ans: { reasoning?: string; text: string }): string {
  const v = p.vendor;
  let on = false;
  let effort = String(body.reasoning_effort ?? "");
  if (v === "glm") on = p.thinking === "forced" || body.thinking?.type === "enabled";
  else if (v === "kimi") on = true;
  else if (v === "deepseek") on = body.thinking ? body.thinking.type === "enabled" : effort !== "none";
  else if (v === "openai") on = !!effort && effort !== "none";
  if (v === "deepseek" && !body.thinking && !effort) effort = "high";
  if (!on) return "";
  const mult = { low: 1, minimal: 1, medium: 2, high: 3, max: 5, xhigh: 4 }[effort] ?? (v === "kimi" ? 5 : 3);
  const base = ans.reasoning ?? "Let me think about the request and answer it precisely. ";
  return base.repeat(mult);
}

const truncate = (text: string, budget: number) => {
  if (outputTokens(text) <= budget) return { text, cut: false };
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (outputTokens(text.slice(0, mid)) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo), cut: true };
};

function validate(p: Persona, body: Json): Response | null {
  const v = p.vendor;
  const msgs: Json[] = body.messages ?? [];
  const e400 = (message: string, code: string | number = "invalid_request_error", status = 400) =>
    v === "glm" ? err(status, { error: { code: String(code), message } }) : err(status, { error: { message, type: "invalid_request_error", param: null, code: typeof code === "string" ? code : null } });
  if (!p.honest) {
    if (estTokens(JSON.stringify(msgs)) > p.window) return err(400, { object: "error", message: `This model's maximum context length is ${p.window} tokens. However, you requested more tokens.`, type: "BadRequestError", code: 400 });
    return null;
  }
  if (!Array.isArray(msgs) || !msgs.length) return e400("messages must not be empty", v === "glm" ? 1214 : "invalid_request_error", v === "deepseek" ? 422 : 400);
  const toolNames = (body.tools ?? []).map((t: Json) => t.function?.name).filter(Boolean);
  if (v === "openai") {
    const f = openaiFacts(p.id);
    if (body.max_tokens !== undefined && f.reasoning) return e400("Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.", "unsupported_parameter");
    if (body.stop !== undefined && !f.stopSupported) return e400("Unsupported parameter: 'stop' is not supported with this model.", "unsupported_parameter");
    if (body.reasoning_effort !== undefined && !f.efforts.includes(body.reasoning_effort)) return e400(`Unsupported value: 'reasoning_effort' does not support '${body.reasoning_effort}' with this model.`, "unsupported_value");
    if (body.temperature !== undefined && body.temperature !== 1 && body.reasoning_effort && body.reasoning_effort !== "none") return e400("Unsupported value: 'temperature' does not support 0 with this model.", "unsupported_value");
    if ((body.max_completion_tokens ?? 0) > f.maxOutput) return e400(`max_tokens is too large: ${body.max_completion_tokens}. This model supports at most ${f.maxOutput} completion tokens, whereas you provided ${body.max_completion_tokens}.`, "invalid_value");
    const js = body.response_format?.json_schema;
    if (js?.strict && js.schema?.additionalProperties !== false) return e400("Invalid schema for response_format 'x': In context=(), 'additionalProperties' is required to be supplied and to be false.", "invalid_json_schema");
    return null;
  }
  if (v === "glm") {
    const f = compatFacts("glm", p.id);
    if (body.thinking?.type === "disabled" && f.thinking === "forced") return e400("This model always engages in thinking and cannot be disabled; please use low, high, or max", 1210);
    if (body.reasoning_effort !== undefined && !f.efforts.includes(body.reasoning_effort)) return e400("reasoning_effort must be one of low, high, max", 1214);
    if (body.max_tokens !== undefined && (body.max_tokens < 1 || body.max_tokens > 131072)) return e400("max_tokens out of range", 1210);
    for (const k of ["user_id", "request_id"]) if (body[k] !== undefined && (String(body[k]).length < 6 || String(body[k]).length > 64)) return e400(`${k} length is invalid`, 1214);
    if (msgs.every((m) => m.role === "system" || m.role === "assistant")) return e400("messages must contain a user message", 1214);
    if (msgs.some((m) => m.role === "tool" && !m.tool_call_id)) return e400("tool_call_id is required", 1214);
    if ((body.tools ?? []).length > 128) return e400("too many tools", 1214);
    if (body.tool_choice !== undefined && body.tool_choice !== "auto") return e400("tool_choice only supports auto", 1214);
    if (toolNames.some((n: string) => n.length > 64 || !/^[a-zA-Z0-9_-]+$/.test(n)) || new Set(toolNames).size !== toolNames.length) return e400("invalid function name", 1214);
    if (body.response_format?.type === "json_schema") return e400("response_format type not supported", 1214);
    if (msgs.some((m) => Array.isArray(m.content) && m.content.some((c: Json) => c.type === "image_url")) && !f.vision) return e400("This model does not support image input", 1214);
    return null;
  }
  if (v === "kimi") {
    const f = compatFacts("kimi", p.id);
    if (body.temperature !== undefined && body.temperature !== 1) return e400("invalid temperature: only 1.0 is allowed for this model");
    if (body.top_p !== undefined && body.top_p !== 0.95) return e400("invalid top_p: only 0.95 is allowed for this model");
    if (body.n !== undefined && body.n !== 1) return e400("invalid n: only 1 is allowed for this model");
    if ((body.presence_penalty ?? 0) !== 0 || (body.frequency_penalty ?? 0) !== 0) return e400("invalid penalty: only 0 is allowed for this model");
    if (f.series === "k3" && body.thinking !== undefined) return e400("thinking is not supported for this model");
    if (body.reasoning_effort !== undefined && f.series === "k3" && !f.efforts.includes(body.reasoning_effort)) return e400("invalid reasoning_effort: must be one of low, high, max");
    if (Array.isArray(body.stop) && (body.stop.length > 5 || body.stop.some((s: string) => Buffer.byteLength(s) > 32))) return e400("invalid stop");
    if (body.response_format?.type === "json_schema" && body.response_format.json_schema?.schema?.type === "nonsense") return e400("Invalid request: the `response_format.json_schema.schema` field is invalid");
    if (body.prompt_cache_options?.ttl && !["5m", "1h"].includes(body.prompt_cache_options.ttl)) return e400("invalid prompt_cache_options.ttl");
    if (new Set(toolNames).size !== toolNames.length || toolNames.some((n: string) => !/^[a-zA-Z_][a-zA-Z0-9-_]{0,127}$/.test(n))) return e400("invalid tool definition");
    const tc = body.tool_choice;
    if (tc === "required" && f.series !== "k3") return e400("tool_choice 'required' is only supported by kimi-k3 series");
    if (tc?.type === "function") {
      if (!toolNames.includes(tc.function?.name)) return e400("tool_choice refers to an undeclared tool");
      if (f.thinking === "forced" || body.thinking?.type !== "disabled") return e400("tool_choice 'specified' is incompatible with thinking enabled");
    }
    if (msgs.some((m) => Array.isArray(m.content) && m.content.some((c: Json) => /^https?:/.test(c?.image_url?.url ?? "")))) return e400("image_url must be a base64 data URI or ms:// file id");
    const sysTools = msgs.find((m) => m.role === "system" && m.tools);
    if (sysTools && sysTools.content) return e400("system message with tools cannot be used with content");
    if (sysTools && f.series !== "k3") return e400("tokenization failed");
    return null;
  }
  if (v === "deepseek") {
    const thinkingOn = body.thinking ? body.thinking.type === "enabled" : body.reasoning_effort !== "none";
    const efforts = ["none", "low", "high", "max", "minimal", "medium", "xhigh", "ultra"];
    if (body.reasoning_effort !== undefined && !efforts.includes(body.reasoning_effort)) return e400("Invalid reasoning_effort", "invalid_request_error", 422);
    if (body.temperature !== undefined && (body.temperature < 0 || body.temperature > 2)) return e400("temperature must be in [0, 2]", "invalid_request_error", 422);
    if (Array.isArray(body.stop) && body.stop.length > 16) return e400("stop supports at most 16 sequences", "invalid_request_error", 422);
    if (body.top_logprobs !== undefined && (body.top_logprobs > 20 || !body.logprobs)) return e400("top_logprobs must be between 0 and 20", "invalid_request_error", 422);
    if (body.stream_options && !body.stream) return e400("stream_options should be set along with stream = true");
    if (body.user_id && Buffer.byteLength(String(body.user_id)) > 512) return e400("user_id is too long", "invalid_request_error", 422);
    if ((body.max_tokens ?? 0) > 393216) return e400("max_tokens must be <= 393216", "invalid_request_error", 422);
    if ((body.tool_choice === "required" || body.tool_choice?.type === "function") && thinkingOn) return e400("tool_choice is not supported in thinking mode");
    if (new Set(toolNames).size !== toolNames.length || toolNames.some((n: string) => !/^[a-zA-Z0-9_-]{1,128}$/.test(n))) return e400("invalid function name", "invalid_request_error", 422);
    if (msgs.some((m) => m.role !== "user" && Array.isArray(m.content) && m.content.some((c: Json) => c.type === "image_url"))) return e400("image is only allowed in user messages");
    if (body.response_format?.type === "json_schema") return e400("response_format type must be text or json_object", "invalid_request_error", 422);
    if (body.tool_choice?.type === "function" && !toolNames.includes(body.tool_choice.function?.name)) return e400("tool_choice function not found in tools");
    for (const t of body.tools ?? []) {
      const ps = t.function?.parameters;
      if (t.function?.strict && ps && (ps.additionalProperties !== false || Object.keys(ps.properties ?? {}).some((k) => !(ps.required ?? []).includes(k)))) return e400("strict mode requires all properties to be required and additionalProperties to be false");
    }
    if (estTokens(JSON.stringify(msgs)) > p.window) return e400(`This model's maximum context length is ${p.window} tokens.`);
    return null;
  }
  return null;
}

export async function handleChat(p: Persona, body: Json, headers: Headers): Promise<Response> {
  const v = p.vendor;
  const invalid = validate(p, body);
  if (invalid) return invalid;
  const created = Math.floor(Date.now() / 1000);
  const id = chatId(p, created);
  const { system, turns, media, toolResult } = extractChat(body.messages);
  const last = turns[turns.length - 1];
  const prefixMsg = body.messages?.[body.messages.length - 1];
  const all = `${system}\n${turns.map((t) => t.text).join("\n")}`;
  const promptText = (body.messages ?? []).map((m: Json) => flatten(m.content)).join("\n") + (body.tools ? JSON.stringify(body.tools) : "");
  const promptTokens = inputTokens(p, promptText) + (media.images.length ? 85 : 0) + (!p.honest ? 0 : 0);
  const cacheKey = system.length > 4000 ? system : (turns[0]?.text.length ?? 0) > 4000 ? turns[0].text.slice(0, 8000) : "";
  const cached = cacheKey ? cacheLookup(`${p.id}|${cacheKey}`, estTokens(cacheKey)) : 0;

  let text: string;
  let reasoning = "";
  let toolCall: { id: string; name: string; args: string } | null = null;
  const allTools = [...(body.tools ?? []), ...(body.messages ?? []).filter((m: Json) => m.role === "system" && Array.isArray(m.tools)).flatMap((m: Json) => m.tools)];
  const plan = toolResult === null ? planTool(allTools, body.tool_choice, last?.text ?? "", all) : null;
  if (toolResult !== null) text = weatherReply(toolResult);
  else if (plan) {
    text = "";
    const tid = !p.honest ? `chatcmpl-tool-${hex(32)}` : v === "kimi" ? `${plan.name}_0_${hex(8)}` : v === "deepseek" ? `call_00_${hex(24)}` : v === "glm" ? `call_${hex(16)}` : `call_${Array.from({ length: 24 }, () => B62[Math.floor(Math.random() * 62)]).join("")}`;
    toolCall = { id: tid, name: plan.name, args: JSON.stringify(plan.args) };
  } else {
    const ans = answer(p, prefixMsg?.prefix || prefixMsg?.partial ? turns.slice(0, -1) : turns, system, media);
    text = ans.text;
    reasoning = reasoningFor(p, body, ans);
    if (prefixMsg?.role === "assistant" && (prefixMsg.prefix || prefixMsg.partial)) text = /python/.test(prefixMsg.content) ? "def square(x):\n    return x * x\n```" : " Paris.";
    const schema = body.response_format?.json_schema?.schema;
    if (schema?.properties && p.honest) {
      const sample: Record<string, Json> = { name: "Alice", age: 30, city: "Paris", population: 14000000 };
      text = JSON.stringify(Object.fromEntries(Object.entries(schema.properties).map(([k, v]: [string, Json]) => [k, sample[k] ?? (v.type === "integer" ? 1 : "x")])));
    } else if (body.response_format?.type === "json_object" || body.response_format?.type === "json_schema") text = text.trim().startsWith("{") ? text : JSON.stringify({ answer: text });
    if (!p.honest && reasoning) text = `<think>${reasoning}</think>${text}`;
  }
  if (!p.honest && v === "deepseek" && !toolCall && !reasoning && body.thinking?.type !== "disabled" && body.reasoning_effort !== "none") text = `<think>Thinking.</think>${text}`;
  const stops: string[] = typeof body.stop === "string" ? [body.stop] : Array.isArray(body.stop) ? (v === "glm" ? body.stop.slice(0, 1) : body.stop) : [];
  let finish = toolCall ? "tool_calls" : "stop";
  for (const s of stops) {
    const i = text.indexOf(s);
    if (i >= 0) text = text.slice(0, i);
  }
  const budget = body.max_completion_tokens ?? body.max_tokens ?? 1_000_000;
  const rt = outputTokens(reasoning);
  if (rt > budget) {
    reasoning = truncate(reasoning, budget).text;
    text = "";
    finish = "length";
  } else {
    const t = truncate(text, budget - rt);
    if (t.cut) finish = "length";
    text = t.text;
  }
  const completion = outputTokens(text) + outputTokens(reasoning) + (toolCall ? outputTokens(toolCall.args) + 4 : 0);
  const usage: Json = { prompt_tokens: promptTokens, completion_tokens: completion, total_tokens: promptTokens + completion };
  if (p.honest) {
    usage.prompt_tokens_details = { cached_tokens: cached };
    if (v === "kimi" && compatFacts("kimi", p.id).series === "k3") usage.prompt_tokens_details.cache_write_tokens = cached ? 0 : cacheKey ? estTokens(cacheKey) : 0;
    if (reasoning || v === "openai") usage.completion_tokens_details = { reasoning_tokens: outputTokens(reasoning) };
    if (v === "openai") {
      usage.prompt_tokens_details.audio_tokens = 0;
      Object.assign(usage.completion_tokens_details, { accepted_prediction_tokens: 0, rejected_prediction_tokens: 0, audio_tokens: 0 });
    }
    if (v === "deepseek") Object.assign(usage, { prompt_cache_hit_tokens: cached, prompt_cache_miss_tokens: promptTokens - cached });
  }
  const n = v === "openai" || !p.honest ? Math.max(1, Math.min(4, Number(body.n) || 1)) : 1;
  const msg: Json = { role: "assistant", content: toolCall ? null : text };
  if (reasoning && p.honest) msg.reasoning_content = reasoning;
  if (toolCall) msg.tool_calls = [{ id: toolCall.id, type: "function", function: { name: toolCall.name, arguments: toolCall.args } }];
  if (v === "openai") Object.assign(msg, { refusal: null, annotations: [] });
  const model = p.honest || v !== "deepseek" ? body.model : body.model;
  const extraHeaders: Record<string, string> = {};
  if (!p.honest) extraHeaders.server = "uvicorn";
  if (v === "kimi" && p.honest) {
    extraHeaders["msh-request-id"] = hex(24);
    const nonce = headers.get("x-msh-request-nonce");
    if (nonce) {
      const ts = String(Date.now());
      extraHeaders["msh-request-timestamp"] = ts;
      extraHeaders["msh-request-signature"] = `reqsigv1_${createHash("sha256").update(`${nonce}|${ts}|${body.model}`).digest("hex").slice(0, 40)}`;
    }
    if (usage.prompt_tokens_details?.cache_write_tokens) extraHeaders[`msh-usage-cache-write-tokens-${body.prompt_cache_options?.ttl === "1h" ? "1h" : "5m"}`] = String(usage.prompt_tokens_details.cache_write_tokens);
  }
  if (v === "openai" && p.honest) Object.assign(extraHeaders, { "openai-processing-ms": "120", "x-request-id": `req_${hex(32)}` });
  const fingerprint = v === "deepseek" && p.honest ? createHash("md5").update(p.id).digest("hex") : v === "openai" ? null : undefined;

  if (!body.stream) {
    await sleep(80 + text.length * 0.05);
    const out: Json = {
      id,
      object: "chat.completion",
      created,
      model,
      choices: Array.from({ length: n }, (_, i) => ({ index: i, message: msg, finish_reason: finish, ...(v === "deepseek" ? { logprobs: body.logprobs && p.honest ? { content: tokensLogprobs(text, body.top_logprobs ?? 0) } : null } : !p.honest && body.logprobs ? { logprobs: { content: tokensLogprobs(text, 2) } } : {}) })),
      usage,
    };
    if (fingerprint !== undefined) out.system_fingerprint = fingerprint;
    if (!p.honest) out.system_fingerprint = null;
    if (v === "glm" && body.request_id) out.request_id = body.request_id;
    if (v === "glm" && (body.tools ?? []).some((t: Json) => t.type === "web_search")) out.web_search = [{ title: "BBC News", link: "https://www.bbc.com/news", refer: "ref_1" }];
    return Response.json(out, { headers: extraHeaders });
  }

  const enc = new TextEncoder();
  const includeUsage = !!body.stream_options?.include_usage;
  const kimiFp = `fpv0_${createHash("md5").update(p.id).digest("hex").slice(0, 8)}`;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: Json) => controller.enqueue(enc.encode(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`));
      const chunk = (delta: Json, finishReason: string | null = null, extra: Json = {}) => {
        const c: Json = { id, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta, finish_reason: finishReason, ...extra }] };
        if (v === "kimi" && p.honest) c.system_fingerprint = kimiFp;
        if (v === "deepseek" && p.honest) c.system_fingerprint = fingerprint;
        if (v === "openai") c.system_fingerprint = null;
        if (includeUsage && v !== "glm") c.usage = null;
        return c;
      };
      send(chunk({ role: "assistant", content: "" }));
      await sleep(150 + Math.random() * 150);
      for (let i = 0; i < reasoning.length; i += 40) {
        send(chunk({ reasoning_content: reasoning.slice(i, i + 40) }));
        await sleep(p.delayMs);
      }
      if (toolCall) {
        const parts = toolCall.args.match(/.{1,6}/g) ?? [toolCall.args];
        send(chunk({ tool_calls: [{ index: 0, id: toolCall.id, type: "function", function: { name: toolCall.name, arguments: "" } }] }));
        for (const part of parts) {
          send(chunk({ tool_calls: [{ index: 0, function: { arguments: part } }] }));
          await sleep(p.delayMs);
        }
      }
      for (let i = 0; i < text.length; i += 12) {
        send(chunk({ content: text.slice(i, i + 12) }));
        await sleep(p.delayMs);
      }
      const finalUsage = p.honest || includeUsage ? usage : null;
      if (v === "kimi" && p.honest) send(chunk({}, finish, { usage }));
      else if ((v === "glm" || v === "deepseek") && p.honest) send({ ...chunk({}, finish), usage });
      else send(chunk({}, finish));
      if (includeUsage && finalUsage && !(p.honest && (v === "glm" || v === "deepseek"))) send({ id, object: "chat.completion.chunk", created, model, choices: [], usage: finalUsage });
      send("[DONE]");
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...extraHeaders } });
}

function tokensLogprobs(text: string, top: number) {
  return (text.match(/\S+\s*/g) ?? []).slice(0, 30).map((t) => ({ token: t, logprob: -0.1, bytes: [...Buffer.from(t)], top_logprobs: Array.from({ length: top }, () => ({ token: t, logprob: -0.1, bytes: [...Buffer.from(t)] })) }));
}
