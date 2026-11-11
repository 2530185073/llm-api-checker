import bankJson from "@/data/tokenizer_bank.json";
import { assertTokenizerBank, wrapProbe, type TokenizerBank } from "../vendor/tokenizer/tokenizer-bank";
import {
  nextProbes,
  probingDone,
  tokenizerPosterior,
  tokenizerVerdict,
  type TokenizerObservation,
} from "../vendor/tokenizer/tokenizer-posterior";
import type { CallResult, TokenizerSummary } from "./types";

const bank = bankJson as unknown as TokenizerBank;
assertTokenizerBank(bank);

export const tokenizerBank = bank;
export const MAX_TOKENIZER_PROBES = 12;
const BATCH = 4;

/**
 * Differential counting: each probe is `prefix + text + suffix`, and the baseline is
 * `prefix + suffix`, so hidden chat templates and system prompts cancel out of `x_j - x_0`.
 */
export async function runTokenizerProbe(
  claimed: string,
  send: (prompt: string, label: string) => Promise<CallResult>,
): Promise<TokenizerSummary> {
  const observations: TokenizerObservation[] = [];
  const empty = (error: string): TokenizerSummary => ({
    kind: "unknown",
    className: "",
    lab: "",
    confidence: 0,
    probes: 0,
    claim: null,
    baselineDrift: false,
    error,
  });
  const baseline = await send(wrapProbe(bank, ""), "对照请求");
  if (!baseline.ok) return empty(baseline.error ?? "对照请求失败");
  if (baseline.usage.input === null) return empty("接口没有在 usage 中返回输入 token 数");
  observations.push({ probe: null, tokens: baseline.usage.input });

  const asked = new Set<string>();
  let posterior = tokenizerPosterior(bank, observations);
  while (asked.size < MAX_TOKENIZER_PROBES && !(posterior && probingDone(posterior, MAX_TOKENIZER_PROBES))) {
    const ids = nextProbes(bank, posterior, asked, Math.min(BATCH, MAX_TOKENIZER_PROBES - asked.size));
    if (!ids.length) break;
    ids.forEach((id) => asked.add(id));
    const results = await Promise.all(
      ids.map(async (id) => {
        const probe = bank.probes.find((p) => p.id === id)!;
        return { id, call: await send(wrapProbe(bank, probe.text), `探针 ${id}`) };
      }),
    );
    for (const { id, call } of results) {
      if (call.ok && call.usage.input !== null) observations.push({ probe: id, tokens: call.usage.input });
    }
    if (results.every((r) => !r.call.ok)) return empty(results[0].call.error ?? "探针请求全部失败");
    posterior = tokenizerPosterior(bank, observations);
  }

  const second = await send(wrapProbe(bank, ""), "复核对照请求");
  const baselineDrift = second.ok && second.usage.input !== null && second.usage.input !== baseline.usage.input;
  if (second.ok && second.usage.input !== null) observations.push({ probe: null, tokens: second.usage.input });
  posterior = tokenizerPosterior(bank, observations);
  if (!posterior) return empty("没有可用的计数");
  const verdict = tokenizerVerdict(bank, posterior, claimed);
  const cls = bank.classes.find((c) => c.id === verdict.top.id);
  return {
    kind: verdict.kind,
    className: cls ? `${cls.series_zh}（${cls.lab_name}）` : verdict.top.id,
    classId: verdict.top.id,
    lab: cls?.lab_name ?? "",
    confidence: verdict.confidence,
    probes: observations.filter((o) => o.probe !== null).length,
    claim: verdict.claim ? { status: verdict.claim.status, probability: verdict.claim.probability, vendor: verdict.claim.vendor } : null,
    baselineDrift,
  };
}
