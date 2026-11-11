"use client";

import { Check, CircleDashed, Loader2, X } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { MonoTag } from "./parts";

export interface StepState {
  key: string;
  model?: string;
  group: string;
  label: string;
  state: "running" | "done" | "failed";
  detail?: string;
}

const GROUPS: Record<string, string> = {
  detect: "协议识别",
  fingerprint: "模型指纹",
  tokenizer: "分词器探测",
  composition: "渠道成分",
  degradation: "降智检测",
};

function StepIcon({ state }: { state: StepState["state"] }) {
  if (state === "running") return <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-fg-3" />;
  if (state === "done")
    return (
      <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full bg-success-soft text-success">
        <Check className="size-2.5" strokeWidth={3} />
      </span>
    );
  return (
    <span className="mt-0.5 grid size-3.5 shrink-0 place-items-center rounded-full bg-danger-soft text-danger">
      <X className="size-2.5" strokeWidth={3} />
    </span>
  );
}

function StepList({ steps }: { steps: StepState[] }) {
  const groups = Object.keys(GROUPS).filter((g) => steps.some((s) => s.group === g));
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {groups.map((group) => {
        const list = steps.filter((s) => s.group === group);
        const running = list.filter((s) => s.state === "running");
        const recent = [...running, ...list.filter((s) => s.state !== "running").slice(-4)].slice(0, 8);
        return (
          <div key={group} className="rounded-xl bg-fill-1 p-3.5 ring-1 ring-line-1">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">{GROUPS[group]}</h4>
              <MonoTag className="tabular-nums">
                {list.filter((s) => s.state !== "running").length}/{list.length}
              </MonoTag>
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {recent.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-sm leading-6">
                  <StepIcon state={s.state} />
                  <span className="min-w-0 flex-1">
                    <span className={cn(s.state === "running" ? "text-fg-2" : "text-foreground")}>{s.label}</span>
                    {s.detail && <span className="block truncate text-sm text-fg-3">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!groups.length && (
        <div className="flex items-center gap-2 text-sm text-fg-2">
          <CircleDashed className="size-4 animate-spin [animation-duration:3s]" /> 正在连接目标接口…
        </div>
      )}
    </div>
  );
}

const clock = (elapsedMs: number) => {
  const s = Math.max(0, Math.floor(elapsedMs / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export function ProgressPanel({
  steps,
  expected,
  elapsed,
  stage,
  models,
  doneModels,
}: {
  steps: StepState[];
  expected: number;
  elapsed: number;
  stage: string;
  models: string[];
  doneModels: string[];
}) {
  const finished = steps.filter((s) => s.state !== "running" && s.group !== "detect").length;
  const value = expected ? Math.min(100, Math.round((finished / expected) * 100)) : 0;
  const multi = models.length > 1;
  return (
    <div className="space-y-6" aria-live="polite">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-fill-2 py-0.5 pr-2.5 pl-2 text-[13px] font-medium text-fg-2">
              <span className="relative flex size-1.5">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-brand opacity-60" />
                <span className="relative inline-flex size-1.5 rounded-full bg-brand" />
              </span>
              检测中
            </span>
            <p className="mt-2.5 truncate text-base font-medium">{stage || "准备中"}</p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-[28px] leading-8 font-medium tracking-[-0.03em] tabular-nums">
              {value}
              <span className="ml-0.5 text-[15px] font-normal text-fg-3">%</span>
            </div>
            <div className="mt-0.5 font-mono text-[13px] text-fg-3 tabular-nums">
              {finished}/{expected} · {clock(elapsed)}
            </div>
          </div>
        </div>
        <Progress value={value} className="mt-4" />
        <p className="mt-2.5 text-sm text-fg-3">长上下文、重复次数与多模型会显著延长检测时间，请保持页面打开。</p>
      </div>
      {multi ? (
        <div className="space-y-2.5">
          {models.map((m) => {
            const own = steps.filter((s) => s.model === m);
            const done = doneModels.includes(m);
            return (
              <details key={m} className="group rounded-2xl ring-1 ring-line-1" open={models.length <= 3}>
                <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[15px] [&::-webkit-details-marker]:hidden">
                  {done ? (
                    <span className="grid size-4 place-items-center rounded-full bg-success-soft text-success">
                      <Check className="size-3" strokeWidth={3} />
                    </span>
                  ) : (
                    <Loader2 className="size-4 animate-spin text-fg-3" />
                  )}
                  <span className="truncate font-mono text-sm font-medium">{m}</span>
                  <span className="ml-auto shrink-0 font-mono text-[13px] text-fg-3 tabular-nums">{own.filter((s) => s.state !== "running").length} 步完成</span>
                </summary>
                <div className="border-t border-line-1 p-3">
                  <StepList steps={own} />
                </div>
              </details>
            );
          })}
        </div>
      ) : (
        <StepList steps={steps} />
      )}
    </div>
  );
}
