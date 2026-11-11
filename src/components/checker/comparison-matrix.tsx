"use client";

import { ArrowUpRight, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { CheckReport, MultiReport } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { FLAG_LABEL, compositionTone } from "./composition-view";
import { CLAIM_LABEL, ms, pct, TONE_TEXT, type Tone } from "./format";
import { SectionCard, ToneBadge } from "./parts";

const cellTone = (rate: number | null): Tone => (rate === null ? "muted" : rate >= 0.85 ? "good" : rate >= 0.5 ? "warn" : "bad");

export function ComparisonMatrix({ report, onPick }: { report: MultiReport; onPick: (model: string) => void }) {
  const reps = report.reports;
  const tests = (() => {
    const out: { id: string; name: string }[] = [];
    for (const r of reps) for (const t of r.degradation?.tests ?? []) if (!out.some((x) => x.id === t.id)) out.push({ id: t.id, name: t.name.replace(/（.*?）$/, "") });
    return out;
  })();
  const row = (label: string, cell: (r: CheckReport) => React.ReactNode, strong = false) => (
    <tr key={label} className="group/row">
      <th
        className={cn(
          "sticky left-0 z-10 min-w-[6.5rem] bg-card py-2.5 pr-3 pl-5 text-left text-sm whitespace-nowrap transition-colors group-hover/row:bg-surface-1 sm:pl-6",
          strong ? "font-medium text-foreground" : "font-normal text-fg-2",
        )}
      >
        {label}
      </th>
      {reps.map((r) => (
        <td key={r.target.model} className="px-3 py-2.5 text-center text-[15px] tabular-nums transition-colors group-hover/row:bg-fill-1">
          {cell(r)}
        </td>
      ))}
    </tr>
  );
  const score = (v: number | null | undefined, tone: Tone) => <span className={cn("text-[20px] leading-6 font-medium tracking-[-0.02em]", TONE_TEXT[tone])}>{v ?? "—"}</span>;
  return (
    <SectionCard
      icon={Table2}
      title="多模型对比"
      description={
        <>
          {reps.length} 个模型{report.repeat > 1 ? `，每题重复 ${report.repeat} 次` : ""}。点击模型名查看详细报告。
          {report.errors.length ? ` ${report.errors.length} 个模型检测失败：${report.errors.map((e) => `${e.model}（${e.message.slice(0, 40)}）`).join("、")}` : ""}
        </>
      }
    >
      <div className="-mx-5 -mb-5 overflow-hidden rounded-b-2xl sm:-mx-6 sm:-mb-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-y border-line-1">
                <th className="sticky left-0 z-10 bg-surface-1 py-2.5 pr-3 pl-5 text-left text-sm font-medium text-fg-3 sm:pl-6">指标</th>
                {reps.map((r) => (
                  <th key={r.target.model} className="bg-surface-1 px-3 py-2.5 text-center">
                    <button
                      type="button"
                      onClick={() => onPick(r.target.model)}
                      className="inline-flex items-center gap-1 rounded-full bg-background py-1 pr-2 pl-2.5 font-mono text-sm font-medium whitespace-nowrap shadow-raised transition-colors hover:bg-fill-2"
                    >
                      {r.target.model}
                      <ArrowUpRight className="size-3 text-fg-3" />
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line-1">
              {row("综合评分", (r) => score(r.overall.score, r.overall.level === "unknown" ? "muted" : r.overall.level), true)}
              {row("指纹判定", (r) =>
                r.fingerprint ? (
                  <ToneBadge tone={CLAIM_LABEL[r.fingerprint.claimStatus].tone} className="mx-auto">
                    {CLAIM_LABEL[r.fingerprint.claimStatus].text}
                  </ToneBadge>
                ) : (
                  "—"
                ),
              )}
              {row("最可能的模型", (r) =>
                r.fingerprint?.likely ? (
                  <span className="font-mono text-sm">
                    {r.fingerprint.likely.model}
                    {r.fingerprint.confidence !== null ? <span className="block text-fg-3">{pct(r.fingerprint.confidence)}</span> : null}
                  </span>
                ) : (
                  "—"
                ),
              )}
              {row("成分得分", (r) => (r.composition ? score(r.composition.score, compositionTone(r.composition)) : "—"), true)}
              {row("成分关键问题", (r) =>
                r.composition?.flags.length ? (
                  <span className="flex flex-wrap justify-center gap-1">
                    {r.composition.flags.slice(0, 4).map((f) => (
                      <Badge key={f} variant="destructive" className="text-[13px]">
                        {FLAG_LABEL[f]}
                      </Badge>
                    ))}
                  </span>
                ) : r.composition ? (
                  <span className="text-sm text-success">无</span>
                ) : (
                  "—"
                ),
              )}
              {row("智力得分", (r) => score(r.degradation?.score, r.degradation?.score == null ? "muted" : r.degradation.score >= 85 ? "good" : r.degradation.score >= 60 ? "warn" : "bad"), true)}
              {row("平均首字", (r) => (
                <span className="text-sm text-fg-2">{ms(r.degradation?.stats.avgTtftMs)}</span>
              ))}
              {row("平均耗时", (r) => (
                <span className="text-sm text-fg-2">{ms(r.degradation?.stats.avgDurationMs)}</span>
              ))}
              {row("请求数", (r) => (
                <span className="text-sm text-fg-2">{r.totals.requests}</span>
              ))}
              {tests.length > 0 && (
                <tr>
                  <th colSpan={reps.length + 1} className="bg-surface-1 py-2 pr-3 pl-5 text-left text-sm font-medium text-fg-3 sm:pl-6">
                    <span className="sticky left-5 sm:left-6">逐题通过率 · 平均耗时 / P95</span>
                  </th>
                </tr>
              )}
              {tests.map((t) =>
                row(t.name, (r) => {
                  const x = r.degradation?.tests.find((y) => y.id === t.id);
                  if (!x) return "—";
                  const rate = x.stats?.passRate ?? (x.status === "normal" ? 1 : x.status === "error" ? null : 0);
                  return (
                    <span className="text-sm">
                      <span className={cn("font-medium", TONE_TEXT[cellTone(rate)])}>{rate === null ? "失败" : `${Math.round(rate * 100)}%`}</span>
                      <span className="block text-fg-3">
                        {ms(x.stats?.meanMs ?? x.durationMs)}
                        {x.stats && x.stats.runs > 1 ? ` / ${ms(x.stats.p95Ms)}` : ""}
                      </span>
                    </span>
                  );
                }),
              )}
            </tbody>
          </table>
        </div>
      </div>
    </SectionCard>
  );
}
