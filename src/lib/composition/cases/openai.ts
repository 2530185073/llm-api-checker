import { normalizeModelId } from "../../checker/model-id";
import { consistencyCase, memoryCase, tokenizerCase, ttftCase, tpsCase, unicodeCase } from "../common";
import { WEATHER } from "../compat";
import { defineCases, fail, info, ok, skip, warn } from "../engine";
import { openaiFacts } from "../facts";
import { type Ctx, errText, is400 } from "../http";
import { chat, type ChatOut } from "../protocols";
import type { Outcome } from "../types";
import { dataUrl, digitsPng, needleDoc, parseJsonLoose } from "../util";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const F = (c: Ctx) => openaiFacts(c.model);
const lowEffort = (c: Ctx) => (F(c).reasoning ? { reasoning_effort: F(c).efforts[0] } : {});
const req = (c: Ctx, content: string, extra: Json = {}): Json => ({ model: c.model, messages: [{ role: "user", content }], ...extra });
const B62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

export function openaiIdTime(id: string | null): number | null {
  const m = id?.match(/^chatcmpl-([0-9A-Za-z]{29})$/);
  if (!m) return null;
  let v = 0;
  for (const ch of m[1].slice(0, 5)) v = v * 62 + B62.indexOf(ch);
  return v + 1576800000;
}

const responses = (c: Ctx, body: Json) => c.send({ path: "/responses", body: { model: c.model, ...body } });

async function basic(c: Ctx): Promise<Outcome> {
  const r = await chat(c, req(c, "Reply with exactly: OK"));
  c.state.set("basic", r);
  if (!r.ok) return fail(`请求失败：${errText(r)}`);
  const bad = [r.json?.object !== "chat.completion" && `object=${r.json?.object}`, !r.choices.length && "choices 为空", !/OK/.test(r.content) && "内容不含 OK", r.finish !== "stop" && `finish_reason=${r.finish}`, !r.usage && "缺 usage"].filter(Boolean);
  return bad.length ? fail(bad.join("，")) : ok("基础对话结构符合官方");
}

async function platform(c: Ctx): Promise<Outcome> {
  const r = (c.state.get("basic") as ChatOut | undefined) ?? (await chat(c, req(c, "Reply OK.")));
  c.state.set("basic", r);
  const id = r.id ?? "";
  let p = "unknown";
  if (r.json?.prompt_filter_results || r.headers["apim-request-id"]) p = "Azure OpenAI";
  else if (/^gen-/.test(id)) p = "OpenRouter";
  else if (/^chatcmpl-[0-9a-f-]{36}$/.test(id)) p = "LiteLLM";
  else if (/^chatcmpl-\d{10,}/.test(id)) p = "new-api";
  else if (/^[0-9a-f-]{36}$/.test(id)) p = "其它厂商（裸 UUID）";
  else if (openaiIdTime(id)) p = "OpenAI 官方";
  c.state.set("platform", p);
  return info(`判定为 ${p}`, [`id ${id}`, `openai-processing-ms ${r.headers["openai-processing-ms"] ?? "无"}`, `x-request-id ${r.headers["x-request-id"] ? "有" : "无"}`]);
}

export const OPENAI_CASES = defineCases("openai", [
  ["basic", "连通性", "基础对话", 3, ["pre"], "最简 Chat Completions 要求只回 OK：校验 200、object=chat.completion、choices 非空、内容含 OK、finish_reason=stop、带 usage。", basic],
  ["developer", "协议保真", "system / developer 消息", 2, [], "用 developer 角色要求只回 PINEAPPLE；丢掉或改写系统指令的中转会让模型正常回答。", async (c) => {
    const r = await chat(c, { model: c.model, messages: [{ role: "developer", content: "Whatever the user says, reply only with the word PINEAPPLE." }, { role: "user", content: "What's the weather like?" }] });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /PINEAPPLE/i.test(r.content) ? ok("developer 指令生效") : fail("developer 指令未生效", [r.content.slice(0, 120)]);
  }],
  ["stop", "协议保真", "stop 停止序列", 2, [], "从 1 数到 20、stop=[\"7\"]：非推理模型应在 7 之前截断；推理模型官方推理前就 400（不支持 stop）。", async (c) => {
    const r = await chat(c, req(c, "Count from 1 to 20 separated by spaces.", { stop: ["7"] }));
    if (!F(c).stopSupported) return is400(r) ? ok("推理模型拒绝 stop，与官方一致") : fail("推理模型却接受了 stop（参数被吞或模型被换）", [], { flags: ["model_swapped"] });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /\b(8|9|20)\b/.test(r.content) ? fail("stop 未生效", [r.content]) : ok("在 7 之前截断");
  }],
  ["output_limit", "协议保真", "输出上限截断", 1, [], "max_completion_tokens=5 写长文：官方 finish_reason=length 且 completion_tokens ≤ 5（部分型号改为 400，同样算官方行为）。", async (c) => {
    const r = await chat(c, req(c, "Write a long essay about the moon.", { max_completion_tokens: 5, ...lowEffort(c) }));
    if (is400(r) && /max_tokens|output limit/i.test(r.text)) return ok("官方以 400 拒绝过小的预算");
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const comp = r.usage?.completion_tokens;
    if (r.finish !== "length") return fail(`finish_reason=${r.finish}，上限没被透传`);
    return comp <= 5 ? ok("截断与计数正确") : fail(`completion_tokens=${comp} 超过上限`, [], { flags: ["usage_fake"] });
  }],
  ["json_schema", "协议保真", "结构化输出 json_schema（strict）", 2, [], "strict json_schema 应严格符合；缺 additionalProperties:false 的 strict schema 官方推理前就 400。", async (c) => {
    const schema = { type: "object", properties: { city: { type: "string" }, population: { type: "integer" } }, required: ["city", "population"], additionalProperties: false };
    const a = await chat(c, req(c, "Give Tokyo and its population.", { response_format: { type: "json_schema", json_schema: { name: "city", strict: true, schema } } }));
    const bad = await chat(c, req(c, "hi", { response_format: { type: "json_schema", json_schema: { name: "x", strict: true, schema: { type: "object", properties: { a: { type: "string" } }, required: ["a"] } } } }));
    if (!a.ok) return fail(`请求失败：${errText(a)}`);
    const j = parseJsonLoose(a.content) as Json;
    const d = [a.content.slice(0, 80), `缺 additionalProperties：${bad.ok ? "200" : errText(bad)}`];
    if (!j || typeof j.city !== "string" || !Number.isInteger(j.population) || Object.keys(j).length !== 2) return fail("输出不符合 schema", d);
    return is400(bad) ? ok("strict schema 校验与官方一致", d) : fail("不合规的 strict schema 被接受（转换层忽略了 schema）", d);
  }],
  ["n", "协议保真", "n 多候选", 1, [], "n=2：官方返回 index 0、1 两个 choice；把 n 吞掉的中转只返回 1 个。", async (c) => {
    const r = await chat(c, req(c, "Say a random fruit.", { n: 2, ...lowEffort(c) }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return r.choices.length === 2 ? ok("返回 2 个候选") : fail(`只返回 ${r.choices.length} 个候选`);
  }],
  ["unicode", "协议保真", "Unicode / 中文标点保真", 1, [], "要求原样复制一句含弯引号、直角引号、全角标点与破折号的中文。", (c) => unicodeCase(c)],
  ["multi_turn", "协议保真", "多轮上下文记忆", 2, [], "三轮对话后追问前文的名字与数字。", memoryCase],
  ["responses_basic", "协议保真", "Responses API 基础请求", 2, [], "POST /responses：官方 id 为 resp_ + 50 位十六进制且内含 created_at，status=completed，output 含 message 条目，usage 带 input / output / total 与细分。", async (c) => {
    const r = await responses(c, { input: "Reply with exactly: OK" });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const j = r.json ?? {};
    const id = String(j.id ?? "");
    const issues = [
      !/^resp_[0-9a-f]{50}$/.test(id) && `id 形态 ${id.slice(0, 20)}`,
      j.object !== "response" && "object 不是 response",
      j.status !== "completed" && `status=${j.status}`,
      !(j.output ?? []).some((o: Json) => o.type === "message") && "没有 message 输出",
      typeof j.usage?.input_tokens_details?.cached_tokens !== "number" && "usage 缺细分",
    ].filter(Boolean) as string[];
    if (/^resp_[0-9a-f]{50}$/.test(id) && j.created_at && Math.abs(parseInt(id.slice(22, 30), 16) - j.created_at) > 5) issues.push("id 内嵌时间与 created_at 不符");
    return issues.length ? fail(issues.join("；")) : ok("Responses 响应为官方形态");
  }],
  ["ttft", "流式", "TTFT 首字延迟（流式 ×5）", 0, ["unscored"], "1 次预热后连发 5 次流式最简请求，按中位 TTFT 判定。推理模型的隐藏推理也算在首字之前。", (c) => ttftCase(c, 5, "median")],
  ["tps", "流式", "TPS 生成吞吐（流式 ×3）", 0, ["unscored"], "1 次预热后发 3 次流式短文请求，以可见输出 token ÷ 首末内容增量间隔计吞吐。", (c) => tpsCase(c, 20)],
  ["stream_chunks", "流式", "流式分块结构", 2, [], "stream + include_usage：每块 object=chat.completion.chunk、id 不变，首个内容块带 role，最后一块 choices:[] 只带 usage，以 [DONE] 结束。", async (c) => {
    const r = await chat(c, req(c, "Reply with exactly: OK", { stream: true, stream_options: { include_usage: true } }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const chunks = r.events.filter((e) => e.json && !e.json.prompt_filter_results);
    const issues = [
      chunks.some((e) => e.json.object !== "chat.completion.chunk") && "object 不全是 chunk",
      new Set(chunks.map((e) => e.json.id)).size > 1 && "id 在块之间变化",
      !r.usageChunks.some((u) => u.emptyChoices) && "没有 choices:[] 的 usage 末块",
      !r.doneSeen && "缺 [DONE]",
      !/OK/.test(r.content) && "内容不含 OK",
    ].filter(Boolean) as string[];
    return issues.length ? fail(issues.join("；")) : ok("流式分块结构与官方一致");
  }],
  ["stream_tools", "流式", "流式工具调用", 1, [], "流式调用 get_weather：首个工具块给出 index、call_ + 24 位 id、type 与 name，之后只追加 arguments 片段，finish_reason=tool_calls。", async (c) => {
    const r = await chat(c, req(c, "What's the weather in Paris? Use get_weather.", { tools: [WEATHER], stream: true }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const t = r.toolCalls[0];
    const pieces = r.events.filter((e) => e.json?.choices?.[0]?.delta?.tool_calls).length;
    const ids = r.events.filter((e) => e.json?.choices?.[0]?.delta?.tool_calls?.[0]?.id).length;
    if (!t) return fail("没有工具调用");
    const d = [`${pieces} 片，id ${t.id}`];
    if (!/^call_[A-Za-z0-9]{24}$/.test(t.id ?? "")) return fail("id 不是 call_ + 24 位", d);
    if (ids > 1) return fail("每块重复 id / name（转换层）", d, { flags: ["protocol_shim"] });
    if (pieces < 2) return fail("一次性吐出完整 arguments（转换层）", d, { flags: ["protocol_shim"] });
    return r.finish === "tool_calls" ? ok("流式工具调用增量正常", d) : fail(`finish_reason=${r.finish}`, d);
  }],
  ["function_tools", "高级特性", "函数工具调用与回传", 3, [], "get_weather 查巴黎天气：finish_reason=tool_calls、id 为 call_ + 24 位、arguments 合法；再以 role=tool 回传 17°C，模型据此作答。", async (c) => {
    const r = await chat(c, req(c, "What's the weather in Paris?", { tools: [WEATHER] }));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const t = r.toolCalls[0];
    if (!t) return fail("没有工具调用", [r.content.slice(0, 100)]);
    const d = [`id ${t.id}，arguments ${t.arguments}`];
    if (!/^call_[A-Za-z0-9]{24}$/.test(t.id ?? "")) return fail("tool call id 不是官方形态", d);
    const r2 = await chat(c, { model: c.model, messages: [{ role: "user", content: "What's the weather in Paris?" }, r.choices[0].message, { role: "tool", tool_call_id: t.id, content: "17°C, cloudy" }], tools: [WEATHER] });
    if (!r2.ok) return fail(`回传失败：${errText(r2)}`, d);
    return /17/.test(r2.content) ? ok("函数调用与回传正常", d) : fail("回答没有引用工具结果", d);
  }],
  ["vision", "高级特性", "图片输入（OCR）", 2, [], "data URL 发送画着 4 位数字的小图，要求只回数字（只差一位也算读到）。", async (c) => {
    const digits = String(1000 + Math.floor(Math.random() * 9000));
    const r = await chat(c, { model: c.model, messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(digitsPng(digits)) } }, { type: "text", text: "Reply with only the digits in this image." }] }] });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const got = r.content.replace(/\D/g, "");
    const diff = [...digits].filter((ch, i) => got[i] !== ch).length;
    return diff <= 1 && got.length >= 3 ? ok(`读出 ${got}`) : fail(`没有读出数字（期望 ${digits}，得到 ${r.content.slice(0, 30)}）`);
  }],
  ["prompt_cache", "高级特性", "自动提示缓存", 1, [], "同一段本次运行唯一的长前缀带 prompt_cache_key 连发三次：后续请求的 cached_tokens 应 > 0 且不超过 prompt_tokens。", async (c) => {
    const prefix = needleDoc(4300, c.salt("oc"), []).text;
    const rs: ChatOut[] = [];
    for (let i = 0; i < 3; i++) rs.push(await chat(c, { model: c.model, messages: [{ role: "user", content: `${prefix}\n\nQuestion ${i}: reply OK.` }], prompt_cache_key: c.salt("k"), ...lowEffort(c) }));
    const cached = rs.map((r) => r.usage?.prompt_tokens_details?.cached_tokens ?? 0);
    const d = rs.map((r, i) => `#${i + 1} prompt ${r.usage?.prompt_tokens} cached ${cached[i]}`);
    if (rs.some((r, i) => cached[i] > (r.usage?.prompt_tokens ?? 0))) return fail("cached 超过 prompt", d, { flags: ["usage_fake"] });
    return cached.slice(1).some((v) => v > 0) ? ok("后续请求命中缓存", d) : warn("没有命中缓存", d);
  }],
  ["responses_state", "高级特性", "Responses 函数调用与服务端状态", 2, [], "Responses 上提供 get_weather：output 应有 function_call；再只发 previous_response_id + function_call_output，官方从服务端存储取回上一轮。", async (c) => {
    const tool = { type: "function", name: "get_weather", parameters: WEATHER.function.parameters };
    const a = await responses(c, { input: "What's the weather in Paris?", tools: [tool] });
    if (!a.ok) return fail(`请求失败：${errText(a)}`);
    const call = (a.json?.output ?? []).find((o: Json) => o.type === "function_call");
    if (!call) return fail("没有 function_call 输出");
    const b = await responses(c, { previous_response_id: a.json.id, input: [{ type: "function_call_output", call_id: call.call_id, output: "17°C, cloudy" }], tools: [tool] });
    if (!b.ok) return fail(`previous_response_id 不被支持：${errText(b)}`, [], { flags: ["protocol_shim"] });
    const text = JSON.stringify(b.json?.output ?? []);
    return /17/.test(text) ? ok("服务端状态与函数调用正常") : fail("没有据工具结果作答");
  }],
  ["web_search", "高级特性", "托管 web_search 工具", 1, [], "Responses 上声明 {type:web_search} 并要求使用：官方 output 有 web_search_call 且回答带 url_citation 注解。", async (c) => {
    const r = await responses(c, { input: "Search the web: who won the most recent Nobel Prize in Physics?", tools: [{ type: "web_search" }], tool_choice: "required" });
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    const out = r.json?.output ?? [];
    const hasCall = out.some((o: Json) => o.type === "web_search_call" && o.status === "completed");
    const cites = JSON.stringify(out).includes("url_citation");
    return hasCall && cites ? ok("服务端执行了搜索") : fail("没有 web_search_call 或引用注解");
  }],
  ["id_time", "身份/成分", "id 形态与内嵌时间", 3, [], "官方 chat id 为 chatcmpl- + 29 位 base62，前 5 位编码创建时间（应与 created 吻合）；system_fingerprint 在 GPT-5 起为 null，GPT-4o / 4.1 为 fp_ 开头。", async (c) => {
    const r = c.state.get("basic") as ChatOut | undefined;
    if (!r) return skip("没有基础响应");
    const t = openaiIdTime(r.id);
    const d = [`id ${r.id}`, `created ${r.created}`, `system_fingerprint ${r.fingerprint}`];
    if (t === null) return fail("id 不是官方 chatcmpl- + 29 位 base62 形态", d);
    if (Math.abs(t - (r.created ?? 0)) > 3) return fail("id 内嵌时间与 created 不符（中转自造 id）", d);
    const fpOk = F(c).fingerprintNull ? r.fingerprint === null : /^fp_[0-9a-f]+$/.test(String(r.fingerprint));
    return fpOk ? ok("id 与 system_fingerprint 均为官方形态", d) : warn("system_fingerprint 形态与型号不符", d);
  }],
  ["usage_details", "身份/成分", "usage 细分字段", 3, [], "官方 usage 带 prompt_tokens_details 与 completion_tokens_details 全部细分，total = prompt + completion；消息带 refusal:null 与 annotations:[]。", async (c) => {
    const r = c.state.get("basic") as ChatOut | undefined;
    const u = r?.usage ?? {};
    const msg = r?.choices[0]?.message ?? {};
    const missing = [
      ...["cached_tokens", "audio_tokens"].filter((k) => typeof u.prompt_tokens_details?.[k] !== "number").map((k) => `prompt_tokens_details.${k}`),
      ...["reasoning_tokens", "accepted_prediction_tokens", "rejected_prediction_tokens", "audio_tokens"].filter((k) => typeof u.completion_tokens_details?.[k] !== "number").map((k) => `completion_tokens_details.${k}`),
      !("refusal" in msg) && "message.refusal",
      !Array.isArray(msg.annotations) && "message.annotations",
    ].filter(Boolean) as string[];
    if (u.total_tokens !== u.prompt_tokens + u.completion_tokens) return fail("total ≠ prompt + completion", [], { flags: ["usage_fake"] });
    return missing.length ? fail(`缺少 ${missing.join(", ")}`, [], { flags: ["protocol_shim"] }) : ok("usage 细分字段齐全");
  }],
  ["model_echo", "身份/成分", "模型名回显", 2, [], "官方回显实际服务的快照名（别名解析成带日期的快照）。去掉前缀与日期后不是同一型号判失败；别名回显别名本身给警告。", async (c) => {
    const r = c.state.get("basic") as ChatOut | undefined;
    const echo = r?.model ?? "";
    const strip = (s: string) => normalizeModelId(s).replace(/-\d{4}-\d{2}-\d{2}$/, "");
    if (!echo) return warn("缺少 model 字段");
    if (strip(echo) !== strip(c.model)) return fail(`请求 ${c.model}，回显 ${echo}：模型被换`, [], { flags: ["model_swapped"] });
    return echo === c.model && /^gpt-(4o|4\.1|5\.5)$/.test(c.model) ? warn("别名回显了别名本身（中转改写了 model）") : ok(`回显 ${echo}`);
  }],
  ["tokenizer", "身份/成分", "分词器指纹（token 差值）", 3, [], "用 prompt_tokens 的差值测出每段探针文本的 token 数并与 o200k_base 等官方分词器比对；Claude / Gemini / DeepSeek / Qwen 的分词器计数都不同。", tokenizerCase],
  ["reasoning_params", "身份/成分", "推理模型参数校验", 3, [], "推理模型传 max_tokens 必 400（要求改用 max_completion_tokens）；在 effort ≠ none 时传 temperature=0 必 400；非推理模型两者都接受。", async (c) => {
    const a = await chat(c, req(c, "Say hi.", { max_tokens: 50 }));
    const b = await chat(c, req(c, "Say hi.", { temperature: 0, ...(F(c).reasoning ? { reasoning_effort: F(c).efforts.find((e) => e !== "none") ?? "low" } : {}) }));
    const d = [`max_tokens：${a.ok ? "200" : errText(a)}`, `temperature=0：${b.ok ? "200" : errText(b)}`];
    if (F(c).reasoning) return is400(a) && /max_completion_tokens/.test(a.text) && is400(b) ? ok("参数校验与官方一致", d) : fail("推理模型的参数校验与官方不符（参数被吞或模型被换）", d, { flags: ["model_swapped"] });
    return a.ok && b.ok ? ok("非推理模型接受这些参数", d) : fail("非推理模型拒绝了常规参数", d);
  }],
  ["effort_levels", "身份/成分", "reasoning_effort 档位（代际指纹）", 2, [], "按型号核对接受的 reasoning_effort 档位，再发非法值 turbo（必须 400）。档位与型号不符说明背后是别的代际。", async (c) => {
    const f = F(c);
    if (!f.reasoning || !f.known) return skip("非推理模型或未知型号");
    const all = ["none", "minimal", "low", "medium", "high", "xhigh", "turbo"];
    const res = await Promise.all(all.map((e) => chat(c, req(c, "Say hi.", { reasoning_effort: e }))));
    const d = all.map((e, i) => `${e}：${res[i].ok ? "200" : "400"}`);
    if (res[6].ok) return fail("非法档位 turbo 被接受", d);
    const mism = all.slice(0, 6).filter((e, i) => res[i].ok !== f.efforts.includes(e));
    return mism.length ? fail(`档位与该型号官方不符：${mism.join(", ")}`, d, { flags: ["model_swapped"] }) : ok("档位与代际一致", d);
  }],
  ["max_output", "身份/成分", "最大输出 token 上限（代际指纹）", 2, [], "输出上限设为官方上限 + 1：官方推理前就 400 并报出上限 M；M 与型号不符或干脆 200 说明背后是别的模型。", async (c) => {
    const f = F(c);
    if (!f.known) return skip("未知型号");
    const r = await chat(c, req(c, "Say hi.", { max_completion_tokens: f.maxOutput + 1 }));
    if (r.ok) return fail("超过官方上限仍被接受", [], { flags: ["model_swapped"] });
    const m = Number(r.text.match(/at most (\d+)/)?.[1] ?? 0);
    return m && m !== f.maxOutput ? fail(`报错上限 ${m} 与官方 ${f.maxOutput} 不符`, [errText(r)], { flags: ["model_swapped"] }) : ok("输出上限与官方一致", [errText(r)]);
  }],
  ["self_identity", "身份/成分", "模型自述身份", 2, [], "询问由哪家公司训练、属于什么模型家族；不提 OpenAI / GPT 多半是模型被替换或注入了身份改写提示。", async (c) => {
    const r = await chat(c, req(c, "Which company trained you and what model family are you? One sentence.", lowEffort(c)));
    if (!r.ok) return fail(`请求失败：${errText(r)}`);
    return /openai|gpt|chatgpt/i.test(r.content) ? ok("自述为 OpenAI GPT", [r.content.slice(0, 120)]) : fail("自述未提及 OpenAI / GPT", [r.content.slice(0, 120)], { flags: ["model_swapped"] });
  }],
  ["model_profile", "身份/成分", "型号画像与默认推理档", 1, [], "列出该型号的官方规格，再不传 reasoning_effort 问一道三位数乘法：默认 none 的型号 reasoning_tokens 必为 0，默认 medium 的型号几乎总有推理 token。", async (c) => {
    const f = F(c);
    if (!f.reasoning) return info("非推理模型", [`输出上限 ${f.maxOutput}`]);
    const r = await chat(c, req(c, "What is 487 * 36? Number only."));
    const rt = r.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
    const d = [`默认档 ${f.defaultEffort}，档位 ${f.efforts.join("/")}，输出上限 ${f.maxOutput}`, `reasoning_tokens ${rt}`];
    if (f.defaultEffort === "none" && rt > 0) return fail("默认不推理的型号出现了推理 token（背后是别的代际）", d, { flags: ["model_swapped"] });
    if (f.defaultEffort !== "none" && rt === 0) return warn("默认会推理的型号没有推理 token", d);
    return ok("默认推理档与型号一致", d);
  }],
  ["platform", "身份/成分", "平台判定", 0, ["unscored", "pre"], "依据 chat id 生成规则、Azure 注解块与响应头、OpenRouter / LiteLLM / new-api 的 id 形态判断渠道背后的平台。", platform],
  ["responses_param", "身份/成分", "Responses 参数位置校验", 2, [], "在 Responses 顶层传 Chat Completions 的写法 verbosity:\"low\"：官方 400 并提示参数已移到 text.verbosity；200 说明请求被转成了 Chat Completions。", async (c) => {
    const r = await responses(c, { input: "Say hi.", verbosity: "low" });
    return is400(r) && /text\.verbosity/.test(r.text) ? ok("Responses 专有的参数校验生效") : fail(r.ok ? "顶层 verbosity 被接受（转换层）" : `报错文案不符：${errText(r)}`, [], r.ok ? { flags: ["protocol_shim"] } : undefined);
  }],
  ["consistency", "身份/成分", "多请求一致性", 2, [], "连续 5 次相同请求，比对 id 形态、model 回显与 usage；指纹不一致说明背后是多个上游混合负载。", (c) => consistencyCase(c, (id) => (openaiIdTime(id) ? "官方 chatcmpl" : id?.slice(0, 9) ?? "无"))],
]);
