import { normalizeModelId } from "../../checker/model-id";
import { memoryCase, tokenizerCase, ttftCase, tpsCase, unicodeCase } from "../common";
import { defineCases, fail, info, ok, skip, warn } from "../engine";
import { geminiFacts } from "../facts";
import { type Ctx, errText, is400 } from "../http";
import { gemini, type GemOut } from "../protocols";
import type { Outcome } from "../types";
import { digitsPng, needleDoc, parseJsonLoose } from "../util";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const F = (c: Ctx) => geminiFacts(c.model);
const minThink = (c: Ctx) => (F(c).thinkingLevels ? { thinkingConfig: { thinkingLevel: F(c).thinkingLevels![0] } } : { thinkingConfig: { thinkingBudget: 0 } });
const g = (c: Ctx, text: string, gen: Json = {}, extra: Json = {}): Json => ({ contents: [{ role: "user", parts: [{ text }] }], generationConfig: { ...minThink(c), ...gen }, ...extra });
const call = (c: Ctx, body: Json, stream = false) => gemini(c, body, { stream });
const WEATHER_DECL = { name: "get_weather", description: "Get the current weather for a city.", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } };

async function basic(c: Ctx): Promise<Outcome> {
  const r = await call(c, g(c, "Reply with exactly: OK"));
  c.state.set("basic", r);
  if (!r.ok) return fail(`请求失败：${errText(r)}`);
  const bad = [!r.candidates.length && "candidates 为空", !/OK/.test(r.text) && "文本不含 OK", r.finish !== "STOP" && `finishReason=${r.finish}`, !r.responseId && "缺 responseId", !r.modelVersion && "缺 modelVersion", !r.usage && "缺 usageMetadata"].filter(Boolean);
  return bad.length ? fail(bad.join("，")) : ok("generateContent 响应结构符合官方");
}

async function platform(c: Ctx): Promise<Outcome> {
  const r = (c.state.get("basic") as GemOut | undefined) ?? (await call(c, g(c, "Reply OK.")));
  const j = r.chunks[0] ?? {};
  let p = "unknown";
  if (j.usageMetadata?.serviceTier || /gfet4t7/.test(r.headers["server-timing"] ?? "")) p = "Gemini API";
  else if (j.createTime || j.usageMetadata?.trafficType) p = "Vertex AI";
  else if (r.ok && r.responseId) p = "Gemini 兼容（来源未确认）";
  c.state.set("platform", p);
  return info(`判定为 ${p}`, [`server-timing ${r.headers["server-timing"] ?? "无"}`, `serviceTier ${j.usageMetadata?.serviceTier ?? "无"}`]);
}

export const GEMINI_CASES = defineCases("gemini", [
  ["basic", "连通性", "基础对话", 3, ["pre"], "最简 generateContent 要求只回 OK：校验 200、candidates 非空、文本含 OK、finishReason=STOP，以及 responseId / modelVersion / usageMetadata。", basic],
  ["unknown_field", "协议保真", "未知字段校验", 3, [], "请求顶层加一个不存在的字段 foo：Gemini API 用 protobuf JSON 严格解析，推理前就 400「Unknown name \"foo\"」。200 说明中转先把请求解析成自己的结构体。", async (c) => {
    const r = await call(c, { ...g(c, "Reply OK."), foo: 1 });
    return is400(r) && /unknown name|cannot find field/i.test(r.body) ? ok("未知字段被严格拒绝") : fail(r.ok ? "未知字段被接受（请求被转换过）" : `报错不符：${errText(r)}`, [], r.ok ? { flags: ["protocol_shim"] } : undefined);
  }],
  ["bad_enum", "协议保真", "非法枚举 / 类型校验", 2, [], "thinkingLevel=\"ultra\" 与 temperature=\"abc\"：protobuf 解析器推理前就 400，报错带 snake_case 字段路径。", async (c) => {
    const a = await call(c, g(c, "Reply OK.", { thinkingConfig: { thinkingLevel: "ultra" } }));
    const b = await call(c, g(c, "Reply OK.", { temperature: "abc" }));
    const d = [errText(a), errText(b)];
    if (a.ok || b.ok) return fail("非法值被接受", d, { flags: ["protocol_shim"] });
    return /generation_config/.test(a.body + b.body) ? ok("报错带 snake_case 字段路径", d) : warn("被拒但报错文案不是官方形态", d);
  }],
  ["snake_case", "协议保真", "snake_case 字段名", 2, [], "整个请求用 snake_case 写（generation_config.max_output_tokens=8）：官方同时接受两种写法并按 8 截断；只认 camelCase 的中转会丢掉配置。", async (c) => {
    const r = await call(c, { contents: [{ role: "user", parts: [{ text: "Write a long essay about rivers." }] }], generation_config: { max_output_tokens: 8, thinking_config: F(c).thinkingLevels ? { thinking_level: F(c).thinkingLevels![0] } : { thinking_budget: 0 } } });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return r.finish === "MAX_TOKENS" ? ok("snake_case 配置生效") : fail(`finishReason=${r.finish}：snake_case 配置被丢弃`);
  }],
  ["system_instruction", "协议保真", "systemInstruction", 2, [], "systemInstruction 要求只回 PINEAPPLE；丢掉或拼错位置的中转会让模型正常回答。", async (c) => {
    const r = await call(c, g(c, "What's the weather today?", {}, { systemInstruction: { parts: [{ text: "Whatever the user says, reply only with the word PINEAPPLE." }] } }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /PINEAPPLE/i.test(r.text) ? ok("systemInstruction 生效") : fail("systemInstruction 未生效", [r.text.slice(0, 100)]);
  }],
  ["stop_sequences", "协议保真", "stopSequences", 2, [], "从 1 数到 20、stopSequences=[\"7\"]：应在 7 之前截断且 finishReason=STOP。", async (c) => {
    const r = await call(c, g(c, "Count from 1 to 20 separated by spaces.", { stopSequences: ["7"] }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /\b(8|9|20)\b/.test(r.text) ? fail("stopSequences 未生效", [r.text]) : ok("在 7 之前截断");
  }],
  ["max_output", "协议保真", "maxOutputTokens 截断", 1, [], "maxOutputTokens=8 写长文：finishReason=MAX_TOKENS 且 candidatesTokenCount ≤ 8。", async (c) => {
    const r = await call(c, g(c, "Write a long essay about the sea.", { maxOutputTokens: 8 }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const n = r.usage?.candidatesTokenCount ?? 0;
    if (r.finish !== "MAX_TOKENS") return fail(`finishReason=${r.finish}`);
    return n <= 8 ? ok("截断与计数正确") : fail(`candidatesTokenCount=${n} 超过上限`, [], { flags: ["usage_fake"] });
  }],
  ["json_schema", "协议保真", "结构化输出 responseJsonSchema", 2, [], "responseMimeType=application/json + responseJsonSchema：官方返回严格符合 schema 的 JSON 文本。", async (c) => {
    const r = await call(c, g(c, "Give Tokyo and its population.", { responseMimeType: "application/json", responseJsonSchema: { type: "object", properties: { city: { type: "string" }, population: { type: "integer" } }, required: ["city", "population"] } }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const j = parseJsonLoose(r.text) as Json;
    return j && typeof j.city === "string" && Number.isInteger(j.population) ? ok("输出符合 schema") : fail("输出不符合 schema", [r.text.slice(0, 100)]);
  }],
  ["prefill", "协议保真", "model 轮次结尾（prefill）", 2, [], "contents 以非空 model 轮次结尾：3.6 Flash 及更新的模型官方 400，更早的模型接着续写。与代际不符即异常。", async (c) => {
    if (!F(c).known) return skip("未知型号");
    const r = await call(c, { contents: [{ role: "user", parts: [{ text: "Name a colour." }] }, { role: "model", parts: [{ text: "The colour is" }] }], generationConfig: minThink(c) });
    if (F(c).prefillAllowed) return r.ok ? ok("旧代际接着续写") : fail("旧代际却拒绝 prefill（模型被换成新代际）", [], { flags: ["model_swapped"] });
    return is400(r) ? ok("新代际拒绝 prefill，与官方一致") : fail("新代际却接受了 prefill", [], { flags: ["model_swapped"] });
  }],
  ["candidates", "协议保真", "candidateCount（代际指纹）", 2, [], "candidateCount=2：Gemini 2.5 返回 2 个候选，Gemini 3 起官方 400。", async (c) => {
    if (!F(c).known) return skip("未知型号");
    const r = await call(c, g(c, "Name a fruit.", { candidateCount: 2 }));
    if (F(c).multiCandidates) return r.ok && r.candidates.length === 2 ? ok("返回 2 个候选") : fail("旧代际没有返回 2 个候选", [], { flags: ["model_swapped"] });
    return is400(r) ? ok("新代际拒绝多候选") : fail("新代际却返回 200（参数被吞）", [], { flags: ["model_swapped"] });
  }],
  ["unicode", "协议保真", "Unicode / 中文标点保真", 1, [], "要求原样复制一句含弯引号、直角引号、全角标点与破折号的中文。", (c) => unicodeCase(c)],
  ["multi_turn", "协议保真", "多轮上下文记忆", 2, [], "三轮对话后追问前文的名字与数字。", memoryCase],
  ["ttft", "流式", "TTFT 首字延迟（流式 ×5）", 0, ["unscored"], "1 次预热后连发 5 次 streamGenerateContent 最简请求，按中位 TTFT 判定。", (c) => ttftCase(c, 5, "median")],
  ["tps", "流式", "TPS 生成吞吐（流式 ×3）", 0, ["unscored"], "1 次预热后发 3 次流式短文请求计生成吞吐。", (c) => tpsCase(c, 20)],
  ["stream_structure", "流式", "流式分块结构", 2, [], "streamGenerateContent?alt=sse：每个 data 都是完整的 GenerateContentResponse，responseId 全程相同、每块带 modelVersion 与 usageMetadata，最后 finishReason=STOP，没有 data: [DONE]。", async (c) => {
    const r = await call(c, g(c, "Reply with exactly: OK"), true);
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const issues = [
      new Set(r.chunks.map((x) => x.responseId)).size > 1 && "responseId 变化",
      r.chunks.some((x) => !x.modelVersion || !x.usageMetadata) && "有块缺 modelVersion / usageMetadata",
      r.finish !== "STOP" && `finishReason=${r.finish}`,
      r.events.some((e) => e.data === "[DONE]") && "出现了 OpenAI 的 [DONE]",
    ].filter(Boolean) as string[];
    return issues.length ? fail(issues.join("；"), [], issues.some((i) => i.includes("DONE")) ? { flags: ["protocol_shim"] } : undefined) : ok("流式分块结构与官方一致");
  }],
  ["function_call", "高级特性", "函数调用与 thoughtSignature", 3, [], "functionCallingConfig.mode=ANY 调用 get_weather：args 应是对象，Gemini 3 起带 thoughtSignature；原样回传可据结果作答，去掉签名再发官方 400。", async (c) => {
    const body = g(c, "What's the weather in Paris?", {}, { tools: [{ functionDeclarations: [WEATHER_DECL] }], toolConfig: { functionCallingConfig: { mode: "ANY" } } });
    const r = await call(c, body);
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const part = r.parts.find((p) => p.functionCall);
    if (!part) return fail("没有 functionCall 部件");
    const d = [`args ${JSON.stringify(part.functionCall.args)}，签名 ${part.thoughtSignature ? "有" : "无"}`];
    if (typeof part.functionCall.args !== "object") return fail("args 不是对象（转换层）", d, { flags: ["protocol_shim"] });
    if (F(c).version >= 3 && !part.thoughtSignature) return fail("Gemini 3+ 的函数调用缺少 thoughtSignature", d, { flags: ["protocol_shim"] });
    const turn = (p: Json) => ({ ...body, contents: [...body.contents, { role: "model", parts: [p] }, { role: "user", parts: [{ functionResponse: { name: "get_weather", response: { result: "17°C, cloudy" } } }] }], toolConfig: undefined });
    const back = await call(c, turn(part));
    d.push(`回传：${back.ok ? back.text.slice(0, 60) : errText(back)}`);
    if (!back.ok || !/17/.test(back.text)) return fail("回传后没有据工具结果作答", d);
    if (F(c).version >= 3) {
      const { thoughtSignature: _sig, ...noSig } = part;
      void _sig;
      const stripped = await call(c, turn(noSig));
      d.push(`去掉签名：${stripped.ok ? "200" : errText(stripped)}`);
      if (stripped.ok) return fail("去掉签名仍被接受（不校验签名）", d);
    }
    return ok("函数调用与签名校验与官方一致", d);
  }],
  ["google_search", "高级特性", "Google 搜索接地", 1, [], "tools=[{googleSearch:{}}]：官方 candidates[0].groundingMetadata 带 webSearchQueries 与 groundingChunks。", async (c) => {
    const r = await call(c, g(c, "Who won the most recent FIFA World Cup? Search to confirm.", {}, { tools: [{ googleSearch: {} }] }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const gm = r.candidates[0]?.groundingMetadata;
    return gm?.webSearchQueries?.length && gm?.groundingChunks?.length ? ok("返回了接地元数据") : fail("没有 groundingMetadata（工具被忽略）");
  }],
  ["code_execution", "高级特性", "代码执行工具", 1, [], "tools=[{codeExecution:{}}] 计算前 50 个素数之和：parts 依次出现 executableCode 与 codeExecutionResult，答案 5117。", async (c) => {
    const r = await call(c, g(c, "Use code to compute the sum of the first 50 prime numbers.", {}, { tools: [{ codeExecution: {} }] }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const exec = r.parts.some((p) => p.executableCode) && r.parts.some((p) => p.codeExecutionResult?.outcome === "OUTCOME_OK");
    return exec && /5117/.test(JSON.stringify(r.parts)) ? ok("沙箱执行了代码并得到 5117") : fail("没有代码执行结果");
  }],
  ["vision", "高级特性", "图片输入（OCR）", 2, [], "inlineData 发送画着 4 位数字的小图，要求只回数字。", async (c) => {
    const digits = String(1000 + Math.floor(Math.random() * 9000));
    const r = await call(c, { contents: [{ role: "user", parts: [{ inlineData: { mimeType: "image/png", data: digitsPng(digits).toString("base64") } }, { text: "Reply with only the digits in this image." }] }], generationConfig: minThink(c) });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return r.text.replace(/\D/g, "") === digits ? ok(`读出 ${digits}`) : fail(`没有读出数字（期望 ${digits}）`, [r.text.slice(0, 40)]);
  }],
  ["implicit_cache", "高级特性", "隐式缓存", 1, [], "超过型号缓存门槛的同一前缀连发三次：后续请求的 cachedContentTokenCount 应 > 0；未命中只给警告。", async (c) => {
    const prefix = needleDoc(F(c).cacheMin + 800, c.salt("gc"), []).text;
    const rs: GemOut[] = [];
    for (let i = 0; i < 3; i++) rs.push(await call(c, g(c, `${prefix}\n\nQuestion ${i}: reply OK.`)));
    const cached = rs.map((r) => r.usage?.cachedContentTokenCount ?? 0);
    const d = cached.map((v, i) => `#${i + 1} cached ${v}`);
    return cached.slice(1).some((v) => v > 0) ? ok("命中隐式缓存", d) : warn("没有命中隐式缓存", d);
  }],
  ["usage_metadata", "身份/成分", "响应结构与 usageMetadata 算术", 3, [], "usageMetadata 含 prompt / candidates / total 与按 modality 细分的 promptTokensDetails，且 total = prompt + candidates + thoughts。", async (c) => {
    const r = c.state.get("basic") as GemOut | undefined;
    const u = r?.usage ?? {};
    const sum = (u.promptTokenCount ?? 0) + (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0);
    const d = [JSON.stringify(u).slice(0, 200)];
    if (u.totalTokenCount !== sum) return fail("totalTokenCount 算术不成立", d, { flags: ["usage_fake"] });
    if (!Array.isArray(u.promptTokensDetails)) return fail("缺少 promptTokensDetails", d, { flags: ["protocol_shim"] });
    return ok("usageMetadata 结构与算术正确", d);
  }],
  ["model_version", "身份/成分", "modelVersion 回显", 2, [], "modelVersion 是实际服务的模型；归一前缀与后缀后与请求不同判失败，不含 gemini 判失败。", async (c) => {
    const r = c.state.get("basic") as GemOut | undefined;
    const mv = r?.modelVersion ?? "";
    const strip = (s: string) => normalizeModelId(s).replace(/^models\//, "").replace(/-(preview|latest|\d{3})(-\d{2}-\d{2})?$/, "");
    if (!/gemini/i.test(mv)) return fail(`modelVersion=${mv}，不是 Gemini`, [], { flags: ["model_swapped"] });
    const alias: Record<string, string> = { "gemini-3.5-flash": "gemini-3.6-flash", "gemini-3.7-flash": "gemini-3.8-flash" };
    const want = alias[strip(c.model)] ?? strip(c.model);
    return strip(mv) === want || /latest/.test(c.model) ? ok(`modelVersion ${mv}`) : fail(`请求 ${c.model}，modelVersion ${mv}`, [], { flags: ["model_swapped"] });
  }],
  ["count_tokens", "身份/成分", "countTokens 与实际计费一致", 2, [], ":countTokens 的 totalTokens 应与 generateContent 的 promptTokenCount 相等或只差 1；差得多说明 usage 是估算的或被注入了提示。", async (c) => {
    const contents = [{ role: "user", parts: [{ text: `The lighthouse keeper climbed the stairs at dusk. ${c.nonce}` }] }];
    const ct = await c.send({ path: `/models/${c.model}:countTokens`, body: { contents } });
    if (!ct.ok) return warn(`countTokens 不可用：${errText(ct)}`);
    const r = await call(c, { contents, generationConfig: minThink(c) });
    const a = ct.json?.totalTokens;
    const b = r.usage?.promptTokenCount;
    const d = [`countTokens ${a}，promptTokenCount ${b}`];
    if (typeof a !== "number" || typeof b !== "number") return warn("计数缺失", d);
    return Math.abs(b - a) <= 1 + F(c).hiddenPrefix ? ok("计数一致", d) : fail("计数差异过大（估算 usage 或注入提示）", d, { flags: ["injected_prompt"] });
  }],
  ["short_prompt", "身份/成分", "极短输入的 promptTokenCount（注入检测）", 2, [], "只发「Say hi.」：Gemini 3.x 应为个位数，Argon 带固定隐藏前缀；多出几十上百说明中转注入了系统提示。", async (c) => {
    const r = await call(c, g(c, "Say hi."));
    const n = r.usage?.promptTokenCount ?? 0;
    const base = F(c).hiddenPrefix;
    const d = [`promptTokenCount ${n}（型号基线约 ${base}）`];
    if (n > base + 40) return fail("极短输入的 token 数远超基线：注入了提示", d, { flags: ["injected_prompt"] });
    if (base > 20 && n < 10) return fail("声称带隐藏前缀的型号却只有个位数", d, { flags: ["model_swapped"] });
    return ok("极短输入的 token 数正常", d);
  }],
  ["temperature_range", "身份/成分", "temperature 取值范围", 2, [], "temperature=1.5 官方 200，2.1 官方 400（范围 [0, 2]）。1.5 被拒说明背后是 0–1 范围的模型，2.1 被接受说明参数被吞。", async (c) => {
    const a = await call(c, g(c, "Say hi.", { temperature: 1.5 }));
    const b = await call(c, g(c, "Say hi.", { temperature: 2.1 }));
    const d = [`1.5：${a.ok ? "200" : errText(a)}`, `2.1：${b.ok ? "200" : errText(b)}`];
    if (!a.ok) return fail("1.5 被拒（背后像是 0–1 范围的模型）", d, { flags: ["model_swapped"] });
    return is400(b) ? ok("temperature 范围校验与官方一致", d) : fail("2.1 被接受（参数被吞）", d);
  }],
  ["self_identity", "身份/成分", "模型自述身份", 2, [], "询问由哪家公司训练；不提 Google 多半是模型被替换或注入了身份改写提示。", async (c) => {
    const r = await call(c, g(c, "Which company trained you? One sentence."));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /google|gemini|deepmind/i.test(r.text) ? ok("自述为 Google", [r.text.slice(0, 100)]) : fail("自述未提及 Google", [r.text.slice(0, 100)], { flags: ["model_swapped"] });
  }],
  ["model_profile", "身份/成分", "型号画像", 0, ["unscored"], "列出所请求型号的官方规格（思考档位、多候选、prefill、缓存门槛、隐藏前缀 token 数），供代际用例判定。", async (c) => {
    const f = F(c);
    return f.known ? info(`Gemini ${f.version}`, [`思考档位 ${f.thinkingLevels?.join("/") ?? "thinkingBudget"}`, `多候选 ${f.multiCandidates ? "支持" : "不支持"}`, `prefill ${f.prefillAllowed ? "支持" : "不支持"}`, `隐式缓存门槛 ${f.cacheMin}`, `隐藏前缀 ${f.hiddenPrefix}`]) : warn("无法识别型号");
  }],
  ["platform", "身份/成分", "平台判定", 0, ["unscored", "pre"], "依据 serviceTier、server-timing、createTime / trafficType 等被动指纹判断是 Gemini API、Vertex AI 还是兼容层。", platform],
  ["thinking_config", "身份/成分", "思考配置（代际指纹）", 3, [], "Gemini 3 / 4：includeThoughts 时应返回思考摘要且 thoughtsTokenCount > 0，没有的档位与 thinkingLevel + thinkingBudget 同传都应 400。Gemini 2.5 用 thinkingBudget。", async (c) => {
    const f = F(c);
    if (!f.known) return skip("未知型号");
    if (!f.thinkingLevels) {
      const r = await call(c, g(c, "What is 17 * 23?", { thinkingConfig: { thinkingBudget: 512, includeThoughts: true } }));
      return r.ok && (r.usage?.thoughtsTokenCount ?? 0) > 0 ? ok("thinkingBudget 生效") : fail("thinkingBudget 未生效");
    }
    const r = await call(c, g(c, "What is 17 * 23?", { thinkingConfig: { thinkingLevel: "high", includeThoughts: true } }));
    const both = await call(c, g(c, "Say hi.", { thinkingConfig: { thinkingLevel: "low", thinkingBudget: 128 } }));
    const missing = ["minimal", "low", "medium", "high"].find((l) => !f.thinkingLevels!.includes(l));
    const miss = missing ? await call(c, g(c, "Say hi.", { thinkingConfig: { thinkingLevel: missing } })) : null;
    const d = [`思考摘要 ${r.thoughts ? "有" : "无"}，thoughtsTokenCount ${r.usage?.thoughtsTokenCount ?? 0}`, `同传：${both.ok ? "200" : "400"}`, miss ? `${missing}：${miss.ok ? "200" : "400"}` : ""].filter(Boolean);
    if (!r.ok || !r.thoughts || !(r.usage?.thoughtsTokenCount > 0)) return fail("没有思考摘要或思考计数", d);
    if (both.ok) return fail("thinkingLevel 与 thinkingBudget 同传被接受", d);
    if (miss?.ok) return fail(`该型号没有的档位 ${missing} 被接受`, d, { flags: ["model_swapped"] });
    return ok("思考配置校验与代际一致", d);
  }],
  ["tokenizer", "身份/成分", "分词器指纹", 2, [], "差分计数探针识别上游分词器，与 Gemini（Gemma 3 词表）比对。", tokenizerCase],
]);
