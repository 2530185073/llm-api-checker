import type {
  RunResult,
  RunStats,
  CallResult,
  DegradationReport,
  DegradationTestResult,
  Evidence,
  JudgeMode,
  TestStatus,
} from "./types";

export type MatchMode = "exact" | "contains" | "regex" | "number";

export interface Question {
  id: string;
  name: string;
  category: string;
  weight: number;
  prompt: string;
  expected: string;
  match: MatchMode;
  maxDurationMs: number;
}

/** Reasoning puzzle; the expected answer is 21. */
const CANDY_PROMPT =
  "不允许调用工具和联网。在一个黑色的袋子里放有三种口味的糖果，每种糖果有两种不同的形状，分别为圆形和五角星形，不同的形状靠手感可以分辨，现已知苹果味圆形有7颗、苹果味五角星形有7颗、桃子味圆形有9颗、桃子味五角星形有6颗、西瓜味圆形有8颗、西瓜味五角星形有4颗，参赛者需要在活动前决定摸出的糖果数目，那么最少取出多少个糖果才能保证手中同时拥有不同形状的苹果味和桃子味的糖，同时手中有圆形苹果味匹配五角星桃子味糖果，或者有圆形桃子味匹配五角星苹果味糖果都满足要求，最终只回复数字结果。";

const NO_TOOLS = "不允许调用工具、写代码执行或联网，";

const FILLER_TOPICS = [
  "仓储中心在清晨完成了货架盘点，叉车按既定路线把托盘送到出库区，调度员核对了每一张拣货单。",
  "气象站记录到午后湿度明显上升，观测员在日志中写下风向变化，并提醒值班人员检查雨量计。",
  "图书馆的古籍修复室保持恒温恒湿，修复师用薄棉纸加固书页边缘，再把修好的册子装入函套。",
  "港口的集装箱码头连夜作业，岸桥司机根据配载图依次吊装，理货员在终端上逐箱确认箱号。",
  "社区医院的药房更新了库存系统，药剂师把近效期药品单独标注，并安排周末进行复盘。",
  "铁路调度中心收到线路检修计划，值班主任调整了三趟列车的会让方案，并通知沿线车站。",
  "实验室的离心机完成例行校准，研究员把样品按批次编号放入冷柜，记录了每一管的体积。",
  "果园在采摘季增加了临时工人，管理员按地块分配任务，傍晚统一称重并登记各组产量。",
];

function needle(): { prompt: string; expected: string } {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const pick = () => letters[Math.floor(Math.random() * letters.length)];
  const code = `${pick()}${pick()}-${Math.floor(1000 + Math.random() * 9000)}-${pick()}${Math.floor(Math.random() * 10)}`;
  const paragraphs: string[] = [];
  for (let i = 0; i < 64; i++) paragraphs.push(`第${i + 1}段：${FILLER_TOPICS[i % FILLER_TOPICS.length]}`);
  paragraphs.splice(39, 0, `第40段补充：本次夜间值守使用的仓库口令是 ${code}，请勿外传。`);
  return {
    prompt: `${NO_TOOLS}请阅读下面的长篇值班记录，然后回答问题。\n\n${paragraphs.join("\n")}\n\n问题：记录中提到的仓库口令是什么？只回复口令本身。`,
    expected: code,
  };
}

export function buildQuestions(): Question[] {
  const n = needle();
  return [
    {
      id: "candy",
      name: "糖果配对",
      category: "复杂推理",
      weight: 3,
      prompt: CANDY_PROMPT,
      expected: "21",
      match: "number",
      maxDurationMs: 60_000,
    },
    {
      id: "inclusion-exclusion",
      name: "容斥计数",
      category: "数学推理",
      weight: 2,
      prompt: `${NO_TOOLS}请计算：1 到 1000（含）的整数中，既不能被 2 整除、也不能被 3 整除、也不能被 5 整除的数有多少个？最终只回复数字结果。`,
      expected: "266",
      match: "number",
      maxDurationMs: 45_000,
    },
    {
      id: "last-digits",
      name: "幂次末两位",
      category: "数学推理",
      weight: 2,
      prompt: `${NO_TOOLS}请求出 7 的 2026 次方的最后两位数字（十位和个位）。最终只回复这两位数字。`,
      expected: "49",
      match: "number",
      maxDurationMs: 45_000,
    },
    {
      id: "crt",
      name: "同余方程",
      category: "数学推理",
      weight: 1,
      prompt: `${NO_TOOLS}一个正整数除以 3 余 2，除以 5 余 3，除以 7 余 2。满足条件的最小正整数是多少？最终只回复数字结果。`,
      expected: "23",
      match: "number",
      maxDurationMs: 30_000,
    },
    {
      id: "code-trace",
      name: "代码执行推演",
      category: "代码理解",
      weight: 2,
      prompt: `${NO_TOOLS}请在脑中推演下面这段 Python 代码，给出它打印的结果：\n\nx = [3, 1, 4, 1, 5, 9, 2, 6]\ny = sorted(set(x))[::-1]\nprint(sum(y[1:4]) * len(x) % 7)\n\n最终只回复打印出的数字。`,
      expected: "1",
      match: "number",
      maxDurationMs: 30_000,
    },
    {
      id: "char-count",
      name: "字符计数",
      category: "细节注意力",
      weight: 1,
      prompt: `${NO_TOOLS}请数一数字符串 "banana bandana cabana" 中小写字母 a 一共出现了多少次。最终只回复数字结果。`,
      expected: "9",
      match: "number",
      maxDurationMs: 30_000,
    },
    {
      id: "json-format",
      name: "格式指令遵循",
      category: "指令遵循",
      weight: 1,
      prompt:
        '输出一个 JSON 对象，只包含两个键 "a" 和 "b"：a 的值是 7 的平方，b 的值是 3 的立方，值都用数字类型。只输出这个 JSON 对象本身，不要任何解释、不要 Markdown 代码块。',
      expected: '^\\{\\s*"a"\\s*:\\s*49\\s*,\\s*"b"\\s*:\\s*27\\s*\\}$',
      match: "regex",
      maxDurationMs: 30_000,
    },
    {
      id: "needle",
      name: "长上下文检索",
      category: "上下文完整性",
      weight: 2,
      prompt: n.prompt,
      expected: n.expected,
      match: "contains",
      maxDurationMs: 45_000,
    },
  ];
}

/** NFKC, trim, and unwrap one code fence that encloses the whole answer. */
export function normalizeAnswer(raw: string): string {
  let s = raw.normalize("NFKC").trim();
  if (s.startsWith("```") && s.endsWith("```")) {
    const first = s.indexOf("\n");
    if (first >= 3) {
      const inner = s.slice(first + 1, s.length - 3);
      if (!inner.includes("```")) s = inner.trim();
    }
  }
  return s;
}

/**
 * `number` accepts light decoration such as "**21**" or "答案：21。" but rejects answers listing several
 * candidates, so a model cannot pass by enumerating guesses.
 */
export function answerMatches(question: Question, output: string): boolean {
  const out = normalizeAnswer(output);
  const expected = question.match === "regex" ? question.expected : normalizeAnswer(question.expected);
  switch (question.match) {
    case "exact":
      return out === expected;
    case "contains":
      return out.toUpperCase().includes(expected.toUpperCase());
    case "regex":
      return new RegExp(expected).test(out);
    case "number": {
      const numbers = out.replace(/(\d),(\d{3})/g, "$1$2").match(/-?\d+(\.\d+)?/g) ?? [];
      return numbers.length > 0 && numbers.length <= 2 && numbers[numbers.length - 1] === expected;
    }
  }
}

export function gradeQuestion(question: Question, call: CallResult, mode: JudgeMode): DegradationTestResult {
  const answerPassed = call.ok ? answerMatches(question, call.text) : false;
  const latencyPassed = call.ok && call.durationMs < question.maxDurationMs;
  let status: TestStatus = "error";
  if (call.ok) {
    const pass = mode === "answer" ? answerPassed : mode === "latency" ? latencyPassed : answerPassed && latencyPassed;
    status = pass ? "normal" : "degraded";
  }
  const generationMs = call.ttftMs !== null ? call.durationMs - call.ttftMs : null;
  const tokensPerSecond =
    call.usage.output && generationMs && generationMs > 50 ? Math.round((call.usage.output / generationMs) * 10000) / 10 : null;
  return {
    id: question.id,
    kind: "qa",
    name: question.name,
    category: question.category,
    weight: question.weight,
    status,
    answerPassed,
    latencyPassed,
    expected: question.match === "regex" ? '{"a": 49, "b": 27}' : question.expected,
    output: call.text.slice(0, 2000),
    maxDurationMs: question.maxDurationMs,
    durationMs: call.durationMs,
    ttftMs: call.ttftMs,
    usage: call.usage,
    responseModel: call.responseModel,
    finishReason: call.finishReason,
    tokensPerSecond,
    reasoningSeen: call.reasoningText,
    error: call.ok ? null : call.error,
  };
}

const mean = (values: number[]) => (values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);

export function summarizeDegradation(
  tests: DegradationTestResult[],
  mode: JudgeMode,
  context: { claimed: string; effort?: string; reasoningSeen: boolean },
): DegradationReport {
  const graded = tests.filter((t) => t.status !== "error");
  const passed = graded.filter((t) => t.status === "normal");
  const totalWeight = graded.reduce((sum, t) => sum + t.weight, 0);
  const allWeight = tests.reduce((sum, t) => sum + t.weight, 0);
  const rate = (t: DegradationTestResult) => t.stats?.passRate ?? (t.status === "normal" ? 1 : 0);
  const score = totalWeight ? Math.round((graded.reduce((sum, t) => sum + t.weight * rate(t), 0) / totalWeight) * 100) : null;
  let verdict: DegradationReport["verdict"] = "inconclusive";
  let verdictText = "有效结果不足，无法判断（请求失败不计为答错）";
  if (score !== null && totalWeight >= allWeight / 2) {
    if (score >= 85) {
      verdict = "normal";
      verdictText = "表现正常，未发现降智迹象";
    } else if (score >= 60) {
      verdict = "suspect";
      verdictText = "疑似降智：部分题目未通过";
    } else {
      verdict = "degraded";
      verdictText = "明显降智：多数题目未通过";
    }
  }
  const ok = tests.filter((t) => t.status !== "error" && t.kind === "qa");
  const responseModels = [...new Set(tests.map((t) => t.responseModel).filter((m): m is string => !!m))];
  const signals: Evidence[] = [];
  const claimed = context.claimed.toLowerCase();
  const mismatched = responseModels.filter((m) => !m.toLowerCase().includes(claimed.replace(/^.*\//, "")));
  if (responseModels.length) {
    signals.push({
      key: "response-model",
      label: "响应中的 model 字段",
      value: responseModels.join("、"),
      signal: mismatched.length ? "against" : "neutral",
      detail: mismatched.length ? "与请求的模型名不同，渠道可能做了模型替换或重命名" : "与请求的模型名一致（该字段可被中转站改写，属弱证据）",
    });
  }
  if (responseModels.length > 1) {
    signals.push({
      key: "model-drift",
      label: "多次请求返回的模型不一致",
      value: `${responseModels.length} 种`,
      signal: "against",
      detail: "同一检测内返回了多个不同的模型名，可能存在多上游混用",
    });
  }
  const reasoningTokens = tests.reduce((sum, t) => sum + (t.usage.reasoning ?? 0), 0);
  if (context.effort && context.effort !== "none") {
    signals.push({
      key: "reasoning",
      label: "推理强度",
      value: reasoningTokens > 0 || context.reasoningSeen ? `已观察到推理（${reasoningTokens} tokens）` : "未观察到推理 token",
      signal: reasoningTokens > 0 || context.reasoningSeen ? "support" : "against",
      detail:
        reasoningTokens > 0 || context.reasoningSeen
          ? `请求了 ${context.effort} 推理强度，并收到了推理用量或推理内容`
          : `请求了 ${context.effort} 推理强度，但用量中没有推理 token，可能被降级为非推理模式`,
    });
  }
  const visible = tests.filter((t) => t.status !== "error" && (t.usage.output ?? 0) >= 8);
  const noThinking = visible.filter((t) => !t.reasoningSeen);
  if (/grok/i.test(context.claimed) && visible.length) {
    signals.push({
      key: "grok-thinking",
      label: "思考证据（Grok）",
      value: noThinking.length ? `${noThinking.length}/${visible.length} 次有可见输出但无思考内容` : `${visible.length} 次请求均出现思考内容`,
      signal: noThinking.length ? "against" : "support",
      detail:
        "Grok 推理模型正常会先流式输出思考内容；“有可见输出但全程没有思考帧”视为降智。usage 中的 reasoning_tokens 不作为证据（降智账号会虚报）。",
    });
  } else {
    const claimedOnly = visible.filter((t) => (t.usage.reasoning ?? 0) > 0 && !t.reasoningSeen);
    if (claimedOnly.length) {
      signals.push({
        key: "reasoning-evidence",
        label: "推理 token 只出现在用量里",
        value: `${claimedOnly.length} 题`,
        signal: "neutral",
        detail: "usage 报告了推理 token，但流中没有思考内容。OpenAI 官方接口本就隐藏推理过程，因此只作提示；对 Grok 渠道这种情况视为可疑。",
      });
    }
  }
  const truncated = tests.filter((t) => t.finishReason === "length" || t.finishReason === "max_tokens");
  if (truncated.length) {
    signals.push({
      key: "truncated",
      label: "输出被截断",
      value: `${truncated.length} 题`,
      signal: "against",
      detail: "响应因长度上限提前结束，渠道可能限制了输出长度",
    });
  }
  const needle = tests.find((t) => t.id === "needle");
  if (needle && needle.status === "degraded" && needle.usage.input !== null && needle.usage.input < 1500) {
    signals.push({
      key: "context",
      label: "长上下文输入 token 偏少",
      value: `${needle.usage.input} tokens`,
      signal: "against",
      detail: "长文本题的输入用量明显低于正常值，渠道可能截断或压缩了上下文",
    });
  }
  return {
    judgeMode: mode,
    score,
    verdict,
    verdictText,
    passed: passed.length,
    failed: graded.length - passed.length,
    errors: tests.length - graded.length,
    tests,
    stats: {
      avgTtftMs: mean(ok.map((t) => t.ttftMs).filter((v): v is number => v !== null)),
      avgDurationMs: mean(ok.map((t) => t.durationMs)),
      avgTokensPerSecond: (() => {
        const v = ok.map((t) => t.tokensPerSecond).filter((x): x is number => x !== null);
        return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
      })(),
      totalInput: tests.reduce((sum, t) => sum + (t.usage.input ?? 0), 0),
      totalOutput: tests.reduce((sum, t) => sum + (t.usage.output ?? 0), 0),
      totalReasoning: reasoningTokens,
      responseModels,
    },
    signals,
  };
}

const pct = (xs: number[], p: number) => {
  if (!xs.length) return null;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
};

/** Folds N graded runs of one test into a single result: status by majority, score by pass rate. */
export function aggregateRuns(runs: DegradationTestResult[]): DegradationTestResult {
  const first = runs[0];
  const graded = runs.filter((r) => r.status !== "error");
  const passed = graded.filter((r) => r.status === "normal");
  const ok = runs.filter((r) => r.status !== "error").map((r) => r.durationMs);
  const ttfts = runs.map((r) => r.ttftMs).filter((v): v is number => v !== null);
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const m = avg(ok);
  const stdev = ok.length > 1 && m !== null ? Math.round(Math.sqrt(ok.reduce((a, b) => a + (b - m) ** 2, 0) / (ok.length - 1))) : ok.length ? 0 : null;
  const stats: RunStats = {
    runs: runs.length,
    graded: graded.length,
    passed: passed.length,
    passRate: graded.length ? passed.length / graded.length : null,
    meanMs: m,
    p95Ms: pct(ok, 95),
    stdevMs: stdev,
    meanTtftMs: avg(ttfts),
  };
  const rep = passed[0] ?? graded[0] ?? first;
  const runResults: RunResult[] = runs.map((r, index) => ({
    index,
    status: r.status,
    answerPassed: r.answerPassed,
    latencyPassed: r.latencyPassed,
    output: r.output,
    durationMs: r.durationMs,
    ttftMs: r.ttftMs,
    usage: r.usage,
    error: r.error,
    artifact: r.artifact,
  }));
  const status: TestStatus = !graded.length ? "error" : passed.length * 2 >= graded.length ? "normal" : "degraded";
  return {
    ...rep,
    status,
    durationMs: m ?? rep.durationMs,
    ttftMs: stats.meanTtftMs,
    reasoningSeen: runs.some((r) => r.reasoningSeen),
    runs: runs.length > 1 ? runResults : undefined,
    stats,
  };
}
