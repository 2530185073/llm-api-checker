import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TONE_CLASS, TONE_DOT, type Tone } from "./format";

/** Status pill: a small dot plus the label, tinted by tone. */
export function ToneBadge({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex h-[22px] w-fit shrink-0 items-center gap-1.5 rounded-full px-2 text-[11px] font-medium whitespace-nowrap", TONE_CLASS[tone], className)}>
      <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      {children}
    </span>
  );
}

/** Small monospace label, used for counts, paths and identifiers. */
export function MonoTag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-3", className)}>{children}</span>;
}

/** Grey tray holding a raised white panel. */
export function Tray({ children, className, innerClassName }: { children: React.ReactNode; className?: string; innerClassName?: string }) {
  return (
    <div className={cn("rounded-[28px] bg-surface-1 p-1.5 ring-1 ring-line-1", className)}>
      <div className={cn("overflow-hidden rounded-[22px] bg-card shadow-raised", innerClassName)}>{children}</div>
    </div>
  );
}

export function SectionCard({
  icon: Icon,
  title,
  description,
  action,
  children,
  className,
}: {
  icon: LucideIcon;
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("animate-rise rounded-2xl bg-card shadow-raised", className)}>
      <header className="flex items-start gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-fill-2 text-fg-2">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-medium tracking-[-0.01em]">{title}</h3>
          {description && <p className="mt-0.5 text-[13px] leading-5 text-fg-2">{description}</p>}
        </div>
        {action}
      </header>
      <div className="space-y-6 px-5 pt-5 pb-5 sm:px-6 sm:pb-6">{children}</div>
    </section>
  );
}

export function SubHeading({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h4 className="text-xs font-medium text-fg-3">{children}</h4>
      {aside}
    </div>
  );
}

export const LIST_BOX = "divide-y divide-line-1 overflow-hidden rounded-xl ring-1 ring-line-1";

export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { value: T; label: React.ReactNode }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="inline-flex w-fit rounded-full bg-fill-2 p-0.5">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition-colors",
            value === item.value ? "bg-background font-medium text-foreground shadow-raised" : "text-fg-2 hover:text-foreground",
          )}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** A row of large numerals over small captions, separated by hairlines. */
export function StatStrip({ items, className }: { items: { label: string; value: React.ReactNode; small?: boolean }[]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-2 lg:grid-cols-4", className)}>
      {items.map((s, i) => (
        <div key={s.label} className={cn("min-w-0 px-5 py-4 sm:px-6", i % 2 === 1 && "border-l border-line-1", i >= 2 && "border-t border-line-1 lg:border-t-0", i >= 1 && "lg:border-l")}>
          <dd className={cn("leading-7 font-medium tabular-nums", s.small ? "text-[15px] tracking-[-0.01em]" : "truncate text-[22px] tracking-[-0.02em]")}>{s.value}</dd>
          <dt className="mt-1 text-xs text-fg-3">{s.label}</dt>
        </div>
      ))}
    </dl>
  );
}

export function Count({ tone, label, value }: { tone: Tone; label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-fg-2">
      <span className={cn("size-1.5 rounded-full", TONE_DOT[tone])} />
      {label}
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </span>
  );
}
