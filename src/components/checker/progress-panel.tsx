"use client";

import { CheckCircle2, CircleDashed, Loader2, XCircle } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export interface StepState {
  key: string;
  group: string;
  label: string;
  state: "running" | "done" | "failed";
  detail?: string;
}

const GROUPS: Record<string, string> = {
  detect: "协议识别",
  fingerprint: "模型指纹",
  tokenizer: "分词器探测",
  degradation: "降智检测",
};

export function ProgressPanel({ steps, expected, elapsed, stage }: { steps: StepState[]; expected: number; elapsed: number; stage: string }) {
  const finished = steps.filter((s) => s.state !== "running" && s.group !== "detect").length;
  const value = expected ? Math.min(100, Math.round((finished / expected) * 100)) : 0;
  const groups = Object.keys(GROUPS).filter((g) => steps.some((s) => s.group === g));
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin text-primary" />
            {stage || "准备中"}
          </span>
          <span className="tabular-nums text-muted-foreground">
            {finished}/{expected} · {(elapsed / 1000).toFixed(0)} 秒
          </span>
        </div>
        <Progress value={value} />
        <p className="text-xs text-muted-foreground">模型生成较慢时整个检测可能需要 1–5 分钟，请保持页面打开。</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {groups.map((group) => (
          <div key={group} className="space-y-1.5">
            <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{GROUPS[group]}</h4>
            <ul className="space-y-1">
              {steps
                .filter((s) => s.group === group)
                .map((s) => (
                  <li key={s.key} className="flex items-start gap-2 text-sm">
                    {s.state === "running" ? (
                      <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" />
                    ) : s.state === "done" ? (
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                    ) : (
                      <XCircle className="mt-0.5 size-4 shrink-0 text-red-500" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className={cn(s.state === "running" && "text-muted-foreground")}>{s.label}</span>
                      {s.detail && <span className="block truncate text-xs text-muted-foreground">{s.detail}</span>}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
        {!groups.length && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CircleDashed className="size-4" /> 正在连接目标接口…
          </div>
        )}
      </div>
    </div>
  );
}
