"use client";

import { ArrowDown, ArrowRight, Brain, ChevronDown, CircleAlert, CircleCheck, CircleMinus, Download, Fingerprint } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { CheckReport, DegradationReport, DegradationTestResult, Evidence, FingerprintReport } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { CompositionCard } from "./composition-view";
import { CLAIM_LABEL, ms, pct, PROTOCOL_LABEL, TEST_LABEL, TONE_DOT, TONE_TEXT, tokens, VERDICT_LABEL, type Tone } from "./format";
import { Count, LIST_BOX, MonoTag, SectionCard, StatStrip, SubHeading, ToneBadge, Tray } from "./parts";
import { ScoreRing } from "./score-ring";
import { VisualPreview } from "./visual-preview";

const OVERALL_WORD: Record<Tone, string> = { good: "可信", warn: "存疑", bad: "高风险", muted: "信息不足" };

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
      <Tray className="animate-rise">
        <div className="flex flex-col gap-6 p-5 sm:flex-row sm:items-center sm:gap-8 sm:p-7">
          <ScoreRing score={report.overall.score} tone={tone} size={132} label="综合评分" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-fg-3">检测结论</span>
              <MonoTag className="max-w-full truncate">{report.target.model}</MonoTag>
            </div>
            <h2 className={cn("mt-2 font-serif text-[34px] leading-[1.1] font-semibold sm:text-[40px]", TONE_TEXT[tone])}>{OVERALL_WORD[tone]}</h2>
            <p className="mt-3 max-w-4xl text-[15px] leading-6 text-fg-2">{report.overall.summary}</p>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <MonoTag>{report.target.host}</MonoTag>
              <MonoTag>
                {PROTOCOL_LABEL[report.target.protocol]}
                {report.protocolDetection.auto ? " · 自动识别" : ""}
              </MonoTag>
              {report.target.effort && <MonoTag>推理强度 {report.target.effort}</MonoTag>}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={download} className="self-start">
            <Download className="size-3.5" /> 导出 JSON
          </Button>
        </div>
        <StatStrip
          className="border-t border-line-1"
          items={[
            { label: "请求次数", value: report.totals.requests.toLocaleString("zh-CN") },
            { label: "输入 tokens", value: tokens(report.totals.inputTokens) },
            { label: "输出 tokens", value: tokens(report.totals.outputTokens) },
            { label: "总耗时", value: ms(report.totals.durationMs) },
          ]}
        />
      </Tray>
      {report.composition && (report.fingerprint || report.degradation) ? (
        <div className="grid grid-cols-1 gap-5 2xl:grid-cols-2 2xl:items-start">
          <div className="min-w-0 space-y-5">
            {report.fingerprint && <FingerprintCard fp={report.fingerprint} />}
            {report.degradation && <DegradationCard dg={report.degradation} />}
          </div>
          <div className="min-w-0">
            <CompositionCard c={report.composition} />
          </div>
        </div>
      ) : (
        <>
          {report.fingerprint && <FingerprintCard fp={report.fingerprint} />}
          {report.composition && <CompositionCard c={report.composition} />}
          {report.degradation && <DegradationCard dg={report.degradation} />}
        </>
      )}
      <p className="px-1 text-sm leading-6 text-fg-3">
        综合评分 = 降智得分 × 指纹系数（一致 1.0、未收录 0.9、同家族 0.75、不一致 0.4），启用成分检测时再与成分得分按 6 : 4 加权（检出关键问题时成分得分按不超过 40 计）。
      </p>
    </div>
  );
}

function SignalIcon({ signal }: { signal: Evidence["signal"] }) {
  if (signal === "support") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  if (signal === "against") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />;
  return <CircleMinus className="mt-0.5 size-4 shrink-0 text-fg-4" />;
}

function EvidenceList({ items }: { items: Evidence[] }) {
  return (
    <ul className={LIST_BOX}>
      {items.map((e) => (
        <li key={e.key} className="flex gap-3 px-3.5 py-3">
          <SignalIcon signal={e.signal} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
              <span className="text-[15px] font-medium">{e.label}</span>
              <span className="text-sm break-all text-fg-2 sm:text-right">{e.value}</span>
            </div>
            {e.detail && <p className="mt-1 text-sm leading-6 text-fg-3">{e.detail}</p>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ModelNode({ caption, model, sub, tone }: { caption: string; model: string; sub?: React.ReactNode; tone?: Tone }) {
  return (
    <div className="relative min-w-0 rounded-xl bg-background px-4 py-3.5 shadow-float">
      <div className="flex items-center gap-1.5 text-sm text-fg-3">
        {tone && <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />}
        {caption}
      </div>
      <div className={cn("mt-1.5 font-mono text-base font-medium break-all", tone && TONE_TEXT[tone])}>{model}</div>
      {sub && <div className="mt-1 text-sm text-fg-3">{sub}</div>}
    </div>
  );
}

function FingerprintCard({ fp }: { fp: FingerprintReport }) {
  const claim = CLAIM_LABEL[fp.claimStatus];
  const top = fp.candidates.slice(0, 5);
  const maxP = Math.max(...top.map((c) => c.probability ?? 0), 0.0001);
  return (
    <SectionCard icon={Fingerprint} title="模型指纹报告" description="基于数字分布指纹、分词器探测与响应元数据。" action={<ToneBadge tone={claim.tone}>{claim.text}</ToneBadge>}>
      <div className="relative overflow-hidden rounded-2xl bg-surface-1 p-4 ring-1 ring-line-1 sm:p-5">
        <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
        <div className="relative grid items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:gap-3">
          <ModelNode caption="声称的模型" model={fp.claimed} />
          <span className="mx-auto grid size-7 place-items-center rounded-full bg-background text-fg-3 shadow-raised">
            <ArrowRight className="hidden size-3.5 sm:block" />
            <ArrowDown className="size-3.5 sm:hidden" />
          </span>
          <ModelNode
            caption="最可能的实际模型"
            model={fp.likely?.model ?? "—"}
            tone={claim.tone}
            sub={fp.likely ? `${fp.likely.family} · 置信度 ${fp.confidence !== null ? pct(fp.confidence) : "未校准（有效回答不足 3 条）"}` : undefined}
          />
        </div>
        <p className="relative mt-3.5 text-sm leading-6 text-fg-2">{fp.claimSummary}</p>
      </div>

      {fp.error && !fp.likely && <p className="rounded-xl bg-warning-soft p-3 text-[15px] text-warning">{fp.error}</p>}

      {top.length > 0 && (
        <div className="space-y-3">
          <SubHeading aside={<MonoTag>{fp.decision === "scored" ? "参考库已校准" : "参考库未校准"}</MonoTag>}>候选排名</SubHeading>
          <ul className="space-y-3">
            {top.map((c, i) => (
              <li key={c.model} className="grid grid-cols-[1.25rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-[15px]">
                <span className="font-mono text-[13px] text-fg-4 tabular-nums">{String(i + 1).padStart(2, "0")}</span>
                <div className="min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={cn("truncate font-mono text-sm", i === 0 ? "font-medium" : "text-fg-2")}>{c.model}</span>
                    <span className="shrink-0 text-sm text-fg-3">{c.family}</span>
                  </div>
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-fill-3">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-700", i === 0 ? "bg-foreground" : "bg-fg-4")}
                      style={{ width: `${c.probability === null ? 100 - i * 15 : Math.max(2, ((c.probability ?? 0) / maxP) * 100)}%` }}
                    />
                  </div>
                </div>
                <span className={cn("text-right text-sm tabular-nums", i === 0 ? "font-medium" : "text-fg-2")}>{c.probability === null ? `分数 ${c.score?.toFixed(2)}` : pct(c.probability)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-3">
        <SubHeading>证据</SubHeading>
        <EvidenceList items={fp.evidence} />
      </div>

      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 rounded-full py-1 pr-3 pl-2 text-sm text-fg-2 transition-colors hover:bg-fill-2 hover:text-foreground">
          <ChevronDown className="size-4 transition-transform duration-200 group-data-[panel-open]:rotate-180" /> 指纹样本明细
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-3">
          <div className="overflow-x-auto rounded-xl ring-1 ring-line-1">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="bg-fill-1 text-sm text-fg-3">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">样本</th>
                  <th className="px-3 py-2 text-right font-medium">要求 / 解析</th>
                  <th className="px-3 py-2 text-right font-medium">TTFT</th>
                  <th className="px-3 py-2 text-right font-medium">总耗时</th>
                  <th className="px-3 py-2 text-right font-medium">输入 / 输出 tokens</th>
                  <th className="px-3 py-2 text-left font-medium">状态</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-1">
                {fp.samples.map((s) => (
                  <tr key={s.index}>
                    <td className="px-3 py-2 font-mono text-sm text-fg-3">#{s.index + 1}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {s.expected} / {s.parsed}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms(s.ttftMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{ms(s.durationMs)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {tokens(s.usage.input)} / {tokens(s.usage.output)}
                    </td>
                    <td className="max-w-48 truncate px-3 py-2 text-sm">{s.ok ? <span className="text-success">成功</span> : <span className="text-danger">{s.error}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </SectionCard>
  );
}

function DegradationCard({ dg }: { dg: DegradationReport }) {
  const verdict = VERDICT_LABEL[dg.verdict];
  const qa = dg.tests.filter((t) => t.kind === "qa");
  const visual = dg.tests.filter((t) => t.kind === "visual");
  return (
    <SectionCard
      icon={Brain}
      title="降智检测报告"
      description={
        <>
          固定题目 + 标准答案，NFKC 归一化后判定；请求失败不计为答错。判定方式：
          {dg.judgeMode === "answer" ? "只看答案" : dg.judgeMode === "latency" ? "只看耗时" : "答案和耗时"}。
        </>
      }
      action={<ToneBadge tone={verdict.tone}>{verdict.text}</ToneBadge>}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <ScoreRing score={dg.score} tone={verdict.tone} size={104} label="智力得分" />
        <div className="space-y-3">
          <p className="text-[15px] leading-6">{dg.verdictText}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Count tone="good" label="通过" value={dg.passed} />
            <Count tone="bad" label="未通过" value={dg.failed} />
            <Count tone="muted" label="请求失败" value={dg.errors} />
          </div>
        </div>
      </div>

      <StatStrip
        className="overflow-hidden rounded-xl ring-1 ring-line-1"
        items={[
          { label: "平均首字延迟", value: ms(dg.stats.avgTtftMs) },
          { label: "平均总耗时", value: ms(dg.stats.avgDurationMs) },
          { label: "平均输出速度", value: dg.stats.avgTokensPerSecond === null ? "—" : `${dg.stats.avgTokensPerSecond} tok/s` },
          { label: "输入 / 输出 / 推理 tokens", value: `${tokens(dg.stats.totalInput)} / ${tokens(dg.stats.totalOutput)} / ${tokens(dg.stats.totalReasoning)}`, small: true },
        ]}
      />

      {qa.length > 0 && (
        <div className="space-y-3">
          <SubHeading aside={<MonoTag>{qa.length} 题</MonoTag>}>逐题结果</SubHeading>
          <ul className={LIST_BOX}>
            {qa.map((t) => (
              <TestRow key={t.id} t={t} />
            ))}
          </ul>
        </div>
      )}

      {visual.length > 0 && (
        <div className="space-y-3">
          <SubHeading aside={<MonoTag>{visual.length} 题</MonoTag>}>HTML / SVG 动画题</SubHeading>
          <p className="-mt-1 text-sm leading-6 text-fg-3">自动检查结构、完整性、动画与题意关键词（≥ 75 分记为通过），画面质量请直接目测预览。</p>
          {visual.map((t) => (
            <VisualTestCard key={t.id} t={t} />
          ))}
        </div>
      )}

      {dg.signals.length > 0 && (
        <div className="space-y-3">
          <SubHeading>其他信号</SubHeading>
          <EvidenceList items={dg.signals} />
        </div>
      )}
    </SectionCard>
  );
}

function Meta({ children, warn }: { children: React.ReactNode; warn?: boolean }) {
  return <span className={cn(warn && "text-warning")}>{children}</span>;
}

function VisualTestCard({ t }: { t: DegradationTestResult }) {
  const label = TEST_LABEL[t.status];
  return (
    <div className="space-y-3 rounded-2xl p-4 ring-1 ring-line-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <ToneBadge tone={label.tone}>{label.text}</ToneBadge>
        <span className="text-[15px] font-medium">{t.name}</span>
        <MonoTag>权重 {t.weight}</MonoTag>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-3 tabular-nums">
        <Meta>首段输出 {ms(t.ttftMs)}</Meta>
        <Meta warn={!t.latencyPassed && t.status !== "error"}>
          总耗时 {ms(t.durationMs)}（阈值 {ms(t.maxDurationMs)}）
        </Meta>
        <Meta>输出 {tokens(t.usage.output)} tokens</Meta>
        {t.usage.reasoning ? <Meta>思考 {tokens(t.usage.reasoning)} tokens</Meta> : null}
        {t.tokensPerSecond !== null && <Meta>{t.tokensPerSecond} tok/s</Meta>}
        {t.artifact && <Meta>{(t.artifact.bytes / 1024).toFixed(1)} KB</Meta>}
        {t.responseModel && <Meta>上游返回模型 {t.responseModel}</Meta>}
        {t.finishReason && <Meta>结束原因 {t.finishReason}</Meta>}
      </div>
      {t.stats && t.stats.runs > 1 && <RunStatsLine t={t} />}
      {t.error && <p className="text-sm text-danger">{t.error}</p>}
      {t.runs && t.runs.length > 1 ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {t.runs.map((r) => (
            <div key={r.index} className="space-y-2 rounded-xl bg-fill-1 p-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium">第 {r.index + 1} 次</span>
                <span className={cn("tabular-nums", r.status === "normal" ? "text-success" : r.status === "error" ? "text-fg-3" : "text-danger")}>
                  {TEST_LABEL[r.status].text}
                  {r.artifact ? ` · ${r.artifact.autoScore} 分` : ""} · {ms(r.durationMs)}
                </span>
              </div>
              {r.artifact ? <VisualPreview artifact={r.artifact} name={`${t.name} #${r.index + 1}`} compact /> : <p className="text-sm text-danger">{r.error ?? "没有输出"}</p>}
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
    <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-fill-2 px-2.5 py-1.5 text-sm text-fg-2 tabular-nums">
      <span>
        通过率 <b className="font-medium text-foreground">{s.passRate === null ? "—" : `${Math.round(s.passRate * 100)}%`}</b>（{s.passed}/{s.graded}，共 {s.runs} 次）
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
        <CollapsibleTrigger className="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors hover:bg-fill-1">
          <span className={cn("size-2 shrink-0 rounded-full", TONE_DOT[label.tone])} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-medium">{t.name}</div>
            <div className="mt-0.5 text-sm text-fg-3">
              {t.category} · 权重 {t.weight}
              {t.stats && t.stats.runs > 1 ? ` · 通过 ${t.stats.passed}/${t.stats.graded}` : ""}
            </div>
          </div>
          <div className="hidden text-right text-sm text-fg-3 tabular-nums sm:block">
            <div>TTFT {ms(t.ttftMs)}</div>
            <div className={cn(!t.latencyPassed && t.status !== "error" && "text-warning")}>总 {ms(t.durationMs)}</div>
          </div>
          <span className={cn("w-14 shrink-0 text-right text-sm font-medium", TONE_TEXT[label.tone])}>{label.text}</span>
          <ChevronDown className={cn("size-4 shrink-0 text-fg-4 transition-transform duration-200", open && "rotate-180")} />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-2.5 px-3.5 pb-3.5 text-[15px]">
            {t.stats && t.stats.runs > 1 && <RunStatsLine t={t} />}
            {t.runs && t.runs.length > 1 && (
              <ul className="space-y-1 text-sm">
                {t.runs.map((r) => (
                  <li key={r.index} className="flex gap-2 rounded-lg bg-fill-1 px-2.5 py-1.5">
                    <span className="w-10 shrink-0 font-mono text-fg-4">#{r.index + 1}</span>
                    <span className={cn("w-16 shrink-0", r.status === "normal" ? "text-success" : r.status === "error" ? "text-fg-3" : "text-danger")}>{TEST_LABEL[r.status].text}</span>
                    <span className="w-16 shrink-0 text-fg-3 tabular-nums">{ms(r.durationMs)}</span>
                    <span className="min-w-0 truncate font-mono">{r.error ?? r.output}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-xl bg-fill-1 p-3">
                <div className="text-sm text-fg-3">标准答案</div>
                <div className="mt-1 font-mono text-sm break-all">{t.expected}</div>
              </div>
              <div className="rounded-xl bg-fill-1 p-3">
                <div className="flex items-center gap-1.5 text-sm text-fg-3">
                  模型回答
                  {t.status !== "error" && <span className={t.answerPassed ? "text-success" : "text-danger"}>{t.answerPassed ? "✓" : "✗"}</span>}
                </div>
                <div className="mt-1 max-h-40 overflow-auto font-mono text-sm break-all whitespace-pre-wrap">{t.error ? <span className="text-danger">{t.error}</span> : t.output || "（空）"}</div>
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-3">
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
