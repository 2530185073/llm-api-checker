"use client";

import { Brain, ChevronDown, Fingerprint, FlaskConical, Layers, Play, Plug, ShieldAlert, SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { DetectorMeta } from "@/lib/checker/fingerprint";
import type { MultiReport, ProgressEvent } from "@/lib/checker/types";
import { detectVendor } from "@/lib/composition/facts";
import type { Vendor } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import type { CaseCatalog } from "./case-checklist";
import { ComparisonMatrix } from "./comparison-matrix";
import { ConfigForm, DEMO_MODELS, INITIAL_FORM, type FormState } from "./config-form";
import { ProgressPanel, type StepState } from "./progress-panel";
import { ReportView } from "./report-view";

export function CheckerApp({ initialCatalog = null, initialMeta }: { initialCatalog?: CaseCatalog | null; initialMeta?: DetectorMeta }) {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [available, setAvailable] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CaseCatalog | null>(initialCatalog);
  const [meta, setMeta] = useState<DetectorMeta>(initialMeta ?? { modelCount: 75, builtAt: null });
  const [configOpen, setConfigOpen] = useState(true);
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
      .then((d: CaseCatalog & { detector?: DetectorMeta }) => {
        if (!initialCatalog) setCatalog(d);
        if (d.detector) setMeta(d.detector);
      })
      .catch(() => {
        if (!initialCatalog) toast.error("用例清单加载失败");
      });
  }, [initialCatalog]);

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

  function applyDemo() {
    setForm((prev) => ({
      ...prev,
      baseUrl: `${window.location.origin}/api/mock/v1`,
      apiKey: "sk-demo",
      models: ["claude-opus-4.8", "claude-sonnet-4.6", "deepseek-v4-pro"],
      protocol: "auto",
      composition: true,
    }));
    setAvailable(DEMO_MODELS);
    setConfigOpen(true);
    toast.info("已填入演示端点：claude-opus-4.8 与 deepseek-v4-pro 为掺假渠道，其余 6 个为正常渠道");
  }

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
      setConfigOpen(false);
    } else if (event.type === "error") setError(event.message);
  }

  async function start() {
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setConfigOpen(false);
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
            allowNative: f.protocol !== "auto" && f.allowNative,
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
      try {
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
      } finally {
        reader.releaseLock();
      }
    } catch (err) {
      if (controller.signal.aborted) toast.info("检测已停止");
      else {
        setError((err as Error).message || "检测失败");
        setConfigOpen(true);
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  }

  const reports = report?.reports ?? [];
  const shown = reports.find((r) => r.target.model === active);
  const totalCases = catalog ? Object.values(catalog.cases).reduce((s, arr) => s + arr.length, 0) : 301;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-5 px-4 py-6 sm:px-6 lg:py-8">
      {/* Compact Header */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-sm font-semibold text-primary">
            <ShieldAlert className="size-4" />
            <span>LLM API 鉴真</span>
            <span className="text-muted-foreground/50">·</span>
            <span className="font-normal text-muted-foreground">Claude / OpenAI / Gemini / GLM / Kimi / DeepSeek</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">验证 API 背后的真实模型、渠道成分与是否降智</h1>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
          <span className="rounded-full border bg-card px-3 py-1">
            指纹库 <b className="font-semibold text-foreground">{meta.modelCount}</b> 模型
            {meta.builtAt ? ` · ${meta.builtAt.slice(0, 10)}` : ""}
          </span>
        </div>
      </header>

      {/* Top Config Workbench (or compact summary bar when running / viewing results) */}
      <Card>
        {!configOpen && (running || report) ? (
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-medium text-foreground">{report?.host || form.baseUrl}</span>
              <span className="text-muted-foreground">·</span>
              <span className="font-mono text-[13px] text-muted-foreground">
                {form.models.length <= 3 ? form.models.join(", ") : `${form.models.slice(0, 2).join(", ")} 等 ${form.models.length} 个模型`}
              </span>
              <span className="text-muted-foreground">·</span>
              <span className="text-muted-foreground">协议：{form.protocol === "auto" ? "自动识别" : form.protocol}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
                <SlidersHorizontal className="size-4" /> 修改配置
              </Button>
              {!running && (
                <Button type="button" size="sm" onClick={start}>
                  <Play className="size-4" /> 重新检测
                </Button>
              )}
            </div>
          </CardContent>
        ) : (
          <CardContent className="space-y-2">
            {report && (
              <div className="flex items-center justify-between pb-1">
                <span className="text-sm font-semibold text-foreground">检测配置</span>
                <button
                  type="button"
                  onClick={() => setConfigOpen(false)}
                  className="inline-flex items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground"
                >
                  收起配置 <ChevronDown className="size-4 rotate-180" />
                </button>
              </div>
            )}
            <ConfigForm
              form={form}
              setForm={setForm}
              running={running}
              onStart={start}
              onCancel={() => abortRef.current?.abort()}
              onDemo={applyDemo}
              catalog={catalog}
              available={available}
              setAvailable={setAvailable}
            />
          </CardContent>
        )}
      </Card>

      {/* Main Results / Progress / Compact Overview */}
      <main ref={resultRef} className="min-w-0 space-y-5">
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

        {report && reports.length > 1 && (
          <div className="space-y-4">
            <ComparisonMatrix report={report} activeModel={active} onPick={(m) => setActive(m === active ? null : m)} />
            {shown && (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5" role="tablist" aria-label="切换模型详细报告">
                    {reports.map((r) => (
                      <button
                        key={r.target.model}
                        type="button"
                        role="tab"
                        aria-selected={active === r.target.model}
                        onClick={() => setActive(r.target.model)}
                        className={cn(
                          "rounded-full border px-3.5 py-1.5 font-mono text-sm transition-colors",
                          active === r.target.model ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {r.target.model}
                      </button>
                    ))}
                  </div>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setActive(null)}>
                    收起详情
                  </Button>
                </div>
                <ReportView key={shown.target.model} report={shown} />
              </div>
            )}
          </div>
        )}

        {report && reports.length === 1 && shown && <ReportView key={shown.target.model} report={shown} />}

        {report && !reports.length && (
          <Alert variant="destructive">
            <AlertTitle>所有模型都检测失败</AlertTitle>
            <AlertDescription>{report.errors.map((e) => `${e.model}：${e.message}`).join("\n")}</AlertDescription>
          </Alert>
        )}

        {!running && !report && !error && <EmptyOverview meta={meta} totalCases={totalCases} onDemo={applyDemo} />}
      </main>
    </div>
  );
}

function EmptyOverview({ meta, totalCases, onDemo }: { meta: DetectorMeta; totalCases: number; onDemo: () => void }) {
  const highlights = [
    { icon: Fingerprint, stat: `${meta.modelCount} 个参考模型`, title: "数字指纹 + 分词器", desc: "识别中转站背后真实模型，揪出套壳掉包" },
    { icon: Layers, stat: `6 家 · ${totalCases} 用例`, title: "渠道成分核验", desc: "协议保真、usage 计费算术、参数与注入检测" },
    { icon: Brain, stat: "8 问答 + 22 动画", title: "降智与耗时评估", desc: "客观推理题 + 沙箱动画渲染，支持重复测 P95" },
    { icon: Plug, stat: "4 大原生协议", title: "Chat / Responses / Messages / Gemini", desc: "自动探测或强制锁定，绝不偷偷回退协议" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {highlights.map(({ icon: Icon, stat, title, desc }) => (
          <div key={title} className="rounded-xl border bg-card p-4">
            <div className="flex items-center justify-between gap-2">
              <Icon className="size-5 text-primary" />
              <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-foreground">{stat}</span>
            </div>
            <div className="mt-3 text-[15px] font-semibold text-foreground">{title}</div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed bg-card/60 px-5 py-3.5">
        <p className="text-sm text-muted-foreground">
          手头没有 Key？内置模拟上游包含 <b className="font-medium text-foreground">6 家正常渠道</b> 与 <b className="font-medium text-foreground">2 个掺假渠道</b>，可一键跑通全套报告。
        </p>
        <Button type="button" variant="secondary" size="sm" onClick={onDemo}>
          <FlaskConical className="size-4" /> 一键填入演示端点
        </Button>
      </div>
    </div>
  );
}
