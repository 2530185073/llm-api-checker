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
import type { JudgeMode, ProtocolChoice } from "@/lib/checker/types";
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
};

const PROTOCOL_ITEMS = [
  { value: "auto", label: "自动识别" },
  { value: "chat", label: "OpenAI Chat Completions" },
  { value: "responses", label: "OpenAI Responses" },
  { value: "messages", label: "Anthropic Messages" },
];
const EFFORT_ITEMS = [{ value: "default", label: "不指定（使用渠道默认）" }, ...["none", "minimal", "low", "medium", "high", "xhigh"].map((v) => ({ value: v, label: v }))];
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

function Pick({
  label,
  items,
  value,
  onChange,
  disabled,
  prefix,
}: {
  label?: string;
  items: { value: string; label: string }[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  prefix?: string;
}) {
  return (
    <div className="space-y-2">
      {label && <Label className="text-[13px] text-fg-2">{label}</Label>}
      <Select items={items} value={value} onValueChange={(v) => v && onChange(String(v))} disabled={disabled}>
        <SelectTrigger className="w-full">
          {prefix && <span className="text-fg-3">{prefix}</span>}
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
    <div className="flex items-start justify-between gap-3 px-3.5 py-2.5">
      <div>
        <Label htmlFor={id} className="text-sm">
          {label}
        </Label>
        <p className="mt-0.5 text-xs text-fg-3">{hint}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}

function Section({ title, children, defaultOpen = false }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-2xl bg-fill-1 ring-1 ring-line-1">
      <CollapsibleTrigger className="flex w-full items-center justify-between px-3.5 py-3 text-sm font-medium">
        {title}
        <ChevronDown className={cn("size-4 text-fg-3 transition-transform duration-200", open && "rotate-180")} />
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t border-line-1 px-3.5 pt-4 pb-4">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ConfigForm({
  form,
  setForm,
  available,
  setAvailable,
  running,
  onStart,
  onCancel,
  onDemo,
  catalog,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  available: string[];
  setAvailable: (models: string[]) => void;
  running: boolean;
  onStart: (models?: string[]) => void;
  onCancel: () => void;
  onDemo: () => void;
  catalog: CaseCatalog | null;
}) {
  const [showKey, setShowKey] = useState(false);
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
  const toggleModel = (m: string) =>
    form.models.includes(m)
      ? set(
          "models",
          form.models.filter((x) => x !== m),
        )
      : addModel(m);

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

  const vendors = [...new Set(form.models.map((m) => (form.vendor === "auto" ? detectVendor(m) : form.vendor)).filter((v): v is Vendor => !!v))];
  const modeRelevant = vendors.some((v) => ["glm", "kimi", "deepseek"].includes(v));
  // A model name typed but not yet confirmed with Enter still counts.
  const pending = draft.trim() && !form.models.includes(draft.trim()) && form.models.length < 12 ? draft.trim() : "";
  const modelCount = form.models.length + (pending ? 1 : 0);
  const missing = [
    !form.baseUrl.trim() && "Base URL",
    !form.apiKey.trim() && "API Key",
    modelCount === 0 && "至少一个模型",
    !(form.fingerprint || form.degradation || form.composition) && "至少一项检测",
  ].filter(Boolean) as string[];
  const canStart = missing.length === 0;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canStart || running) return;
        if (pending) {
          setDraft("");
          onStart([...form.models, pending]);
        } else onStart();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="baseUrl" className="text-[13px] text-fg-2">
          Base URL
        </Label>
        <Input
          id="baseUrl"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://api.example.com/v1"
          value={form.baseUrl}
          onChange={(e) => set("baseUrl", e.target.value)}
          disabled={running}
        />
        <p className="text-xs text-fg-3">只写到域名时自动补 /v1；也可以粘贴完整端点地址。</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey" className="text-[13px] text-fg-2">
          API Key
        </Label>
        <div className="relative">
          <Input
            id="apiKey"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-..."
            className="pr-10 font-mono text-[13px]"
            value={form.apiKey}
            onChange={(e) => set("apiKey", e.target.value)}
            disabled={running}
          />
          <button
            type="button"
            aria-label={showKey ? "隐藏 Key" : "显示 Key"}
            onClick={() => setShowKey((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-fg-3 hover:text-foreground"
          >
            {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="model" className="text-[13px] text-fg-2">
            模型 <span className="text-fg-4">可多选，最多 12 个</span>
          </Label>
          <button
            type="button"
            onClick={fetchModels}
            disabled={loadingModels || running}
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs text-brand transition-colors hover:bg-brand-soft disabled:opacity-50"
          >
            {loadingModels ? <Loader2 className="size-3 animate-spin" /> : <ListRestart className="size-3" />}从 /v1/models 获取
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
          <Button type="button" variant="secondary" size="icon-lg" aria-label="添加模型" onClick={() => (addModel(draft), setDraft(""))} disabled={running || !draft.trim()}>
            <Plus className="size-4" />
          </Button>
        </div>
        {form.models.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {form.models.map((m) => (
              <span key={m} className="inline-flex items-center gap-1 rounded-full bg-primary py-0.5 pr-1 pl-2.5 font-mono text-xs text-primary-foreground">
                {m}
                <button type="button" aria-label={`移除 ${m}`} onClick={() => toggleModel(m)} disabled={running} className="rounded-full p-0.5 opacity-70 transition-opacity hover:opacity-100">
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {available.length > 0 && (
          <div className="max-h-36 overflow-y-auto rounded-xl bg-fill-1 p-2 ring-1 ring-line-1">
            <div className="flex flex-wrap gap-1.5">
              {available.map((m) => (
                <button
                  key={m}
                  type="button"
                  disabled={running}
                  onClick={() => toggleModel(m)}
                  className={cn(
                    "rounded-full px-2.5 py-0.5 font-mono text-xs transition-colors",
                    form.models.includes(m) ? "bg-primary text-primary-foreground" : "bg-background text-fg-2 shadow-raised hover:text-foreground",
                  )}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <Pick label="接口协议（指纹 / 降智检测）" items={PROTOCOL_ITEMS} value={form.protocol} onChange={(v) => set("protocol", v as ProtocolChoice)} disabled={running} />

      <div className="divide-y divide-line-1 rounded-2xl bg-fill-1 ring-1 ring-line-1">
        <ToggleRow id="fp" label="模型指纹" hint="3 道随机整数挑战 + 自报身份" checked={form.fingerprint} onChange={(v) => set("fingerprint", v)} disabled={running} />
        <ToggleRow
          id="tk"
          label="分词器探测"
          hint="约 14 个极短请求，读取输入 token 数"
          checked={form.fingerprint && form.tokenizer}
          onChange={(v) => set("tokenizer", v)}
          disabled={running || !form.fingerprint}
        />
        <ToggleRow id="dg" label="降智检测" hint="8 道问答题 + 所选 HTML/SVG 动画题" checked={form.degradation} onChange={(v) => set("degradation", v)} disabled={running} />
        <ToggleRow id="cp" label="渠道成分检测" hint="按厂商的协议 / 计费 / 参数 / 身份用例清单" checked={form.composition} onChange={(v) => set("composition", v)} disabled={running} />
      </div>

      {form.composition && (
        <Section title="渠道成分检测设置" defaultOpen>
          <Pick
            label="渠道类型"
            items={VENDOR_ITEMS.map((i) => ({ ...i, label: i.value === "auto" ? i.label : (catalog?.labels[i.value as Vendor] ?? i.label) }))}
            value={form.vendor}
            onChange={(v) => set("vendor", v as Vendor | "auto")}
            disabled={running}
          />
          <Pick label={`评分模式${modeRelevant ? "" : "（仅对 GLM / Kimi / DeepSeek 生效）"}`} items={MODE_ITEMS} value={form.mode} onChange={(v) => set("mode", v as Mode)} disabled={running} />
          <CaseChecklist catalog={catalog} selected={form.selected} onChange={(next) => set("selected", next)} mode={form.mode} focus={vendors.length ? vendors : ["claude"]} disabled={running} />
          <Pick label="上下文阶梯档位上限" items={LADDER_ITEMS} value={String(form.ladderMax)} onChange={(v) => set("ladderMax", Number(v))} disabled={running} />
          <div className="space-y-2">
            <Label className="text-[13px] text-fg-2">对照官方端点（可选）</Label>
            <Input placeholder="官方 Base URL" value={form.refBaseUrl} onChange={(e) => set("refBaseUrl", e.target.value)} disabled={running} autoComplete="off" spellCheck={false} />
            <Input
              type="password"
              placeholder="官方 API Key（只在本次检测中使用）"
              value={form.refApiKey}
              onChange={(e) => set("refApiKey", e.target.value)}
              disabled={running}
              autoComplete="off"
              className="font-mono"
            />
            <Input placeholder="对照模型名（默认与被测相同）" value={form.refModel} onChange={(e) => set("refModel", e.target.value)} disabled={running} autoComplete="off" spellCheck={false} />
            <p className="text-xs text-fg-3">填写后启用「对照官方」类用例（分词计数比对、贪心分歧、吞吐对比等）。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="second" className="text-[13px] text-fg-2">
              第二模型（可选）
            </Label>
            <Input
              id="second"
              placeholder="例如 glm-5.3-flash，用于判断两个名字是否同一后端"
              value={form.secondModel}
              onChange={(e) => set("secondModel", e.target.value)}
              disabled={running}
              autoComplete="off"
              spellCheck={false}
            />
          </div>
        </Section>
      )}

      <Section title="降智检测与运行设置">
        <div className="grid grid-cols-2 gap-3">
          <Pick label="每题重复次数" items={NUM_ITEMS(10)} value={String(form.repeat)} onChange={(v) => set("repeat", Number(v))} disabled={running || !form.degradation} />
          <Pick label="全局并发" items={NUM_ITEMS(16)} value={String(form.concurrency)} onChange={(v) => set("concurrency", Number(v))} disabled={running} />
        </div>
        <p className="-mt-2 text-xs text-fg-3">每道问答题与动画题并发执行 N 次，报告给出通过率、平均 / P95 耗时与标准差；所有模型共享全局并发上限。</p>
        <div className="space-y-2">
          <Label className="text-[13px] text-fg-2">HTML / SVG 动画题</Label>
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
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                    active ? "bg-primary text-primary-foreground" : "bg-background text-fg-2 shadow-raised hover:text-foreground",
                  )}
                >
                  {o.name}
                </button>
              );
            })}
          </div>
          <Pick
            items={TIMEOUT_ITEMS}
            value={String(form.visualTimeoutMin)}
            onChange={(v) => set("visualTimeoutMin", Number(v))}
            disabled={running || !form.degradation || !form.visualPresets.length}
            prefix="动画题超时上限："
          />
        </div>
        <Pick label="推理强度" items={EFFORT_ITEMS} value={form.effort || "default"} onChange={(v) => set("effort", v === "default" ? "" : v)} disabled={running} />
        <Pick label="降智判定方式" items={JUDGE_ITEMS} value={form.judgeMode} onChange={(v) => set("judgeMode", v as JudgeMode)} disabled={running} />
      </Section>

      <p className="flex gap-2.5 rounded-xl bg-fill-1 p-3 text-xs leading-relaxed text-fg-2">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
        API Key（含对照 Key）只在本次检测期间由服务端转发给对应接口，不写日志、不落盘、检测结束即丢弃。检测会产生真实用量，成分检测的长上下文与重复次数会显著增加请求量。
      </p>

      <div className="sticky bottom-0 z-10 -mx-5 -mb-5 lg:-bottom-6 space-y-2 border-t border-line-1 bg-card/90 px-5 py-4 backdrop-blur-md sm:-mx-6 sm:-mb-6 sm:px-6">
        <div className="flex gap-2">
          {running ? (
            <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onCancel}>
              <Square className="size-4" /> 停止检测
            </Button>
          ) : (
            <Button type="submit" size="lg" className="min-w-0 flex-1" disabled={!canStart}>
              <Play className="size-4" /> 开始检测{modelCount > 1 ? `（${modelCount} 个模型）` : ""}
            </Button>
          )}
          <Button type="button" variant="secondary" size="lg" onClick={onDemo} disabled={running}>
            <FlaskConical className="size-4" />
            <span className="sm:hidden">演示</span>
            <span className="hidden sm:inline">使用演示端点</span>
          </Button>
        </div>
        {!running && missing.length > 0 && <p className="text-center text-xs text-fg-3">还需填写：{missing.join("、")}</p>}
      </div>
    </form>
  );
}
