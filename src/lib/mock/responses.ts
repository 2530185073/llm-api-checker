import { randomBytes } from "node:crypto";
import { openaiFacts } from "../composition/facts";
import { err, planTool } from "./chat";
import { answer, inputTokens, outputTokens, type Persona, weatherReply } from "./upstream";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const store = new Map<string, Json>();

export async function handleResponses(p: Persona, body: Json): Promise<Response> {
  if (p.vendor === "openai" && p.honest && "verbosity" in body) return err(400, { error: { message: "Unsupported parameter: 'verbosity'. In the Responses API, this parameter has moved to 'text.verbosity'.", type: "invalid_request_error", param: "verbosity", code: "unsupported_parameter" } });
  if (p.vendor === "openai" && body.reasoning?.effort && !openaiFacts(p.id).efforts.includes(body.reasoning.effort)) return err(400, { error: { message: "Unsupported reasoning effort", type: "invalid_request_error" } });
  const created = Math.floor(Date.now() / 1000);
  const id = `resp_${randomBytes(9).toString("hex").slice(0, 17)}${created.toString(16).padStart(8, "0")}${randomBytes(13).toString("hex").slice(0, 25)}`;
  const prev = body.previous_response_id ? store.get(body.previous_response_id) : null;
  if (body.previous_response_id && !prev) return err(400, { error: { message: "Previous response not found.", type: "invalid_request_error" } });
  const items: Json[] = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input ?? [];
  const toolOut = items.find((i) => i.type === "function_call_output");
  const userText = items.map((i) => (typeof i.content === "string" ? i.content : Array.isArray(i.content) ? i.content.map((c: Json) => c.text ?? "").join("") : "")).join("\n") || (prev?.userText ?? "");
  const output: Json[] = [];
  const tools: Json[] = body.tools ?? [];
  if (toolOut) output.push({ type: "message", id: `msg_${randomBytes(8).toString("hex")}`, role: "assistant", status: "completed", content: [{ type: "output_text", text: weatherReply(toolOut.output), annotations: [] }] });
  else if (tools.some((t) => t.type === "web_search")) {
    output.push({ type: "web_search_call", id: `ws_${randomBytes(8).toString("hex")}`, status: "completed" });
    output.push({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: answer(p, [{ role: "user", text: userText }], "", { images: [], pdfs: [], urlImages: [] }).text, annotations: [{ type: "url_citation", url: "https://www.nobelprize.org", title: "Nobel Prize" }] }] });
  } else {
    const plan = planTool(tools.filter((t) => t.type === "function").map((t) => ({ function: { name: t.name } })), body.tool_choice, userText, userText);
    if (plan) output.push({ type: "function_call", id: `fc_${randomBytes(8).toString("hex")}`, call_id: `call_${randomBytes(12).toString("base64url").replace(/[-_]/g, "a").slice(0, 24)}`, name: plan.name, arguments: JSON.stringify(plan.args), status: "completed" });
    else {
      let text = answer(p, [{ role: "user", text: userText }], String(body.instructions ?? ""), { images: [], pdfs: [], urlImages: [] }).text;
      if (body.max_output_tokens && outputTokens(text) > body.max_output_tokens) text = text.slice(0, body.max_output_tokens * 4);
      output.push({ type: "message", id: `msg_${randomBytes(8).toString("hex")}`, role: "assistant", status: "completed", phase: "final_answer", content: [{ type: "output_text", text, annotations: [] }] });
    }
  }
  const outText = JSON.stringify(output);
  const usage = {
    input_tokens: inputTokens(p, userText + String(body.instructions ?? "")),
    input_tokens_details: { cached_tokens: 0 },
    output_tokens: outputTokens(outText.slice(0, 2000)),
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 0,
  };
  usage.total_tokens = usage.input_tokens + usage.output_tokens;
  const res = { id, object: "response", created_at: created, status: "completed", model: body.model, output, usage, userText };
  store.set(id, res);
  if (store.size > 2000) store.delete(store.keys().next().value!);
  const { userText: _u, ...publicRes } = res;
  void _u;
  if (!body.stream) return Response.json(publicRes);
  const enc = new TextEncoder();
  const text = output.find((o) => o.type === "message")?.content?.[0]?.text ?? "";
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: Json) => controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify({ type: event, ...data })}\n\n`));
      send("response.created", { response: { ...publicRes, status: "in_progress", output: [] } });
      await new Promise((r) => setTimeout(r, 150));
      for (let i = 0; i < text.length; i += 16) send("response.output_text.delta", { delta: text.slice(i, i + 16) });
      send("response.completed", { response: publicRes });
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream" } });
}
