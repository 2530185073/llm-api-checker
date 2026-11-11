"use client";

import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, CircleSlash, Layers, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CaseResult, CompositionReport, Flag } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import { ms } from "./format";
import { ScoreRing } from "./score-ring";

export const FLAG_LABEL: Record<Flag, string> = {
  model_swapped: "模型被替换",
  usage_fake: "usage 造假",
  context_truncated: "上下文被截断",
  injected_prompt: "注入系统提示",
  protocol_shim: "协议转换层",
  relay_trace: "中转痕迹",
  non_official_backend: "非官方后端",
  low_precision: "疑似低精度",
  slow: "性能低于官方",
  cc_reverse: "Claude Code 逆向",
};

const VENDOR_NAME = { claude: "Claude", openai: "OpenAI", gemini: "Gemini", glm: "GLM", kimi: "Kimi", deepseek: "DeepSeek" } as const;
const PLATFORM_LABEL: Record<string, string> = {
  anthropic: "Anthropic 官方 API",
  bedrock: "AWS Bedrock",
  vertex: "Google Vertex AI",
  foundry: "Microsoft Foundry",
  openrouter: "OpenRouter",
  "openai-shim": "OpenAI 格式协议转换",
  unknown: "未知",
};

export const compositionTone = (c: CompositionReport | null) =>
  !c || c.score === null ? "muted" : c.verdict === "official" ? "good" : c.verdict === "suspect" ? "warn" : "bad";

function StatusIcon({ s }: { s: CaseResult["status"] }) {
  if (s === "pass") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />;
  if (s === "warn") return <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />;
  if (s === "fail") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-red-500" />;
  if (s === "skip") return <CircleSlash className="mt-0.5 size-4 shrink-0 text-muted-foreground/60" />;
  return <CircleMinus className="mt-0.5 size-4 shrink-0 text-muted-foreground" />;
}

function CaseRow({ r }: { r: CaseResult }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!r.details?.length;
  return (
    <li>
      <button type="button" className={cn("flex w-full gap-2.5 px-3 py-2 text-left", hasMore && "hover:bg-muted/30")} onClick={() => hasMore && setOpen((v) => !v)}>
        <StatusIcon s={r.status} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{r.title}</span>
            <span className="text-[11px] text-muted-foreground">{r.weight > 0 ? `权重 ${r.weight}` : "不计分"}</span>
            {r.tags.includes("critical") && (
              <Badge variant="destructive" className="text-[10px]">
                关键
              </Badge>
            )}
            {r.flags?.map((f) => (
              <Badge key={f} variant="outline" className="border-red-500/30 text-[10px] text-red-600 dark:text-red-400">
                {FLAG_LABEL[f]}
              </Badge>
            ))}
          </span>
          <span className="block text-xs text-muted-foreground">{r.summary}</span>
        </span>
        <span className="hidden shrink-0 text-right text-[11px] tabular-nums text-muted-foreground sm:block">
          {r.requests} 次请求
          <br />
          {ms(r.durationMs)}
        </span>
        {hasMore && <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />}
      </button>
      {open && (
        <ul className="mx-3 mb-2 space-y-0.5 rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
          {r.details!.map((d, i) => (
            <li key={i} className="break-all whitespace-pre-wrap">
              {d}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function CompositionCard({ c }: { c: CompositionReport }) {
  const [filter, setFilter] = useState<"all" | "issues">("issues");
  const tone = compositionTone(c);
  const sections = useMemo(() => {
    const out: { name: string; items: CaseResult[] }[] = [];
    for (const r of c.cases) {
      if (filter === "issues" && !(r.status === "fail" || r.status === "warn")) continue;
      const s = out.find((x) => x.name === r.section);
      if (s) s.items.push(r);
      else out.push({ name: r.section, items: [r] });
    }
    return out;
  }, [c.cases, filter]);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Layers className="size-5 text-primary" /> 渠道成分报告 · {VENDOR_NAME[c.vendor]}
        </CardTitle>
        <CardDescription>
          {!["glm", "kimi", "deepseek"].includes(c.vendor)
            ? "按官方 API 的协议、计费与参数行为逐项核对。"
            : c.mode === "official"
              ? "要求官方链路：官方链路特征计分并封顶结论。"
              : "官方等价：只看模型、上下文、思考、计费、精度与性能是否与官方一致。"}
          {c.platform ? ` 平台判定：${PLATFORM_LABEL[c.platform] ?? c.platform}。` : ""}
          {c.backend ? ` 后端判定：${c.backend}。` : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <ScoreRing score={c.score} tone={tone} size={96} label="成分得分" />
          <div className="space-y-2">
            <p className="text-sm font-medium">{c.verdictText}</p>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="text-emerald-600">通过 {c.passed}</span>
              <span className="text-amber-600">警告 {c.warned}</span>
              <span className="text-red-500">失败 {c.failed}</span>
              <span className="text-muted-foreground">跳过 {c.skipped}</span>
              <span className="text-muted-foreground">精度证据 {c.precisionPoints} 分</span>
            </div>
            {c.flags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {c.flags.map((f) => (
                  <Badge key={f} variant="destructive">
                    {FLAG_LABEL[f]}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="flex gap-1 rounded-md border p-0.5 text-xs w-fit">
          {(["issues", "all"] as const).map((k) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn("rounded px-2.5 py-1", filter === k ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>
              {k === "issues" ? `只看问题（${c.failed + c.warned}）` : `全部用例（${c.cases.length}）`}
            </button>
          ))}
        </div>
        {sections.length === 0 && <p className="text-sm text-muted-foreground">没有警告或失败的用例。</p>}
        {sections.map((s) => (
          <div key={s.name} className="space-y-1">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{s.name}</h4>
            <ul className="divide-y rounded-lg border">
              {s.items.map((r) => (
                <CaseRow key={r.id} r={r} />
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
