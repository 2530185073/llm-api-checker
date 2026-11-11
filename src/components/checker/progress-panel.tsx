"use client";

import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

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

function StepList({ steps }: { steps: StepState[] }) {
  const groups = Object.keys(GROUPS).filter((g) => steps.some((s) => s.group === g));
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {groups.map((group) => {
        const list = steps.filter((s) => s.group === group);
        const running = list.filter((s) => s.state === "running");
        const recent = [...running, ...list.filter((s) => s.state !== "running").slice(-4)].slice(0, 8);
        return (
          <div key={group} className="space-y-1.5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {GROUPS[group]} <span className="tabular-nums">{list.filter((s) => s.state !== "running").length}/{list.length}</span>
            </h4>
            <ul className="space-y-1">
              {recent.map((s) => (
                <li key={s.key} className="flex items-start gap-2 text-sm">
                  {s.state === "running" ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" /> : s.state === "done" ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />}
                  <span className="min-w-0 flex-1">
                    <span className={cn(s.state === "running" && "text-muted-foreground")}>{s.label}</span>
                    {s.detail && <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!groups.length && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleDashed className="size-4" /> 正在连接目标接口…
        </div>
      )}
    </div>
  );
}

export function ProgressPanel({ steps, expected, elapsed, stage, models, doneModels }: { steps: StepState[]; expected: number; elapsed: number; stage: string; models: string[]; doneModels: string[] }) {
  const finished = steps.filter((s) => s.state !== "running" && s.group !== "detect").length;
  const value = expected ? Math.min(100, Math.round((finished / expected) * 100)) : 0;
  const multi = models.length > 1;
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-sm">
          <span className="flex min-w-0 items-center gap-2 font-medium">
            <Loader2 className="size-4 shrink-0 animate-spin text-primary" />
            <span className="truncate">{stage || "准备中"}</span>
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            {finished}/{expected} · {(elapsed / 1000).toFixed(0)} 秒
          </span>
        </div>
        <Progress value={value} />
        <p className="text-xs text-muted-foreground">长上下文、重复次数与多模型会显著延长检测时间，请保持页面打开。</p>
      </div>
      {multi ? (
        <div className="space-y-4">
          {models.map((m) => {
            const own = steps.filter((s) => s.model === m);
            const done = doneModels.includes(m);
            return (
              <details key={m} className="rounded-lg border p-3" open={models.length <= 3}>
                <summary className="flex cursor-pointer items-center gap-2 text-sm">
                  {done ? <CheckCircle2 className="size-4 text-emerald-600" /> : <Loader2 className="size-4 animate-spin text-primary" />}
                  <span className="font-mono">{m}</span>
                  <span className="ml-auto text-xs tabular-nums text-muted-foreground">{own.filter((s) => s.state !== "running").length} 步完成</span>
                </summary>
                <div className="pt-3">
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
