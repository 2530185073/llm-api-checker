import { answer, inputTokens, outputTokens, PERSONAS, personaFor } from "@/lib/mock/upstream";


type Json = Record<string, unknown>;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const rid = () => Math.random().toString(36).slice(2, 14);

function authorized(request: Request): boolean {
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  return !!(bearer || request.headers.get("x-api-key")?.trim());
}

function unauthorized() {
  return Response.json({ error: { message: "缺少 API Key（演示端点接受任意非空 Key）", type: "invalid_request_error" } }, { status: 401 });
}

function promptOf(body: Json): string {
  const flatten = (content: unknown): string =>
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((part) => (typeof part === "string" ? part : String((part as Json).text ?? ""))).join("")
        : "";
  const messages = (body.messages ?? body.input) as unknown;
  if (typeof messages === "string") return messages;
  if (!Array.isArray(messages)) return "";
  return messages.map((m) => flatten((m as Json).content)).join("\n");
}

function chunks(text: string, size = 24): string[] {
  const parts: string[] = [];
  for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
  return parts.length ? parts : [""];
}

export async function GET(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.join("/") !== "models") return Response.json({ error: { message: "not found" } }, { status: 404 });
  if (!authorized(request)) return unauthorized();
  return Response.json({
    object: "list",
    data: PERSONAS.map((p) => ({ id: p.id, object: "model", created: 1767225600, owned_by: p.ownedBy })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  const route = path.join("/");
  if (!["chat/completions", "responses", "messages"].includes(route)) {
    return Response.json({ error: { message: "not found" } }, { status: 404 });
  }
  if (!authorized(request)) return unauthorized();
  const body = (await request.json().catch(() => ({}))) as Json;
  const model = String(body.model ?? "");
  if (!model) return Response.json({ error: { message: "model is required" } }, { status: 400 });
  if (route === "messages" && !body.max_tokens) {
    return Response.json({ type: "error", error: { type: "invalid_request_error", message: "max_tokens: Field required" } }, { status: 400 });
  }
  const persona = personaFor(model);
  const prompt = promptOf(body);
  const text = answer(persona, prompt);
  const usageIn = inputTokens(persona, prompt);
  const usageOut = outputTokens(text);
  const wantsReasoning = !!(body.reasoning_effort || body.reasoning || body.output_config);
  const reasoning = persona.reasoning && wantsReasoning ? 64 + Math.floor(prompt.length / 8) : 0;
  const stream = body.stream === true;
  const ttft = 250 + Math.floor(Math.random() * 250) + (persona.smart ? 0 : 400);

  if (!stream) {
    await sleep(ttft + text.length * 0.3);
    if (route === "chat/completions") {
      return Response.json({
        id: `chatcmpl-${rid()}`,
        object: "chat.completion",
        model,
        system_fingerprint: "fp_demo",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: usageIn, completion_tokens: usageOut + reasoning, completion_tokens_details: { reasoning_tokens: reasoning } },
      });
    }
    if (route === "responses") {
      return Response.json({
        id: `resp_${rid()}`,
        object: "response",
        status: "completed",
        model,
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
        usage: { input_tokens: usageIn, output_tokens: usageOut + reasoning, output_tokens_details: { reasoning_tokens: reasoning } },
      });
    }
    return Response.json({
      id: `msg_${rid()}`,
      type: "message",
      role: "assistant",
      model,
      content: [{ type: "text", text }],
      stop_reason: "end_turn",
      usage: { input_tokens: usageIn, output_tokens: usageOut + reasoning },
    });
  }

  const encoder = new TextEncoder();
  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: Json | string, event?: string) => {
        const payload = typeof data === "string" ? data : JSON.stringify(data);
        controller.enqueue(encoder.encode(`${event ? `event: ${event}\n` : ""}data: ${payload}\n\n`));
      };
      const id = rid();
      const created = Math.floor(Date.now() / 1000);
      if (route === "messages") {
        send({ type: "message_start", message: { id: `msg_${id}`, type: "message", role: "assistant", model, content: [], usage: { input_tokens: usageIn, output_tokens: 1 } } }, "message_start");
        send({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }, "content_block_start");
      } else if (route === "responses") {
        send({ type: "response.created", response: { id: `resp_${id}`, model, status: "in_progress" } }, "response.created");
      }
      await sleep(ttft);
      for (const piece of chunks(text)) {
        if (route === "chat/completions") {
          send({ id: `chatcmpl-${id}`, object: "chat.completion.chunk", created, model, system_fingerprint: "fp_demo", choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] });
        } else if (route === "responses") {
          send({ type: "response.output_text.delta", delta: piece }, "response.output_text.delta");
        } else {
          send({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } }, "content_block_delta");
        }
        await sleep(persona.delayMs);
      }
      if (route === "chat/completions") {
        send({ id: `chatcmpl-${id}`, object: "chat.completion.chunk", created, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
        send({
          id: `chatcmpl-${id}`,
          object: "chat.completion.chunk",
          created,
          model,
          choices: [],
          usage: { prompt_tokens: usageIn, completion_tokens: usageOut + reasoning, total_tokens: usageIn + usageOut + reasoning, completion_tokens_details: { reasoning_tokens: reasoning } },
        });
        send("[DONE]");
      } else if (route === "responses") {
        send(
          {
            type: "response.completed",
            response: {
              id: `resp_${id}`,
              model,
              status: "completed",
              usage: { input_tokens: usageIn, output_tokens: usageOut + reasoning, output_tokens_details: { reasoning_tokens: reasoning } },
            },
          },
          "response.completed",
        );
      } else {
        send({ type: "content_block_stop", index: 0 }, "content_block_stop");
        send({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: usageOut + reasoning } }, "message_delta");
        send({ type: "message_stop" }, "message_stop");
      }
      controller.close();
    },
  });
  return new Response(readable, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
