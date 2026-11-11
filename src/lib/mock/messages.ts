import { createHash, randomBytes } from "node:crypto";
import { claudeFacts } from "../composition/facts";
import { estTokens } from "../composition/util";
import { planTool } from "./chat";
import { answer, inputTokens, outputTokens, type Media, type Persona, type Turn, weatherReply } from "./upstream";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const rand = (n: number) => Array.from(randomBytes(n), (b) => ALNUM[b % ALNUM.length]).join("");
const SECRET = randomBytes(16).toString("hex");
const sign = (text: string) => `EqMOCK${createHash("sha256").update(SECRET + text).digest("base64url").slice(0, 40)}`;

const error = (status: number, type: string, message: string) =>
  Response.json({ type: "error", error: { type, message }, request_id: `req_${rand(24)}` }, { status, headers: { "request-id": `req_${rand(24)}` } });

const text = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (b?.type === "text" ? b.text : b?.type === "tool_result" ? (typeof b.content === "string" ? b.content : text(b.content)) : "")).join("") : "";

function extract(body: Json) {
  const media: Media = { images: [], pdfs: [], urlImages: [] };
  const turns: Turn[] = [];
  let toolResult: string | null = null;
  for (const m of body.messages ?? []) {
    if (Array.isArray(m.content))
      for (const b of m.content) {
        if (b.type === "image" && b.source?.type === "base64") media.images.push(b.source.data);
        if (b.type === "image" && b.source?.type === "url") media.urlImages.push(b.source.url);
        if (b.type === "document" && b.source?.type === "base64") media.pdfs.push(b.source.data);
      }
    if (m.role === "system") continue;
    turns.push({ role: m.role, text: text(m.content) });
  }
  const last = body.messages?.[body.messages.length - 1];
  if (Array.isArray(last?.content) && last.content.some((b: Json) => b.type === "tool_result")) toolResult = text(last.content);
  const system = typeof body.system === "string" ? body.system : Array.isArray(body.system) ? body.system.map((b: Json) => b.text ?? "").join("\n") : "";
  return { media, turns, toolResult, system };
}

const cachedPrefixes = new Set<string>();
const h = (t: string) => createHash("sha1").update(t).digest("hex");

/** Anthropic-style caching: read the longest previously cached prefix at a block boundary, write up to the last breakpoint. */
function cacheInfo(body: Json, model: string) {
  const sys = Array.isArray(body.system) ? body.system : [];
  let prefix = "";
  const boundaries: string[] = [];
  let marked: { text: string; ttl: string } | null = null;
  for (const b of sys) {
    prefix += b.text ?? "";
    boundaries.push(prefix);
    if (b.cache_control) marked = { text: prefix, ttl: b.cache_control.ttl ?? "5m" };
  }
  for (const m of body.messages ?? []) {
    for (const b of Array.isArray(m.content) ? m.content : [{ type: "text", text: m.content }]) {
      prefix += b?.text ?? "";
      boundaries.push(prefix);
      if (b?.cache_control) marked = { text: prefix, ttl: b.cache_control.ttl ?? "5m" };
    }
  }
  if (!marked) return null;
  const key = (t: string) => h(`${model}|${marked!.ttl}|${t}`);
  let read = 0;
  for (const bnd of boundaries) if (bnd.length <= marked.text.length && cachedPrefixes.has(key(bnd))) read = Math.max(read, estTokens(bnd));
  const total = estTokens(marked.text);
  const creation = cachedPrefixes.has(key(marked.text)) ? 0 : total - read;
  cachedPrefixes.add(key(marked.text));
  return { ttl: marked.ttl, read: read >= 1024 ? read : 0, creation: total >= 1024 ? creation : 0 };
}

function validate(p: Persona, body: Json, headers: Headers): Response | null {
  if (!p.honest) return null;
  const f = claudeFacts(p.id);
  const msgs: Json[] = body.messages ?? [];
  const version = headers.get("anthropic-version");
  const bad = (m: string) => error(400, "invalid_request_error", m);
  if (!Array.isArray(msgs) || !msgs.length) return bad("messages: at least one message is required");
  if (!body.max_tokens) return bad("max_tokens: Field required");
  if (version === "2026-10-21" && ["temperature", "top_p", "top_k"].some((k) => k in body)) return bad("temperature, top_p and top_k are not supported in this API version");
  if ("temperature" in body && "top_p" in body) return bad("`temperature` and `top_p` cannot both be specified for this model.");
  if (f.samplingRule === "legacy" && typeof body.temperature === "number" && (body.temperature < 0 || body.temperature > 1)) return bad("temperature: range: 0..1");
  if (body.max_tokens > f.maxOutput) return bad(`max_tokens: ${body.max_tokens} > ${f.maxOutput}, which is the maximum allowed number of output tokens for ${p.id}`);
  if (msgs[msgs.length - 1]?.role === "assistant" && !f.prefillAllowed) return bad("This model does not support assistant message prefill. The conversation must end with a user message.");
  if (msgs.some((m) => m.role === "system") && !f.systemRoleInMessages) return bad("messages: role 'system' is not supported on this model");
  const effort = body.output_config?.effort;
  if (effort !== undefined) {
    if (!f.effortLevels) return bad("This model does not support the effort parameter.");
    if (!f.effortLevels.includes(effort)) return bad(`This model does not support effort level '${effort}'. Supported levels: ${[...f.effortLevels].sort().join(", ")}.`);
  }
  const th = body.thinking;
  if (th) {
    if (th.type === "between_tools" && !f.betweenTools) return bad('"thinking.type.between_tools" is not supported for this model.');
    if (th.type === "disabled" && !f.thinkingDisableable) return bad('"thinking.type.disabled" is not supported for this model');
    if (th.type === "enabled" && f.budgetTokensRemoved) return bad('"thinking.type.enabled" is not supported for this model');
    if (th.display && !["summarized", "omitted"].includes(th.display)) return bad(`thinking.display: unknown value '${th.display}'`);
    if (th.block_binding) return bad("thinking.block_binding: requires a model that supports thinking binding");
  }
  for (const m of msgs)
    for (const b of Array.isArray(m.content) ? m.content : [])
      if (b.type === "thinking" && b.signature !== sign(b.thinking ?? "")) return bad("messages: thinking block has an invalid signature");
  if (body.service_tier !== undefined && !["auto", "standard_only"].includes(body.service_tier)) return bad("service_tier: invalid value");
  if (body.inference_geo !== undefined && !["us", "global"].includes(body.inference_geo)) return bad("inference_geo: invalid value");
  const ttlBad = JSON.stringify(body).match(/"ttl":"(\w+)"/g)?.some((t) => !/"(5m|1h)"/.test(t));
  if (ttlBad) return bad("cache_control.ttl: must be one of 5m, 1h");
  if (body.speed !== undefined && f.fastMode === "none") return bad(`'${p.id.replace(/\./g, "-")}' does not support the \`speed\` parameter.`);
  for (const t of body.tools ?? []) {
    if (/^computer_/.test(t.type ?? "")) return bad(`'${p.id.replace(/\./g, "-")}' does not support tool types: ${t.type}. Did you mean one of computer_20251124?`);
  }
  if (body.tool_choice?.type === "tool" && f.forcedToolChoiceRemoved) return bad('tool_choice: type "tool" and "any" are not supported for this model');
  return null;
}

export async function handleMessages(p: Persona, body: Json, headers: Headers): Promise<Response> {
  const invalid = validate(p, body, headers);
  if (invalid) return invalid;
  const f = claudeFacts(p.id);
  const { media, turns, toolResult, system } = extract(body);
  const id = p.honest ? `msg_01${rand(22)}` : `chatcmpl-${randomBytes(16).toString("hex")}`;
  const promptText = `${system}\n${turns.map((t) => t.text).join("\n")}${body.tools ? JSON.stringify(body.tools) : ""}`;
  const input = inputTokens(p, promptText) + (media.images.length ? 80 : 0) + (media.pdfs.length ? 300 : 0);
  const cache = p.honest ? cacheInfo(body, p.id) : null;
  const read = cache?.read ?? 0;
  const creation = cache?.creation ?? 0;
  const content: Json[] = [];
  let stop = "end_turn";
  let stopSequence: string | null = null;
  const thinkOn = p.honest && body.thinking && body.thinking.type !== "disabled" && body.thinking.type !== "between_tools";
  const lastUser = turns.filter((t) => t.role === "user").pop()?.text ?? "";
  const all = `${system}\n${turns.map((t) => t.text).join("\n")}`;
  const serverSearch = (body.tools ?? []).find((t: Json) => /^web_search_/.test(t.type ?? ""));
  const plan = toolResult === null && !serverSearch ? planTool((body.tools ?? []).filter((t: Json) => !t.type || t.type === "custom"), body.tool_choice, lastUser, all) : null;
  let usageExtra: Json = {};
  if (toolResult !== null) content.push({ type: "text", text: weatherReply(toolResult) });
  else if (serverSearch && p.honest) {
    const sid = `srvtoolu_01${rand(22)}`;
    content.push({ type: "server_tool_use", id: sid, name: "web_search", input: { query: lastUser } }, { type: "web_search_tool_result", tool_use_id: sid, content: [{ type: "web_search_result", url: "https://en.wikipedia.org/wiki/Canberra", title: "Canberra" }] }, { type: "text", text: "Canberra" });
    usageExtra = { server_tool_use: { web_search_requests: 1 } };
  } else if (plan) {
    content.push({ type: "tool_use", id: p.honest ? `toolu_01${rand(22)}` : `call_${rand(24)}`, name: plan.name, input: plan.args });
    stop = "tool_use";
  } else {
    const ans = answer(p, turns, system, media);
    let t = ans.text;
    if (thinkOn) {
      const thought = ans.reasoning ?? "Let me work through this.";
      const shown = (body.thinking.display ?? f.displayDefault) === "summarized" ? thought : "";
      content.push({ type: "thinking", thinking: shown, signature: sign(shown) });
    }
    for (const s of p.honest ? body.stop_sequences ?? [] : []) {
      const i = t.indexOf(s);
      if (i >= 0) {
        t = t.slice(0, i);
        stop = "stop_sequence";
        stopSequence = s;
      }
    }
    if (outputTokens(t) > body.max_tokens) {
      let lo = 0;
      let hi = t.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (outputTokens(t.slice(0, mid)) <= body.max_tokens) lo = mid;
        else hi = mid - 1;
      }
      t = t.slice(0, lo);
      stop = "max_tokens";
    }
    if (body.output_config?.format?.type === "json_schema" && p.honest && !t.trim().startsWith("{")) t = '{"city":"Tokyo","population":14000000}';
    content.push({ type: "text", text: t });
  }
  const output = content.reduce((s, b) => s + outputTokens(b.text ?? b.thinking ?? JSON.stringify(b.input ?? "")), 0) + (thinkOn ? 12 : 0);
  const usage: Json = p.honest
    ? {
        input_tokens: input - read - creation > 0 ? input - read - creation : 1,
        cache_creation_input_tokens: creation,
        cache_read_input_tokens: read,
        cache_creation: { ephemeral_5m_input_tokens: cache?.ttl === "5m" ? creation : 0, ephemeral_1h_input_tokens: cache?.ttl === "1h" ? creation : 0 },
        output_tokens: output,
        service_tier: "standard",
        ...(body.inference_geo ? { inference_geo: body.inference_geo } : {}),
        ...(body.speed && f.fastMode !== "none" ? { speed: f.fastMode === "standard" ? "standard" : "fast" } : {}),
        ...usageExtra,
      }
    : { input_tokens: input, output_tokens: output };
  const model = p.honest ? body.model : body.model;
  const headersOut: Record<string, string> = p.honest ? { "request-id": `req_${rand(24)}`, "anthropic-ratelimit-requests-limit": "4000" } : {};

  if (!body.stream) {
    await sleep(60);
    return Response.json({ id, type: "message", role: "assistant", model, content, stop_reason: stop, stop_sequence: stopSequence, usage }, { headers: headersOut });
  }
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Json) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`));
      const start = p.honest ? { ...usage, output_tokens: 1 } : { input_tokens: input, output_tokens: 1 };
      send("message_start", { message: { id, type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: start } });
      if (p.honest) send("ping", {});
      await sleep(200);
      content.forEach((b, index) => {
        if (b.type === "text") {
          send("content_block_start", { index, content_block: { type: "text", text: "" } });
          for (let i = 0; i < b.text.length; i += 10) send("content_block_delta", { index, delta: { type: "text_delta", text: b.text.slice(i, i + 10) } });
        } else if (b.type === "thinking") {
          send("content_block_start", { index, content_block: { type: "thinking", thinking: "", signature: "" } });
          if (b.thinking) send("content_block_delta", { index, delta: { type: "thinking_delta", thinking: b.thinking } });
          send("content_block_delta", { index, delta: { type: "signature_delta", signature: b.signature } });
        } else if (b.type === "tool_use") {
          send("content_block_start", { index, content_block: { type: "tool_use", id: b.id, name: b.name, input: {} } });
          const json = JSON.stringify(b.input);
          if (p.honest) for (let i = 0; i < json.length; i += 5) send("content_block_delta", { index, delta: { type: "input_json_delta", partial_json: json.slice(i, i + 5) } });
        } else send("content_block_start", { index, content_block: b });
        send("content_block_stop", { index });
      });
      for (let i = 0; i < 3; i++) await sleep(p.delayMs * 4);
      send("message_delta", { delta: { stop_reason: stop, stop_sequence: stopSequence }, usage: { output_tokens: output } });
      send("message_stop", {});
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", ...headersOut } });
}

export function countTokens(p: Persona, body: Json) {
  const { turns, system } = extract(body);
  return Response.json({ input_tokens: inputTokens(p, `${system}\n${turns.map((t) => t.text).join("\n")}`) });
}
