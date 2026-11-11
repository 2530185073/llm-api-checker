"use client";

import { CircleCheck, CircleX, Code2, Download, Eye, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { VisualArtifact } from "@/lib/checker/types";
import { cn } from "@/lib/utils";
import { Segmented } from "./parts";

/** CSP precedes the generated markup, and the frame is sandboxed without same-origin. */
const PREVIEW_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function previewDocument(html: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${PREVIEW_CSP}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;min-height:100%;}svg{max-width:100%;}</style></head><body>${html}</body></html>`;
}

const REVIEW_CRITERIA = ["主体形态是否可辨（如鹈鹕的长喙与喉囊）", "车轮、踏板等机构是否合理", "动作是否连贯自然", "场景与代码是否完整"];

export function VisualPreview({ artifact, name, compact = false }: { artifact: VisualArtifact; name: string; compact?: boolean }) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [nonce, setNonce] = useState(0);
  const doc = useMemo(() => previewDocument(artifact.html), [artifact.html]);
  const download = () => {
    const blob = new Blob([artifact.html], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${artifact.preset}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="预览方式"
          value={view}
          onChange={setView}
          items={[
            {
              value: "preview",
              label: (
                <>
                  <Eye className="size-3.5" /> 动画预览
                </>
              ),
            },
            {
              value: "source",
              label: (
                <>
                  <Code2 className="size-3.5" /> HTML 源码
                </>
              ),
            },
          ]}
        />
        <Button type="button" variant="ghost" size="sm" onClick={() => setNonce((n) => n + 1)} disabled={!artifact.html}>
          <RotateCcw className="size-3.5" /> 重新播放
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={download} disabled={!artifact.html}>
          <Download className="size-3.5" /> 下载 HTML
        </Button>
        {!compact && <span className="ml-auto rounded-md bg-fill-2 px-1.5 py-0.5 font-mono text-[13px] text-fg-3">隔离沙箱 · 仅加载内联内容</span>}
      </div>
      {view === "preview" ? (
        artifact.html ? (
          <iframe
            key={nonce}
            title={`${name} 预览`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={doc}
            className={cn("w-full rounded-xl bg-white ring-1 ring-line-2", compact ? "h-[200px] sm:h-[240px]" : "h-[300px] sm:h-[420px]")}
          />
        ) : (
          <div className="flex h-40 items-center justify-center rounded-xl bg-fill-1 text-sm text-fg-3">未提取到 HTML，无法预览</div>
        )
      ) : (
        <pre className="max-h-[420px] overflow-auto rounded-xl bg-fill-1 p-3.5 font-mono text-sm leading-relaxed break-all whitespace-pre-wrap ring-1 ring-line-1">{artifact.html || "（空）"}</pre>
      )}
      <div className={cn("grid gap-3", compact ? "hidden" : "lg:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]")}>
        <div className="rounded-xl bg-fill-1 p-3.5">
          <div className="mb-2 flex items-center justify-between text-sm font-medium">
            <span>自动检查</span>
            <span className="font-mono text-[13px] text-fg-3 tabular-nums">{artifact.autoScore} / 100</span>
          </div>
          <ul className="space-y-1.5">
            {artifact.checks.map((c) => (
              <li key={c.key} className="flex gap-2 text-sm">
                {c.passed ? <CircleCheck className="mt-px size-3.5 shrink-0 text-success" /> : <CircleX className="mt-px size-3.5 shrink-0 text-danger" />}
                <span className="min-w-0">
                  <span className="font-medium">{c.label}</span>
                  <span className="text-fg-3"> · {c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl bg-fill-1 p-3.5">
          <div className="mb-2 text-sm font-medium">人工目测要点</div>
          <ul className="list-disc space-y-1 pl-4 text-sm text-fg-2 marker:text-fg-4">
            {REVIEW_CRITERIA.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
