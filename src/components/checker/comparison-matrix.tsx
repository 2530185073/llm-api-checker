"use client";

import { Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CheckReport, MultiReport } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { FLAG_LABEL, compositionTone } from "./composition-view";
import { CLAIM_LABEL, ms, pct, TONE_TEXT, type Tone } from "./format";

const cellTone = (rate: number | null): Tone => (rate === null ? "muted" : rate >= 0.85 ? "good" : rate >= 0.5 ? "warn" : "bad");

export function ComparisonMatrix({ report, onPick }: { report: MultiReport; onPick: (model: string) => void }) {
  const reps = report.reports;
  const tests = (() => {
    const out: { id: string; name: string }[] = [];
    for (const r of reps) for (const t of r.degradation?.tests ?? []) if (!out.some((x) => x.id === t.id)) out.push({ id: t.id, name: t.name.replace(/（.*?）$/, "") });
    return out;
  })();
  const row = (label: string, cell: (r: CheckReport) => React.ReactNode, sticky = false) => (
    <tr key={label} className={cn(sticky && "bg-muted/20")}>
      <th className="sticky left-0 z-10 min-w-[5.5rem] whitespace-nowrap bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">{label}</th>
      {reps.map((r) => (
        <td key={r.target.model} className="px-3 py-2 text-center text-sm tabular-nums">
          {cell(r)}
        </td>
      ))}
    </tr>
  );
  const score = (v: number | null | undefined, tone: Tone) => <span className={cn("font-semibold", TONE_TEXT[tone])}>{v ?? "—"}</span>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="size-5 text-primary" /> 多模型对比
        </CardTitle>
        <CardDescription>
          {reps.length} 个模型{report.repeat > 1 ? `，每题重复 ${report.repeat} 次` : ""}。点击模型名查看详细报告。
          {report.errors.length ? ` ${report.errors.length} 个模型检测失败：${report.errors.map((e) => `${e.model}（${e.message.slice(0, 40)}）`).join("、")}` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="px-0 sm:px-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse">
            <thead>
              <tr className="border-b">
                <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-xs font-medium text-muted-foreground">指标</th>
                {reps.map((r) => (
                  <th key={r.target.model} className="px-3 py-2 text-center">
                    <button type="button" onClick={() => onPick(r.target.model)} className="font-mono text-xs font-semibold text-primary hover:underline">
                      {r.target.model}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {row("综合评分", (r) => score(r.overall.score, r.overall.level === "unknown" ? "muted" : r.overall.level), true)}
              {row("指纹判定", (r) =>
                r.fingerprint ? <span className={cn("text-xs", TONE_TEXT[CLAIM_LABEL[r.fingerprint.claimStatus].tone])}>{CLAIM_LABEL[r.fingerprint.claimStatus].text}</span> : "—",
              )}
              {row("最可能的模型", (r) =>
                r.fingerprint?.likely ? (
                  <span className="font-mono text-xs">
                    {r.fingerprint.likely.model}
                    {r.fingerprint.confidence !== null ? <span className="block text-muted-foreground">{pct(r.fingerprint.confidence)}</span> : null}
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
                      <Badge key={f} variant="destructive" className="text-[10px]">
                        {FLAG_LABEL[f]}
                      </Badge>
                    ))}
                  </span>
                ) : r.composition ? (
                  <span className="text-xs text-emerald-600">无</span>
                ) : (
                  "—"
                ),
              )}
              {row("智力得分", (r) => score(r.degradation?.score, r.degradation?.score == null ? "muted" : r.degradation.score >= 85 ? "good" : r.degradation.score >= 60 ? "warn" : "bad"), true)}
              {row("平均首字", (r) => <span className="text-xs">{ms(r.degradation?.stats.avgTtftMs)}</span>)}
              {row("平均耗时", (r) => <span className="text-xs">{ms(r.degradation?.stats.avgDurationMs)}</span>)}
              {row("请求数", (r) => <span className="text-xs">{r.totals.requests}</span>)}
              {tests.length > 0 && (
                <tr>
                  <th colSpan={reps.length + 1} className="sticky left-0 bg-muted/40 px-3 py-1.5 text-left text-xs font-medium">
                    逐题通过率 · 平均耗时 / P95
                  </th>
                </tr>
              )}
              {tests.map((t) =>
                row(t.name, (r) => {
                  const x = r.degradation?.tests.find((y) => y.id === t.id);
                  if (!x) return "—";
                  const rate = x.stats?.passRate ?? (x.status === "normal" ? 1 : x.status === "error" ? null : 0);
                  return (
                    <span className="text-xs">
                      <span className={cn("font-semibold", TONE_TEXT[cellTone(rate)])}>{rate === null ? "失败" : `${Math.round(rate * 100)}%`}</span>
                      <span className="block text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}
