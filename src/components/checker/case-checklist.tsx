"use client";

import { ListChecks } from "lucide-react";
import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import type { CaseInfo, Mode, Vendor } from "@/lib/composition/types";
import { cn } from "@/lib/utils";

export interface CaseCatalog {
  cases: Record<Vendor, CaseInfo[]>;
  defaults: Record<Vendor, string[]>;
  labels: Record<Vendor, string>;
}

export const VENDORS: Vendor[] = ["claude", "openai", "gemini", "glm", "kimi", "deepseek"];
const MODE_VENDORS: Vendor[] = ["glm", "kimi", "deepseek"];

const TAG_TEXT: Record<string, string> = { pre: "前置", unscored: "不计分", ref: "官方链路特征", critical: "关键", final: "收尾", optional: "默认不勾选" };

export function weightLabel(c: CaseInfo, mode: Mode, vendor: Vendor) {
  const official = mode === "official" || !MODE_VENDORS.includes(vendor);
  if (c.tags.includes("ref")) return official ? `权重 ${c.officialWeight ?? c.weight}` : `参考不计分（官方链路模式权重 ${c.officialWeight ?? c.weight}）`;
  if (c.tags.includes("unscored")) return "不计分";
  return `权重 ${c.weight}`;
}

export function CaseChecklist({
  catalog,
  selected,
  onChange,
  mode,
  focus,
  disabled,
}: {
  catalog: CaseCatalog | null;
  selected: Partial<Record<Vendor, string[]>>;
  onChange: (next: Partial<Record<Vendor, string[]>>) => void;
  mode: Mode;
  focus: Vendor[];
  disabled?: boolean;
}) {
  const [vendor, setVendor] = useState<Vendor>(focus[0] ?? "claude");
  const current = (v: Vendor) => selected[v] ?? catalog?.defaults[v] ?? [];
  const list = useMemo(() => catalog?.cases[vendor] ?? [], [catalog, vendor]);
  const sections = useMemo(() => {
    const out: { name: string; items: CaseInfo[] }[] = [];
    for (const c of list) {
      const s = out.find((x) => x.name === c.section);
      if (s) s.items.push(c);
      else out.push({ name: c.section, items: [c] });
    }
    return out;
  }, [list]);
  const sel = new Set(current(vendor));
  const setFor = (ids: string[]) => onChange({ ...selected, [vendor]: ids });
  const toggle = (id: string) => setFor(sel.has(id) ? [...sel].filter((x) => x !== id) : [...sel, id]);
  const summary = focus.map((v) => `${catalog?.labels[v]?.split("（")[0] ?? v} ${current(v).length}/${catalog?.cases[v]?.length ?? 0}`).join("，");

  return (
    <Dialog>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="w-full justify-between" disabled={disabled || !catalog} />}>
        <span className="inline-flex items-center gap-1.5">
          <ListChecks className="size-4" /> 用例清单
        </span>
        <span className="truncate text-xs text-muted-foreground">{catalog ? summary || "选择模型后显示" : "加载中…"}</span>
      </DialogTrigger>
      <DialogContent className="flex max-h-[88vh] flex-col gap-3 sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>渠道成分检测用例</DialogTitle>
          <DialogDescription>按厂商与分组勾选要运行的用例。各模型按自身厂商使用对应清单。</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {VENDORS.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVendor(v)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                vendor === v ? "border-primary bg-primary text-primary-foreground" : focus.includes(v) ? "border-primary/40 text-foreground" : "text-muted-foreground",
              )}
            >
              {catalog?.labels[v]?.split("（")[0] ?? v} <span className="tabular-nums opacity-80">{current(v).length}/{catalog?.cases[v]?.length ?? 0}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" onClick={() => setFor(catalog?.defaults[vendor] ?? [])}>
            默认
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setFor(list.map((c) => c.id))}>
            全选
          </Button>
          <Button type="button" size="sm" variant="secondary" onClick={() => setFor([])}>
            全不选
          </Button>
          <span className="text-xs text-muted-foreground">
            已选 {sel.size} / {list.length}
          </span>
        </div>
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
          {sections.map((s) => {
            const ids = s.items.map((c) => c.id);
            const all = ids.every((id) => sel.has(id));
            return (
              <div key={s.name} className="mb-4">
                <div className="sticky top-0 z-10 flex items-center justify-between bg-popover py-1.5">
                  <h4 className="text-sm font-medium">{s.name}</h4>
                  <button type="button" className="text-xs text-primary hover:underline" onClick={() => setFor(all ? [...sel].filter((x) => !ids.includes(x)) : [...new Set([...sel, ...ids])])}>
                    {all ? "本组全不选" : "本组全选"}
                  </button>
                </div>
                <ul className="space-y-1">
                  {s.items.map((c, i) => (
                    <li key={c.id}>
                      <label className="flex cursor-pointer gap-2.5 rounded-md p-2 hover:bg-muted/50">
                        <Checkbox checked={sel.has(c.id)} onCheckedChange={() => toggle(c.id)} className="mt-0.5" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-xs tabular-nums text-muted-foreground">{list.indexOf(c) + 1 || i + 1}.</span>
                            <span className="text-sm font-medium">{c.title}</span>
                            <Badge variant="outline" className="text-[10px]">
                              {weightLabel(c, mode, vendor)}
                            </Badge>
                            {c.tags
                              .filter((t) => t !== "ref" && t !== "unscored")
                              .map((t) => (
                                <Badge key={t} variant={t === "critical" ? "destructive" : "secondary"} className="text-[10px]">
                                  {TAG_TEXT[t]}
                                </Badge>
                              ))}
                            {c.needsRef && (
                              <Badge variant="secondary" className="text-[10px]">
                                需对照端点
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{c.desc}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
