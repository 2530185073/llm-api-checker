"use client";

import { Activity, Brain, Fingerprint, Layers, ShieldAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MultiReport, ProgressEvent } from "@/lib/checker/types";
import { detectVendor } from "@/lib/composition/facts";
import type { Vendor } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import type { CaseCatalog } from "./case-checklist";
import { ComparisonMatrix } from "./comparison-matrix";
import { ConfigForm, INITIAL_FORM, type FormState } from "./config-form";
import { ProgressPanel, type StepState } from "./progress-panel";
import { ReportView } from "./report-view";

export function CheckerApp() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [catalog, setCatalog] = useState<CaseCatalog | null>(null);
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<StepState[]>([]);
  const [stage, setStage] = useState("");
  const [doneModels, setDoneModels] = useState<string[]>([]);
  const [report, setReport] = useState<MultiReport | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(0);
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/cases")
      .then((r) => r.json())
      .then((d: CaseCatalog) => setCatalog(d))
      .catch(() => toast.error("用例清单加载失败"));
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, [running]);

  const perModel = (m: string) => {
    const v = form.vendor === "auto" ? detectVendor(m) : form.vendor;
    const comp = form.composition && v && catalog ? (form.selected[v as Vendor] ?? catalog.defaults[v as Vendor] ?? []).length : 0;
    return (form.fingerprint ? 4 + (form.tokenizer ? 1 : 0) : 0) + (form.degradation ? 8 + form.visualPresets.length : 0) + comp;
  };
  const expected = form.models.reduce((s, m) => s + perModel(m), 0);

  function handle(event: ProgressEvent) {
    if (event.type === "stage") setStage(event.model ? `${event.model} · ${event.message}` : event.message);
    else if (event.type === "step") {
      const key = `${event.model ?? ""}:${event.group}:${event.id}`;
      setSteps((prev) => {
        const step = { key, model: event.model, group: event.group, label: event.label, state: event.state, detail: event.detail };
        const index = prev.findIndex((s) => s.key === key);
        if (index === -1) return [...prev, step];
        const copy = [...prev];
        copy[index] = step;
        return copy;
      });
    } else if (event.type === "model") {
      setDoneModels((prev) => [...prev, event.model]);
      if (event.error) toast.error(`${event.model}：${event.error}`);
    } else if (event.type === "result") {
      setReport(event.report);
      setActive(event.report.reports.length > 1 ? null : event.report.reports[0]?.target.model ?? null);
    } else if (event.type === "error") setError(event.message);
  }

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSteps([]);
    setDoneModels([]);
    setStage("正在连接");
    setReport(null);
    setError(null);
    setStartedAt(Date.now());
    setNow(Date.now());
    const f = form;
    try {
      const res = await fetch("/api/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: f.baseUrl,
          apiKey: f.apiKey,
          models: f.models,
          protocol: f.protocol,
          effort: f.effort,
          judgeMode: f.judgeMode,
          fingerprint: f.fingerprint,
          tokenizer: f.tokenizer,
          degradation: f.degradation,
          visualPresets: f.visualPresets,
          visualTimeoutMin: f.visualTimeoutMin,
          repeat: f.repeat,
          concurrency: f.concurrency,
          composition: {
            enabled: f.composition,
            vendor: f.vendor,
            mode: f.mode,
            selected: f.selected,
            ladderMax: f.ladderMax,
            secondModel: f.secondModel,
            ref: f.refBaseUrl.trim() && f.refApiKey.trim() ? { baseUrl: f.refBaseUrl, apiKey: f.refApiKey, model: f.refModel } : null,
          },
        }),
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

  const reports = report?.reports ?? [];
  const shown = reports.find((r) => r.target.model === active);

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6 sm:px-6 lg:py-10">
      <header className="mb-6 flex flex-col gap-2 sm:mb-8">
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <ShieldAlert className="size-4" /> LLM API 鉴真
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">这个 API 背后真的是你买的模型吗？</h1>
        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          填入中转站或第三方接口的 Base URL 与 Key，可一次选多个模型并排对比：<b className="text-foreground">模型指纹</b>（实际模型是谁）、<b className="text-foreground">渠道成分</b>（协议、计费、参数校验与身份是否像官方）与{" "}
          <b className="text-foreground">降智报告</b>（推理能力、上下文、延迟是否缩水）。支持 Claude、OpenAI、Gemini、GLM、Kimi、DeepSeek。
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader>
            <CardTitle>检测配置</CardTitle>
          </CardHeader>
          <CardContent>
            <ConfigForm form={form} setForm={setForm} running={running} onStart={start} onCancel={() => abortRef.current?.abort()} catalog={catalog} />
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
                <ProgressPanel steps={steps} expected={expected} elapsed={now - startedAt} stage={stage} models={form.models} doneModels={doneModels} />
              </CardContent>
            </Card>
          )}
          {report && reports.length > 1 && <ComparisonMatrix report={report} onPick={(m) => setActive(m)} />}
          {report && reports.length > 1 && (
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="模型详细报告">
              <button type="button" role="tab" aria-selected={active === null} onClick={() => setActive(null)} className={cn("rounded-full border px-3 py-1 text-xs", active === null ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}>
                只看对比
              </button>
              {reports.map((r) => (
                <button
                  key={r.target.model}
                  type="button"
                  role="tab"
                  aria-selected={active === r.target.model}
                  onClick={() => setActive(r.target.model)}
                  className={cn("rounded-full border px-3 py-1 font-mono text-xs", active === r.target.model ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {r.target.model}
                </button>
              ))}
            </div>
          )}
          {shown && <ReportView key={shown.target.model} report={shown} />}
          {report && !reports.length && (
            <Alert variant="destructive">
              <AlertTitle>所有模型都检测失败</AlertTitle>
              <AlertDescription>{report.errors.map((e) => `${e.model}：${e.message}`).join("\n")}</AlertDescription>
            </Alert>
          )}
          {!running && !report && !error && <EmptyState />}
        </div>
      </div>
    </div>
  );
}

function EmptyState() {
  const items = [
    { icon: Fingerprint, title: "数字指纹", text: "让模型凭第一反应写约 300 个 1–355 的整数，与 69 个模型的参考库比对，排出最可能的实际模型。" },
    { icon: Layers, title: "渠道成分", text: "按厂商运行协议保真、usage 计费算术、参数校验、思考与工具、上下文阶梯、分词器指纹等用例，支持官方等价 / 要求官方链路两种评分。" },
    { icon: Brain, title: "降智检测", text: "8 道有标准答案的问答题与 22 道 HTML/SVG 动画题（结果可直接预览），可重复 N 次统计通过率与 P95 延迟。" },
    { icon: Activity, title: "多模型对比", text: "一次选择多个模型，共享并发上限同时检测，结果以对比矩阵并排展示，再逐个下钻查看。" },
  ];
  return (
    <Card className="border-dashed">
      <CardContent className="space-y-5 py-2">
        <div>
          <h3 className="font-medium">检测会做什么</h3>
          <p className="mt-1 text-sm text-muted-foreground">没有可用的 Key？点击左侧“使用演示端点”，内置的模拟上游包含 6 家厂商的正常渠道与两个掺假渠道。</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
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
