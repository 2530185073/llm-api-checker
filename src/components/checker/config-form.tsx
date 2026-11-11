"use client";

import { ChevronDown, Eye, EyeOff, FlaskConical, ListRestart, Loader2, Play, ShieldCheck, Square } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { JudgeMode, ProtocolChoice } from "@/lib/checker/types";
import { cn } from "@/lib/utils";

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
];
const TIMEOUT_ITEMS = [
  { value: "10", label: "10 分钟" },
  { value: "20", label: "20 分钟" },
  { value: "30", label: "30 分钟" },
];

export interface FormState {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: ProtocolChoice;
  effort: string;
  judgeMode: JudgeMode;
  fingerprint: boolean;
  tokenizer: boolean;
  degradation: boolean;
  visualPresets: string[];
  visualTimeoutMin: number;
}

export const INITIAL_FORM: FormState = {
  baseUrl: "",
  apiKey: "",
  model: "",
  protocol: "auto",
  effort: "",
  judgeMode: "answer",
  fingerprint: true,
  tokenizer: true,
  degradation: true,
  visualPresets: ["pelican"],
  visualTimeoutMin: 10,
};

const PROTOCOL_ITEMS = [
  { value: "auto", label: "自动识别" },
  { value: "chat", label: "OpenAI Chat Completions" },
  { value: "responses", label: "OpenAI Responses" },
  { value: "messages", label: "Anthropic Messages" },
];
const EFFORT_ITEMS = [
  { value: "default", label: "不指定（使用渠道默认）" },
  { value: "none", label: "none" },
  { value: "minimal", label: "minimal" },
  { value: "low", label: "low" },
  { value: "medium", label: "medium" },
  { value: "high", label: "high" },
  { value: "xhigh", label: "xhigh" },
];
const JUDGE_ITEMS = [
  { value: "answer", label: "只看答案（默认）" },
  { value: "latency", label: "只看耗时" },
  { value: "both", label: "答案和耗时都要通过" },
];

export function ConfigForm({
  form,
  setForm,
  running,
  onStart,
  onCancel,
}: {
  form: FormState;
  setForm: (updater: (prev: FormState) => FormState) => void;
  running: boolean;
  onStart: () => void;
  onCancel: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));

  async function fetchModels() {
    if (!form.baseUrl.trim() || !form.apiKey.trim()) {
      toast.error("请先填写 Base URL 和 API Key");
      return;
    }
    setLoadingModels(true);
    try {
      const res = await fetch("/api/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey }),
      });
      const data = (await res.json()) as { models?: string[]; error?: string };
      if (!res.ok || !data.models) throw new Error(data.error || "获取失败");
      setModels(data.models);
      if (!data.models.length) toast.warning("接口返回了空的模型列表，请手动填写模型名");
      else {
        toast.success(`获取到 ${data.models.length} 个模型`);
        if (!form.model) set("model", data.models[0]);
      }
    } catch (error) {
      toast.error(`获取模型列表失败：${(error as Error).message}`);
    } finally {
      setLoadingModels(false);
    }
  }

  function useDemo() {
    setForm((prev) => ({ ...prev, baseUrl: `${window.location.origin}/api/mock/v1`, apiKey: "sk-demo", model: "claude-opus-4.8", protocol: "auto" }));
    setModels(["claude-opus-4.8", "claude-sonnet-4.6", "gpt-5.4"]);
    toast.info("已填入内置演示端点：claude-opus-4.8 是一个冒充 + 降智的模拟渠道，另外两个是正常渠道");
  }

  const canStart = form.baseUrl.trim() && form.apiKey.trim() && form.model.trim() && (form.fingerprint || form.degradation);

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
        <p className="text-xs text-muted-foreground">只写到域名时自动补 /v1；也可以粘贴完整端点地址。</p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="apiKey">API Key</Label>
        <div className="relative">
          <Input
            id="apiKey"
            type={showKey ? "text" : "password"}
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-..."
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

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="model">模型名</Label>
          <button
            type="button"
            onClick={fetchModels}
            disabled={loadingModels || running}
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
          >
            {loadingModels ? <Loader2 className="size-3 animate-spin" /> : <ListRestart className="size-3" />}
            从 /v1/models 获取
          </button>
        </div>
        <Input
          id="model"
          autoComplete="off"
          spellCheck={false}
          placeholder="例如 gpt-5.4、claude-sonnet-4-6"
          value={form.model}
          onChange={(e) => set("model", e.target.value)}
          disabled={running}
        />
        {models.length > 0 && (
          <Select items={models.map((m) => ({ value: m, label: m }))} value={models.includes(form.model) ? form.model : null} onValueChange={(v) => v && set("model", String(v))} disabled={running}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder={`从 ${models.length} 个模型中选择`} />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              {models.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-2">
        <Label>接口协议</Label>
        <Select items={PROTOCOL_ITEMS} value={form.protocol} onValueChange={(v) => v && set("protocol", v as ProtocolChoice)} disabled={running}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROTOCOL_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Collapsible open={advanced} onOpenChange={setAdvanced}>
        <CollapsibleTrigger className="flex w-full items-center justify-between rounded-md py-1 text-sm font-medium text-muted-foreground hover:text-foreground">
          检测项与高级设置
          <ChevronDown className={`size-4 transition-transform ${advanced ? "rotate-180" : ""}`} />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-4 pt-3">
          <ToggleRow
            id="fp"
            label="模型指纹"
            hint="3 道随机整数挑战 + 自报身份"
            checked={form.fingerprint}
            onChange={(v) => set("fingerprint", v)}
            disabled={running}
          />
          <ToggleRow
            id="tk"
            label="分词器探测"
            hint="约 14 个极短请求，读取 usage 中的输入 token 数"
            checked={form.fingerprint && form.tokenizer}
            onChange={(v) => set("tokenizer", v)}
            disabled={running || !form.fingerprint}
          />
          <ToggleRow
            id="dg"
            label="降智检测"
            hint="8 道带标准答案的问答题 + 所选 HTML/SVG 动画题"
            checked={form.degradation}
            onChange={(v) => set("degradation", v)}
            disabled={running}
          />
          <div className="space-y-2">
            <Label>HTML / SVG 动画题</Label>
            <p className="text-xs text-muted-foreground">12 道内置动画题，结果可在报告中直接预览。每题生成较慢、消耗较多 token。</p>
            <div className="flex flex-wrap gap-1.5">
              {VISUAL_OPTIONS.map((option) => {
                const active = form.visualPresets.includes(option.key);
                return (
                  <button
                    key={option.key}
                    type="button"
                    aria-pressed={active}
                    disabled={running || !form.degradation}
                    onClick={() =>
                      set("visualPresets", active ? form.visualPresets.filter((k) => k !== option.key) : [...form.visualPresets, option.key])
                    }
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-50",
                      active ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {option.name}
                  </button>
                );
              })}
            </div>
            <Select
              items={TIMEOUT_ITEMS}
              value={String(form.visualTimeoutMin)}
              onValueChange={(v) => v && set("visualTimeoutMin", Number(v))}
              disabled={running || !form.degradation || !form.visualPresets.length}
            >
              <SelectTrigger className="w-full">
                <span className="text-muted-foreground">动画题超时上限：</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TIMEOUT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>推理强度</Label>
            <Select items={EFFORT_ITEMS} value={form.effort || "default"} onValueChange={(v) => set("effort", !v || v === "default" ? "" : String(v))} disabled={running}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EFFORT_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>降智判定方式</Label>
            <Select items={JUDGE_ITEMS} value={form.judgeMode} onValueChange={(v) => v && set("judgeMode", v as JudgeMode)} disabled={running}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {JUDGE_ITEMS.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="flex flex-col gap-2 sm:flex-row">
        {running ? (
          <Button type="button" variant="outline" className="h-10 flex-1" onClick={onCancel}>
            <Square className="size-4" /> 停止检测
          </Button>
        ) : (
          <Button type="submit" className="h-10 flex-1" disabled={!canStart}>
            <Play className="size-4" /> 开始检测
          </Button>
        )}
        <Button type="button" variant="secondary" className="h-10" onClick={useDemo} disabled={running}>
          <FlaskConical className="size-4" /> 使用演示端点
        </Button>
      </div>

      <p className="flex gap-2 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" />
        API Key 只在本次检测期间由服务端转发给你填写的接口，不写日志、不落盘、检测结束即丢弃。检测会产生真实用量（默认约 26 次请求，含 1 道动画题）。
      </p>
    </form>
  );
}

function ToggleRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
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
