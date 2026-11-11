import { parseCheck } from "@/lib/checker/request";
import { runMulti } from "@/lib/checker/run";
import type { ProgressEvent } from "@/lib/checker/types";
import { redact } from "@/lib/checker/url";


const MAX_ACTIVE = Number(process.env.MAX_CONCURRENT_CHECKS || 4);
let active = 0;

export async function POST(request: Request) {
  let parsed: Awaited<ReturnType<typeof parseCheck>>;
  try {
    parsed = await parseCheck((await request.json()) as Record<string, unknown>, request.headers.get("host"));
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 });
  }
  if (active >= MAX_ACTIVE) {
    return Response.json({ error: "当前检测任务较多，请稍后再试" }, { status: 429 });
  }
  active++;
  const { options, target } = parsed;
  const abort = new AbortController();
  request.signal.addEventListener("abort", () => abort.abort());
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const emit = (event: ProgressEvent) => {
        if (closed) return;
        let line = redact(JSON.stringify(event), options.apiKey);
        if (options.composition.ref) line = redact(line, options.composition.ref.apiKey);
        try {
          controller.enqueue(encoder.encode(line + "\n"));
        } catch {
          closed = true;
        }
      };
      const heartbeat = setInterval(() => emit({ type: "ping" }), 10_000);
      try {
        const report = await runMulti(options, target.fetchBase, target.host, emit, abort.signal);
        emit({ type: "result", report });
      } catch (error) {
        emit({ type: "error", message: (error as Error).message });
      } finally {
        clearInterval(heartbeat);
        active--;
        closed = true;
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
