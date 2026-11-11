import { createHash, randomBytes } from "node:crypto";
import { geminiFacts } from "../composition/facts";
import { estTokens } from "../composition/util";
import { cacheLookup, planTool } from "./chat";
import { answer, inputTokens, outputTokens, type Media, type Persona, type Turn, weatherReply } from "./upstream";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const SECRET = randomBytes(8).toString("hex");
const sig = (s: string) => `CiQB${createHash("sha256").update(SECRET + s).digest("base64").slice(0, 32)}`;
const KNOWN_TOP = new Set(["contents", "generationConfig", "generation_config", "systemInstruction", "system_instruction", "tools", "toolConfig", "tool_config", "safetySettings", "safety_settings", "cachedContent", "cached_content"]);
const KNOWN_GEN = new Set(["maxOutputTokens", "temperature", "topP", "topK", "stopSequences", "candidateCount", "responseMimeType", "responseJsonSchema", "responseSchema", "thinkingConfig", "max_output_tokens", "thinking_config", "stop_sequences", "candidate_count", "response_mime_type", "top_p", "top_k", "seed"]);

const bad = (message: string) => Response.json({ error: { code: 400, message, status: "INVALID_ARGUMENT", details: [{ "@type": "type.googleapis.com/google.rpc.BadRequest" }] } }, { status: 400 });

const camel = (o: Json): Json => (o && typeof o === "object" && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_(\w)/g, (_, c) => c.toUpperCase()), camel(v)])) : o);

function validate(p: Persona, body: Json): Response | null {
  for (const k of Object.keys(body)) if (!KNOWN_TOP.has(k)) return bad(`Invalid JSON payload received. Unknown name "${k}": Cannot find field.`);
  const gen = body.generationConfig ?? body.generation_config ?? {};
  for (const k of Object.keys(gen)) if (!KNOWN_GEN.has(k)) return bad(`Invalid JSON payload received. Unknown name "${k}" at 'generation_config': Cannot find field.`);
  const g = camel(gen);
  const f = geminiFacts(p.id);
  if (g.temperature !== undefined && typeof g.temperature !== "number") return bad(`Invalid value at 'generation_config.temperature' (TYPE_FLOAT), "${g.temperature}"`);
  if (typeof g.temperature === "number" && (g.temperature < 0 || g.temperature > 2)) return bad("Unable to submit request because it has a temperature value of " + g.temperature + " but the supported range is from 0 (inclusive) to 2.0 (inclusive). temperature must be in the range [0.0, 2.0]");
  const tc = g.thinkingConfig ?? {};
  if (tc.thinkingLevel !== undefined) {
    if (!["minimal", "low", "medium", "high"].includes(tc.thinkingLevel)) return bad(`Invalid value at 'generation_config.thinking_config.thinking_level' (type.googleapis.com/google.ai.generativelanguage.v1beta.ThinkingConfig.ThinkingLevel), "${tc.thinkingLevel}"`);
    if (f.thinkingLevels && !f.thinkingLevels.includes(tc.thinkingLevel)) return bad(`Thinking level ${tc.thinkingLevel} is not supported for this model.`);
    if (tc.thinkingBudget !== undefined) return bad("thinking_level and thinking_budget cannot be set at the same time.");
  }
  if ((g.candidateCount ?? 1) > 1 && !f.multiCandidates) return bad("Multiple candidates is not enabled for this model");
  const contents: Json[] = body.contents ?? [];
  const lastC = contents[contents.length - 1];
  if (lastC?.role === "model" && lastC.parts?.some((x: Json) => x.text) && !f.prefillAllowed) return bad("Please ensure that the conversation ends with a user turn.");
  for (const c of contents)
    for (const part of c.parts ?? []) if (part.functionCall && f.version >= 3 && part.thoughtSignature !== sig(JSON.stringify(part.functionCall))) return bad(`Function call is missing a thought_signature in functionCall parts.`);
  return null;
}

function extract(body: Json) {
  const media: Media = { images: [], pdfs: [], urlImages: [] };
  const turns: Turn[] = [];
  let toolResult: string | null = null;
  for (const c of body.contents ?? []) {
    let t = "";
    for (const part of c.parts ?? []) {
      if (part.text) t += part.text;
      if (part.inlineData?.mimeType?.startsWith("image/")) media.images.push(part.inlineData.data);
      if (part.functionResponse) toolResult = JSON.stringify(part.functionResponse.response?.result ?? part.functionResponse.response);
    }
    turns.push({ role: c.role === "model" ? "assistant" : "user", text: t });
  }
  const si = body.systemInstruction ?? body.system_instruction;
  const system = (si?.parts ?? []).map((x: Json) => x.text ?? "").join("\n");
  return { media, turns, toolResult, system };
}

export async function handleGemini(p: Persona, model: string, body: Json, stream: boolean): Promise<Response> {
  const invalid = validate(p, body);
  if (invalid) return invalid;
  const gen = camel(body.generationConfig ?? body.generation_config ?? {});
  const { media, turns, toolResult, system } = extract(body);
  const lastUser = turns.filter((t) => t.role === "user").pop()?.text ?? "";
  const promptText = `${system}\n${turns.map((t) => t.text).join("\n")}`;
  const promptTokens = inputTokens(p, promptText) - 9 + 4 + (media.images.length ? 258 : 0);
  const cached = (turns[0]?.text.length ?? 0) > 8000 ? cacheLookup(`${p.id}|g|${turns[0].text.slice(0, 16000)}`, estTokens(turns[0].text)) : 0;
  const parts: Json[] = [];
  let finish = "STOP";
  const tools: Json[] = body.tools ?? [];
  const decls = tools.flatMap((t) => t.functionDeclarations ?? []);
  const fcMode = body.toolConfig?.functionCallingConfig?.mode;
  const think = gen.thinkingConfig ?? {};
  let thoughtTokens = 0;
  const grounding = tools.some((t) => t.googleSearch);
  const codeExec = tools.some((t) => t.codeExecution);
  const plan = toolResult === null && decls.length ? planTool(decls, fcMode === "ANY" ? { mode: "ANY" } : "auto", lastUser, promptText) : null;
  if (toolResult !== null) parts.push({ text: weatherReply(toolResult) });
  else if (plan) {
    const fc = { name: plan.name, args: plan.args };
    parts.push({ functionCall: fc, ...(geminiFacts(p.id).version >= 3 ? { thoughtSignature: sig(JSON.stringify(fc)) } : {}) });
  } else if (codeExec) {
    parts.push({ executableCode: { language: "PYTHON", code: "import sympy\nprint(sum(sympy.prime(i) for i in range(1, 51)))" } }, { codeExecutionResult: { outcome: "OUTCOME_OK", output: "5117\n" } }, { text: "The sum of the first 50 primes is 5117." });
  } else {
    const ans = answer(p, turns, system, media);
    let t = ans.text;
    if (think.includeThoughts) {
      parts.push({ text: ans.reasoning ?? "Working through the problem step by step.", thought: true });
      thoughtTokens = 40;
    } else if (think.thinkingLevel && think.thinkingLevel !== "minimal") thoughtTokens = 20;
    for (const s of gen.stopSequences ?? []) {
      const i = t.indexOf(s);
      if (i >= 0) t = t.slice(0, i);
    }
    const budget = gen.maxOutputTokens ?? 8192;
    if (outputTokens(t) > budget) {
      let lo = 0;
      let hi = t.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (outputTokens(t.slice(0, mid)) <= budget) lo = mid;
        else hi = mid - 1;
      }
      t = t.slice(0, lo);
      finish = "MAX_TOKENS";
    }
    if (gen.responseMimeType === "application/json" && !t.trim().startsWith("{")) t = '{"city":"Tokyo","population":14000000}';
    parts.push({ text: t });
  }
  const candidates = parts.filter((x) => !x.thought).reduce((s, x) => s + outputTokens(x.text ?? JSON.stringify(x.functionCall ?? x.executableCode ?? "")), 0);
  const usageMetadata: Json = {
    promptTokenCount: promptTokens,
    candidatesTokenCount: candidates,
    totalTokenCount: promptTokens + candidates + thoughtTokens,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: promptTokens }],
    serviceTier: "standard",
    ...(thoughtTokens ? { thoughtsTokenCount: thoughtTokens } : {}),
    ...(cached ? { cachedContentTokenCount: cached, cacheTokensDetails: [{ modality: "TEXT", tokenCount: cached }] } : {}),
  };
  const n = Math.max(1, gen.candidateCount ?? 1);
  const responseId = randomBytes(15).toString("base64url");
  const candidate = (i: number, cParts: Json[], fin?: string) => ({ content: { role: "model", parts: cParts }, ...(fin ? { finishReason: fin } : {}), index: i, ...(grounding && fin ? { groundingMetadata: { webSearchQueries: [lastUser], groundingChunks: [{ web: { uri: "https://www.fifa.com", title: "fifa.com" } }], searchEntryPoint: { renderedContent: "<div></div>" } } } : {}) });
  const headers = { "server-timing": "gfet4t7; dur=120" };
  if (!stream) return Response.json({ candidates: Array.from({ length: n }, (_, i) => candidate(i, parts, finish)), usageMetadata, modelVersion: model, responseId }, { headers });
  const enc = new TextEncoder();
  const body2 = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (d: Json) => controller.enqueue(enc.encode(`data: ${JSON.stringify(d)}\r\n\r\n`));
      await new Promise((r) => setTimeout(r, 150));
      const textParts = parts.map((x) => (x.text && !x.thought ? x.text : null));
      const chunks: Json[][] = [];
      parts.forEach((x, i) => {
        if (textParts[i]) for (let j = 0; j < x.text.length; j += 20) chunks.push([{ text: x.text.slice(j, j + 20) }]);
        else chunks.push([x]);
      });
      for (let i = 0; i < chunks.length; i++) {
        send({ candidates: [candidate(0, chunks[i], i === chunks.length - 1 ? finish : undefined)], usageMetadata: { ...usageMetadata, candidatesTokenCount: Math.round((candidates * (i + 1)) / chunks.length) }, modelVersion: model, responseId });
        await new Promise((r) => setTimeout(r, p.delayMs));
      }
      controller.close();
    },
  });
  return new Response(body2, { headers: { "Content-Type": "text/event-stream", ...headers } });
}

export function geminiCountTokens(p: Persona, body: Json) {
  const { turns, system } = extract(body);
  return Response.json({ totalTokens: inputTokens(p, `${system}\n${turns.map((t) => t.text).join("\n")}`) - 9 + 3 });
}
