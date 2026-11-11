import {
  contextLadderCase,
  greedyDivergenceCase,
  hiddenPromptCase,
  identityCase,
  kvDiffCase,
  multiNeedleCase,
  precisionSuiteCase,
  precisionVerdictCase,
  refThroughputCase,
  refTokenizerCase,
  secondModelCase,
  thinkingProfileCase,
  tokenizerCase,
} from "../common";
import * as K from "../compat";
import { defineCases, fail, info, ok, skip, warn } from "../engine";
import { compatFacts } from "../facts";
import { type Ctx, errText } from "../http";
import { chat } from "../protocols";
import type { Outcome } from "../types";
import { dataUrl, estTokens, needleDoc, redPng, stripThink } from "../util";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const F = (c: Ctx) => compatFacts("deepseek", c.model);
const ladderMax = (c: Ctx) => (c.state.get("ladderMax") as number) ?? 262_144;
const off = { thinking: { type: "disabled" } };
const dsIdRule = (id: string) => (/^call_\d+_[A-Za-z0-9]{24}$/.test(id) ? null : /^chatcmpl-tool-/.test(id) ? "vLLM 合成 id" : /^toolu_/.test(id) ? "Anthropic 协议转换 id" : "非官方 id 形态");

async function usageShapeCase(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Say hi."));
  const b = await chat(c, { model: c.model, messages: [{ role: "user", content: "What is 12 * 13?" }], max_tokens: 2048, thinking: { type: "enabled" }, reasoning_effort: "low" });
  const issues: string[] = [];
  for (const [label, r] of [["非思考", a], ["思考", b]] as const) {
    const u = r.usage ?? {};
    for (const k of ["prompt_tokens", "completion_tokens", "total_tokens", "prompt_cache_hit_tokens", "prompt_cache_miss_tokens"]) if (typeof u[k] !== "number") issues.push(`${label}缺 ${k}`);
    if (typeof u.prompt_tokens_details?.cached_tokens !== "number") issues.push(`${label}缺 prompt_tokens_details.cached_tokens`);
    if (typeof u.prompt_cache_hit_tokens === "number" && u.prompt_cache_hit_tokens + u.prompt_cache_miss_tokens !== u.prompt_tokens) issues.push(`${label} hit + miss ≠ prompt`);
  }
  if (b.ok && b.reasoning && typeof b.usage?.completion_tokens_details?.reasoning_tokens !== "number") issues.push("思考请求缺 reasoning_tokens");
  const d = [JSON.stringify(a.usage ?? {}).slice(0, 240)];
  if (issues.some((i) => i.includes("≠"))) return fail(issues.join("；"), d, { flags: ["usage_fake"] });
  return issues.length ? fail(`usage 缺少必填字段：${issues.join("；")}`, d, { flags: ["protocol_shim"] }) : ok("usage 形态符合官方（含缓存命中 / 未命中计数）", d);
}

async function outputCountCase(c: Ctx): Promise<Outcome> {
  const p = "Count from 1 to 60 separated by commas. Output only the numbers.";
  const a = await chat(c, K.body(c, p, {}, 400));
  const b = await chat(c, K.body(c, p, { stream: true, stream_options: { include_usage: true } }, 400));
  if (!a.ok || !b.ok) return fail(`请求失败：${errText(a.ok ? b : a)}`);
  const ca = a.usage?.completion_tokens ?? 0;
  const cb = b.usage?.completion_tokens ?? 0;
  const est = estTokens(a.content);
  const d = [`非流式 ${ca}，流式 ${cb}，文本估算 ${est}`];
  if (ca === 0 || cb === 0) return fail("completion_tokens=0：usage 造假", d, { flags: ["usage_fake"] });
  if (ca < est * 0.4 || ca > est * 3) return fail("completion_tokens 与输出长度不相称", d, { flags: ["usage_fake"] });
  if (Math.abs(ca - cb) / Math.max(ca, cb) > 0.3) return warn("流式与非流式计数相差超过 30%", d);
  return ok("输出计数合理", d);
}

async function diskCacheCase(c: Ctx): Promise<Outcome> {
  const sys = needleDoc(3000, c.salt("dc"), []).text;
  const q1 = "Summarize the handbook in one sentence.";
  const a = await chat(c, { model: c.model, messages: [{ role: "system", content: sys }, { role: "user", content: q1 }], max_tokens: 200, ...off });
  if (!a.ok) return fail(`请求失败：${errText(a)}`);
  await new Promise((r) => setTimeout(r, 6000));
  const b = await chat(c, { model: c.model, messages: [{ role: "system", content: sys }, { role: "user", content: q1 }, { role: "assistant", content: a.content }, { role: "user", content: "Now name one item from it." }], max_tokens: 200, ...off });
  const hit = (r: typeof a) => r.usage?.prompt_cache_hit_tokens ?? null;
  const d = [`第 1 轮 hit ${hit(a)} / miss ${a.usage?.prompt_cache_miss_tokens}`, `第 2 轮 hit ${hit(b)} / miss ${b.usage?.prompt_cache_miss_tokens}`];
  if (hit(a) === null) return fail("没有 prompt_cache_hit_tokens 字段", d, { flags: ["protocol_shim"] });
  if ((hit(a) ?? 0) > (a.usage?.prompt_tokens ?? 0) * 0.1) return fail("首轮就大额命中从未见过的前缀：伪造缓存折扣", d, { flags: ["usage_fake"] });
  return (hit(b) ?? 0) > 0 ? ok("多轮拼接命中硬盘缓存", d) : warn("第 2 轮未命中（缓存尽力而为）", d);
}

async function maxTokensTrunc(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Write a long essay about volcanoes.", {}, 24));
  const b = await chat(c, { model: c.model, messages: [{ role: "user", content: "Write a long essay about volcanoes." }], max_tokens: 64, thinking: { type: "enabled" }, reasoning_effort: "low" });
  const d = [`非思考：finish ${a.finish}，completion ${a.usage?.completion_tokens}`, `思考：finish ${b.finish}，completion ${b.usage?.completion_tokens}`];
  if (!a.ok) return fail(`请求失败：${errText(a)}`);
  if ((a.usage?.completion_tokens ?? 0) > 24 || (b.usage?.completion_tokens ?? 0) > 64) return fail("completion_tokens 超过 max_tokens", d, { flags: ["usage_fake"] });
  if (a.finish !== "length") return fail("max_tokens 未生效", d);
  return ok("截断与计数正确（思考与正文共用预算）", d);
}

async function maxTokens384k(c: Ctx): Promise<Outcome> {
  const base = { model: c.model, messages: [{ role: "system", content: needleDoc(1000, c.salt("m3"), []).text }, { role: "user", content: "Reply with one word: yes" }], ...off };
  const a = await chat(c, { ...base, max_tokens: 393216 });
  const b = await chat(c, { ...base, max_tokens: 393217 });
  const d = [`393216：${a.ok ? "200" : errText(a)}`, `393217：${b.ok ? "200" : errText(b)}`];
  if (!a.ok) return fail("官方范围内的 max_tokens 被拒（中转把上限改低了）", d);
  if (b.ok && c.official) return warn("超出上限仍被接受", d);
  return ok("max_tokens 上限与官方一致", d);
}

async function overflowCase(c: Ctx): Promise<Outcome> {
  if (ladderMax(c) < 1_048_576) return skip("档位上限低于 1M，跳过（不花钱）");
  const doc = needleDoc(1_100_000, c.salt("ovf"), [0.5]);
  const r = await chat(c, { model: c.model, messages: [{ role: "system", content: doc.text }, { role: "user", content: "Reply OK." }], max_tokens: 64, ...off }, { timeoutMs: 900_000 });
  const d = [r.ok ? "200" : errText(r)];
  if ((r.status === 400 || r.status === 422) && /context length|too long/i.test(r.text)) {
    const n = Number(r.text.match(/maximum context length is (\d+)/i)?.[1] ?? 1048576);
    return n < 1_048_576 ? fail(`后端窗口 ${n} 低于官方`, d, { flags: ["context_truncated"] }) : ok("超窗按官方契约拒收", d);
  }
  if (r.ok) return fail("超窗请求被静默裁剪后作答", d, { flags: ["context_truncated"] });
  return warn("无法判定", d);
}

async function samplingContract(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Say hi.", { temperature: 2 }));
  const b = await chat(c, K.body(c, "Say hi.", { temperature: 2.5 }));
  const t = await chat(c, { model: c.model, messages: [{ role: "user", content: "Say hi." }], max_tokens: 1024, thinking: { type: "enabled" }, temperature: 0.3, presence_penalty: 1 });
  const d = [`temperature=2：${a.ok ? "200" : errText(a)}`, `temperature=2.5：${b.ok ? "200" : errText(b)}`, `思考 + temperature：${t.ok ? "200" : errText(t)}`];
  if (!a.ok) return fail("合法范围内的 temperature=2 被拒", d);
  if (!t.ok) return fail("思考模式下设置 temperature 应不报错", d);
  if (b.ok && c.official) return warn("越界 temperature 被接受", d);
  return ok("采样参数契约与官方一致", d);
}

async function effortRules(c: Ctx): Promise<Outcome> {
  const q = "What is 9 + 10?";
  const probes: [string, Json][] = [["medium", { reasoning_effort: "medium" }], ["minimal", { reasoning_effort: "minimal" }], ["xhigh", { reasoning_effort: "xhigh" }], ["bogus", { reasoning_effort: "bogus" }]];
  const res = await Promise.all(probes.map(([, e]) => chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, ...e })));
  const d = probes.map(([n], i) => `${n}：${res[i].ok ? "200" : errText(res[i])}`);
  if (res.slice(0, 3).some((r) => !r.ok)) return fail("官方兼容的 effort 别名被拒", d);
  if (res[3].ok) return warn("非法 effort 被接受", d);
  return ok("effort 取值规则与官方一致", d);
}

async function logprobsCase(c: Ctx): Promise<Outcome> {
  const r = await chat(c, K.body(c, "Say hello.", { logprobs: true, top_logprobs: 3 }));
  if (!r.ok) return fail(`请求失败：${errText(r)}`);
  const lp = r.choices[0]?.logprobs?.content;
  const d = [Array.isArray(lp) ? `${lp.length} 个 token，首项 ${JSON.stringify(lp[0]).slice(0, 120)}` : "无 logprobs.content"];
  if (!Array.isArray(lp) || !lp.length) return fail("没有返回逐 token 的 logprobs", d);
  if (!lp.every((x: Json) => typeof x.token === "string" && typeof x.logprob === "number" && Array.isArray(x.top_logprobs))) return fail("logprobs 项结构不符", d);
  const bad = await chat(c, K.body(c, "Say hello.", { logprobs: true, top_logprobs: 21 }));
  d.push(`top_logprobs=21：${bad.ok ? "200" : errText(bad)}`);
  return bad.ok && c.official ? warn("越界 top_logprobs 被接受", d) : ok("logprobs 结构与官方一致", d);
}

async function messageRules(c: Ctx): Promise<Outcome> {
  const empty = await chat(c, { ...K.body(c, ""), messages: [] });
  const so = await chat(c, K.body(c, "hi", { stream_options: { include_usage: true } }));
  const mid = await chat(c, { ...K.body(c, ""), messages: [{ role: "user", content: "Hi" }, { role: "assistant", content: "Hello!" }, { role: "system", content: "From now on, answer in French." }, { role: "user", content: "How are you?" }] });
  const d = [`空 messages：${empty.ok ? "200" : errText(empty)}`, `非流式带 stream_options：${so.ok ? "200" : errText(so)}`, `中途 system：${mid.ok ? mid.content.slice(0, 40) : errText(mid)}`];
  if (empty.ok) return fail("空 messages 被接受", d);
  if (!mid.ok) return fail("中途插入 system 被拒", d);
  if (so.ok && c.official) return warn("stream_options 未与 stream 一起使用也被接受", d);
  return ok("消息结构规则与官方一致", d);
}

async function userIdCase(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Say hi.", { user_id: `dscheck-${c.nonce}` }));
  const b = await chat(c, K.body(c, "Say hi.", { user_id: "x".repeat(600) }));
  const d = [`user_id：${a.ok ? "200" : errText(a)}`, `600 字节：${b.ok ? "200" : errText(b)}`];
  if (!a.ok) return fail("中间层不认官方的 user_id 参数", d);
  return b.ok && c.official ? warn("超长 user_id 被接受", d) : ok("user_id 处理与官方一致", d);
}

async function undefinedFields(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Say hi.", { dscheck_unknown: true }));
  const b = await chat(c, K.body(c, "Say hi.", { n: 2 }));
  const u = await chat(c, K.body(c, "Say hi.", { user: "x" }));
  return info(b.ok && b.choices.length >= 2 ? "n=2 返回两个 choice（后端不是 DeepSeek 的线索）" : "未定义字段已记录", [`未知字段：${a.ok ? "200" : errText(a)}`, `n=2：${b.ok ? `${b.choices.length} 个 choice` : errText(b)}`, `user：${u.ok ? "200" : errText(u)}`]);
}

async function defaultThinking(c: Ctx): Promise<Outcome> {
  const r = await chat(c, { model: c.model, messages: [{ role: "user", content: `A box holds 12 apples. ${c.nonce.length} boxes are filled and 5 apples are eaten. How many remain? Number only.` }], max_tokens: 8192 });
  if (!r.ok) return fail(`请求失败：${errText(r)}`);
  const d = [`字段 ${r.reasoningField ?? "无"}，思考 ${r.reasoning.length} 字符，reasoning_tokens ${r.usage?.completion_tokens_details?.reasoning_tokens ?? "—"}`];
  if (/<think>/.test(r.content)) return fail("content 里泄露了 <think>", d);
  if (r.reasoningField === "reasoning") return fail("思考字段名为 reasoning：协议转换层", d, { flags: ["protocol_shim"] });
  if (!r.reasoning) return (r.usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0 ? fail("计费了思考却没有思考文本", d) : fail("默认应开启思考却没有思考：模型被替换", d, { flags: ["model_swapped"] });
  return ok("默认开启思考并返回 reasoning_content", d);
}

async function thinkingSwitch(c: Ctx): Promise<Outcome> {
  const q = "What is 23 + 19?";
  const mk = (e: Json) => chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, ...e });
  const [a, b, cc, dd] = await Promise.all([mk({ thinking: { type: "disabled" } }), mk({ reasoning_effort: "none" }), mk({ thinking: { type: "disabled" }, reasoning_effort: "high" }), mk({ thinking: { type: "enabled" }, reasoning_effort: "low" })]);
  const t = (r: typeof a) => (r.ok ? (r.reasoning ? "思考" : "不思考") : errText(r));
  const d = [`disabled：${t(a)}`, `effort=none：${t(b)}`, `disabled + high：${t(cc)}`, `enabled + low：${t(dd)}`];
  if ([a, b, cc, dd].some((r) => !r.ok)) return fail("官方开关写法被拒", d);
  if (a.reasoning || b.reasoning || cc.reasoning) return fail("关闭思考无效", d);
  if (!dd.reasoning) return fail("开启思考无效", d);
  return ok("思考开关与优先级符合官方", d);
}

async function prefixCompletion(c: Ctx): Promise<Outcome> {
  const r = await chat(c, { model: c.model, messages: [{ role: "user", content: "Write a Python function that squares a number." }, { role: "assistant", content: "```python\n", prefix: true }], stop: ["```"], max_tokens: 200, ...off }, { base: `${K.root(c)}/beta` });
  if (!r.ok) return fail(`Beta 前缀续写失败：${errText(r)}`);
  const d = [r.content.slice(0, 100)];
  if (r.content.startsWith("```")) return fail("重复了前缀（prefix 被忽略）", d);
  return /def\s/.test(r.content) ? ok("按前缀续写", d) : fail("续写内容不符", d);
}

async function fimCase(c: Ctx): Promise<Outcome> {
  const r = await c.send({ path: `${K.root(c)}/beta/completions`, body: { model: c.model, prompt: "def fib(a):", suffix: "    return fib(a-1) + fib(a-2)", max_tokens: 128 } });
  if (!r.ok) return fail(`FIM 补全失败：${errText(r)}`);
  const j = r.json ?? {};
  const d = [`object ${j.object}，text ${String(j.choices?.[0]?.text ?? "").slice(0, 80)}`];
  if (j.object !== "text_completion" || typeof j.choices?.[0]?.text !== "string") return fail("FIM 响应不是官方形态", d);
  return ok("FIM 补全可用", d);
}

async function anthropicEndpoint(c: Ctx): Promise<Outcome> {
  const r = await c.send({ path: `${K.root(c)}/anthropic/v1/messages`, body: { model: c.model, max_tokens: 64, messages: [{ role: "user", content: "Reply OK." }] }, headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" } });
  const s = await c.send({ path: `${K.root(c)}/anthropic/v1/messages`, body: { model: c.model, max_tokens: 64, stream: true, messages: [{ role: "user", content: "Reply OK." }] }, stream: true, headers: { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" } });
  if (!r.ok) return fail(`Anthropic 格式端点不可用：${errText(r)}`);
  const names = s.events.map((e) => e.event ?? e.json?.type).filter(Boolean);
  const d = [`type ${r.json?.type}，content ${JSON.stringify(r.json?.content).slice(0, 80)}`, `流式事件 ${names.slice(0, 6).join(" → ")}`];
  if (r.json?.type !== "message") return fail("响应不是 Anthropic message 形态", d);
  return names[0] === "message_start" ? ok("Anthropic 格式端点可用", d) : warn("流式事件不是 Anthropic 形态", d);
}

async function responsesCase(c: Ctx): Promise<Outcome> {
  const r = await c.send({ path: "/responses", body: { model: c.model, input: "Reply OK.", reasoning: { effort: "none" }, max_output_tokens: 64 } });
  if (!r.ok) return fail(`Responses API 不可用：${errText(r)}`);
  const j = r.json ?? {};
  const msg = (j.output ?? []).find((o: Json) => o.type === "message");
  const d = [`object ${j.object}，status ${j.status}`];
  return j.object === "response" && j.status === "completed" && msg ? ok("Responses API 可用", d) : fail("Responses 响应不是官方形态", d);
}

async function strictTools(c: Ctx): Promise<Outcome> {
  const tool = { type: "function", function: { name: "get_weather", strict: true, parameters: { type: "object", properties: { city: { type: "string" }, unit: { type: "string", enum: ["c", "f"] } }, required: ["city", "unit"], additionalProperties: false } } };
  const a = await chat(c, K.body(c, "What's the weather in Tokyo in celsius?", { tools: [tool] }, 512), { base: `${K.root(c)}/beta` });
  const bad = await chat(c, K.body(c, "hi", { tools: [{ ...tool, function: { ...tool.function, parameters: { type: "object", properties: { city: { type: "string" } } } } }] }), { base: `${K.root(c)}/beta` });
  const d = [`合规 strict：${a.ok ? `${a.toolCalls.length} 个调用` : errText(a)}`, `不合规 schema：${bad.ok ? "200" : errText(bad)}`];
  if (!a.ok || !a.toolCalls.length) return fail("strict 工具调用失败", d);
  return bad.ok ? warn("不合规的 strict schema 未被校验", d) : ok("strict 模式与官方一致", d);
}

async function toolDefs(c: Ctx): Promise<Outcome> {
  const noParams = await chat(c, K.body(c, "Call ping.", { tools: [{ type: "function", function: { name: "ping", description: "Ping." } }] }));
  if (!noParams.ok) return fail(`无参函数定义被拒：${errText(noParams)}`);
  const r = await K.toolSchemaCase(128)(c);
  return r.status === "pass" ? ok("工具定义校验与官方一致") : r;
}

async function visionCase(c: Ctx): Promise<Outcome> {
  const f = F(c);
  const r = await chat(c, K.body(c, "", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(redPng(16)) } }, { type: "text", text: "What colour is this image? One word." }] }] }, 256));
  const sysImg = await chat(c, K.body(c, "", { messages: [{ role: "system", content: [{ type: "image_url", image_url: { url: dataUrl(redPng(8)) } }] }, { role: "user", content: "hi" }] }));
  const d = [r.ok ? stripThink(r.content).slice(0, 40) : errText(r), `system 里的图片：${sysImg.ok ? "200" : errText(sysImg)}`];
  if (!f.vision) return r.ok && /red|红/i.test(r.content) ? fail("纯文本型号却答出了颜色：被路由到了多模态模型", d, { flags: ["model_swapped"] }) : ok("纯文本型号拒绝图片", d);
  if (!r.ok || !/red|红/i.test(r.content)) return fail("视觉型号没有读出图片", d, { flags: ["model_swapped"] });
  return sysImg.ok && c.official ? warn("system 消息里的图片被接受（官方 400）", d) : ok("图片输入与官方一致", d);
}

async function thinkingToolRoundtrip(c: Ctx): Promise<Outcome> {
  const first = await chat(c, { model: c.model, messages: [{ role: "user", content: "Figure out the capital of Japan, then call get_weather for it." }], tools: [K.WEATHER], max_tokens: 4096, thinking: { type: "enabled" }, reasoning_effort: "low" });
  if (!first.ok) return fail(`第 1 轮失败：${errText(first)}`);
  const call = first.toolCalls[0];
  if (!call) return skip("模型没有发起工具调用");
  const msgs = [{ role: "user", content: "Figure out the capital of Japan, then call get_weather for it." }, first.choices[0].message, { role: "tool", tool_call_id: call.id, content: "23°C, sunny" }];
  const second = await chat(c, { model: c.model, messages: msgs, tools: [K.WEATHER], max_tokens: 4096, thinking: { type: "enabled" }, reasoning_effort: "low" });
  const d = [`第 1 轮思考 ${first.reasoning.length} 字符`, `第 2 轮：${second.ok ? second.content.slice(0, 60) : errText(second)}`];
  if (!second.ok) return fail("回传 reasoning_content 被拒", d);
  return /23/.test(second.content) ? ok("思考 + 工具调用回传正常", d) : fail("回答没有引用工具结果", d);
}

async function toolResult(c: Ctx): Promise<Outcome> {
  const t1 = await chat(c, K.body(c, "What's the weather in Tokyo? Call get_weather.", { tools: [K.WEATHER] }, 512));
  const call = t1.toolCalls[0];
  if (!t1.ok || !call) return skip("没有拿到工具调用");
  const t2 = await chat(c, { ...K.body(c, ""), messages: [{ role: "user", content: "What's the weather in Tokyo?" }, t1.choices[0].message, { role: "tool", tool_call_id: call.id, content: "22°C, sunny" }], tools: [K.WEATHER] });
  if (!t2.ok) return fail(`tool 消息被拒：${errText(t2)}`);
  return /22/.test(t2.content) && t2.finish === "stop" ? ok("回答用到了工具结果") : fail("回答没有用到工具结果", [t2.content.slice(0, 120)]);
}

export const DEEPSEEK_CASES = defineCases("deepseek", [
  ["basic", "连通性 / 端点画像", "基础对话", 2, ["pre"], "最省 token 的请求（thinking=disabled）要求回复 OK-<nonce>，校验 200、role、content 含 nonce、finish_reason=stop、带 usage。", K.basicCase],
  ["backend", "连通性 / 端点画像", "后端判定", 0, ["ref", "pre"], "官方 id 为小写 UUID v4、system_fingerprint 为 32 位 hex；chatcmpl- + hex 为 vLLM / SGLang，gen- 为 OpenRouter，msg_ 为 Anthropic 协议转换。", K.backendCase, { officialWeight: 0 }],
  ["endpoint", "连通性 / 端点画像", "端点画像（官方 / Beta / 中转）", 0, ["ref", "pre"], "按 base_url 判定官方端点、Beta 端点或中转 / 自部署。", K.endpointProfileCase([[/api\.deepseek\.com\/beta/, "DeepSeek Beta 端点"], [/api\.deepseek\.com/, "DeepSeek 官方端点"]]), { officialWeight: 0 }],
  ["model_echo", "连通性 / 端点画像", "模型名回显", 2, [], "model 字段应回显请求的 DeepSeek 型号；旧名回显为新名算一致。非 DeepSeek 名字判模型被替换。", K.modelEchoCase(/deepseek/i, /deepseek-(flash|v4)/i)],
  ["id_shape", "连通性 / 端点画像", "ID 与 system_fingerprint 形态", 0, ["ref"], "官方 id 为小写 UUID v4，system_fingerprint 为 32 位小写 hex 且非流式与流式都带。", K.idShapeCase, { officialWeight: 2 }],
  ["models", "连通性 / 端点画像", "/models 元数据", 0, ["ref"], "官方只列 DeepSeek 模型并带 owned_by=deepseek、context_window 等字段；出现其它厂商模型是面板汇总列表。", K.modelsListCase(/deepseek/i, "deepseek"), { officialWeight: 0 }],
  ["headers", "连通性 / 端点画像", "响应头指纹", 0, ["ref"], "记录响应头并标注 uvicorn、Cloudflare、OpenRouter 与中转层头。", K.headersCase(), { officialWeight: 0 }],
  ["balance", "连通性 / 端点画像", "/user/balance", 0, ["ref"], "GET /user/balance（主机根路径）：官方返回 is_available 与 balance_infos；其它响应说明中转未代理该接口。数值不展示。", K.balanceCase("/user/balance"), { officialWeight: 0 }],
  ["error_contract", "连通性 / 端点画像", "错误契约", 0, ["ref"], "未知模型、畸形 JSON、错误 key：错误体应为 OpenAI 风格 {error:{message,type,param,code}}，状态码按官方错误码表。", K.errorContractCase, { officialWeight: 2 }],
  ["usage_shape", "usage 计费完整性", "usage 字段形态", 3, ["critical"], "非思考与思考请求各一次：prompt / completion / total、cached_tokens、prompt_cache_hit / miss_tokens 都是必填，hit + miss = prompt。", usageShapeCase],
  ["output_count", "usage 计费完整性", "输出 token 计数（0 输出客诉）", 2, ["critical"], "从 1 数到 60，非流式与流式各一次：completion_tokens 应 ≥ 1 且在文本估算的 0.4–3 倍之间，两次相差不超过 30%。", outputCountCase],
  ["disk_cache", "usage 计费完整性", "硬盘缓存命中（prompt_cache_hit_tokens）", 3, ["critical"], "第 1 轮带约 3000 token 的专属 system，6 秒后按多轮拼接发第 2 轮：应命中缓存；首轮就大额命中判伪造缓存折扣。", diskCacheCase],
  ["max_tokens_trunc", "usage 计费完整性", "max_tokens 截断与计数", 2, [], "非思考 max_tokens=24 应截断且 completion ≤ 24；思考请求 max_tokens=64 时思考与正文共用预算。", maxTokensTrunc],
  ["usage_invariants", "usage 计费完整性", "usage 一致性审计（收尾）", 3, ["critical", "final"], "汇总本次运行每个 200 响应的 usage：total 算术、hit + miss = prompt、cached ≤ prompt、reasoning ≤ completion。", K.usageInvariantsCase],
  ["precision_suite", "与官方对照（精度 / 性能）", "精度题组（机械任务）", 3, [], "6 道本地判分的机械题（非思考 + temperature 0），按绝对线或对照官方产出精度证据。", (c) => precisionSuiteCase(c, { s: 0.9, failBelow: 0.6 })],
  ["multi_needle", "与官方对照（精度 / 性能）", "64K 多针召回", 3, [], "约 64K 填充中埋 12 根同形式的针与干扰项，按命中数产出精度证据。", (c) => multiNeedleCase(c, Math.min(64_000, ladderMax(c)))],
  ["kv_diff", "与官方对照（精度 / 性能）", "KV 缓存差分复制", 2, [], "300 字符随机串在短档与约 48K 长档分别复制，比较字符错误率。", (c) => kvDiffCase(c, Math.min(48_000, ladderMax(c)))],
  ["throughput_floor", "与官方对照（精度 / 性能）", "吞吐与首字延迟下限", 2, ["critical"], "三次流式数数探针（thinking=disabled），中位吞吐低于官方速度的 0.35× 且三次都低判性能过低。", (c) => refThroughputCase(c, F(c).officialSpeed * 0.35)],
  ["ref_greedy", "与官方对照（精度 / 性能）", "对照官方：贪心解码分歧点", 3, [], "四个中熵提示以非思考 + temperature 0 交错发给官方与被测，比较最长公共前缀。需要对照端点。", (c) => greedyDivergenceCase(c, { temperature: 0, ...off }), { needsRef: true }],
  ["ref_tokenizer", "与官方对照（精度 / 性能）", "对照官方：分词一致", 3, ["critical"], "固定文本分别发给被测与官方逐段比较 prompt_tokens。需要对照端点。", refTokenizerCase, { needsRef: true }],
  ["ref_throughput", "与官方对照（精度 / 性能）", "对照官方：吞吐 / 首字延迟", 2, ["critical"], "被测与官方交错各发 3 次流式探针，逐对比值中位 < 0.4 判性能过低。需要对照端点。", (c) => refThroughputCase(c, F(c).officialSpeed * 0.35), { needsRef: true }],
  ["ref_thinking", "与官方对照（精度 / 性能）", "对照官方：思考画像", 1, [], "同一组合计数题并发发给被测与官方，被测答错而官方答对给弱精度证据。需要对照端点。", (c) => thinkingProfileCase(c, { thinking: { type: "enabled" } }), { needsRef: true }],
  ["second_model", "与官方对照（精度 / 性能）", "跨模型相似度（second_model）", 1, [], "5 个事实短问分别发给本次模型与第二模型，几乎逐字相同说明两个名字指向同一后端。", secondModelCase, { needsSecond: true }],
  ["precision_verdict", "与官方对照（精度 / 性能）", "精度综合判定（收尾）", 2, ["critical", "final"], "汇总各精度用例：强证据 2 分、弱证据 1 分，合计 ≥ 4 才判疑似低精度。", precisionVerdictCase],
  ["context_ladder", "上下文窗口", "上下文阶梯", 4, ["critical"], "8K / 32K / 64K / 120K / 200K 逐档送入（填充放在 system），三针全中且 prompt_tokens ≥ 0.6×档位才通过；官方窗口 1M。", (c) => contextLadderCase(c, { tiers: [8000, 32000, 64000, 120000, 200000], window: F(c).window, ladderMax: ladderMax(c), systemFiller: true })],
  ["overflow", "上下文窗口", "超窗错误契约", 2, ["optional"], "送入约 1.1M token：官方 400「maximum context length is 1048576」；200 说明静默裁剪。默认不勾选。", overflowCase],
  ["max_tokens_384k", "上下文窗口", "max_tokens 上限（384K）", 1, [], "max_tokens=393216 应被接受；393217 官方应拒绝。", maxTokens384k],
  ["sampling", "参数校验 / 协议保真", "采样参数契约", 2, [], "temperature 范围 [0, 2]；思考模式下设置 temperature / penalty 不报错也不生效。", samplingContract],
  ["effort_rules", "参数校验 / 协议保真", "thinking / reasoning_effort 取值规则", 2, [], "官方接受 low / high / max 及兼容别名 minimal / medium / xhigh；非法值应被拒。", effortRules],
  ["json_output", "参数校验 / 协议保真", "JSON Output", 2, [], "response_format=json_object 且提示含 json 与示例时，输出应为合法 JSON。", K.jsonModeCase("reject")],
  ["stop", "参数校验 / 协议保真", "stop 词", 1, [], "从 1 数到 30、stop=[\" 12\"] 应在 12 之前结束；16 个 stop 串应 200，17 个官方应拒绝。", K.stopCase("deepseek")],
  ["logprobs", "参数校验 / 协议保真", "logprobs / top_logprobs", 2, [], "logprobs=true + top_logprobs=3 应返回逐 token 数组，每项含 token / logprob / bytes / top_logprobs；top_logprobs 上限 20。", logprobsCase],
  ["message_rules", "参数校验 / 协议保真", "消息结构规则", 2, [], "空 messages 应被拒；stream_options 须与 stream 一起使用；对话中途插入 system 应被接受。", messageRules],
  ["user_id", "参数校验 / 协议保真", "user_id 参数", 1, [], "官方 user_id 应被接受；600 字节的 user_id 官方应拒绝。", userIdCase],
  ["undefined_fields", "参数校验 / 协议保真", "未定义字段处理（参考）", 0, ["ref", "optional"], "未定义字段、n=2 与 user 各发一次，只记录；n=2 返回两个 choice 是后端不是 DeepSeek 的线索。", undefinedFields, { officialWeight: 0 }],
  ["default_thinking", "思考模式", "默认思考与 reasoning_content", 3, ["critical"], "不带 thinking 参数发一道推理题：官方默认开启思考并在 reasoning_content 返回；完全没有思考判模型被替换。", defaultThinking],
  ["thinking_switch", "思考模式", "思考开关（thinking.type / reasoning_effort=none）", 3, [], "disabled、effort=none、disabled + high（thinking 对象优先）应不思考；enabled + low 应思考。", thinkingSwitch],
  ["effort_compare", "思考模式", "reasoning_effort 低 / 高 / 最高档对比", 2, [], "同一组合计数题以 low 与 max 发送，max 的思考应明显更多。", K.effortGradientCase("low", "max")],
  ["thinking_tool_roundtrip", "思考模式", "思考 + 工具调用的 reasoning_content 回传", 3, [], "思考模式下先推理再调用工具，第 2 轮回传 reasoning_content 与工具结果：应 200 且引用结果。", thinkingToolRoundtrip],
  ["tool_basic", "工具调用", "工具调用基础", 3, [], "非思考 + get_weather 查东京天气：finish_reason=tool_calls、arguments 为合法 JSON 且 city 为 Tokyo；官方 id 为 call_NN_ + 24 位。", K.toolRoundtripCase(dsIdRule)],
  ["tool_result", "工具调用", "工具结果回传", 2, [], "非思考模式拿到 get_weather 调用后，追加 assistant 消息与 role=tool 结果（22°C sunny）：应 200、finish_reason=stop 且回答用到 22。", toolResult],
  ["tool_choice", "工具调用", "tool_choice 规则", 3, [], "非思考模式下 required 与指定函数都应强制调用；思考模式下二者官方 400。", K.toolChoiceRulesCase({ requiredOk: true, namedOk: true, thinkingBlocksNamed: false })],
  ["strict_tools", "工具调用", "strict 模式工具调用（Beta）", 2, [], "Beta 端点 + strict=true：合规 schema 应正常调用，不合规 schema 应被服务端拒绝。", strictTools],
  ["tool_defs", "工具调用", "工具定义校验", 1, [], "省略 parameters 的无参函数应被接受；同名、名字含空格、超长名字官方应拒绝。", toolDefs],
  ["sse_syntax", "流式", "流式语法", 3, [], "非思考流式：data-only SSE、同一个 id 与 created、首块带 role、恰好一个 finish 块、以 [DONE] 结束。", K.sseSyntaxCase],
  ["stream_fingerprint", "流式", "流式 system_fingerprint", 0, ["ref"], "官方每个流式块都带相同的 32 位 hex system_fingerprint。", K.streamFingerprintCase(/^[0-9a-f]{32}$/), { officialWeight: 1 }],
  ["stream_usage", "流式", "流式 usage 块", 2, [], "不论是否设置 include_usage，[DONE] 前的最后一块都应带整次请求的 usage。", K.streamUsageBlockCase],
  ["stream_reasoning", "流式", "流式思考顺序", 2, [], "思考模式流式：reasoning_content 增量全部先于 content；交错或字段名为 reasoning 判失败。", K.streamReasoningOrderCase],
  ["stream_tools", "流式", "流式工具调用", 2, [], "非思考流式 + get_weather：首块带 id / type / name，后续块只带 arguments；后续块重复 id 判中转按块重写。", K.toolStreamCase()],
  ["prefix_completion", "官方特性（Beta / 多协议）", "对话前缀续写（Beta）", 2, [], "Beta 端点下以 prefix:true 的 assistant 前缀结尾：应只返回续写部分（含 def，不重复前缀）。", prefixCompletion],
  ["fim", "官方特性（Beta / 多协议）", "FIM 补全（Beta）", 2, [], "POST /beta/completions {prompt, suffix}：应返回 object=text_completion 的中间部分。", fimCase],
  ["anthropic_format", "官方特性（Beta / 多协议）", "Anthropic 格式（/anthropic/v1/messages）", 2, [], "官方 Anthropic 兼容端点：非流式应返回 message 形态，流式依次为 message_start → content_block_*…", anthropicEndpoint],
  ["responses_api", "官方特性（Beta / 多协议）", "Responses API（/responses）", 2, [], "官方原生支持 Responses API：应返回 object=response、status=completed 且含 message 输出项。", responsesCase],
  ["identity", "身份 / 成分", "自述身份", 2, [], "中英文身份提问：DeepSeek 模型没有 system 时自述 DeepSeek / 深度求索；两条都自称其它厂商判模型被替换。", (c) => identityCase(c, /deepseek|深度求索/i, "DeepSeek")],
  ["hidden_prompt", "身份 / 成分", "隐藏系统提示探测", 2, ["critical"], "要求逐字复述此前收到的所有指令，没有就回 NONE；出现强特征判注入。", hiddenPromptCase],
  ["tokenizer", "身份 / 成分", "分词器指纹", 4, ["critical"], "差分计数探针识别上游分词器，与 DeepSeek 官方词表比对；分词器属于另一家判模型被替换。", tokenizerCase],
  ["vision", "身份 / 成分", "图片输入", 3, ["critical"], "deepseek-flash 原生支持图片，deepseek-v4-pro 不支持；图片放在 system 消息里官方 400。", visionCase],
]);
