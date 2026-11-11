import { generateChallenges, loadDetector, parseNumbers, type Analysis, type Detector } from "lmfpd-sdk";
import type { CallResult, Candidate, ClaimStatus, Evidence, FingerprintReport, FingerprintSample, TokenizerSummary } from "./types";

let detectorPromise: Promise<Detector> | null = null;

export function getDetector(): Promise<Detector> {
  if (!detectorPromise) {
    const source = process.env.LMFPD_DATA_SOURCE;
    const cache = process.env.LMFPD_CACHE || "/tmp/lmfpd/data.bin";
    detectorPromise = loadDetector(source ? { source } : { cache, ttl: 7 * 86400 }).catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

export const fingerprintChallenges = () => generateChallenges(3);

/** Maps vendor ids like `anthropic/claude-sonnet-4-6-20260115` onto reference ids like `claude-sonnet-4.6`. */
export function normalizeModelId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/^.*\//, "")
    .replace(/:.*$/, "")
    .replace(/-(latest|\d{8}|\d{4}-\d{2}-\d{2})$/, "")
    .replace(/(\d)-(\d)(?!\d{2,})/g, "$1.$2");
}

const familyPrefix = (id: string) => normalizeModelId(id).split(/[-.\d]/)[0];

export function compareClaim(
  claimed: string,
  likely: Candidate | null,
  known: { model: string; family: string }[],
): { status: ClaimStatus; summary: string } {
  if (!likely) return { status: "unknown", summary: "数字指纹未能给出排名，无法核对所声称的模型" };
  const claim = normalizeModelId(claimed);
  const exact = known.find((m) => m.model === claim);
  const claimFamily = exact?.family ?? known.find((m) => familyPrefix(m.model) === familyPrefix(claim))?.family ?? null;
  if (likely.model === claim) return { status: "match", summary: `指纹与所声称的 ${claimed} 一致` };
  if (!exact) {
    if (claimFamily && claimFamily === likely.family) {
      return {
        status: "unlisted",
        summary: `参考库未收录 ${claimed}，最接近的是同家族的 ${likely.model}；同家族未收录型号可能就是它`,
      };
    }
    return {
      status: claimFamily ? "mismatch" : "unlisted",
      summary: claimFamily
        ? `参考库未收录 ${claimed}，但指纹最接近其他家族的 ${likely.model}，可疑`
        : `参考库未收录 ${claimed} 所属家族，只能给出最接近的 ${likely.model}`,
    };
  }
  if (claimFamily === likely.family) {
    return { status: "family", summary: `同家族但型号不同：声称 ${claimed}，指纹更像 ${likely.model}（可能被替换为同家族的其他型号）` };
  }
  return { status: "mismatch", summary: `不一致：声称 ${claimed}，指纹最像 ${likely.model}，很可能被替换为其他模型` };
}

const percent = (p: number | null) => (p === null ? "—" : `${(p * 100).toFixed(p > 0.999 || p < 0.001 ? 2 : 1)}%`);

function idStyle(id: string | null): string | null {
  if (!id) return null;
  if (/^chatcmpl-/.test(id)) return "OpenAI Chat 风格（chatcmpl-）";
  if (/^resp_/.test(id)) return "OpenAI Responses 风格（resp_）";
  if (/^msg_/.test(id)) return "Anthropic 风格（msg_）";
  if (/^gen-/.test(id)) return "OpenRouter 风格（gen-）";
  if (/^[0-9a-f-]{36}$/.test(id)) return "UUID（常见于自建或国产网关）";
  return `其他（${id.slice(0, 12)}…）`;
}

export function buildFingerprintReport(input: {
  claimed: string;
  challenges: { expected_count: number }[];
  calls: (CallResult | null)[];
  analysis: Analysis | null;
  analysisError: string | null;
  tokenizer: TokenizerSummary | null;
  selfReport: CallResult | null;
}): FingerprintReport {
  const { claimed, analysis } = input;
  const samples: FingerprintSample[] = input.calls.map((call, index) => ({
    index,
    expected: input.challenges[index].expected_count,
    parsed: call ? parseNumbers(call.text).length : 0,
    ok: !!call && call.ok,
    error: call?.error ?? "未执行",
    durationMs: call?.durationMs ?? 0,
    ttftMs: call?.ttftMs ?? null,
    usage: call?.usage ?? { input: null, output: null, reasoning: null, cached: null },
    responseModel: call?.responseModel ?? null,
  }));
  const candidates: Candidate[] = (analysis?.results ?? []).slice(0, 8).map((r) => ({
    model: r.model,
    family: r.family_name || r.family,
    probability: r.probability,
    score: r.score,
  }));
  const likely = candidates[0] ?? null;
  const known = (analysis?.results ?? []).map((r) => ({ model: r.model, family: r.family_name || r.family }));
  const claim = compareClaim(claimed, likely, known);
  const evidence: Evidence[] = [];

  if (analysis && likely) {
    const top3 = candidates.slice(0, 3).map((c) => `${c.model} ${percent(c.probability)}`).join(" / ");
    evidence.push({
      key: "numeric",
      label: "数字指纹",
      value: top3,
      signal: claim.status === "match" ? "support" : claim.status === "mismatch" || claim.status === "family" ? "against" : "neutral",
      detail: `让模型凭第一反应写约 300 个 1–355 的整数，比较数值分布、位置分段与末位数字特征。${
        analysis.decision === "partial" ? "只有部分回答有效，排名可信度降低，且没有校准置信度。" : "置信度为参考库内的封闭集合概率。"
      }`,
    });
  } else if (analysis?.decision === "not_model") {
    evidence.push({
      key: "numeric",
      label: "数字指纹",
      value: "回答不像语言模型生成",
      signal: "against",
      detail: "相邻数字的自相关和小步长占比不符合语言模型的特征，可能是程序生成或缓存回放的内容。",
    });
  } else {
    evidence.push({
      key: "numeric",
      label: "数字指纹",
      value: "未得到有效排名",
      signal: "neutral",
      detail: input.analysisError ?? "有效回答不足（每条至少需要 80 个 1–355 的整数）",
    });
  }

  if (analysis?.sequence) {
    evidence.push({
      key: "sequence",
      label: "序列形态检查",
      value: analysis.sequence.model_like ? "像语言模型的回答" : "不像语言模型的回答",
      signal: analysis.sequence.model_like ? "neutral" : "against",
      detail: `lag-1 自相关 ${analysis.sequence.autocorrelation.toFixed(3)}，小步长占比 ${(analysis.sequence.small_step_share * 100).toFixed(1)}%`,
    });
  }

  const allCalls = [...input.calls, input.selfReport].filter((c): c is CallResult => !!c && c.status !== null);
  const responseModels = [...new Set(allCalls.map((c) => c.responseModel).filter((m): m is string => !!m))];
  if (responseModels.length) {
    const consistent = responseModels.every((m) => normalizeModelId(m) === normalizeModelId(claimed));
    evidence.push({
      key: "response-model",
      label: "响应 model 字段",
      value: responseModels.join("、"),
      signal: consistent ? "neutral" : "against",
      detail: consistent ? "与所声称的模型一致。该字段可被中转站随意改写，只作弱证据。" : "与请求的模型名不同，渠道存在模型映射或替换。",
    });
  }
  const ids = [...new Set(allCalls.map((c) => idStyle(c.responseId)).filter((v): v is string => !!v))];
  if (ids.length) {
    evidence.push({ key: "id-style", label: "响应 ID 格式", value: ids.join("、"), signal: "neutral", detail: "反映网关或上游的实现方式；中转站转换协议后通常会改写。" });
  }
  const fingerprints = [...new Set(allCalls.map((c) => c.systemFingerprint).filter((v): v is string => !!v))];
  if (fingerprints.length) {
    evidence.push({ key: "system-fingerprint", label: "system_fingerprint", value: fingerprints.slice(0, 3).join("、"), signal: "neutral" });
  }
  const headerHints = [...new Set(allCalls.flatMap((c) => Object.entries(c.headers).map(([k, v]) => `${k}: ${v}`)))].slice(0, 6);
  if (headerHints.length) {
    evidence.push({ key: "headers", label: "响应头线索", value: headerHints.join("；"), signal: "neutral" });
  }

  if (input.tokenizer) {
    const t = input.tokenizer;
    const kindText = t.kind === "exact" ? `完全一致：${t.className}` : t.kind === "related" ? `接近 ${t.className}（未收录的变体）` : "未收录的分词器";
    evidence.push({
      key: "tokenizer",
      label: "分词器探测",
      value: t.error ? `探测失败：${t.error}` : `${kindText}（${percent(t.confidence)}，${t.probes} 条探针）`,
      signal: t.error || !t.claim ? "neutral" : t.claim.status === "consistent" ? "support" : t.claim.status === "inconsistent" ? "against" : "neutral",
      detail: t.error
        ? undefined
        : t.claim
          ? `与所填模型（${t.claim.vendor}）的核对：${
              t.claim.status === "consistent" ? "一致" : t.claim.status === "inconsistent" ? "不一致" : "还不能确定"
            }（${percent(t.claim.probability)}）。${t.baselineDrift ? "两次对照请求计数不同，上游注入了长度会变化的隐藏内容。" : ""}多个模型可能共用同一分词器，中转站也可能本地估算用量。`
          : "所填模型没有已知的分词器映射，无法核对。",
    });
  }

  if (input.selfReport?.ok) {
    evidence.push({
      key: "self-report",
      label: "模型自报身份",
      value: input.selfReport.text.trim().slice(0, 120) || "（空）",
      signal: "neutral",
      detail: "模型的自我介绍很容易被系统提示词改写，只作参考。",
    });
  }

  return {
    claimed,
    decision: analysis?.decision ?? "unscorable",
    likely,
    family: analysis?.family_prediction_name || null,
    candidates,
    claimStatus: claim.status,
    claimSummary: claim.summary,
    confidence: analysis?.probability ?? null,
    samples,
    sequence: analysis?.sequence
      ? {
          autocorrelation: analysis.sequence.autocorrelation,
          smallStepShare: analysis.sequence.small_step_share,
          modelLike: analysis.sequence.model_like,
        }
      : null,
    tokenizer: input.tokenizer,
    selfReport: input.selfReport?.ok ? input.selfReport.text.trim().slice(0, 300) : null,
    evidence,
    error: likely ? null : input.analysisError ?? (analysis ? analysis.evidence.reason : "指纹检测失败"),
  };
}

/** Lenient sampling: keep the first `expected` integers of the longest run. */
export function scoringText(text: string, expected: number): string {
  return parseNumbers(text).slice(0, expected).join(", ");
}

export async function analyzeSamples(
  challenges: { expected_count: number }[],
  calls: (CallResult | null)[],
): Promise<{ analysis: Analysis | null; error: string | null }> {
  const detector = await getDetector();
  const outputs = challenges.flatMap((challenge, i) => {
    const call = calls[i];
    if (!call || !call.text) return [];
    const minimum = Math.max(80, Math.ceil(challenge.expected_count * 0.55));
    const numbers = parseNumbers(call.text);
    if (numbers.length < minimum) return [];
    const text = scoringText(call.text, challenge.expected_count);
    return [{ text, expected_count: challenge.expected_count }];
  });
  if (!outputs.length) return { analysis: null, error: "没有有效的数字指纹回答（请求失败或整数个数不足）" };
  try {
    return { analysis: detector.analyze(outputs), error: null };
  } catch (error) {
    return { analysis: null, error: (error as Error).message };
  }
}
