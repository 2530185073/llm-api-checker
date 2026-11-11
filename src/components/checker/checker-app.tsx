"use client";

import { ArrowRight, ArrowUpRight, Brain, FlaskConical, Fingerprint, KeyRound, Layers, Moon, ScanSearch, Server, ShieldCheck, Sun, Table2, Waypoints } from "lucide-react";
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
import { MonoTag, ToneBadge, Tray } from "./parts";
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
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const checkRef = useRef<HTMLElement>(null);

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

  const scrollToCheck = () => checkRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

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

  return (
    <div className="relative flex flex-1 flex-col">
      <SiteHeader />

      <main className="flex-1">
        <Hero
          onStart={scrollToCheck}
          onDemo={() => {
            fillDemo();
            scrollToCheck();
          }}
        />

        <section id="check" ref={checkRef} className="mx-auto w-full max-w-7xl scroll-mt-16 px-4 pb-24 sm:px-6 lg:px-8">
          <SectionHeading lead="填好接口，" tail="一次看清" note="Base URL 与 Key 由本服务转发到被测接口，检测期间实时显示进度；多个模型会在结果里并排对比，再逐个下钻。" />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:gap-8">
            <div className="h-fit rounded-[28px] bg-surface-1 p-1.5 ring-1 ring-line-1 lg:sticky lg:top-[4.5rem]">
              <div className="scroll-thin rounded-[22px] bg-card p-5 shadow-raised sm:p-6 lg:max-h-[calc(100dvh-6.25rem)] lg:overflow-y-auto">
                <div className="mb-5 flex items-center justify-between">
                  <h3 className="text-[15px] font-medium tracking-[-0.01em]">检测配置</h3>
                  <span className="rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">POST /api/check</span>
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
            </div>

            <div ref={resultRef} className="min-w-0 scroll-mt-20 space-y-5">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>检测未完成</AlertTitle>
                  <AlertDescription className="whitespace-pre-wrap break-all">{error}</AlertDescription>
                </Alert>
              )}
              {running && (
                <div className="rounded-2xl bg-card p-5 shadow-raised sm:p-6">
                  <ProgressPanel steps={steps} expected={expected} elapsed={now - startedAt} stage={stage} models={form.models} doneModels={doneModels} />
                </div>
              )}
              {report && reports.length > 1 && <ComparisonMatrix report={report} onPick={(m) => setActive(m)} />}
              {report && reports.length > 1 && (
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="模型详细报告">
                  <ModelTab selected={active === null} onClick={() => setActive(null)}>
                    只看对比
                  </ModelTab>
                  {reports.map((r) => (
                    <ModelTab key={r.target.model} selected={active === r.target.model} onClick={() => setActive(r.target.model)} mono>
                      {r.target.model}
                    </ModelTab>
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
              {!running && !report && !error && <EmptyState caseCount={caseCount} onDemo={fillDemo} />}
            </div>
          </div>
        </section>

        <HowItWorks caseCount={caseCount} />
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
        "rounded-full px-3 py-1 text-xs transition-colors",
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
  const links = [
    { href: "#check", label: "检测" },
    { href: "#how", label: "原理" },
    { href: "#privacy", label: "隐私" },
  ];
  return (
    <header className="glass sticky top-0 z-40 border-b border-line-1">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="#" aria-label="回到顶部">
          <Logo />
        </a>
        <nav className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {links.map((l) => (
            <a key={l.href} href={l.href} className="rounded-full px-3 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-fill-2 hover:text-foreground">
              {l.label}
            </a>
          ))}
        </nav>
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

function Hero({ onStart, onDemo }: { onStart: () => void; onDemo: () => void }) {
  return (
    <section className="relative overflow-hidden">
      <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black_30%,transparent_95%)]" />
      <div className="relative mx-auto w-full max-w-7xl px-4 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:px-8">
        <div className="grid items-center gap-12 xl:grid-cols-[minmax(0,1fr)_minmax(0,430px)]">
          <div>
            <div className="animate-rise">
              <span className="inline-flex items-center gap-2 rounded-full bg-background p-1 pr-3 text-xs shadow-raised">
                <span className="rounded-full bg-fill-3 px-2 py-0.5 font-medium">开源</span>
                <span className="text-fg-2">可自托管 · Key 不写日志、不落盘</span>
              </span>
            </div>
            <h1 className="mt-7 text-[40px] leading-[1.08] tracking-[-0.025em] sm:text-[60px] xl:text-[72px]" style={{ animationDelay: "60ms" }}>
              <span className="animate-rise block font-semibold">这个 API 背后，</span>
              <span className="animate-rise block font-serif text-fg-3" style={{ animationDelay: "120ms" }}>
                真是你买的模型吗？
              </span>
            </h1>
            <p className="animate-rise mt-7 max-w-xl text-[15px] leading-7 text-fg-2 sm:text-base" style={{ animationDelay: "180ms" }}>
              填入中转站或第三方接口的 Base URL 与 Key，一次检测给出三份报告：实际在跑的是哪个模型，渠道像不像官方，能力有没有缩水。
            </p>
            <div className="animate-rise mt-9 flex flex-wrap items-center gap-2.5" style={{ animationDelay: "240ms" }}>
              <Button size="lg" onClick={onStart}>
                开始检测 <ArrowRight className="size-4" />
              </Button>
              <Button size="lg" variant="secondary" onClick={onDemo}>
                <FlaskConical className="size-4" /> 用演示端点试试
              </Button>
              <a href={REPO} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center gap-1.5 px-3 text-sm text-fg-2 transition-colors hover:text-foreground">
                <GithubMark className="size-4" /> GitHub
              </a>
            </div>
          </div>
          <HeroSample onDemo={onDemo} />
        </div>

        <div className="animate-rise mt-16 flex flex-wrap items-center gap-x-8 gap-y-3 sm:mt-20" style={{ animationDelay: "300ms" }}>
          <span className="text-xs text-fg-3">覆盖的渠道</span>
          {VENDOR_STRIP.map((v) => (
            <span key={v} className="text-[15px] font-medium tracking-[-0.01em] text-fg-3 transition-colors hover:text-foreground">
              {v}
            </span>
          ))}
          <span className="font-mono text-[11px] text-fg-4">Chat · Responses · Messages · generateContent</span>
        </div>
      </div>
    </section>
  );
}

/** A static example of what a report looks like, taken from the built-in demo upstream. */
function HeroSample({ onDemo }: { onDemo: () => void }) {
  const rows = [
    { label: "指纹判定", value: "不一致", tone: "text-danger" },
    { label: "成分得分", value: "36", tone: "text-danger" },
    { label: "智力得分", value: "31", tone: "text-danger" },
  ];
  return (
    <div className="animate-rise hidden xl:block" style={{ animationDelay: "260ms" }}>
      <Tray className="shadow-float">
        <div className="flex items-center justify-between px-5 pt-4">
          <span className="flex items-center gap-2 text-xs text-fg-3">
            示例报告 <MonoTag>内置演示端点</MonoTag>
          </span>
          <ToneBadge tone="bad">高风险</ToneBadge>
        </div>
        <div className="flex items-center gap-5 px-5 pt-4 pb-5">
          <ScoreRing score={22} tone="bad" size={104} label="综合评分" />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <div className="text-[11px] text-fg-3">声称的模型</div>
              <div className="mt-0.5 truncate font-mono text-[13px] font-medium">claude-opus-4.8</div>
            </div>
            <div className="h-px bg-line-1" />
            <div>
              <div className="text-[11px] text-fg-3">最可能的实际模型</div>
              <div className="mt-0.5 truncate font-mono text-[13px] font-medium text-danger">deepseek-v4-flash</div>
              <div className="mt-0.5 text-[11px] text-fg-3">置信度 &gt;99.9%</div>
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-3 border-t border-line-1">
          {rows.map((r, i) => (
            <div key={r.label} className={cn("px-5 py-3.5", i > 0 && "border-l border-line-1")}>
              <dd className={cn("text-[18px] leading-6 font-medium tracking-[-0.02em] tabular-nums", r.tone)}>{r.value}</dd>
              <dt className="mt-0.5 text-[11px] text-fg-3">{r.label}</dt>
            </div>
          ))}
        </dl>
        <div className="flex items-center justify-between gap-3 border-t border-line-1 bg-fill-1 px-5 py-3">
          <span className="text-xs leading-5 text-fg-2">演示端点里一个掺假渠道的检测结果</span>
          <button
            type="button"
            onClick={onDemo}
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-background px-3 py-1 text-xs font-medium shadow-raised transition-colors hover:bg-fill-2"
          >
            自己跑一遍 <ArrowRight className="size-3" />
          </button>
        </div>
      </Tray>
    </div>
  );
}

function SectionHeading({ lead, tail, note, eyebrow }: { lead: string; tail: string; note?: string; eyebrow?: string }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:mb-10 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && <p className="mb-3 text-xs text-fg-3">{eyebrow}</p>}
        <h2 className="font-serif text-[32px] leading-[1.15] tracking-[-0.02em] sm:text-[44px]">
          <span>{lead}</span>
          <span className="text-fg-3">{tail}</span>
        </h2>
      </div>
      {note && <p className="max-w-sm text-[13px] leading-6 text-fg-2 md:text-right">{note}</p>}
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
    <div className="rounded-[28px] bg-surface-1 p-1.5 ring-1 ring-line-1">
      <div className="relative overflow-hidden rounded-[22px] bg-card px-5 py-6 shadow-raised sm:px-7 sm:py-7">
        <div aria-hidden className="dot-grid pointer-events-none absolute inset-x-0 top-0 h-40 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h3 className="text-[15px] font-medium tracking-[-0.01em]">检测会做什么</h3>
            <p className="mt-1 max-w-md text-[13px] leading-6 text-fg-2">报告会出现在这里。还没有可用的 Key？内置的模拟上游有 6 家厂商的正常渠道和两个掺假渠道，可以先跑一遍看看。</p>
          </div>
          <Button variant="outline" size="sm" onClick={onDemo} className="self-start">
            <FlaskConical className="size-3.5" /> 填入演示端点
          </Button>
        </div>
        <ul className="relative mt-6 divide-y divide-line-1">
          {items.map(({ icon: Icon, title, text, tag }) => (
            <li key={title} className="flex gap-4 py-4 first:pt-0 last:pb-0">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-background text-fg-2 shadow-raised">
                <Icon className="size-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3">{tag}</span>
                </div>
                <p className="mt-1 text-[13px] leading-6 text-fg-2">{text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function FlowNode({ icon: Icon, title, sub, mono, highlight, className }: { icon: typeof KeyRound; title: string; sub: string; mono?: boolean; highlight?: boolean; className?: string }) {
  return (
    <div className={cn("relative z-10 flex items-center gap-3 rounded-xl bg-background/90 p-3 shadow-float backdrop-blur", highlight && "ring-1 ring-brand/40", className)}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill-2 text-fg-2">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium">{title}</span>
        <span className={cn("block truncate text-[11px] text-fg-3", mono && "font-mono")}>{sub}</span>
      </span>
    </div>
  );
}

function HowItWorks({ caseCount }: { caseCount: number }) {
  const stats = [
    { value: "69", label: "指纹参考库中的模型" },
    { value: "6", label: "按厂商区分的渠道清单" },
    { value: String(caseCount), label: "渠道成分用例" },
    { value: "30", label: "降智题（8 问答 + 22 动画）" },
  ];
  return (
    <section id="how" className="mx-auto w-full max-w-7xl scroll-mt-16 px-4 pb-24 sm:px-6 lg:px-8">
      <SectionHeading lead="一次检测，" tail="一条链路" note="请求带着你的 Key，经本服务原样转发给被测接口——不写日志、不落盘，检测结束即丢弃；回来的响应被拆成三份报告。" />
      <div className="overflow-hidden rounded-[28px] bg-surface-1 ring-1 ring-line-1">
        <div className="relative px-4 py-8 sm:px-8 lg:py-12">
          <div aria-hidden className="dot-grid pointer-events-none absolute inset-0 opacity-60" />
          {/* connectors (desktop) */}
          <svg aria-hidden className="pointer-events-none absolute inset-0 hidden h-full w-full text-line-3 lg:block" viewBox="0 0 100 100" preserveAspectRatio="none">
            <g fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke">
              <path d="M10 50 H50" vectorEffect="non-scaling-stroke" />
              {[22, 50, 78].map((y) => (
                <g key={y}>
                  <path d={`M50 50 C60 50 60 ${y} 70 ${y}`} vectorEffect="non-scaling-stroke" />
                  <path d={`M70 ${y} C80 ${y} 80 50 90 50`} vectorEffect="non-scaling-stroke" />
                </g>
              ))}
            </g>
          </svg>
          <div className="relative grid gap-3 lg:grid-cols-5 lg:items-center lg:gap-6">
            <FlowNode icon={KeyRound} title="你的接口与 Key" sub="Base URL · 模型名" />
            <FlowNode icon={ShieldCheck} title="本服务" sub="只转发，不保存" highlight />
            <FlowNode icon={Server} title="被测接口" sub="中转站 / 第三方" mono />
            <div className="grid gap-3 lg:gap-8">
              <FlowNode icon={Fingerprint} title="模型指纹" sub="实际是哪个模型" />
              <FlowNode icon={Layers} title="渠道成分" sub="像不像官方" />
              <FlowNode icon={Brain} title="降智检测" sub="能力有没有缩水" />
            </div>
            <FlowNode icon={Waypoints} title="报告" sub="对比矩阵 · JSON 导出" />
          </div>
        </div>
        <dl className="grid grid-cols-2 border-t border-line-1 lg:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className={cn("px-6 py-6 sm:px-8 sm:py-7", i % 2 === 1 && "border-l border-line-1", i >= 2 && "border-t border-line-1 lg:border-t-0", i >= 1 && "lg:border-l")}>
              <dd className="text-[32px] font-medium leading-none tracking-[-0.03em] tabular-nums sm:text-[40px]">{s.value}</dd>
              <dt className="mt-2.5 text-xs text-fg-2">{s.label}</dt>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer id="privacy" className="border-t border-line-1">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1fr_auto] lg:px-8">
        <div className="max-w-2xl space-y-3">
          <Logo />
          <p className="text-[13px] leading-6 text-fg-2">
            API Key（含可选的对照官方 Key）只放在发往本服务的请求体里，由服务端在本次检测期间转发给对应接口，不写日志、不落盘、不回传；进度流与报告中出现的 Key 会被替换为
            [REDACTED]。生产模式默认拒绝内网与回环地址，且不跟随重定向。
          </p>
          <p className="text-xs leading-5 text-fg-3">检测会产生真实用量：成分检测的长上下文、重复次数与模型数都会成倍放大请求量，可在用例清单里按需取消。</p>
        </div>
        <div className="flex items-start gap-2 md:justify-end">
          <a
            href={REPO}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-fill-2 px-3 py-1.5 text-[13px] text-fg-2 transition-colors hover:bg-fill-3 hover:text-foreground"
          >
            <GithubMark className="size-3.5" /> 源码 <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </div>
    </footer>
  );
}
