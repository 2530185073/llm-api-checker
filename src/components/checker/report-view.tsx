"use client";

import {
  ArrowRight,
  Brain,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  Download,
  Fingerprint,
  Gauge,
  Layers,
  Receipt,
  Timer,
  Zap,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CheckReport, DegradationReport, DegradationTestResult, Evidence, FingerprintReport } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { CompositionCard, compositionTone } from "./composition-view";
import { CLAIM_LABEL, ms, pct, PROTOCOL_LABEL, TEST_LABEL, TONE_CLASS, TONE_TEXT, tokens, VERDICT_LABEL, type Tone } from "./format";
import { ScoreRing } from "./score-ring";
import { VisualPreview } from "./visual-preview";

type TabKey = "fingerprint" | "composition" | "degradation";

function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border", TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3.5">
      <div className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
        <Icon className="size-4" />
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ReportView({ report }: { report: CheckReport }) {
  const billSummary = report.composition?.cases.find((r) => r.id === "bill_summary" && r.status !== "skip") ?? null;
  const defaultTab: TabKey =
    report.composition && (report.composition.flags.length > 0 || billSummary)
      ? "composition"
      : report.fingerprint
        ? "fingerprint"
        : report.composition
          ? "composition"
          : "degradation";
  const [tab, setTab] = useState<TabKey>(defaultTab);
  const tone: Tone = report.overall.level === "unknown" ? "muted" : report.overall.level;
  const claim = report.fingerprint ? CLAIM_LABEL[report.fingerprint.claimStatus] : null;
  const compTone = compositionTone(report.composition);
  const dgTone: Tone = report.degradation ? VERDICT_LABEL[report.degradation.verdict].tone : "muted";

  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `llm-check-${report.target.model}-${report.startedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-4">
      {/* Hero Verdict + 3 Interactive KPI Switcher Tiles */}
      <Card>
        <CardContent className="space-y-5">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <ScoreRing score={report.overall.score} tone={tone} label="综合评分" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-mono text-xl font-bold">{report.target.model}</h2>
                <ToneBadge tone={tone} className="text-sm">
                  {tone === "good" ? "可信" : tone === "warn" ? "存疑" : tone === "bad" ? "高风险" : "信息不足"}
                </ToneBadge>
              </div>
              <p className="text-[15px] leading-relaxed text-foreground/85">{report.overall.summary}</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
                <span>目标：{report.target.host}</span>
                <span>
                  协议：{PROTOCOL_LABEL[report.target.protocol]}（
                  {{ explicit: "显式选择", url: "按 URL 推断", auto: "自动识别" }[report.protocolDetection.source ?? (report.protocolDetection.auto ? "auto" : "explicit")]}
                  {report.protocolDetection.locked ? "，已锁定" : ""}）
                </span>
                {report.target.effort && <span>推理强度：{report.target.effort}</span>}
                <span>
                  {report.totals.requests} 次请求 · {tokens(report.totals.inputTokens + report.totals.outputTokens)} tokens · {ms(report.totals.durationMs)}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={download} className="self-start">
              <Download className="size-4" /> 导出 JSON
            </Button>
          </div>

          {billSummary && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Receipt className="size-4 shrink-0 text-primary" />
                {billSummary.summary}
              </span>
              {tab !== "composition" && (
                <button type="button" onClick={() => setTab("composition")} className="text-[13px] font-medium text-primary hover:underline">
                  查看计费明细 →
                </button>
              )}
            </div>
          )}

          {/* 3 Sub-Score KPI Cards acting as Section Tabs */}
          <div className="space-y-1.5">
            <div className="text-[13px] text-muted-foreground">点击下方卡片切换各模块详细报告：</div>
            <div className="grid gap-2.5 sm:grid-cols-3" role="tablist" aria-label="报告分项切换">
              {report.fingerprint && claim && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "fingerprint"}
                  onClick={() => setTab("fingerprint")}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 text-left transition-all",
                    tab === "fingerprint" ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "bg-muted/20 hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Fingerprint className="size-4 text-primary" /> 模型指纹
                    </span>
                    <span className={cn("font-semibold", TONE_TEXT[claim.tone])}>{claim.text}</span>
                  </div>
                  <div className={cn("truncate font-mono text-base font-semibold", TONE_TEXT[claim.tone])}>{report.fingerprint.likely?.model ?? "未识别"}</div>
                  <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                    <span>{report.fingerprint.confidence !== null ? `置信度 ${pct(report.fingerprint.confidence)}` : "参考库未校准"}</span>
                    <span className={cn("font-medium", tab === "fingerprint" ? "text-primary" : "text-muted-foreground")}>{tab === "fingerprint" ? "当前展开" : "查看详情 →"}</span>
                  </div>
                </button>
              )}

              {report.composition && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "composition"}
                  onClick={() => setTab("composition")}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 text-left transition-all",
                    tab === "composition" ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "bg-muted/20 hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Layers className="size-4 text-primary" /> 渠道成分{billSummary ? " · 含计费" : ""}
                    </span>
                    <span className={cn("font-semibold", TONE_TEXT[compTone])}>
                      {report.composition.flags.length ? `${report.composition.flags.length} 项关键问题` : "无关键问题"}
                    </span>
                  </div>
                  <div className={cn("text-2xl font-bold leading-tight tabular-nums", TONE_TEXT[compTone])}>
                    {report.composition.score ?? "—"} <span className="text-sm font-normal text-muted-foreground">/ 100</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                    <span>
                      通过 {report.composition.passed} · 警告 {report.composition.warned} · 失败 {report.composition.failed}
                    </span>
                    <span className={cn("font-medium", tab === "composition" ? "text-primary" : "text-muted-foreground")}>{tab === "composition" ? "当前展开" : "查看详情 →"}</span>
                  </div>
                </button>
              )}

              {report.degradation && (
                <button
                  type="button"
                  role="tab"
                  aria-selected={tab === "degradation"}
                  onClick={() => setTab("degradation")}
                  className={cn(
                    "flex cursor-pointer flex-col gap-1 rounded-xl border p-3.5 text-left transition-all",
                    tab === "degradation" ? "border-primary bg-primary/5 ring-2 ring-primary/25" : "bg-muted/20 hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <div className="flex items-center justify-between text-[13px] font-medium text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      <Brain className="size-4 text-primary" /> 降智与动画
                    </span>
                    <span className={cn("font-semibold", TONE_TEXT[dgTone])}>{VERDICT_LABEL[report.degradation.verdict].text}</span>
                  </div>
                  <div className={cn("text-2xl font-bold leading-tight tabular-nums", TONE_TEXT[dgTone])}>
                    {report.degradation.score ?? "—"} <span className="text-sm font-normal text-muted-foreground">/ 100</span>
                  </div>
                  <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                    <span>
                      通过 {report.degradation.passed}/{report.degradation.passed + report.degradation.failed} · 首字 {ms(report.degradation.stats.avgTtftMs)}
                    </span>
                    <span className={cn("font-medium", tab === "degradation" ? "text-primary" : "text-muted-foreground")}>{tab === "degradation" ? "当前展开" : "查看详情 →"}</span>
                  </div>
                </button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Active Detail Tab */}
      {tab === "fingerprint" && report.fingerprint && <FingerprintCard fp={report.fingerprint} />}
      {tab === "composition" && report.composition && <CompositionCard c={report.composition} />}
      {tab === "degradation" && report.degradation && <DegradationCard dg={report.degradation} />}

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        综合评分 = 降智得分 × 指纹系数（一致 1.0、未收录 0.9、同家族 0.75、不一致 0.4），启用成分检测时再与成分得分按 6 : 4 加权（检出关键问题时成分得分按不超过 40 计）。
      </p>
    </div>
  );
}

function SignalIcon({ signal }: { signal: Evidence["signal"] }) {
  if (signal === "support") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  if (signal === "against") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />;
  return <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((e) => (
        <li key={e.key} className="flex gap-3 p-3.5">
          <SignalIcon signal={e.signal} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="text-[15px] font-medium">{e.label}</span>
              <span className="break-all text-[15px] text-foreground/85 sm:text-right">{e.value}</span>
            </div>
            {e.detail && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function FingerprintCard({ fp }: { fp: FingerprintReport }) {
  const claim = CLAIM_LABEL[fp.claimStatus];
  const top = fp.candidates.slice(0, 5);
  const maxP = Math.max(...top.map((c) => c.probability ?? 0), 0.0001);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Fingerprint className="size-5 text-primary" /> 模型指纹报告
        </CardTitle>
        <CardDescription>基于数字分布指纹、分词器探测与响应元数据。</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid items-center gap-3 rounded-xl border bg-muted/20 p-4 sm:grid-cols-[1fr_auto_1fr]">
          <div>
            <div className="text-sm text-muted-foreground">声称的模型</div>
            <div className="mt-1 break-all font-mono text-lg font-semibold">{fp.claimed}</div>
          </div>
          <ArrowRight className="hidden size-5 text-muted-foreground sm:block" />
          <div className="sm:text-right">
            <div className="text-sm text-muted-foreground">最可能的实际模型</div>
            <div className={cn("mt-1 break-all font-mono text-lg font-semibold", TONE_TEXT[claim.tone])}>{fp.likely?.model ?? "—"}</div>
            {fp.likely && (
              <div className="mt-0.5 text-sm text-muted-foreground">
                {fp.likely.family} · 置信度 {fp.confidence !== null ? pct(fp.confidence) : "未校准（有效回答不足 3 条）"}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={claim.tone}>{claim.text}</ToneBadge>
          <span className="text-[15px] text-muted-foreground">{fp.claimSummary}</span>
        </div>

        {fp.error && !fp.likely && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 text-[15px] text-amber-700 dark:text-amber-400">{fp.error}</p>}

        {top.length > 0 && (
          <div className="space-y-2.5">
            <h4 className="text-[15px] font-semibold">候选排名（参考库 {fp.decision === "scored" ? "已校准" : "未校准"}）</h4>
            <ul className="space-y-2">
              {top.map((c, i) => (
                <li key={c.model} className="grid grid-cols-[1.5rem_minmax(0,1fr)_5rem] items-center gap-2 text-[15px]">
                  <span className="text-sm text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono">{c.model}</span>
                      <span className="shrink-0 text-[13px] text-muted-foreground">{c.family}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-primary/40")}
                        style={{ width: `${c.probability === null ? 100 - i * 15 : Math.max(2, ((c.probability ?? 0) / maxP) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-right text-sm tabular-nums">{c.probability === null ? `分数 ${c.score?.toFixed(2)}` : pct(c.probability)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-[15px] font-semibold">证据</h4>
          <EvidenceList items={fp.evidence} />
        </div>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-[15px] font-medium text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" /> 指纹样本明细
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[540px] text-sm">
                <thead className="bg-muted/40 text-sm text-muted-foreground">
                  <tr>
                    <th className="p-2.5 text-left font-medium">样本</th>
                    <th className="p-2.5 text-right font-medium">要求 / 解析</th>
                    <th className="p-2.5 text-right font-medium">TTFT</th>
                    <th className="p-2.5 text-right font-medium">总耗时</th>
                    <th className="p-2.5 text-right font-medium">输入 / 输出 tokens</th>
                    <th className="p-2.5 text-left font-medium">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fp.samples.map((s) => (
                    <tr key={s.index}>
                      <td className="p-2.5">#{s.index + 1}</td>
                      <td className="p-2.5 text-right tabular-nums">
                        {s.expected} / {s.parsed}
                      </td>
                      <td className="p-2.5 text-right tabular-nums">{ms(s.ttftMs)}</td>
                      <td className="p-2.5 text-right tabular-nums">{ms(s.durationMs)}</td>
                      <td className="p-2.5 text-right tabular-nums">
                        {tokens(s.usage.input)} / {tokens(s.usage.output)}
                      </td>
                      <td className="max-w-48 truncate p-2.5 text-sm">{s.ok ? <span className="text-emerald-600">成功</span> : <span className="text-red-500">{s.error}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}

function DegradationCard({ dg }: { dg: DegradationReport }) {
  const verdict = VERDICT_LABEL[dg.verdict];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="size-5 text-primary" /> 降智检测报告
        </CardTitle>
        <CardDescription>
          固定题目 + 标准答案，NFKC 归一化后判定；请求失败不计为答错。判定方式：
          {dg.judgeMode === "answer" ? "只看答案" : dg.judgeMode === "latency" ? "只看耗时" : "答案和耗时"}。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ScoreRing score={dg.score} tone={verdict.tone} size={96} label="智力得分" />
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <ToneBadge tone={verdict.tone}>{verdict.text}</ToneBadge>
              <span className="text-[15px] text-muted-foreground">{dg.verdictText}</span>
            </div>
            <div className="flex gap-4 text-[15px]">
              <span className="text-emerald-600">通过 {dg.passed}</span>
              <span className="text-red-500">未通过 {dg.failed}</span>
              <span className="text-muted-foreground">请求失败 {dg.errors}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <Stat icon={Zap} label="平均首字延迟" value={ms(dg.stats.avgTtftMs)} />
          <Stat icon={Timer} label="平均总耗时" value={ms(dg.stats.avgDurationMs)} />
          <Stat icon={Gauge} label="平均输出速度" value={dg.stats.avgTokensPerSecond === null ? "—" : `${dg.stats.avgTokensPerSecond} tok/s`} />
          <Stat icon={Brain} label="输入 / 输出 / 推理" value={`${tokens(dg.stats.totalInput)} / ${tokens(dg.stats.totalOutput)} / ${tokens(dg.stats.totalReasoning)}`} />
        </div>

        <div className="space-y-2">
          <h4 className="text-[15px] font-semibold">逐题结果</h4>
          <ul className="divide-y rounded-lg border">
            {dg.tests
              .filter((t) => t.kind === "qa")
              .map((t) => (
                <TestRow key={t.id} t={t} />
              ))}
          </ul>
        </div>

        {dg.tests.some((t) => t.kind === "visual") && (
          <div className="space-y-3">
            <div>
              <h4 className="text-[15px] font-semibold">HTML / SVG 动画题</h4>
              <p className="mt-1 text-sm text-muted-foreground">
                自动检查结构、完整性、动画与题意关键词（≥ 75 分记为通过），画面质量请直接目测预览。
              </p>
            </div>
            {dg.tests
              .filter((t) => t.kind === "visual")
              .map((t) => (
                <VisualTestCard key={t.id} t={t} />
              ))}
          </div>
        )}

        {dg.signals.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-[15px] font-semibold">其他信号</h4>
            <EvidenceList items={dg.signals} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function VisualTestCard({ t }: { t: DegradationTestResult }) {
  const label = TEST_LABEL[t.status];
  return (
    <div className="space-y-3 rounded-lg border p-3.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ToneBadge tone={label.tone} className="w-16 justify-center">
          {label.text}
        </ToneBadge>
        <span className="text-[15px] font-medium">{t.name}</span>
        <span className="text-[13px] text-muted-foreground">权重 {t.weight}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] tabular-nums text-muted-foreground">
        <span>首段输出 {ms(t.ttftMs)}</span>
        <span className={cn(!t.latencyPassed && t.status !== "error" && "text-amber-600")}>
          总耗时 {ms(t.durationMs)}（阈值 {ms(t.maxDurationMs)}）
        </span>
        <span>输出 {tokens(t.usage.output)} tokens</span>
        {t.usage.reasoning ? <span>思考 {tokens(t.usage.reasoning)} tokens</span> : null}
        {t.tokensPerSecond !== null && <span>{t.tokensPerSecond} tok/s</span>}
        {t.artifact && <span>{(t.artifact.bytes / 1024).toFixed(1)} KB</span>}
        {t.responseModel && <span>上游返回模型 {t.responseModel}</span>}
        {t.finishReason && <span>结束原因 {t.finishReason}</span>}
      </div>
      {t.stats && t.stats.runs > 1 && <RunStatsLine t={t} />}
      {t.error && <p className="text-sm text-red-500">{t.error}</p>}
      {t.runs && t.runs.length > 1 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {t.runs.map((r) => (
            <div key={r.index} className="space-y-1.5 rounded-lg border p-2.5">
              <div className="flex items-center justify-between text-[13px]">
                <span className="font-medium">第 {r.index + 1} 次</span>
                <span className={cn("tabular-nums", r.status === "normal" ? "text-emerald-600" : r.status === "error" ? "text-muted-foreground" : "text-red-500")}>
                  {TEST_LABEL[r.status].text}
                  {r.artifact ? ` · ${r.artifact.autoScore} 分` : ""} · {ms(r.durationMs)}
                </span>
              </div>
              {r.artifact ? <VisualPreview artifact={r.artifact} name={`${t.name} #${r.index + 1}`} compact /> : <p className="text-[13px] text-red-500">{r.error ?? "没有输出"}</p>}
            </div>
          ))}
        </div>
      ) : t.artifact ? (
        <VisualPreview artifact={t.artifact} name={t.name} />
      ) : null}
    </div>
  );
}

function RunStatsLine({ t }: { t: DegradationTestResult }) {
  const s = t.stats!;
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-muted/40 px-2.5 py-2 text-[13px] tabular-nums">
      <span>
        通过率 <b>{s.passRate === null ? "—" : `${Math.round(s.passRate * 100)}%`}</b>（{s.passed}/{s.graded}，共 {s.runs} 次）
      </span>
      <span>平均 {ms(s.meanMs)}</span>
      <span>P95 {ms(s.p95Ms)}</span>
      <span>标准差 {ms(s.stdevMs)}</span>
      <span>平均首字 {ms(s.meanTtftMs)}</span>
    </div>
  );
}

function TestRow({ t }: { t: DegradationTestResult }) {
  const [open, setOpen] = useState(false);
  const label = TEST_LABEL[t.status];
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 p-3.5 text-left hover:bg-muted/30">
          <ToneBadge tone={label.tone} className="w-16 justify-center">
            {label.text}
          </ToneBadge>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{t.name}</div>
            <div className="text-[13px] text-muted-foreground">
              {t.category} · 权重 {t.weight}
              {t.stats && t.stats.runs > 1 ? ` · 通过 ${t.stats.passed}/${t.stats.graded}` : ""}
            </div>
          </div>
          <div className="hidden text-right text-[13px] tabular-nums text-muted-foreground sm:block">
            <div>TTFT {ms(t.ttftMs)}</div>
            <div className={cn(!t.latencyPassed && t.status !== "error" && "text-amber-600")}>总 {ms(t.durationMs)}</div>
          </div>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2.5 px-3.5 pb-3.5 text-sm">
            {t.stats && t.stats.runs > 1 && <RunStatsLine t={t} />}
            {t.runs && t.runs.length > 1 && (
              <ul className="space-y-1 text-[13px]">
                {t.runs.map((r) => (
                  <li key={r.index} className="flex gap-2 rounded bg-muted/30 px-2.5 py-1.5">
                    <span className="w-12 shrink-0 text-muted-foreground">#{r.index + 1}</span>
                    <span className={cn("w-14 shrink-0", r.status === "normal" ? "text-emerald-600" : r.status === "error" ? "text-muted-foreground" : "text-red-500")}>
                      {TEST_LABEL[r.status].text}
                    </span>
                    <span className="w-16 shrink-0 tabular-nums text-muted-foreground">{ms(r.durationMs)}</span>
                    <span className="min-w-0 truncate font-mono">{r.error ?? r.output}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2.5 sm:grid-cols-2">
              <div className="rounded-md bg-muted/40 p-2.5">
                <div className="text-[13px] text-muted-foreground">标准答案</div>
                <div className="mt-1 break-all font-mono text-sm">{t.expected}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2.5">
                <div className="text-[13px] text-muted-foreground">模型回答 {t.status !== "error" && (t.answerPassed ? "✓" : "✗")}</div>
                <div className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-sm">
                  {t.error ? <span className="text-red-500">{t.error}</span> : t.output || "（空）"}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
              <span>TTFT {ms(t.ttftMs)}</span>
              <span>
                总耗时 {ms(t.durationMs)}（阈值 {ms(t.maxDurationMs)} {t.latencyPassed ? "✓" : "✗"}）
              </span>
              <span>
                tokens 输入 {tokens(t.usage.input)} / 输出 {tokens(t.usage.output)}
                {t.usage.reasoning ? ` / 推理 ${tokens(t.usage.reasoning)}` : ""}
              </span>
              {t.tokensPerSecond !== null && <span>{t.tokensPerSecond} tok/s</span>}
              {t.responseModel && <span>响应模型 {t.responseModel}</span>}
              {t.finishReason && <span>结束原因 {t.finishReason}</span>}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </li>
  );
}
