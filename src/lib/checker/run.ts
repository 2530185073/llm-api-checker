import { callModel } from "./client";
import { buildQuestions, gradeQuestion, summarizeDegradation } from "./degradation";
import { analyzeSamples, buildFingerprintReport, fingerprintChallenges, getDetector } from "./fingerprint";
import { runTokenizerProbe } from "./tokenizer";
import { gradeVisual, VISUAL_INSTRUCTIONS, VISUAL_PRESETS } from "./visual";
import type {
  CallResult,
  CheckOptions,
  CheckReport,
  DegradationReport,
  Endpoint,
  FingerprintReport,
  ProgressEvent,
  Protocol,
  TokenizerSummary,
} from "./types";

const CONCURRENCY = 4;
const VISUAL_LATENCY_MS = 180_000;

function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active >= max) await new Promise<void>((resolve) => queue.push(resolve));
    active++;
    try {
      return await task();
    } finally {
      active--;
      queue.shift()?.();
    }
  };
}

function protocolOrder(model: string): Protocol[] {
  return /claude|anthropic/i.test(model) ? ["messages", "chat", "responses"] : ["chat", "responses", "messages"];
}

const PROTOCOL_NAMES: Record<Protocol, string> = {
  chat: "OpenAI Chat Completions",
  responses: "OpenAI Responses",
  messages: "Anthropic Messages",
};

export async function detectProtocol(
  base: Omit<Endpoint, "protocol">,
  fetchBase: string,
  emit: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<{ protocol: Protocol; attempted: Protocol[] }> {
  const attempted: Protocol[] = [];
  const errors: string[] = [];
  for (const protocol of protocolOrder(base.model)) {
    attempted.push(protocol);
    emit({ type: "step", group: "detect", id: protocol, label: `尝试 ${PROTOCOL_NAMES[protocol]}`, state: "running" });
    const call = await callModel({ ...base, protocol, effort: undefined }, fetchBase, {
      prompt: "Reply with OK.",
      maxTokens: protocol === "messages" ? 16 : undefined,
      timeoutMs: 60_000,
      signal,
    });
    if (call.ok) {
      emit({ type: "step", group: "detect", id: protocol, label: `${PROTOCOL_NAMES[protocol]} 可用`, state: "done", detail: `${call.durationMs} ms` });
      return { protocol, attempted };
    }
    errors.push(`${PROTOCOL_NAMES[protocol]}：${call.error}`);
    emit({ type: "step", group: "detect", id: protocol, label: `${PROTOCOL_NAMES[protocol]} 不可用`, state: "failed", detail: call.error ?? undefined });
    if (call.status === 401 || call.status === 403) break;
  }
  throw new Error(`没有可用的协议。\n${errors.join("\n")}`);
}

const SELF_REPORT_PROMPT =
  "请用一句话回答：你是哪个模型、由哪家公司开发？只回复模型名称和公司，例如“X 模型，由 Y 公司开发”。";

export async function runCheck(
  options: CheckOptions,
  fetchBase: string,
  displayHost: string,
  emit: (event: ProgressEvent) => void,
  signal?: AbortSignal,
): Promise<CheckReport> {
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const base = { baseUrl: options.baseUrl, apiKey: options.apiKey, model: options.model, effort: options.effort || undefined };
  const calls: CallResult[] = [];
  const track = (call: CallResult) => {
    calls.push(call);
    return call;
  };

  if (options.fingerprint) getDetector().catch(() => {});

  let protocol: Protocol;
  let attempted: Protocol[];
  if (options.protocol === "auto") {
    emit({ type: "stage", stage: "detect", message: "正在自动识别接口协议" });
    ({ protocol, attempted } = await detectProtocol(base, fetchBase, emit, signal));
  } else {
    protocol = options.protocol;
    attempted = [protocol];
  }
  const endpoint: Endpoint = { ...base, protocol };
  const run = limiter(CONCURRENCY);
  const send = (prompt: string, extra: { maxTokens?: number; noEffort?: boolean; system?: string; timeoutMs?: number } = {}) =>
    run(() =>
      callModel(extra.noEffort ? { ...endpoint, effort: undefined } : endpoint, fetchBase, {
        prompt,
        system: extra.system,
        maxTokens: extra.maxTokens,
        timeoutMs: extra.timeoutMs,
        signal,
      }),
    ).then(track);

  emit({ type: "stage", stage: "run", message: `使用 ${PROTOCOL_NAMES[protocol]} 开始检测` });

  const fingerprintTask = async (): Promise<FingerprintReport | null> => {
    if (!options.fingerprint) return null;
    const challenges = fingerprintChallenges();
    const sampleTasks = challenges.map(async (challenge, i) => {
      const id = `sample-${i + 1}`;
      emit({ type: "step", group: "fingerprint", id, label: `数字指纹样本 ${i + 1}/3（${challenge.expected_count} 个整数）`, state: "running" });
      const call = await send(challenge.prompt, { maxTokens: protocol === "messages" ? 8192 : undefined });
      emit({
        type: "step",
        group: "fingerprint",
        id,
        label: `数字指纹样本 ${i + 1}/3（${challenge.expected_count} 个整数）`,
        state: call.ok ? "done" : "failed",
        detail: call.ok ? `${call.durationMs} ms` : call.error ?? undefined,
      });
      return call;
    });
    const selfTask = (async () => {
      emit({ type: "step", group: "fingerprint", id: "self", label: "询问模型自报身份", state: "running" });
      const call = await send(SELF_REPORT_PROMPT, { maxTokens: protocol === "messages" ? 256 : undefined });
      emit({ type: "step", group: "fingerprint", id: "self", label: "询问模型自报身份", state: call.ok ? "done" : "failed", detail: call.error ?? undefined });
      return call;
    })();
    const tokenizerTask = (async (): Promise<TokenizerSummary | null> => {
      if (!options.tokenizer) return null;
      emit({ type: "step", group: "tokenizer", id: "tokenizer", label: "分词器探测（差分计数）", state: "running" });
      const summary = await runTokenizerProbe(options.model, (prompt) =>
        send(prompt, { maxTokens: protocol === "messages" ? 16 : undefined, noEffort: protocol === "messages" }),
      );
      emit({
        type: "step",
        group: "tokenizer",
        id: "tokenizer",
        label: "分词器探测（差分计数）",
        state: summary.error ? "failed" : "done",
        detail: summary.error ?? `${summary.probes} 条探针`,
      });
      return summary;
    })();
    const [sampleCalls, selfReport, tokenizer] = await Promise.all([Promise.all(sampleTasks), selfTask, tokenizerTask]);
    let analysisResult: Awaited<ReturnType<typeof analyzeSamples>>;
    try {
      analysisResult = await analyzeSamples(challenges, sampleCalls);
    } catch (error) {
      analysisResult = { analysis: null, error: `参考数据加载失败：${(error as Error).message}` };
    }
    return buildFingerprintReport({
      claimed: options.model,
      challenges,
      calls: sampleCalls,
      analysis: analysisResult.analysis,
      analysisError: analysisResult.error,
      tokenizer,
      selfReport,
    });
  };

  const degradationTask = async (): Promise<DegradationReport | null> => {
    if (!options.degradation) return null;
    const questions = buildQuestions();
    let reasoningSeen = false;
    const presets = VISUAL_PRESETS.filter((p) => options.visualPresets.includes(p.key));
    const visualTasks = presets.map(async (preset) => {
      const id = `visual-${preset.key}`;
      const label = `${preset.name}（HTML/SVG 动画）`;
      emit({ type: "step", group: "degradation", id, label, state: "running" });
      const timeoutMs = options.visualTimeoutMin * 60_000;
      let call = await send(preset.prompt, { system: VISUAL_INSTRUCTIONS, timeoutMs, maxTokens: protocol === "messages" ? 32768 : undefined });
      if (protocol === "messages" && call.status === 400 && /max_tokens/i.test(call.error ?? "")) {
        call = await send(preset.prompt, { system: VISUAL_INSTRUCTIONS, timeoutMs, maxTokens: 8192 });
      }
      reasoningSeen ||= call.reasoningText;
      const graded = gradeVisual(preset, call, options.judgeMode, VISUAL_LATENCY_MS, preset.key === "pelican" ? 2 : 1);
      emit({
        type: "step",
        group: "degradation",
        id,
        label,
        state: graded.status === "normal" ? "done" : "failed",
        detail:
          graded.status === "error" ? graded.error ?? "请求失败" : `自动检查 ${graded.artifact?.autoScore ?? 0} 分 · ${Math.round(call.durationMs / 1000)} 秒`,
      });
      return graded;
    });
    const qaResults = Promise.all(
      questions.map(async (question) => {
        emit({ type: "step", group: "degradation", id: question.id, label: question.name, state: "running" });
        const call = await send(question.prompt, { maxTokens: protocol === "messages" ? 8192 : undefined });
        reasoningSeen ||= call.reasoningText;
        const graded = gradeQuestion(question, call, options.judgeMode);
        emit({
          type: "step",
          group: "degradation",
          id: question.id,
          label: question.name,
          state: graded.status === "normal" ? "done" : "failed",
          detail: graded.status === "error" ? graded.error ?? "请求失败" : graded.status === "normal" ? "通过" : "未通过",
        });
        return graded;
      }),
    );
    const results = [...(await qaResults), ...(await Promise.all(visualTasks))];
    return summarizeDegradation(results, options.judgeMode, { claimed: options.model, effort: options.effort, reasoningSeen });
  };

  const [fingerprint, degradation] = await Promise.all([fingerprintTask(), degradationTask()]);
  if (signal?.aborted) throw new Error("检测已取消");

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    target: { host: displayHost, protocol, model: options.model, effort: options.effort || undefined },
    protocolDetection: { attempted, chosen: protocol, auto: options.protocol === "auto" },
    fingerprint,
    degradation,
    overall: overallScore(fingerprint, degradation),
    totals: {
      requests: calls.length,
      inputTokens: calls.reduce((sum, c) => sum + (c.usage.input ?? 0), 0),
      outputTokens: calls.reduce((sum, c) => sum + (c.usage.output ?? 0), 0),
      durationMs: Date.now() - started,
    },
  };
}

/**
 * Overall = degradation score scaled by how well the fingerprint supports the claim. Unknown parts are
 * left out instead of being counted as failures.
 */
export function overallScore(fp: FingerprintReport | null, dg: DegradationReport | null): CheckReport["overall"] {
  const factor: Record<string, number | null> = { match: 1, unlisted: 0.9, family: 0.75, mismatch: 0.4, unknown: null };
  const fpFactor = fp ? factor[fp.claimStatus] : null;
  const dgScore = dg && dg.verdict !== "inconclusive" ? dg.score : null;
  let score: number | null = null;
  if (dgScore !== null && fpFactor != null) score = Math.round(dgScore * fpFactor);
  else if (dgScore !== null) score = dgScore;
  else if (fpFactor != null) score = Math.round(fpFactor * 100);
  const parts: string[] = [];
  if (fp) parts.push(fp.claimSummary);
  if (dg) parts.push(`降智检测：${dg.verdictText}${dg.score !== null ? `（${dg.score} 分）` : ""}`);
  const level = score === null ? "unknown" : score >= 80 ? "good" : score >= 55 ? "warn" : "bad";
  return { score, level, summary: parts.join("；") || "未执行任何检测" };
}
