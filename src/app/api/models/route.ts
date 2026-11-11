import { listModels } from "@/lib/checker/client";
import { parseTarget } from "@/lib/checker/request";
import { redact } from "@/lib/checker/url";


export async function POST(request: Request) {
  let apiKey = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const target = await parseTarget(body, request.headers.get("host"));
    apiKey = target.apiKey;
    const models = await listModels(target.fetchBase, target.apiKey);
    return Response.json({ models });
  } catch (error) {
    return Response.json({ error: redact((error as Error).message, apiKey) }, { status: 400 });
  }
}
