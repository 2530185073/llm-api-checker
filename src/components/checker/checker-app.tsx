"use client";

import { ArrowUpRight, Brain, FlaskConical, Fingerprint, Layers, Moon, PanelLeftClose, PanelLeftOpen, ScanSearch, ShieldCheck, Sun, Table2 } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { MultiReport, ProgressEvent } from "@/lib/checker/types";
import { detectVendor } from "@/lib/composition/facts";
import type { Vendor } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import type { CaseCatalog } from "./case-checklist";
import { ComparisonMatrix } from "./comparison-matrix";
import { ConfigForm, INITIAL_FORM, type FormState } from "./config-form";
import { ProgressPanel, type StepState } from "./progress-panel";
import { MonoTag } from "./parts";
import { ReportView } from "./report-view";
import { ScoreRing } from "./score-ring";

const REPO = "https://github.com/2530185073/llm-api-checker";
const VENDOR_STRIP = ["Claude", "OpenAI", "Gemini", "GLM", "Kimi", "DeepSeek"];
const DEMO_MODELS = ["claude-opus-4.8", "claude-sonnet-4.6", "gpt-5.4", "gemini-3.6-flash", "glm-5.3", "kimi-k3", "deepseek-flash", "deepseek-v4-pro"];

export function CheckerApp() {
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [available, setAvailable] = useState<string[]>([]);
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
  const [configOpen, setConfigOpen] = useState(true);
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
  const caseCount = catalog ? Object.values(catalog.cases).reduce((s, list) => s + list.length, 0) : 301;

  function fillDemo() {
    setForm((prev) => ({
      ...prev,
      baseUrl: `${window.location.origin}/api/mock/v1`,
      apiKey: "sk-demo",
      models: ["claude-opus-4.8", "claude-sonnet-4.6", "deepseek-v4-pro"],
      protocol: "auto",
      composition: true,
    }));
    setAvailable(DEMO_MODELS);
    toast.info("已填入内置演示端点：claude-opus-4.8 与 deepseek-v4-pro 是掺假渠道，其余为正常渠道，可点选更多模型对比");
  }

  /** Bring the top of the result column into view unless it is already comfortably visible. */
  function reveal() {
    const el = resultRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (top < 56 || top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: "smooth", block: "start" });
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
      // On a phone the form sits above the report; fold it away so the report comes first.
      if (event.report.reports.length && window.matchMedia("(max-width: 1023px)").matches) setConfigOpen(false);
      setActive(event.report.reports.length > 1 ? null : (event.report.reports[0]?.target.model ?? null));
    } else if (event.type === "error") setError(event.message);
  }

  async function start(models?: string[]) {
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
    const f = models ? { ...form, models } : form;
    if (models) setForm(() => f);
    setTimeout(reveal, 50);
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
      setTimeout(reveal, 50);
    }
  }

  const reports = report?.reports ?? [];
  const shown = reports.find((r) => r.target.model === active);
  const multi = reports.length > 1;
  const pick = (model: string | null) => {
    setActive(model);
    setTimeout(reveal, 50);
  };

  return (
    <div className="relative flex flex-1 flex-col">
      <SiteHeader />

      <main className="relative flex-1">
        <div aria-hidden className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-44 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="relative mx-auto w-full max-w-[1680px] px-4 pb-16 sm:px-6">
          <Intro />

          <div className={cn("grid grid-cols-1 gap-5", configOpen && "lg:grid-cols-[400px_minmax(0,1fr)] lg:gap-6")}>
            <aside className={cn("h-fit rounded-2xl bg-card shadow-raised lg:sticky lg:top-[4.25rem]", !configOpen && "hidden")}>
              <div className="scroll-thin rounded-2xl p-5 sm:p-6 lg:max-h-[calc(100dvh-5.25rem)] lg:overflow-y-auto">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-[15px] font-medium tracking-[-0.01em]">检测配置</h2>
                  <MonoTag>POST /api/check</MonoTag>
                </div>
                <ConfigForm
                  form={form}
                  setForm={setForm}
                  available={available}
                  setAvailable={setAvailable}
                  running={running}
                  onStart={start}
                  onCancel={() => abortRef.current?.abort()}
                  onDemo={fillDemo}
                  catalog={catalog}
                />
              </div>
            </aside>

            <div ref={resultRef} className="min-w-0 scroll-mt-[4.25rem] space-y-4">
              {(report || running || !configOpen) && (
                <div className="flex flex-wrap items-center gap-2">
                  {report && multi && (
                    <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="报告视图">
                      <ModelTab selected={active === null} onClick={() => pick(null)}>
                        对比总览
                      </ModelTab>
                      {reports.map((r) => (
                        <ModelTab key={r.target.model} selected={active === r.target.model} onClick={() => pick(r.target.model)} mono>
                          {r.target.model}
                        </ModelTab>
                      ))}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setConfigOpen((v) => !v)}
                    aria-expanded={configOpen}
                    className="ml-auto inline-flex h-7 items-center gap-1.5 rounded-full bg-fill-2 px-3 text-xs text-fg-2 transition-colors hover:bg-fill-3 hover:text-foreground"
                  >
                    {configOpen ? <PanelLeftClose className="size-3.5" /> : <PanelLeftOpen className="size-3.5" />}
                    {configOpen ? "收起配置" : "展开配置"}
                  </button>
                </div>
              )}
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>检测未完成</AlertTitle>
                  <AlertDescription className="break-all whitespace-pre-wrap">{error}</AlertDescription>
                </Alert>
              )}
              {running && (
                <div className="rounded-2xl bg-card p-5 shadow-raised sm:p-6">
                  <ProgressPanel steps={steps} expected={expected} elapsed={now - startedAt} stage={stage} models={form.models} doneModels={doneModels} />
                </div>
              )}
              {report && multi && active === null && <ComparisonMatrix report={report} onPick={pick} />}
              {shown && <ReportView key={shown.target.model} report={shown} />}
              {report && !reports.length && (
                <Alert variant="destructive">
                  <AlertTitle>所有模型都检测失败</AlertTitle>
                  <AlertDescription>{report.errors.map((e) => `${e.model}：${e.message}`).join("\n")}</AlertDescription>
                </Alert>
              )}
              {!running && !report && !error && <EmptyState caseCount={caseCount} onDemo={fillDemo} />}
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}

function ModelTab({ selected, onClick, mono, children }: { selected: boolean; onClick: () => void; mono?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        "h-7 rounded-full px-3 text-xs transition-colors",
        mono && "font-mono",
        selected ? "bg-primary text-primary-foreground" : "bg-fill-2 text-fg-2 hover:bg-fill-3 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function GithubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={className} fill="currentColor">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid size-6 place-items-center rounded-[7px] bg-foreground text-background">
        <ScanSearch className="size-3.5" strokeWidth={2.25} />
      </span>
      <span className="text-[14px] font-semibold tracking-[-0.01em]">API 鉴真</span>
    </span>
  );
}

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <button
      type="button"
      aria-label="切换深浅色"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="grid size-8 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-foreground"
    >
      <Moon className="size-4 dark:hidden" />
      <Sun className="hidden size-4 dark:block" />
    </button>
  );
}

function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 border-b border-line-1">
      <div className="mx-auto flex h-14 w-full max-w-[1680px] items-center justify-between px-4 sm:px-6">
        <Logo />
        <div className="flex items-center gap-1">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub 仓库"
            className="grid size-8 place-items-center rounded-full text-fg-2 transition-colors hover:bg-fill-2 hover:text-foreground"
          >
            <GithubMark className="size-4" />
          </a>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function Intro() {
  return (
    <div className="flex flex-col gap-3 pt-6 pb-5 lg:flex-row lg:items-end lg:justify-between lg:gap-8 lg:pt-7">
      <div className="animate-rise min-w-0">
        <h1 className="text-[24px] leading-[1.2] tracking-[-0.02em] sm:text-[30px]">
          <span className="block font-semibold sm:inline">这个 API 背后，</span>
          <span className="block font-serif text-fg-3 sm:inline">真是你买的模型吗？</span>
        </h1>
        <p className="mt-2 max-w-4xl text-[13px] leading-6 text-fg-2 sm:text-sm">
          填入中转站或第三方接口的 Base URL 与 Key，一次检测给出三份报告：实际在跑的是哪个模型，渠道像不像官方，能力有没有缩水。
        </p>
      </div>
      <ul className="flex shrink-0 flex-wrap gap-1.5" aria-label="覆盖的渠道">
        {VENDOR_STRIP.map((v) => (
          <li key={v} className="rounded-full bg-fill-2 px-2.5 py-1 text-xs text-fg-2">
            {v}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EmptyState({ caseCount, onDemo }: { caseCount: number; onDemo: () => void }) {
  const items = [
    { icon: Fingerprint, title: "模型指纹", text: "让模型凭第一反应写约 300 个 1–355 的整数，再结合分词器与响应元数据，从参考库里排出最可能的实际模型。", tag: "69 个参考模型" },
    { icon: Layers, title: "渠道成分", text: "协议保真、流式语法、usage 计费算术、参数校验、思考与工具、上下文阶梯，逐项核对像不像官方。", tag: `6 家 · ${caseCount} 条用例` },
    { icon: Brain, title: "降智检测", text: "有标准答案的问答题，加上直接在页面里渲染预览的 HTML / SVG 动画题，可重复 N 次看通过率与 P95。", tag: "8 问答 + 22 动画" },
    { icon: Table2, title: "多模型对比", text: "一次选多个模型，共享并发上限同时检测，结果先以对比矩阵并排展示，再逐个下钻。", tag: "最多 12 个" },
  ];
  return (
    <div className="relative overflow-hidden rounded-2xl bg-card shadow-raised">
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between sm:p-6">
        <div>
          <h2 className="text-[15px] font-medium tracking-[-0.01em]">报告会出现在这里</h2>
          <p className="mt-1 max-w-xl text-[13px] leading-6 text-fg-2">还没有可用的 Key？内置的模拟上游有 6 家厂商的正常渠道和两个掺假渠道，可以先跑一遍看看。</p>
        </div>
        <Button variant="outline" onClick={onDemo} className="self-start sm:self-auto">
          <FlaskConical className="size-4" /> 填入演示端点
        </Button>
      </div>
      <ul className="grid gap-px border-t border-line-1 bg-line-1 sm:grid-cols-2">
        {items.map(({ icon: Icon, title, text, tag }) => (
          <li key={title} className="bg-card p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2.5">
                <span className="grid size-8 place-items-center rounded-lg bg-fill-2 text-fg-2">
                  <Icon className="size-4" />
                </span>
                <span className="text-sm font-medium">{title}</span>
              </span>
              <MonoTag>{tag}</MonoTag>
            </div>
            <p className="mt-3 text-[13px] leading-6 text-fg-2">{text}</p>
          </li>
        ))}
      </ul>
      <div className="border-t border-line-1 p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs text-fg-3">
          结论长这样 <MonoTag>示例 · 内置演示端点里的掺假渠道</MonoTag>
        </div>
        <div className="mt-4 flex flex-col gap-5 sm:flex-row sm:items-center sm:gap-7">
          <ScoreRing score={22} tone="bad" size={96} label="综合评分" />
          <div className="min-w-0 flex-1">
            <div className="font-serif text-[28px] leading-none tracking-[-0.02em] text-danger">高风险</div>
            <p className="mt-2.5 max-w-3xl text-[13px] leading-6 text-fg-2">
              声称 <span className="font-mono text-[12px] text-foreground">claude-opus-4.8</span>，指纹最像 <span className="font-mono text-[12px] text-danger">deepseek-v4-flash</span>（置信度
              &gt;99.9%）；渠道成分 36 分，检出模型被替换、协议转换层等关键问题；智力得分 31 分。
            </p>
          </div>
        </div>
      </div>
      <p className="flex gap-2.5 border-t border-line-1 bg-fill-1 px-5 py-3.5 text-xs leading-5 text-fg-2 sm:px-6">
        <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-success" />
        检测会向被测接口发出真实请求并产生用量：指纹与降智约 27 次，渠道成分按清单约 150–400 次，可在用例清单里按需取消。
      </p>
    </div>
  );
}

function SiteFooter() {
  return (
    <footer className="border-t border-line-1">
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-3 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-8">
        <p className="max-w-4xl text-xs leading-5 text-fg-3">
          API Key 只放在发往本服务的请求体里，由服务端在本次检测期间转发给对应接口，不写日志、不落盘、不回传；进度流与报告中出现的 Key 会被替换为 [REDACTED]。
        </p>
        <a
          href={REPO}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1.5 self-start rounded-full bg-fill-2 px-3 py-1.5 text-xs text-fg-2 transition-colors hover:bg-fill-3 hover:text-foreground md:self-auto"
        >
          <GithubMark className="size-3.5" /> 源码 <ArrowUpRight className="size-3.5" />
        </a>
      </div>
    </footer>
  );
}
