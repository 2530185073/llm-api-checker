"use client";

import {
  Brain,
  ChevronDown,
  Eye,
  EyeOff,
  Fingerprint,
  FlaskConical,
  Layers,
  ListRestart,
  Loader2,
  Play,
  Plus,
  ScanText,
  Settings2,
  ShieldCheck,
  Square,
  X,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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

export const DEMO_MODELS = [
  "claude-opus-4.8",
  "claude-sonnet-4.6",
  "gpt-5.4",
  "gemini-3.6-flash",
  "glm-5.3",
  "kimi-k3",
  "deepseek-flash",
  "deepseek-v4-pro",
];

const PROTOCOL_ITEMS: { value: ProtocolChoice; short: string; path: string }[] = [
  { value: "auto", short: "自动", path: "按模型自动探测可用协议（Claude→Messages，Gemini→generateContent，其余→Chat）" },
  { value: "chat", short: "Chat", path: "锁定 /v1/chat/completions" },
  { value: "responses", short: "Responses", path: "锁定 /v1/responses" },
  { value: "messages", short: "Messages", path: "锁定 /v1/messages（Anthropic）" },
  { value: "gemini", short: "Gemini", path: "锁定 /v1beta/models/{model}:generateContent" },
];

const PROTOCOL_NAME: Record<Protocol, string> = {
  chat: "Chat Completions",
  responses: "Responses",
  messages: "Anthropic Messages",
  gemini: "Gemini generateContent",
};

const EFFORT_ITEMS = [
  { value: "default", label: "不指定（渠道默认）" },
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
    <div className="space-y-1.5">
      {label && <Label className="text-sm">{label}</Label>}
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

function ModuleChip({
  icon: Icon,
  label,
  checked,
  onToggle,
  disabled,
}: {
  icon: typeof Fingerprint;
  label: string;
  checked: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors disabled:opacity-50",
        checked
          ? "border-primary/40 bg-primary/10 text-primary"
          : "border-border bg-background text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  );
}

export function ConfigForm({
  form,
  setForm,
  running,
  onStart,
  onCancel,
  onDemo,
  catalog,
  available,
  setAvailable,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  running: boolean;
  onStart: () => void;
  onCancel: () => void;
  onDemo: () => void;
  catalog: CaseCatalog | null;
  available: string[];
  setAvailable: (models: string[]) => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [draft, setDraft] = useState("");
  const [loadingModels, setLoadingModels] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  const addModel = (m: string) => {
    const v = m.trim();
    if (!v || form.models.includes(v)) return;
    if (form.models.length >= 12) return toast.warning("一次最多检测 12 个模型");
    set("models", [...form.models, v]);
  };
  const toggleModel = (m: string) => (form.models.includes(m) ? set("models", form.models.filter((x) => x !== m)) : addModel(m));

  async function fetchModels() {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) return toast.error("请先填写 Base URL 和 API Key");
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }),
      });
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

  const implied = impliedProtocol(form.baseUrl);
  const conflict = !!implied && form.protocol !== "auto" && implied !== form.protocol;
  const vendors = [...new Set(form.models.map((m) => (form.vendor === "auto" ? detectVendor(m) : form.vendor)).filter((v): v is Vendor => !!v))];
  const modeRelevant = vendors.some((v) => ["glm", "kimi", "deepseek"].includes(v));
  const canStart = !!form.baseUrl.trim() && !!form.apiKey.trim() && form.models.length > 0 && !conflict && (form.fingerprint || form.degradation || form.composition);

  const activeProtoItem = PROTOCOL_ITEMS.find((p) => p.value === form.protocol) ?? PROTOCOL_ITEMS[0];
  const advancedSummary = [
    form.repeat > 1 ? `重复 ×${form.repeat}` : null,
    form.effort ? `推理 ${form.effort}` : null,
    form.visualPresets.length !== 1 || form.visualPresets[0] !== "pelican" ? `${form.visualPresets.length} 动画题` : null,
    form.mode === "official" ? "要求官方链路" : null,
    form.refBaseUrl.trim() ? "含官方对照" : null,
    form.secondModel.trim() ? "双模型对照" : null,
  ].filter(Boolean);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (canStart && !running) onStart();
      }}
    >
      {/* Row 1: Endpoint + Key */}
      <div className="grid gap-3.5 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="baseUrl">Base URL</Label>
          <Input
            id="baseUrl"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="https://api.example.com/v1（或完整端点地址）"
            value={form.baseUrl}
            onChange={(e) => set("baseUrl", e.target.value)}
            disabled={running}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="apiKey">API Key</Label>
          <div className="relative">
            <Input
              id="apiKey"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-... 或 AIza..."
              className="pr-10 font-mono"
              value={form.apiKey}
              onChange={(e) => set("apiKey", e.target.value)}
              disabled={running}
            />
            <button
              type="button"
              aria-label={showKey ? "隐藏 Key" : "显示 Key"}
              onClick={() => setShowKey((v) => !v)}
              className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
            >
              {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Row 2: Models + Protocol */}
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="model">检测模型（最多 12 个）</Label>
            <button
              type="button"
              onClick={fetchModels}
              disabled={loadingModels || running}
              className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline disabled:opacity-50"
            >
              {loadingModels ? <Loader2 className="size-3.5 animate-spin" /> : <ListRestart className="size-3.5" />}
              从 /models 获取
            </button>
          </div>
          <div className="flex gap-2">
            <Input
              id="model"
              autoComplete="off"
              spellCheck={false}
              placeholder="输入模型名回车添加，如 claude-sonnet-4.6 / gemini-4-neon"
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
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="添加模型"
              className="size-10 shrink-0"
              onClick={() => (addModel(draft), setDraft(""))}
              disabled={running || !draft.trim()}
            >
              <Plus className="size-4" />
            </Button>
          </div>
          {form.models.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {form.models.map((m) => (
                <span key={m} className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 py-1 pl-3 pr-1.5 font-mono text-[13px] font-medium text-primary">
                  {m}
                  <button type="button" aria-label={`移除 ${m}`} onClick={() => toggleModel(m)} disabled={running} className="rounded-full p-0.5 hover:bg-primary/20">
                    <X className="size-3.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {available.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-muted/20 p-2">
              <span className="px-1 text-[13px] text-muted-foreground">可选：</span>
              {available.map((m) => {
                const picked = form.models.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    disabled={running}
                    onClick={() => toggleModel(m)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 font-mono text-[13px] transition-colors",
                      picked ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label id="protocol-label">接口协议</Label>
          <div role="radiogroup" aria-labelledby="protocol-label" className="grid grid-cols-5 gap-1 rounded-lg border bg-muted/30 p-1">
            {PROTOCOL_ITEMS.map((item) => {
              const active = form.protocol === item.value;
              return (
                <button
                  key={item.value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={running}
                  onClick={() => set("protocol", item.value)}
                  className={cn(
                    "rounded-md px-2 py-2 text-center text-sm font-medium transition-all disabled:opacity-50",
                    active ? "bg-card text-primary shadow-xs ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.short}
                </button>
              );
            })}
          </div>
          {conflict ? (
            <p className="text-[13px] leading-snug text-destructive">
              URL 指向 {PROTOCOL_PATH[implied!]}，与所选 {PROTOCOL_NAME[form.protocol as Protocol]} 冲突，请调整 URL 或切换协议。
            </p>
          ) : (
            <p className="text-[13px] leading-snug text-muted-foreground">
              {form.protocol === "auto" && implied
                ? `已从 URL 识别为 ${PROTOCOL_NAME[implied]}（${PROTOCOL_PATH[implied]}）`
                : activeProtoItem.path}
            </p>
          )}
        </div>
      </div>

      {/* Row 3: Modules + Actions (always visible above the fold) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <ModuleChip icon={Fingerprint} label="模型指纹" checked={form.fingerprint} onToggle={() => set("fingerprint", !form.fingerprint)} disabled={running} />
          <ModuleChip
            icon={ScanText}
            label="分词器"
            checked={form.fingerprint && form.tokenizer}
            onToggle={() => set("tokenizer", !form.tokenizer)}
            disabled={running || !form.fingerprint}
          />
          <ModuleChip icon={Brain} label="降智检测" checked={form.degradation} onToggle={() => set("degradation", !form.degradation)} disabled={running} />
          <ModuleChip icon={Layers} label="渠道成分" checked={form.composition} onToggle={() => set("composition", !form.composition)} disabled={running} />

          {form.composition && (
            <div className="w-48">
              <CaseChecklist
                catalog={catalog}
                selected={form.selected}
                onChange={(next) => set("selected", next)}
                mode={form.mode}
                focus={vendors.length ? vendors : ["claude"]}
                disabled={running}
              />
            </div>
          )}

          <Button
            type="button"
            variant="ghost"
            className="h-9 gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            <Settings2 className="size-4" />
            高级设置
            {advancedSummary.length > 0 && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">{advancedSummary.length}</span>
            )}
            <ChevronDown className={cn("size-4 transition-transform", showAdvanced && "rotate-180")} />
          </Button>
        </div>

        <div className="flex items-center gap-2.5">
          <Button type="button" variant="outline" className="h-10 text-sm" onClick={onDemo} disabled={running}>
            <FlaskConical className="size-4" /> 演示端点
          </Button>
          {running ? (
            <Button type="button" variant="destructive" className="h-10 px-5 text-[15px] font-medium" onClick={onCancel}>
              <Square className="size-4" /> 停止检测
            </Button>
          ) : (
            <Button type="submit" className="h-10 px-6 text-[15px] font-medium" disabled={!canStart}>
              <Play className="size-4" /> 开始检测{form.models.length > 1 ? `（${form.models.length}）` : ""}
            </Button>
          )}
        </div>
      </div>

      {/* Collapsible Advanced Drawer */}
      {showAdvanced && (
        <div className="grid gap-6 rounded-xl border bg-muted/20 p-4 lg:grid-cols-2">
          <div className="space-y-3.5">
            <div className="text-sm font-semibold text-foreground">渠道成分设置</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pick
                label="渠道类型"
                items={VENDOR_ITEMS.map((i) => ({ ...i, label: i.value === "auto" ? i.label : catalog?.labels[i.value as Vendor] ?? i.label }))}
                value={form.vendor}
                onChange={(v) => set("vendor", v as Vendor | "auto")}
                disabled={running || !form.composition}
              />
              <Pick
                label={`评分模式${modeRelevant ? "" : "（GLM/Kimi/DS）"}`}
                items={MODE_ITEMS}
                value={form.mode}
                onChange={(v) => set("mode", v as Mode)}
                disabled={running || !form.composition}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pick
                label="上下文阶梯上限"
                items={LADDER_ITEMS}
                value={String(form.ladderMax)}
                onChange={(v) => set("ladderMax", Number(v))}
                disabled={running || !form.composition}
              />
              <div className="space-y-1.5">
                <Label htmlFor="second" className="text-sm">
                  第二模型（可选）
                </Label>
                <Input
                  id="second"
                  placeholder="如 glm-5.3-flash"
                  value={form.secondModel}
                  onChange={(e) => set("secondModel", e.target.value)}
                  disabled={running || !form.composition}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
            {form.protocol !== "auto" && (
              <div className="flex items-center justify-between gap-3 rounded-lg border bg-background px-3 py-2.5">
                <div>
                  <Label htmlFor="native" className="text-sm">
                    允许厂商原生协议（跨协议）
                  </Label>
                  <p className="text-[13px] text-muted-foreground">
                    {form.allowNative ? "成分检测可调用原生端点；指纹与降智仍锁定所选协议" : `仅发 ${PROTOCOL_PATH[form.protocol]}，不适用用例标注跳过`}
                  </p>
                </div>
                <Switch id="native" checked={form.allowNative} onCheckedChange={(v) => set("allowNative", v)} disabled={running || !form.composition} />
              </div>
            )}
            <div className="space-y-2">
              <Label className="text-sm">对照官方端点（可选）</Label>
              <div className="grid gap-2 sm:grid-cols-3">
                <Input
                  placeholder="官方 Base URL"
                  value={form.refBaseUrl}
                  onChange={(e) => set("refBaseUrl", e.target.value)}
                  disabled={running || !form.composition}
                  autoComplete="off"
                  spellCheck={false}
                />
                <Input
                  type="password"
                  placeholder="官方 API Key"
                  value={form.refApiKey}
                  onChange={(e) => set("refApiKey", e.target.value)}
                  disabled={running || !form.composition}
                  autoComplete="off"
                  className="font-mono"
                />
                <Input
                  placeholder="对照模型名"
                  value={form.refModel}
                  onChange={(e) => set("refModel", e.target.value)}
                  disabled={running || !form.composition}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            </div>
          </div>

          <div className="space-y-3.5">
            <div className="text-sm font-semibold text-foreground">降智与运行设置</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Pick label="每题重复次数" items={NUM_ITEMS(10)} value={String(form.repeat)} onChange={(v) => set("repeat", Number(v))} disabled={running || !form.degradation} />
              <Pick label="全局并发上限" items={NUM_ITEMS(16)} value={String(form.concurrency)} onChange={(v) => set("concurrency", Number(v))} disabled={running} />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Pick label="推理强度" items={EFFORT_ITEMS} value={form.effort || "default"} onChange={(v) => set("effort", v === "default" ? "" : v)} disabled={running} />
              <Pick label="降智判定方式" items={JUDGE_ITEMS} value={form.judgeMode} onChange={(v) => set("judgeMode", v as JudgeMode)} disabled={running} />
              <Pick
                label="动画超时上限"
                items={TIMEOUT_ITEMS}
                value={String(form.visualTimeoutMin)}
                onChange={(v) => set("visualTimeoutMin", Number(v))}
                disabled={running || !form.degradation || !form.visualPresets.length}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm">HTML / SVG 动画题（已选 {form.visualPresets.length} 道）</Label>
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
                        "rounded-full border px-2.5 py-1 text-[13px] transition-colors disabled:opacity-50",
                        active ? "border-primary bg-primary/10 font-medium text-primary" : "bg-background text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {o.name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Subtle 1-line privacy note */}
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ShieldCheck className="size-4 shrink-0 text-emerald-600" />
        <span>Key 仅在本次检测期间由服务端转发，不写日志不落盘；检测会产生真实 API 用量，可在「用例清单」中按需增减。</span>
      </div>
    </form>
  );
}
