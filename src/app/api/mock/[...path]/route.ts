import { createHash, randomUUID } from "node:crypto";
import { detectVendor } from "@/lib/composition/facts";
import { err, handleChat } from "@/lib/mock/chat";
import { geminiCountTokens, handleGemini } from "@/lib/mock/gemini";
import { countTokens, handleMessages } from "@/lib/mock/messages";
import { handleResponses } from "@/lib/mock/responses";
import { inputTokens, PERSONAS, personaFor } from "@/lib/mock/upstream";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Per-key request counts by path, so tests can prove which endpoints a run touched. Keys are hashed, never stored. */
const requestLog = new Map<string, Record<string, number>>();
const keyId = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 16);
function logRequest(key: string, route: string) {
  if (!key) return;
  const id = keyId(key);
  const entry = requestLog.get(id) ?? {};
  entry[route] = (entry[route] ?? 0) + 1;
  requestLog.set(id, entry);
  if (requestLog.size > 2000) requestLog.delete(requestLog.keys().next().value!);
}

const GENERATION: [RegExp, string][] = [
  [/^(v1|beta)\/chat\/completions$/, "chat"],
  [/^v1\/responses$/, "responses"],
  [/^(v1|anthropic\/v1)\/messages(\/count_tokens)?$/, "messages"],
  [/^v1beta\/models\/[^:]+:/, "gemini"],
  [/^beta\/completions$/, "completions"],
];

/** Demo keys containing only-chat / only-responses emulate channels that expose a single generation endpoint. */
function restricted(key: string, route: string): Response | null {
  const only = key.match(/only-(chat|responses)/)?.[1];
  const wire = GENERATION.find(([re]) => re.test(route))?.[1];
  if (!only || !wire || wire === only) return null;
  return err(404, { error: { message: `This channel only serves /v1/${only === "chat" ? "chat/completions" : "responses"}; ${route} is not available.`, type: "invalid_request_error", code: "unsupported_endpoint" } });
}

function credential(request: Request) {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return bearer || request.headers.get("x-api-key")?.trim() || request.headers.get("x-goog-api-key")?.trim() || new URL(request.url).searchParams.get("key") || "";
}

const unauthorized = (vendor: string | null) =>
  vendor === "claude"
    ? err(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })
    : vendor === "glm"
      ? err(401, { error: { code: "1000", message: "身份验证失败" } })
      : err(401, { error: { message: "Invalid Authentication", type: vendor === "kimi" ? "invalid_authentication_error" : "invalid_request_error" } });

const isUnknown = (model: string) => /check-|nonexistent/i.test(model);

function unknownModel(vendor: string | null, model: string) {
  if (vendor === "glm") return err(400, { error: { code: "1211", message: `Unknown Model, please check the model code. (${model})` } });
  if (vendor === "kimi") return err(404, { error: { type: "resource_not_found_error", message: `Not found the model ${model} or Permission denied` } });
  if (vendor === "deepseek") return err(400, { error: { message: "Model Not Exist", type: "invalid_request_error", param: null, code: "invalid_request_error" } });
  if (vendor === "claude") return err(404, { type: "error", error: { type: "not_found_error", message: `model: ${model}` } });
  return err(404, { error: { message: `The model \`${model}\` does not exist or you do not have access to it.`, type: "invalid_request_error", code: "model_not_found" } });
}

function malformed(vendor: string | null) {
  if (vendor === "glm") return err(400, { error: { code: "1214", message: "Invalid request body" } });
  if (vendor === "claude") return err(400, { type: "error", error: { type: "invalid_request_error", message: "Invalid JSON body" } });
  return err(400, { error: { code: "1214", message: "Invalid request body: not valid JSON", type: "invalid_request_error" } });
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  if (route === "_log") {
    const key = credential(request);
    return Response.json({ paths: requestLog.get(keyId(key)) ?? {} });
  }
  if (!credential(request)) return unauthorized(null);
  if (route === "v1/models" || route === "v1beta/models") {
    return Response.json({ object: "list", data: PERSONAS.map((p) => ({ id: p.id, object: "model", created: 1767225600, owned_by: p.ownedBy, ...(p.vendor === "kimi" ? { context_length: p.window, supports_image_in: p.vision, supports_reasoning: true } : {}), ...(p.vendor === "deepseek" && p.honest ? { context_window: p.window, max_output_tokens: 393216 } : {}) })) });
  }
  const m = route.match(/^v1\/models\/(.+)$/);
  if (m) {
    const p = PERSONAS.find((x) => x.id === m[1]);
    if (!p) return err(404, { type: "error", error: { type: "not_found_error", message: "model not found" } });
    return Response.json({ id: p.id, type: "model", display_name: p.id, created_at: "2026-01-01T00:00:00Z", max_input_tokens: p.window, max_tokens: p.vendor === "claude" ? 128000 : 65536 });
  }
  if (route === "user/balance") return Response.json({ is_available: true, balance_infos: [{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" }] });
  if (route === "v1/users/me/balance") return Response.json({ code: 0, data: { available_balance: 49.5, voucher_balance: 0, cash_balance: 49.5 }, scode: "0x0", status: true });
  return err(404, { error: { message: "not found" } });
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  const key = credential(request);
  logRequest(key, route);
  const blocked = restricted(key, route);
  if (blocked) return blocked;
  const raw = await request.text();
  let body: Json;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    body = null;
  }
  const vendorOf = (model: string) => detectVendor(model ?? "");
  const model = String(body?.model ?? "");

  const gem = route.match(/^v1beta\/models\/([^:]+):(generateContent|streamGenerateContent|countTokens)$/);
  if (gem) {
    if (!key) return unauthorized("gemini");
    if (!body) return err(400, { error: { code: 400, message: "Invalid JSON payload received.", status: "INVALID_ARGUMENT" } });
    const p = personaFor(gem[1]);
    if (gem[2] === "countTokens") return geminiCountTokens(p, body);
    return handleGemini(p, gem[1], body, gem[2] === "streamGenerateContent");
  }
  if (!key) return unauthorized(vendorOf(model));
  if (key.startsWith("sk-check-invalid")) return unauthorized(body ? vendorOf(model) : null);
  if (!body) return malformed(vendorOf(personaFor("").id));

  if (route === "v1/signatures/verify") {
    const expected = `reqsigv1_${createHash("sha256").update(`${body.nonce}|${body.timestamp}|${body.model}`).digest("hex").slice(0, 40)}`;
    return Response.json({ valid: body.signature === expected });
  }
  if (route === "v1/tokenizer" || route === "v1/tokenizers/estimate-token-count") {
    const p = personaFor(model);
    const n = inputTokens(p, (body.messages ?? []).map((m: Json) => (typeof m.content === "string" ? m.content : "")).join("\n")) - 6;
    return route === "v1/tokenizer" ? Response.json({ usage: { prompt_tokens: n } }) : Response.json({ code: 0, data: { total_tokens: n }, status: true });
  }
  if (route === "beta/completions") {
    return Response.json({ id: randomUUID(), object: "text_completion", created: Math.floor(Date.now() / 1000), model, system_fingerprint: createHash("md5").update(model).digest("hex"), choices: [{ index: 0, text: "\n    if a < 2:\n        return a\n", finish_reason: "stop", logprobs: null }], usage: { prompt_tokens: 12, completion_tokens: 10, total_tokens: 22, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 12 } });
  }

  if (isUnknown(model)) return unknownModel(vendorOf(model) ?? vendorOf(route.includes("messages") ? "claude" : "gpt"), model);
  if (!model && route !== "v1/messages/count_tokens") return err(400, { error: { message: "model is required" } });
  const p = personaFor(model);

  if (route === "v1/chat/completions" || route === "beta/chat/completions") {
    if (!Array.isArray(body.messages) && p.honest) return p.vendor === "glm" ? err(400, { error: { code: "1214", message: "messages is required" } }) : err(400, { error: { message: "messages is required", type: "invalid_request_error", param: "messages", code: null } });
    return handleChat(p, body, request.headers);
  }
  if (route === "v1/responses") return handleResponses(p, body);
  if (route === "v1/messages") return handleMessages(p, body, request.headers);
  if (route === "v1/messages/count_tokens") return countTokens(p, body);
  if (route === "anthropic/v1/messages") return handleMessages({ ...p, honest: false }, body, request.headers);
  return err(404, { error: { message: "not found" } });
}
