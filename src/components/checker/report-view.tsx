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
import { CLAIM_LABEL, ms, pct, PROTOCOL_LABEL, TEST_LABEL, TONE_CLASS, TONE_TEXT, tokens, VERDICT_LABEL, type Tone } from "./format";
import { ScoreRing } from "./score-ring";
import { VisualPreview } from "./visual-preview";

function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <Badge variant="outline" className={cn("border", TONE_CLASS[tone], className)}>
      {children}
    </Badge>
  );
}

function Stat({ icon: Icon, label, value }: { icon: typeof Timer; label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-muted/30 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div className="mt-1 text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export function ReportView({ report }: { report: CheckReport }) {
  const tone: Tone = report.overall.level === "unknown" ? "muted" : report.overall.level;
  const download = () => {
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `llm-check-${report.target.model}-${report.startedAt.slice(0, 19).replace(/[:T]/g, "-")}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <ScoreRing score={report.overall.score} tone={tone} label="综合评分" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">检测结论</h2>
              <ToneBadge tone={tone}>{tone === "good" ? "可信" : tone === "warn" ? "存疑" : tone === "bad" ? "高风险" : "信息不足"}</ToneBadge>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">{report.overall.summary}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>目标：{report.target.host}</span>
              <span>协议：{PROTOCOL_LABEL[report.target.protocol]}{report.protocolDetection.auto ? "（自动识别）" : ""}</span>
              <span>模型：{report.target.model}</span>
              {report.target.effort && <span>推理强度：{report.target.effort}</span>}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>请求 {report.totals.requests} 次</span>
              <span>输入 {tokens(report.totals.inputTokens)} tokens</span>
              <span>输出 {tokens(report.totals.outputTokens)} tokens</span>
              <span>耗时 {ms(report.totals.durationMs)}</span>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={download} className="self-start">
            <Download className="size-4" /> 导出 JSON
          </Button>
        </CardContent>
      </Card>
      {report.fingerprint && <FingerprintCard fp={report.fingerprint} />}
      {report.degradation && <DegradationCard dg={report.degradation} />}
      <p className="text-xs leading-relaxed text-muted-foreground">综合评分 = 降智得分 × 指纹系数（一致 1.0、未收录 0.9、同家族 0.75、不一致 0.4）。</p>
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
        <li key={e.key} className="flex gap-3 p-3">
          <SignalIcon signal={e.signal} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="text-sm font-medium">{e.label}</span>
              <span className="break-all text-sm text-foreground/80 sm:text-right">{e.value}</span>
            </div>
            {e.detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{e.detail}</p>}
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
            <div className="text-xs text-muted-foreground">声称的模型</div>
            <div className="mt-1 break-all font-mono text-base font-semibold">{fp.claimed}</div>
          </div>
          <ArrowRight className="hidden size-5 text-muted-foreground sm:block" />
          <div className="sm:text-right">
            <div className="text-xs text-muted-foreground">最可能的实际模型</div>
            <div className={cn("mt-1 break-all font-mono text-base font-semibold", TONE_TEXT[claim.tone])}>{fp.likely?.model ?? "—"}</div>
            {fp.likely && (
              <div className="text-xs text-muted-foreground">
                {fp.likely.family} · 置信度 {fp.confidence !== null ? pct(fp.confidence) : "未校准（有效回答不足 3 条）"}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToneBadge tone={claim.tone}>{claim.text}</ToneBadge>
          <span className="text-sm text-muted-foreground">{fp.claimSummary}</span>
        </div>

        {fp.error && !fp.likely && <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-700 dark:text-amber-400">{fp.error}</p>}

        {top.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-sm font-medium">候选排名（参考库 {fp.decision === "scored" ? "已校准" : "未校准"}）</h4>
            <ul className="space-y-1.5">
              {top.map((c, i) => (
                <li key={c.model} className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
                  <span className="text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <div className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate font-mono">{c.model}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{c.family}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", i === 0 ? "bg-primary" : "bg-primary/40")}
                        style={{ width: `${c.probability === null ? 100 - i * 15 : Math.max(2, ((c.probability ?? 0) / maxP) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <span className="text-right text-xs tabular-nums">{c.probability === null ? `分数 ${c.score?.toFixed(2)}` : pct(c.probability)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="space-y-2">
          <h4 className="text-sm font-medium">证据</h4>
          <EvidenceList items={fp.evidence} />
        </div>

        <Collapsible>
          <CollapsibleTrigger className="group flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className="size-4 transition-transform group-data-[panel-open]:rotate-180" /> 指纹样本明细
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-3">
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-2 text-left font-medium">样本</th>
                    <th className="p-2 text-right font-medium">要求 / 解析</th>
                    <th className="p-2 text-right font-medium">TTFT</th>
                    <th className="p-2 text-right font-medium">总耗时</th>
                    <th className="p-2 text-right font-medium">输入 / 输出 tokens</th>
                    <th className="p-2 text-left font-medium">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {fp.samples.map((s) => (
                    <tr key={s.index}>
                      <td className="p-2">#{s.index + 1}</td>
                      <td className="p-2 text-right tabular-nums">
                        {s.expected} / {s.parsed}
                      </td>
                      <td className="p-2 text-right tabular-nums">{ms(s.ttftMs)}</td>
                      <td className="p-2 text-right tabular-nums">{ms(s.durationMs)}</td>
                      <td className="p-2 text-right tabular-nums">
                        {tokens(s.usage.input)} / {tokens(s.usage.output)}
                      </td>
                      <td className="max-w-48 truncate p-2 text-xs">{s.ok ? <span className="text-emerald-600">成功</span> : <span className="text-red-500">{s.error}</span>}</td>
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
              <span className="text-sm text-muted-foreground">{dg.verdictText}</span>
            </div>
            <div className="flex gap-4 text-sm">
              <span className="text-emerald-600">通过 {dg.passed}</span>
              <span className="text-red-500">未通过 {dg.failed}</span>
              <span className="text-muted-foreground">请求失败 {dg.errors}</span>
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat icon={Zap} label="平均首字延迟" value={ms(dg.stats.avgTtftMs)} />
          <Stat icon={Timer} label="平均总耗时" value={ms(dg.stats.avgDurationMs)} />
          <Stat icon={Gauge} label="平均输出速度" value={dg.stats.avgTokensPerSecond === null ? "—" : `${dg.stats.avgTokensPerSecond} tok/s`} />
          <Stat icon={Brain} label="输入 / 输出 / 推理" value={`${tokens(dg.stats.totalInput)} / ${tokens(dg.stats.totalOutput)} / ${tokens(dg.stats.totalReasoning)}`} />
        </div>

        <div className="space-y-2">
          <h4 className="text-sm font-medium">逐题结果</h4>
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
              <h4 className="text-sm font-medium">HTML / SVG 动画题</h4>
              <p className="mt-0.5 text-xs text-muted-foreground">
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
            <h4 className="text-sm font-medium">其他信号</h4>
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
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <ToneBadge tone={label.tone} className="w-16 justify-center">
          {label.text}
        </ToneBadge>
        <span className="text-sm font-medium">{t.name}</span>
        <span className="text-xs text-muted-foreground">权重 {t.weight}</span>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs tabular-nums text-muted-foreground">
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
      {t.error && <p className="text-xs text-red-500">{t.error}</p>}
      {t.artifact ? <VisualPreview artifact={t.artifact} name={t.name} /> : null}
    </div>
  );
}

function TestRow({ t }: { t: DegradationTestResult }) {
  const [open, setOpen] = useState(false);
  const label = TEST_LABEL[t.status];
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="flex w-full items-center gap-3 p-3 text-left hover:bg-muted/30">
          <ToneBadge tone={label.tone} className="w-16 justify-center">
            {label.text}
          </ToneBadge>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{t.name}</div>
            <div className="text-xs text-muted-foreground">
              {t.category} · 权重 {t.weight}
            </div>
          </div>
          <div className="hidden text-right text-xs tabular-nums text-muted-foreground sm:block">
            <div>TTFT {ms(t.ttftMs)}</div>
            <div className={cn(!t.latencyPassed && t.status !== "error" && "text-amber-600")}>总 {ms(t.durationMs)}</div>
          </div>
          <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2 px-3 pb-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-xs text-muted-foreground">标准答案</div>
                <div className="mt-0.5 break-all font-mono">{t.expected}</div>
              </div>
              <div className="rounded-md bg-muted/40 p-2">
                <div className="text-xs text-muted-foreground">模型回答 {t.status !== "error" && (t.answerPassed ? "✓" : "✗")}</div>
                <div className="mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono">{t.error ? <span className="text-red-500">{t.error}</span> : t.output || "（空）"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
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
