"use client";

import { ArrowRight, ChevronDown, Table2 } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { CheckReport, MultiReport } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { FLAG_LABEL, compositionTone } from "./composition-view";
import { CLAIM_LABEL, ms, pct, TONE_CLASS, TONE_TEXT, type Tone } from "./format";

const cellTone = (rate: number | null): Tone => (rate === null ? "muted" : rate >= 0.85 ? "good" : rate >= 0.5 ? "warn" : "bad");
const overallTone = (r: CheckReport): Tone => (r.overall.level === "unknown" ? "muted" : r.overall.level);
const levelText = (tone: Tone) => (tone === "good" ? "可信" : tone === "warn" ? "存疑" : tone === "bad" ? "高风险" : "信息不足");

export function ComparisonMatrix({
  report,
  activeModel,
  onPick,
}: {
  report: MultiReport;
  activeModel: string | null;
  onPick: (model: string) => void;
}) {
  const [showTable, setShowTable] = useState(false);
  const reps = report.reports;
  const tests = (() => {
    const out: { id: string; name: string }[] = [];
    for (const r of reps) for (const t of r.degradation?.tests ?? []) if (!out.some((x) => x.id === t.id)) out.push({ id: t.id, name: t.name.replace(/（.*?）$/, "") });
    return out;
  })();

  const row = (label: string, cell: (r: CheckReport) => React.ReactNode, shaded = false) => (
    <tr key={label} className={cn(shaded && "bg-muted/25")}>
      <th className="sticky left-0 z-10 min-w-[6.5rem] whitespace-nowrap bg-card px-3.5 py-2.5 text-left text-sm font-medium text-muted-foreground">{label}</th>
      {reps.map((r) => (
        <td key={r.target.model} className="px-3.5 py-2.5 text-center text-[15px] tabular-nums">
          {cell(r)}
        </td>
      ))}
    </tr>
  );
  const score = (v: number | null | undefined, tone: Tone) => <span className={cn("text-base font-semibold", TONE_TEXT[tone])}>{v ?? "—"}</span>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">检测结果总览（{reps.length} 个模型）</h2>
          <p className="text-sm text-muted-foreground">
            点击任意模型卡片查看完整报告{report.repeat > 1 ? ` · 每题重复 ${report.repeat} 次` : ""}
            {report.errors.length ? ` · ${report.errors.length} 个失败` : ""}
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setShowTable((v) => !v)}>
          <Table2 className="size-4" />
          {showTable ? "收起逐项对比表" : "展开逐项对比表"}
          <ChevronDown className={cn("size-4 transition-transform", showTable && "rotate-180")} />
        </Button>
      </div>

      {/* Prominent Verdict KPI Cards */}
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {reps.map((r) => {
          const tone = overallTone(r);
          const selected = activeModel === r.target.model;
          const claim = r.fingerprint ? CLAIM_LABEL[r.fingerprint.claimStatus] : null;
          const degTone: Tone = r.degradation?.score == null ? "muted" : r.degradation.score >= 85 ? "good" : r.degradation.score >= 60 ? "warn" : "bad";
          const compTone = compositionTone(r.composition);
          return (
            <button
              key={r.target.model}
              type="button"
              onClick={() => onPick(r.target.model)}
              className={cn(
                "group flex flex-col justify-between gap-3 rounded-xl border bg-card p-4 text-left transition-all hover:border-primary/50 hover:shadow-sm",
                selected && "border-primary ring-2 ring-primary/25",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate font-mono text-base font-semibold text-foreground group-hover:text-primary">{r.target.model}</div>
                  {r.fingerprint?.likely ? (
                    <div className="mt-1 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                      <span>指纹</span>
                      <ArrowRight className="size-3.5 shrink-0" />
                      <span className={cn("truncate font-mono font-medium", claim && TONE_TEXT[claim.tone])}>{r.fingerprint.likely.model}</span>
                      {r.fingerprint.confidence !== null && <span className="shrink-0 tabular-nums">({pct(r.fingerprint.confidence)})</span>}
                    </div>
                  ) : (
                    <div className="mt-1 text-[13px] text-muted-foreground">{claim ? `指纹：${claim.text}` : "未检测指纹"}</div>
                  )}
                </div>
                <div className="shrink-0 text-right">
                  <div className={cn("text-3xl font-bold leading-none tabular-nums", TONE_TEXT[tone])}>{r.overall.score ?? "—"}</div>
                  <Badge variant="outline" className={cn("mt-1.5 border text-xs", TONE_CLASS[tone])}>
                    {levelText(tone)}
                  </Badge>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 rounded-lg bg-muted/35 px-2.5 py-2 text-center">
                <div>
                  <div className="text-xs text-muted-foreground">指纹</div>
                  <div className={cn("mt-0.5 text-sm font-semibold", claim ? TONE_TEXT[claim.tone] : "text-muted-foreground")}>{claim?.text ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">成分</div>
                  <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", TONE_TEXT[compTone])}>{r.composition?.score ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">智力</div>
                  <div className={cn("mt-0.5 text-sm font-semibold tabular-nums", TONE_TEXT[degTone])}>{r.degradation?.score ?? "—"}</div>
                </div>
              </div>

              {r.composition?.flags.length ? (
                <div className="flex flex-wrap gap-1">
                  {r.composition.flags.slice(0, 3).map((f) => (
                    <Badge key={f} variant="destructive" className="text-xs">
                      {FLAG_LABEL[f]}
                    </Badge>
                  ))}
                  {r.composition.flags.length > 3 && (
                    <Badge variant="secondary" className="text-xs">
                      +{r.composition.flags.length - 3}
                    </Badge>
                  )}
                </div>
              ) : (
                <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                  <span>{r.composition ? "未检出关键成分问题" : `请求 ${r.totals.requests} 次`}</span>
                  <span className="font-medium text-primary">{selected ? "已展开详情" : "查看详情 →"}</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Expandable Item-by-Item Comparison Table */}
      {showTable && (
        <Card>
          <CardContent className="px-0 sm:px-6">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse">
                <thead>
                  <tr className="border-b">
                    <th className="sticky left-0 z-10 bg-card px-3.5 py-2.5 text-left text-sm font-medium text-muted-foreground">指标</th>
                    {reps.map((r) => (
                      <th key={r.target.model} className="px-3.5 py-2.5 text-center">
                        <button type="button" onClick={() => onPick(r.target.model)} className="font-mono text-sm font-semibold text-primary hover:underline">
                          {r.target.model}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {row("综合评分", (r) => score(r.overall.score, overallTone(r)), true)}
                  {row("指纹判定", (r) =>
                    r.fingerprint ? <span className={cn("text-sm font-medium", TONE_TEXT[CLAIM_LABEL[r.fingerprint.claimStatus].tone])}>{CLAIM_LABEL[r.fingerprint.claimStatus].text}</span> : "—",
                  )}
                  {row("最可能的模型", (r) =>
                    r.fingerprint?.likely ? (
                      <span className="font-mono text-sm">
                        {r.fingerprint.likely.model}
                        {r.fingerprint.confidence !== null ? <span className="block text-[13px] text-muted-foreground">{pct(r.fingerprint.confidence)}</span> : null}
                      </span>
                    ) : (
                      "—"
                    ),
                  )}
                  {row("成分得分", (r) => (r.composition ? score(r.composition.score, compositionTone(r.composition)) : "—"), true)}
                  {row("智力得分", (r) => score(r.degradation?.score, r.degradation?.score == null ? "muted" : r.degradation.score >= 85 ? "good" : r.degradation.score >= 60 ? "warn" : "bad"), true)}
                  {row("平均首字", (r) => <span className="text-sm">{ms(r.degradation?.stats.avgTtftMs)}</span>)}
                  {row("平均耗时", (r) => <span className="text-sm">{ms(r.degradation?.stats.avgDurationMs)}</span>)}
                  {row("请求数", (r) => <span className="text-sm">{r.totals.requests}</span>)}
                  {tests.length > 0 && (
                    <tr>
                      <th colSpan={reps.length + 1} className="sticky left-0 bg-muted/40 px-3.5 py-2 text-left text-sm font-medium">
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
                        <span className="text-sm">
                          <span className={cn("font-semibold", TONE_TEXT[cellTone(rate)])}>{rate === null ? "失败" : `${Math.round(rate * 100)}%`}</span>
                          <span className="block text-[13px] text-muted-foreground">
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
      )}
    </div>
  );
}
