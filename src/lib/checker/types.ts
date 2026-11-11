export type Protocol = "chat" | "responses" | "messages";
export type ProtocolChoice = Protocol | "auto";
export type JudgeMode = "answer" | "latency" | "both";

export interface CompositionRequest {
  enabled: boolean;
  vendor: import("../composition/types").Vendor | "auto";
  mode: import("../composition/types").Mode;
  selected: Partial<Record<import("../composition/types").Vendor, string[]>>;
  ladderMax: number;
  ref?: { baseUrl: string; fetchBase: string; apiKey: string; model: string };
  secondModel?: string;
}

export interface CheckOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  models: string[];
  repeat: number;
  concurrency: number;
  composition: CompositionRequest;
  protocol: ProtocolChoice;
  effort?: string;
  judgeMode: JudgeMode;
  fingerprint: boolean;
  tokenizer: boolean;
  degradation: boolean;
  visualPresets: string[];
  visualTimeoutMin: number;
}

export interface Endpoint {
  baseUrl: string;
  apiKey: string;
  model: string;
  protocol: Protocol;
  effort?: string;
}

export interface Usage {
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cached: number | null;
}

export interface CallResult {
  ok: boolean;
  text: string;
  reasoningText: boolean;
  status: number | null;
  error: string | null;
  durationMs: number;
  ttftMs: number | null;
  usage: Usage;
  responseModel: string | null;
  responseId: string | null;
  finishReason: string | null;
  complete: boolean;
  systemFingerprint: string | null;
  headers: Record<string, string>;
}

export type EvidenceSignal = "support" | "against" | "neutral";

export interface Evidence {
  key: string;
  label: string;
  value: string;
  signal: EvidenceSignal;
  detail?: string;
}

export interface Candidate {
  model: string;
  family: string;
  probability: number | null;
  score: number | null;
}

export type ClaimStatus = "match" | "family" | "mismatch" | "unlisted" | "unknown";

export interface TokenizerSummary {
  kind: "exact" | "related" | "unknown";
  className: string;
  classId?: string;
  lab: string;
  confidence: number;
  probes: number;
  claim: { status: "consistent" | "inconsistent" | "uncertain"; probability: number; vendor: string } | null;
  baselineDrift: boolean;
  error?: string;
}

export interface FingerprintSample {
  index: number;
  expected: number;
  parsed: number;
  ok: boolean;
  error: string | null;
  durationMs: number;
  ttftMs: number | null;
  usage: Usage;
  responseModel: string | null;
}

export interface FingerprintReport {
  claimed: string;
  decision: string;
  likely: Candidate | null;
  family: string | null;
  candidates: Candidate[];
  claimStatus: ClaimStatus;
  claimSummary: string;
  confidence: number | null;
  samples: FingerprintSample[];
  sequence: { autocorrelation: number; smallStepShare: number; modelLike: boolean } | null;
  tokenizer: TokenizerSummary | null;
  selfReport: string | null;
  evidence: Evidence[];
  error: string | null;
}

export type TestStatus = "normal" | "degraded" | "error";

export interface VisualCheck {
  key: string;
  label: string;
  passed: boolean;
  weight: number;
  detail: string;
}

export interface VisualArtifact {
  preset: string;
  html: string;
  bytes: number;
  checks: VisualCheck[];
  autoScore: number;
}

export interface RunResult {
  index: number;
  status: TestStatus;
  answerPassed: boolean;
  latencyPassed: boolean;
  output: string;
  durationMs: number;
  ttftMs: number | null;
  usage: Usage;
  error: string | null;
  artifact?: VisualArtifact;
}

export interface RunStats {
  runs: number;
  graded: number;
  passed: number;
  passRate: number | null;
  meanMs: number | null;
  p95Ms: number | null;
  stdevMs: number | null;
  meanTtftMs: number | null;
}

export interface DegradationTestResult {
  id: string;
  kind: "qa" | "visual";
  name: string;
  category: string;
  weight: number;
  status: TestStatus;
  answerPassed: boolean;
  latencyPassed: boolean;
  expected: string;
  output: string;
  maxDurationMs: number;
  durationMs: number;
  ttftMs: number | null;
  usage: Usage;
  responseModel: string | null;
  finishReason: string | null;
  tokensPerSecond: number | null;
  reasoningSeen: boolean;
  error: string | null;
  artifact?: VisualArtifact;
  runs?: RunResult[];
  stats?: RunStats;
}

export type DegradationVerdict = "normal" | "suspect" | "degraded" | "inconclusive";

export interface DegradationReport {
  judgeMode: JudgeMode;
  score: number | null;
  verdict: DegradationVerdict;
  verdictText: string;
  passed: number;
  failed: number;
  errors: number;
  tests: DegradationTestResult[];
  stats: {
    avgTtftMs: number | null;
    avgDurationMs: number | null;
    avgTokensPerSecond: number | null;
    totalInput: number;
    totalOutput: number;
    totalReasoning: number;
    responseModels: string[];
  };
  signals: Evidence[];
}

export interface CheckReport {
  startedAt: string;
  finishedAt: string;
  target: { host: string; protocol: Protocol; model: string; effort?: string };
  protocolDetection: { attempted: Protocol[]; chosen: Protocol; auto: boolean };
  fingerprint: FingerprintReport | null;
  degradation: DegradationReport | null;
  composition: import("../composition/types").CompositionReport | null;
  repeat: number;
  overall: { score: number | null; level: "good" | "warn" | "bad" | "unknown"; summary: string };
  totals: { requests: number; inputTokens: number; outputTokens: number; durationMs: number };
}

export interface MultiReport {
  startedAt: string;
  finishedAt: string;
  host: string;
  repeat: number;
  reports: CheckReport[];
  errors: { model: string; message: string }[];
}

export type ProgressEvent =
  | { type: "stage"; stage: string; message: string; model?: string }
  | { type: "step"; group: "fingerprint" | "tokenizer" | "degradation" | "detect" | "composition"; id: string; label: string; state: "running" | "done" | "failed"; detail?: string; model?: string }
  | { type: "model"; model: string; report?: CheckReport; error?: string }
  | { type: "result"; report: MultiReport }
  | { type: "error"; message: string }
  | { type: "ping" };
