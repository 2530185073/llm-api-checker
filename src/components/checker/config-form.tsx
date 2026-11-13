"use client";

import { ChevronDown, Eye, EyeOff, FlaskConical, ListRestart, Loader2, Play, Plus, ShieldCheck, Square, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { JudgeMode, Protocol, ProtocolChoice } from "@/lib/checker/types";
import { impliedProtocol, PROTOCOL_PATH } from "@/lib/checker/url";
import { detectVendor } from "@/lib/composition/facts";
import type { Mode, Vendor } from "@/lib/composition/types";
import { cn } from "@/lib/utils";
import { CaseChecklist, type CaseCatalog, VENDORS } from "./case-checklist";

export const VISUAL_OPTIONS = [
  { key: "pelican", name: "鹈鹕骑自行车" },
  { key: "polarbear", name: "北极熊骑自行车" },
  { key: "ultraman", name: "奥特曼骑摩托车" },
  { key: "octopus", name: "章鱼打架子鼓" },
  { key: "giraffe", name: "长颈鹿踩滑板" },
  { key: "mooncat", name: "宇航猫月球钓鱼" },
  { key: "clock", name: "模拟时钟" },
  { key: "solar", name: "太阳系轨道" },
  { key: "balls", name: "弹跳小球物理" },
  { key: "gears", name: "齿轮传动" },
  { key: "city", name: "城市夜景视差" },
  { key: "strokes", name: "汉字笔顺" },
  { key: "lighthouse", name: "灯塔夜巡" },
  { key: "newton", name: "牛顿摆" },
  { key: "hummingbird", name: "蜂鸟采蜜" },
  { key: "windmill", name: "风车农场日落" },
  { key: "rocket", name: "火箭发射" },
  { key: "aquarium", name: "海底水族箱" },
  { key: "ecg", name: "心电监护仪" },
  { key: "traffic", name: "十字路口红绿灯" },
  { key: "origami", name: "折纸鹤" },
  { key: "dna", name: "DNA 双螺旋" },
];

export interface FormState {
  baseUrl: string;
  apiKey: string;
  models: string[];
  protocol: ProtocolChoice;
  effort: string;
  judgeMode: JudgeMode;
  fingerprint: boolean;
  tokenizer: boolean;
  degradation: boolean;
  visualPresets: string[];
  visualTimeoutMin: number;
  repeat: number;
  concurrency: number;
  composition: boolean;
  vendor: Vendor | "auto";
  mode: Mode;
  ladderMax: number;
  selected: Partial<Record<Vendor, string[]>>;
  refBaseUrl: string;
  refApiKey: string;
  refModel: string;
  secondModel: string;
  allowNative: boolean;
}

export const INITIAL_FORM: FormState = {
  baseUrl: "",
  apiKey: "",
  models: [],
  protocol: "auto",
  effort: "",
  judgeMode: "answer",
  fingerprint: true,
  tokenizer: true,
  degradation: true,
  visualPresets: ["pelican"],
  visualTimeoutMin: 10,
  repeat: 1,
  concurrency: 4,
  composition: true,
  vendor: "auto",
  mode: "equivalent",
  ladderMax: 262_144,
  selected: {},
  refBaseUrl: "",
  refApiKey: "",
  refModel: "",
  secondModel: "",
  allowNative: false,
};

const PROTOCOL_ITEMS: { value: ProtocolChoice; label: string; path: string }[] = [
  { value: "auto", label: "自动识别", path: "先试 Chat，再试 Responses" },
  { value: "chat", label: "Chat Completions", path: "/v1/chat/completions" },
  { value: "responses", label: "Responses", path: "/v1/responses" },
  { value: "messages", label: "Anthropic Messages", path: "/v1/messages" },
];
const PROTOCOL_NAME: Record<Protocol, string> = { chat: "Chat Completions", responses: "Responses", messages: "Anthropic Messages" };

function ProtocolPicker({ value, baseUrl, onChange, disabled }: { value: ProtocolChoice; baseUrl: string; onChange: (v: ProtocolChoice) => void; disabled?: boolean }) {
  const implied = impliedProtocol(baseUrl);
  const conflict = implied && value !== "auto" && implied !== value;
  return (
    <div className="space-y-2">
      <Label id="protocol-label">接口协议</Label>
      <div role="radiogroup" aria-labelledby="protocol-label" className="grid grid-cols-2 gap-1.5">
        {PROTOCOL_ITEMS.map((item) => {
          const active = value === item.value;
          return (
            <button
              key={item.value}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={disabled}
              onClick={() => onChange(item.value)}
              className={cn(
                "rounded-lg border px-2.5 py-2 text-left transition-colors disabled:opacity-50",
                active ? "border-primary bg-primary/10 ring-1 ring-primary" : "hover:border-foreground/30",
              )}
            >
              <span className={cn("block text-sm font-medium", active && "text-primary")}>{item.label}</span>
              <span className="block truncate font-mono text-[11px] text-muted-foreground">{item.path}</span>
            </button>
          );
        })}
      </div>
      {conflict ? (
        <p className="text-xs text-destructive">
          Base URL 以 {PROTOCOL_PATH[implied]} 结尾，与所选 {PROTOCOL_NAME[value as Protocol]} 冲突，请改为根地址或 /v1，或切换协议。
        </p>
      ) : value === "auto" ? (
        <p className="text-xs text-muted-foreground">
          {implied
            ? `Base URL 指向 ${PROTOCOL_PATH[implied]}，将直接使用 ${PROTOCOL_NAME[implied]}，不再探测其他协议。`
            : "按 Chat → Responses → Messages 顺序探测（Claude 优先 Messages），GPT 渠道通常落在 Chat。需要固定协议时请直接选择。"}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          已锁定 {PROTOCOL_PATH[value]}：指纹、问答、动画题和成分检测都只发这一种请求，失败也不会回退到其他协议；不适用的成分用例会标注跳过。
        </p>
      )}
    </div>
  );
}
const EFFORT_ITEMS = [
  { value: "default", label: "不指定（使用渠道默认）" },
  ...["none", "minimal", "low", "medium", "high", "xhigh"].map((v) => ({ value: v, label: v })),
];
const JUDGE_ITEMS = [
  { value: "answer", label: "只看答案（默认）" },
  { value: "latency", label: "只看耗时" },
  { value: "both", label: "答案和耗时都要通过" },
];
const TIMEOUT_ITEMS = ["10", "20", "30"].map((v) => ({ value: v, label: `${v} 分钟` }));
const VENDOR_ITEMS = [{ value: "auto", label: "按模型名自动判断" }, ...VENDORS.map((v) => ({ value: v, label: v }))];
const MODE_ITEMS = [
  { value: "equivalent", label: "官方等价（允许自部署）" },
  { value: "official", label: "要求官方链路" },
];
const LADDER_ITEMS = [65_536, 131_072, 262_144, 1_048_576].map((v) => ({ value: String(v), label: `${Math.round(v / 1024)}K` }));
const NUM_ITEMS = (max: number) => Array.from({ length: max }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

function Pick({ label, items, value, onChange, disabled, prefix }: { label?: string; items: { value: string; label: string }[]; value: string; onChange: (v: string) => void; disabled?: boolean; prefix?: string }) {
  return (
    <div className="space-y-2">
      {label && <Label>{label}</Label>}
      <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))} disabled={disabled}>
        <SelectTrigger className="w-full">
          {prefix && <span className="text-muted-foreground">{prefix}</span>}
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-72">
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ToggleRow({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border px-3 py-2">
      <CollapsibleTrigger className="flex w-full items-center justify-between py-1 text-sm font-medium">
        {title}
        <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 pb-2 pt-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ConfigForm({
  form,
  setForm,
  running,
  onStart,
  onCancel,
  catalog,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  running: boolean;
  onStart: () => void;
  onCancel: () => void;
  catalog: CaseCatalog | null;
}) {
  const [showKey, setShowKey] = useState(false);
  const [available, setAvailable] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const addModel = (m: string) => {
    const v = m.trim();
    if (!v) return;
    if (form.models.includes(v)) return;
    if (form.models.length >= 12) return toast.warning("一次最多检测 12 个模型");
    set("models", [...form.models, v]);
  };
  const toggleModel = (m: string) => (form.models.includes(m) ? set("models", form.models.filter((x) => x !== m)) : addModel(m));

  async function fetchModels() {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) return toast.error("请先填写 Base URL 和 API Key");
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }) });
      const data = (await res.json()) as { models?: string[]; error?: string };
      if (!res.ok || !data.models) throw new Error(data.error || "获取失败");
      setAvailable(data.models);
      if (!data.models.length) toast.warning("接口返回了空的模型列表，请手动填写模型名");
      else {
        toast.success(`获取到 ${data.models.length} 个模型，点击即可选中`);
        if (!form.models.length) set("models", [data.models[0]]);
      }
    } catch (error) {
      toast.error(`获取模型列表失败：${(error as Error).message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  function useDemo() {
    const list = ["claude-opus-4.8", "claude-sonnet-4.6", "gpt-5.4", "gemini-3.6-flash", "glm-5.3", "kimi-k3", "deepseek-flash", "deepseek-v4-pro"];
    setForm((prev) => ({ ...prev, baseUrl: `${window.location.origin}/api/mock/v1`, apiKey: "sk-demo", models: ["claude-opus-4.8", "claude-sonnet-4.6", "deepseek-v4-pro"], protocol: "auto", composition: true }));
    setAvailable(list);
    toast.info("已填入内置演示端点：claude-opus-4.8 与 deepseek-v4-pro 是掺假渠道，其余为正常渠道，可点选更多模型对比");
  }

  const vendors = [...new Set(form.models.map((m) => (form.vendor === "auto" ? detectVendor(m) : form.vendor)).filter((v): v is Vendor => !!v))];
  const modeRelevant = vendors.some((v) => ["glm", "kimi", "deepseek"].includes(v));
  const canStart = form.baseUrl.trim() && form.apiKey.trim() && form.models.length > 0 && (form.fingerprint || form.degradation || form.composition);

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (canStart && !running) onStart();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="baseUrl">Base URL</Label>
        <Input id="baseUrl" inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://api.example.com/v1" value={form.baseUrl} onChange={(e) => set("baseUrl", e.target.value)} disabled={running} />
        <p className="text-xs text-muted-foreground">只写到域名时自动补 /v1；也可以粘贴完整端点地址。</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <div className="relative">
          <Input id="apiKey" type={showKey ? "text" : "password"} autoComplete="off" spellCheck={false} placeholder="sk-..." className="pr-10 font-mono" value={form.apiKey} onChange={(e) => set("apiKey", e.target.value)} disabled={running} />
          <button type="button" aria-label={showKey ? "隐藏 Key" : "显示 Key"} onClick={() => setShowKey((v) => !v)} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground">
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="model">模型（可多选，最多 12 个）</Label>
          <button type="button" onClick={fetchModels} disabled={loadingModels || running} className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50">
            {loadingModels ? <Loader2 className="size-3 animate-spin" /> : <ListRestart className="size-3" />}
            从 /v1/models 获取
          </button>
        </div>
        <div className="flex gap-2">
          <Input
            id="model"
            autoComplete="off"
            spellCheck={false}
            placeholder="输入模型名后回车，例如 claude-sonnet-4-6"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addModel(draft);
                setDraft("");
              }
            }}
            disabled={running}
          />
          <Button type="button" variant="outline" size="icon" aria-label="添加模型" onClick={() => (addModel(draft), setDraft(""))} disabled={running || !draft.trim()}>
            <Plus className="size-4" />
          </Button>
        </div>
        {form.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.models.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-0.5 pl-2.5 pr-1 font-mono text-xs text-primary">
                {m}
                <button type="button" aria-label={`移除 ${m}`} onClick={() => toggleModel(m)} disabled={running} className="rounded-full p-0.5 hover:bg-primary/20">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {available.length > 0 && (
          <div className="max-h-32 overflow-y-auto rounded-md border p-2">
            <div className="flex flex-wrap gap-1.5">
              {available.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={running}
                  onClick={() => toggleModel(m)}
                  className={cn("rounded-full border px-2.5 py-0.5 font-mono text-xs transition-colors", form.models.includes(m) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <ProtocolPicker value={form.protocol} baseUrl={form.baseUrl} onChange={(v) => set("protocol", v)} disabled={running} />

      <div className="space-y-3 rounded-lg border p-3">
        <ToggleRow id="fp" label="模型指纹" hint="3 道随机整数挑战 + 自报身份" checked={form.fingerprint} onChange={(v) => set("fingerprint", v)} disabled={running} />
        <ToggleRow id="tk" label="分词器探测" hint="约 14 个极短请求，读取输入 token 数" checked={form.fingerprint && form.tokenizer} onChange={(v) => set("tokenizer", v)} disabled={running || !form.fingerprint} />
        <ToggleRow id="dg" label="降智检测" hint="8 道问答题 + 所选 HTML/SVG 动画题" checked={form.degradation} onChange={(v) => set("degradation", v)} disabled={running} />
        <ToggleRow id="cp" label="渠道成分检测" hint="按厂商的协议 / 计费 / 参数 / 身份用例清单" checked={form.composition} onChange={(v) => set("composition", v)} disabled={running} />
      </div>

      {form.composition && (
        <Section title="渠道成分检测设置" defaultOpen>
          <Pick label="渠道类型" items={VENDOR_ITEMS.map((i) => ({ ...i, label: i.value === "auto" ? i.label : catalog?.labels[i.value as Vendor] ?? i.label }))} value={form.vendor} onChange={(v) => set("vendor", v as Vendor | "auto")} disabled={running} />
          <Pick label={`评分模式${modeRelevant ? "" : "（仅对 GLM / Kimi / DeepSeek 生效）"}`} items={MODE_ITEMS} value={form.mode} onChange={(v) => set("mode", v as Mode)} disabled={running} />
          <CaseChecklist catalog={catalog} selected={form.selected} onChange={(next) => set("selected", next)} mode={form.mode} focus={vendors.length ? vendors : ["claude"]} disabled={running} />
          {form.protocol !== "auto" && (
            <ToggleRow
              id="native"
              label="允许厂商原生协议（跨协议）"
              hint={form.allowNative ? "成分检测可调用 Messages / Gemini / Responses 等原生端点；指纹与降智仍只用所选协议" : `默认关闭：成分检测只发 ${PROTOCOL_PATH[form.protocol]} 请求，其余用例标注跳过`}
              checked={form.allowNative}
              onChange={(v) => set("allowNative", v)}
              disabled={running}
            />
          )}
          <Pick label="上下文阶梯档位上限" items={LADDER_ITEMS} value={String(form.ladderMax)} onChange={(v) => set("ladderMax", Number(v))} disabled={running} />
          <div className="space-y-2">
            <Label>对照官方端点（可选）</Label>
            <Input placeholder="官方 Base URL" value={form.refBaseUrl} onChange={(e) => set("refBaseUrl", e.target.value)} disabled={running} autoComplete="off" spellCheck={false} />
            <Input type="password" placeholder="官方 API Key（只在本次检测中使用）" value={form.refApiKey} onChange={(e) => set("refApiKey", e.target.value)} disabled={running} autoComplete="off" className="font-mono" />
            <Input placeholder="对照模型名（默认与被测相同）" value={form.refModel} onChange={(e) => set("refModel", e.target.value)} disabled={running} autoComplete="off" spellCheck={false} />
            <p className="text-xs text-muted-foreground">填写后启用「对照官方」类用例（分词计数比对、贪心分歧、吞吐对比等）。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="second">第二模型（可选）</Label>
            <Input id="second" placeholder="例如 glm-5.3-flash，用于判断两个名字是否同一后端" value={form.secondModel} onChange={(e) => set("secondModel", e.target.value)} disabled={running} autoComplete="off" spellCheck={false} />
          </div>
        </Section>
      )}

      <Section title="降智检测与运行设置">
        <div className="grid grid-cols-2 gap-3">
          <Pick label="每题重复次数" items={NUM_ITEMS(10)} value={String(form.repeat)} onChange={(v) => set("repeat", Number(v))} disabled={running || !form.degradation} />
          <Pick label="全局并发" items={NUM_ITEMS(16)} value={String(form.concurrency)} onChange={(v) => set("concurrency", Number(v))} disabled={running} />
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">每道问答题与动画题并发执行 N 次，报告给出通过率、平均 / P95 耗时与标准差；所有模型共享全局并发上限。</p>
        <div className="space-y-2">
          <Label>HTML / SVG 动画题</Label>
          <div className="flex flex-wrap gap-1.5">
            {VISUAL_OPTIONS.map((o) => {
              const active = form.visualPresets.includes(o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  aria-pressed={active}
                  disabled={running || !form.degradation}
                  onClick={() => set("visualPresets", active ? form.visualPresets.filter((k) => k !== o.key) : [...form.visualPresets, o.key])}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50", active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
                >
                  {o.name}
                </button>
              );
            })}
          </div>
          <Pick items={TIMEOUT_ITEMS} value={String(form.visualTimeoutMin)} onChange={(v) => set("visualTimeoutMin", Number(v))} disabled={running || !form.degradation || !form.visualPresets.length} prefix="动画题超时上限：" />
        </div>
        <Pick label="推理强度" items={EFFORT_ITEMS} value={form.effort || "default"} onChange={(v) => set("effort", v === "default" ? "" : v)} disabled={running} />
        <Pick label="降智判定方式" items={JUDGE_ITEMS} value={form.judgeMode} onChange={(v) => set("judgeMode", v as JudgeMode)} disabled={running} />
      </Section>

      <div className="flex flex-col gap-2 sm:flex-row">
        {running ? (
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onCancel}>
            <Square className="size-4" /> 停止检测
          </Button>
        ) : (
          <Button type="submit" className="h-10 flex-1" disabled={!canStart}>
            <Play className="size-4" /> 开始检测{form.models.length > 1 ? `（${form.models.length} 个模型）` : ""}
          </Button>
        )}
        <Button type="button" variant="secondary" className="h-10" onClick={useDemo} disabled={running}>
          <FlaskConical className="size-4" /> 使用演示端点
        </Button>
      </div>

      <p className="flex gap-2 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        API Key（含对照 Key）只在本次检测期间由服务端转发给对应接口，不写日志、不落盘、检测结束即丢弃。检测会产生真实用量，成分检测的长上下文与重复次数会显著增加请求量。
      </p>
    </form>
  );
}
