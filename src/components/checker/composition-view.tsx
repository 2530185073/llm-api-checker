"use client";

import { ChevronDown, CircleAlert, CircleCheck, CircleMinus, CircleSlash, Layers, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import type { CaseResult, CompositionReport, Flag } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import { ms } from "./format";
import { Count, LIST_BOX, MonoTag, Segmented, SectionCard, SubHeading, ToneBadge } from "./parts";
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

export const compositionTone = (c: CompositionReport | null) => (!c || c.score === null ? "muted" : c.verdict === "official" ? "good" : c.verdict === "suspect" ? "warn" : "bad");

function StatusIcon({ s }: { s: CaseResult["status"] }) {
  if (s === "pass") return <CircleCheck className="mt-0.5 size-4 shrink-0 text-success" />;
  if (s === "warn") return <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />;
  if (s === "fail") return <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" />;
  if (s === "skip") return <CircleSlash className="mt-0.5 size-4 shrink-0 text-fg-4" />;
  return <CircleMinus className="mt-0.5 size-4 shrink-0 text-fg-4" />;
}

function CaseRow({ r }: { r: CaseResult }) {
  const [open, setOpen] = useState(false);
  const hasMore = !!r.details?.length;
  return (
    <li>
      <button
        type="button"
        aria-expanded={hasMore ? open : undefined}
        className={cn("flex w-full gap-3 px-3.5 py-3 text-left transition-colors", hasMore ? "hover:bg-fill-1" : "cursor-default")}
        onClick={() => hasMore && setOpen((v) => !v)}
      >
        <StatusIcon s={r.status} />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-medium">{r.title}</span>
            <span className="text-[11px] text-fg-3">{r.weight > 0 ? `权重 ${r.weight}` : "不计分"}</span>
            {r.tags.includes("critical") && (
              <Badge variant="destructive" className="text-[10px]">
                关键
              </Badge>
            )}
            {r.flags?.map((f) => (
              <Badge key={f} variant="destructive" className="text-[10px]">
                {FLAG_LABEL[f]}
              </Badge>
            ))}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-fg-2">{r.summary}</span>
        </span>
        <span className="hidden shrink-0 text-right text-[11px] leading-4 text-fg-3 tabular-nums sm:block">
          {r.requests} 次请求
          <br />
          {ms(r.durationMs)}
        </span>
        {hasMore ? <ChevronDown className={cn("mt-0.5 size-4 shrink-0 text-fg-4 transition-transform duration-200", open && "rotate-180")} /> : <span className="size-4 shrink-0" aria-hidden />}
      </button>
      {open && (
        <ul className="mx-3.5 mb-3 space-y-0.5 rounded-xl bg-fill-1 p-3 font-mono text-[11px] leading-relaxed text-fg-2">
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

const VERDICT_WORD: Record<CompositionReport["verdict"], string> = { official: "一致", suspect: "存疑", fake: "不符", unknown: "无法判断" };

export function CompositionCard({ c }: { c: CompositionReport }) {
  const issues = c.failed + c.warned;
  const [filter, setFilter] = useState<"all" | "issues">(issues > 0 ? "issues" : "all");
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
    <SectionCard
      icon={Layers}
      title={`渠道成分报告 · ${VENDOR_NAME[c.vendor]}`}
      description={
        <>
          {!["glm", "kimi", "deepseek"].includes(c.vendor)
            ? "按官方 API 的协议、计费与参数行为逐项核对。"
            : c.mode === "official"
              ? "要求官方链路：官方链路特征计分并封顶结论。"
              : "官方等价：只看模型、上下文、思考、计费、精度与性能是否与官方一致。"}
          {c.platform ? ` 平台判定：${PLATFORM_LABEL[c.platform] ?? c.platform}。` : ""}
          {c.backend ? ` 后端判定：${c.backend}。` : ""}
        </>
      }
      action={<ToneBadge tone={tone}>{VERDICT_WORD[c.verdict]}</ToneBadge>}
    >
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-6">
        <ScoreRing score={c.score} tone={tone} size={104} label="成分得分" />
        <div className="min-w-0 space-y-3">
          <p className="text-sm leading-6">{c.verdictText}</p>
          <div className="flex flex-wrap gap-x-5 gap-y-1.5">
            <Count tone="good" label="通过" value={c.passed} />
            <Count tone="warn" label="警告" value={c.warned} />
            <Count tone="bad" label="失败" value={c.failed} />
            <Count tone="muted" label="跳过" value={c.skipped} />
            <Count tone="muted" label="精度证据分" value={c.precisionPoints} />
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
      <div className="space-y-4">
        <Segmented
          label="用例筛选"
          value={filter}
          onChange={setFilter}
          items={[
            { value: "issues", label: `只看问题 ${issues}` },
            { value: "all", label: `全部用例 ${c.cases.length}` },
          ]}
        />
        {sections.length === 0 && <p className="rounded-xl bg-fill-1 px-3.5 py-6 text-center text-[13px] text-fg-2">没有警告或失败的用例。</p>}
        {sections.map((s) => (
          <div key={s.name} className="space-y-2">
            <SubHeading aside={<MonoTag>{s.items.length}</MonoTag>}>{s.name}</SubHeading>
            <ul className={LIST_BOX}>
              {s.items.map((r) => (
                <CaseRow key={r.id} r={r} />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </SectionCard>
  );
}
