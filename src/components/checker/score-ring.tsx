"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { TONE_STROKE, TONE_TEXT, type Tone } from "./format";

export function ScoreRing({ score, tone, size = 112, label }: { score: number | null; tone: Tone; size?: number; label?: string }) {
  const stroke = size >= 120 ? 7 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const value = score === null ? 0 : Math.max(0, Math.min(100, score));
  // Start empty and sweep to the score once mounted.
  const [drawn, setDrawn] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setDrawn(value));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "得分"} ${score === null ? "无" : score}`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-fill-3" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (drawn / 100) * c}
          className={cn("fill-none transition-[stroke-dashoffset] duration-1000 ease-out motion-reduce:transition-none", TONE_STROKE[tone])}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={cn("leading-none font-medium tracking-[-0.03em] tabular-nums", size >= 120 ? "text-[40px]" : "text-[30px]", TONE_TEXT[tone])}>{score === null ? "—" : score}</span>
        {label && <span className="mt-1.5 text-[13px] text-fg-3">{label}</span>}
      </div>
    </div>
  );
}
