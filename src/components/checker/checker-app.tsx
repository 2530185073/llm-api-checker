"use client";

import { Activity, Brain, Fingerprint, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CheckReport, ProgressEvent } from "@/lib/checker/types";
import { ConfigForm, INITIAL_FORM, type FormState } from "./config-form";
import { ProgressPanel, type StepState } from "./progress-panel";
import { ReportView } from "./report-view";

export function CheckerApp() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [stage, setStage] = useState("");
  const [report, setReport] = useState<CheckReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const expected = (form.fingerprint ? 4 + (form.tokenizer ? 1 : 0) : 0) + (form.degradation ? 8 + form.visualPresets.length : 0);

  function handle(event: ProgressEvent) {
    if (event.type === "stage") setStage(event.message);
    else if (event.type === "step") {
      const key = `${event.group}:${event.id}`;
      setSteps((prev) => {
        const next = prev.filter((s) => s.key !== key);
        const index = prev.findIndex((s) => s.key === key);
        const step = { key, group: event.group, label: event.label, state: event.state, detail: event.detail };
        if (index === -1) return [...next, step];
        const copy = [...prev];
        copy[index] = step;
        return copy;
      });
    } else if (event.type === "result") setReport(event.report);
    else if (event.type === "error") setError(event.message);
  }

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSteps([]);
    setStage("正在连接");
    setReport(null);
    setError(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) handle(JSON.parse(line) as ProgressEvent);
        }
        if (done) break;
      }
    } catch (err) {
      if (controller.signal.aborted) toast.info("检测已停止");
      else setError((err as Error).message || "检测失败");
    } finally {
      setRunning(false);
      abortRef.current = null;
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-col gap-2 sm:mb-8">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <ShieldAlert className="size-4" /> LLM API 鉴真
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">这个 API 背后真的是你买的模型吗？</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          填入中转站或第三方接口的 Base URL 与 Key，一次检测同时给出 <b className="text-foreground">模型指纹报告</b>（实际模型是谁）和{" "}
          <b className="text-foreground">降智报告</b>（推理能力、上下文、延迟是否缩水）。支持 OpenAI Chat / Responses 与 Anthropic Messages。
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>检测配置</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfigForm form={form} setForm={setForm} running={running} onStart={start} onCancel={() => abortRef.current?.abort()} />
          </CardContent>
        </Card>

        <div ref={resultRef} className="min-w-0 scroll-mt-4 space-y-5">
          {error && (
            <Alert variant="destructive">
              <AlertTitle>检测未完成</AlertTitle>
              <AlertDescription className="whitespace-pre-wrap break-all">{error}</AlertDescription>
            </Alert>
          )}
          {running && (
            <Card>
              <CardContent>
                <ProgressPanel steps={steps} expected={expected} elapsed={now - startedAt} stage={stage} />
              </CardContent>
            </Card>
          )}
          {report && <ReportView report={report} />}
          {!running && !report && !error && <EmptyState />}
        </div>
      </div>

    </div>
  );
}

function EmptyState() {
  const items = [
    {
      icon: Fingerprint,
      title: "数字指纹",
      text: "让模型凭第一反应写约 300 个 1–355 的整数。每个模型偏好的数值、区间与末位数字都很稳定，与 69 个模型的参考库比对即可排名。",
    },
    {
      icon: Activity,
      title: "分词器探测",
      text: "发送多条极短的探针文本，用 usage 中的输入 token 差值识别上游分词器，并与所填模型的官方分词器核对。",
    },
    {
      icon: Brain,
      title: "降智检测",
      text: "8 道有标准答案的推理、代码、指令遵循与长上下文题，加上「鹈鹕骑自行车」等 HTML/SVG 动画题（结果可直接预览），逐题记录 TTFT、耗时和 token 用量，按权重给出智力得分。",
    },
  ];
  return (
    <Card className="border-dashed">
      <CardContent className="space-y-5 py-2">
        <div>
          <h3 className="font-medium">检测会做什么</h3>
          <p className="mt-1 text-sm text-muted-foreground">没有可用的 Key？点击左侧“使用演示端点”，体验一个冒充 Claude 且降智的模拟渠道。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {items.map(({ icon: Icon, title, text }) => (
            <div key={title} className="rounded-lg border bg-muted/20 p-4">
              <Icon className="size-5 text-primary" />
              <div className="mt-2 text-sm font-medium">{title}</div>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
