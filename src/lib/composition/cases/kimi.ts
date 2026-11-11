import {
  contextLadderCase,
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
import { defineCases, fail, info, ok, skip, strictOr, warn } from "../engine";
import { compatFacts, thinkingOn } from "../facts";
import { type Ctx, errText, is400 } from "../http";
import { chat } from "../protocols";
import type { Outcome } from "../types";
import { dataUrl, needleDoc, redPng } from "../util";

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const F = (c: Ctx) => compatFacts("kimi", c.model);
const ladderMax = (c: Ctx) => (c.state.get("ladderMax") as number) ?? 262_144;
const kimiIdRule = (id: string) =>
  /^functions\.[\w-]+:\d+$/.test(id) ? "vLLM / SGLang 原样透传 id" : /^chatcmpl-tool-/.test(id) ? "vLLM 合成 id" : /^call_/.test(id) ? "OpenAI 风格合成 id" : /^toolu_/.test(id) ? "Anthropic 协议转换 id" : null;

async function signatureCase(c: Ctx): Promise<Outcome> {
  const nonce = crypto.randomUUID();
  const r = await chat(c, K.body(c, "Reply OK."), { headers: { "X-Msh-Request-Nonce": nonce } });
  const ts = r.headers["msh-request-timestamp"];
  const sig = r.headers["msh-request-signature"];
  const d = [`Msh-Request-Id ${r.headers["msh-request-id"] ? "有" : "无"}`, `签名头 ${sig ? sig.slice(0, 20) + "…" : "无"}`];
  if (!ts || !sig) return strictOr(c, fail("响应没有请求签名头（被剥离或未到达 Moonshot）", d));
  const v = await c.send({ path: "/signatures/verify", body: { nonce, timestamp: ts, model: c.model, signature: sig } });
  d.push(`验签：${v.ok ? JSON.stringify(v.json) : errText(v)}`);
  if (v.ok && v.json?.valid === true) return ok("签名验证通过：请求真实到达 Moonshot", d);
  if (v.ok && v.json?.valid === false) return fail("签名不与发送的 model 绑定：model 被改写或签名伪造", d, { flags: ["non_official_backend", "model_swapped"] });
  return strictOr(c, warn("中转未代理验签接口", d));
}

async function cacheOptionsCase(c: Ctx): Promise<Outcome> {
  if (F(c).series !== "k3") return skip("只对写缓存的 K3 系列运行");
  const prefix = needleDoc(2500, c.salt("kco"), []).text;
  const mk = (extra: Json) => chat(c, { model: c.model, messages: [{ role: "system", content: prefix }, { role: "user", content: "Reply OK." }], max_tokens: 2048, reasoning_effort: "low", ...extra });
  const a = await mk({ prompt_cache_options: { mode: "implicit", ttl: "1h" } });
  if (is400(a)) return fail(`官方参数 prompt_cache_options 被拒：${errText(a)}`);
  const write = a.usage?.prompt_tokens_details?.cache_write_tokens ?? 0;
  const h1 = Number(a.headers["msh-usage-cache-write-tokens-1h"] ?? 0);
  const h5 = Number(a.headers["msh-usage-cache-write-tokens-5m"] ?? 0);
  const b = await mk({ prompt_cache_options: { mode: "implicit", ttl: "2h" } });
  const d = [`cache_write_tokens ${write}，1h 头 ${h1}，5m 头 ${h5}`, `ttl=2h：${b.ok ? "200" : errText(b)}`];
  if (!write) return warn("缓存写入计数缺失（缓存计费未透传）", d);
  if (h5 && !h1) return warn("写入记在 5m 档（TTL 被忽略）", d);
  if (b.ok) return c.official ? warn("非法 ttl=2h 被接受", d) : info("非法 ttl 被接受（只记录）", d);
  return ok("缓存选项与官方一致", d);
}

async function usageShapeCase(c: Ctx): Promise<Outcome> {
  const r = await chat(c, { model: c.model, messages: [{ role: "user", content: "Say hi." }], max_tokens: 2048, ...(F(c).series === "k3" ? { reasoning_effort: "low" } : { thinking: { type: "enabled", keep: "all" } }) });
  if (!r.ok) return fail(`请求失败：${errText(r)}`);
  const u = r.usage ?? {};
  const d = [JSON.stringify(u).slice(0, 300)];
  if (["prompt_tokens", "completion_tokens", "total_tokens"].some((k) => typeof u[k] !== "number")) return fail("usage 缺少基本键", d);
  if (u.total_tokens !== u.prompt_tokens + u.completion_tokens) return fail("total ≠ prompt + completion", d, { flags: ["usage_fake"] });
  const rt = u.completion_tokens_details?.reasoning_tokens;
  if (r.reasoning && typeof rt !== "number") return warn("有思考却没有 reasoning_tokens（计费明细被剥离）", d);
  if (!r.reasoning && rt > 0) return warn("没有思考文本却计了 reasoning_tokens", d);
  if (F(c).series === "k3" && !u.prompt_tokens_details && c.official) return warn("K3 缺少 prompt_tokens_details", d);
  if (F(c).series !== "k3" && (u.prompt_tokens_details?.cache_write_tokens ?? 0) > 0) return warn("K2.x 报告了缓存写入（官方 K2.x 不写缓存）", d);
  if (u.prompt_tokens < 3 || u.prompt_tokens > 400) return warn(`极短提示 prompt_tokens=${u.prompt_tokens} 不在合理范围`, d);
  return ok("usage 形态符合官方", d);
}

async function refToolTokensCase(c: Ctx): Promise<Outcome> {
  const tools12 = Array.from({ length: 12 }, (_, i) => ({ ...K.WEATHER, function: { ...K.WEATHER.function, name: `tool_${i}` } }));
  const count = async (tools: Json[] | undefined, ref: boolean) => (await chat(c, { ...K.body(c, "Hello."), max_tokens: 1, ...(tools ? { tools } : {}) }, { ref, audit: false })).usage?.prompt_tokens ?? null;
  const [m0, m1, m12, r0, r1, r12] = await Promise.all([count(undefined, false), count([K.WEATHER], false), count(tools12, false), count(undefined, true), count([K.WEATHER], true), count(tools12, true)]);
  if ([m0, m1, m12, r0, r1, r12].some((v) => v === null)) return skip("计数不全");
  const d1 = (m1! - m0!) - (r1! - r0!);
  const d12 = (m12! - m0!) - (r12! - r0!);
  const d = [`Δ1 被测 ${m1! - m0!} / 官方 ${r1! - r0!}`, `Δ12 被测 ${m12! - m0!} / 官方 ${r12! - r0!}`];
  return Math.abs(d1) > Math.max(5, 0.03 * (r1! - r0!)) || Math.abs(d12) > Math.max(5, 0.03 * (r12! - r0!)) ? warn("工具定义的 token 计数与官方不同（工具被改写或另一套模板）", d) : ok("工具定义计数与官方一致", d);
}

async function overflowContractCase(c: Ctx): Promise<Outcome> {
  const win = F(c).window;
  if (ladderMax(c) < win) return skip("档位上限低于官方窗口，跳过（不花钱）");
  const doc = needleDoc(Math.round(win * 1.05), c.salt("ovf"), [0.03, 0.5, 0.97]);
  const r = await chat(c, { model: c.model, messages: [{ role: "system", content: doc.text }, { role: "user", content: "List the nicknames of telescopes A, B, C." }], max_tokens: 1024, ...K.cheap(c) }, { timeoutMs: 900_000 });
  const d = [r.ok ? `200，prompt_tokens ${r.usage?.prompt_tokens}` : errText(r)];
  if (r.status === 400 && /token length too long|too long/i.test(r.text)) return ok("超窗按官方契约拒收", d);
  const n = Number(r.text.match(/maximum context length is (\d+)/i)?.[1] ?? 0);
  if (n) return n < win ? fail(`后端自报窗口 ${n} 低于官方 ${win}`, d, { flags: ["context_truncated"] }) : c.official ? warn("非官方文案的超窗拒收", d) : ok("拒收行为与官方一致（自部署文案）", d);
  if (r.ok) return (r.usage?.prompt_tokens ?? 0) >= win ? warn("后端窗口比官方更大", d) : fail("超窗请求被静默裁剪后作答", d, { flags: ["context_truncated"] });
  if (r.status === 413) return warn("中转在窗口校验前拒绝了请求体", d);
  return warn("无法判定", d);
}

async function outputClampCase(c: Ctx): Promise<Outcome> {
  const r = await chat(c, { model: c.model, messages: [{ role: "system", content: needleDoc(1000, c.salt("oc"), []).text }, { role: "user", content: "Reply with one word: yes" }], max_tokens: F(c).window, ...K.cheap(c) });
  const d = [r.ok ? `200，finish ${r.finish}，completion ${r.usage?.completion_tokens}` : errText(r)];
  if (r.ok) return r.content ? ok("输出预算被自动下调，与官方一致", d) : warn("200 但 content 为空", d);
  return warn(/maximum context length/i.test(r.text) ? "vLLM 风格拒绝：按文档把 max_tokens 设成窗口的客户端会报错" : "中转自行校验了 max_tokens 上限", d);
}

async function messageShapeCase(c: Ctx): Promise<Outcome> {
  const a = await chat(c, { ...K.body(c, ""), messages: [{ role: "system", content: "Be brief." }, { role: "system", content: "Be polite." }, { role: "user", content: "Reply with exactly: OK" }] });
  const b = await chat(c, { ...K.body(c, ""), messages: [] });
  const d = [`连续 system：${a.ok ? "200" : errText(a)}`, `空 messages：${b.ok ? "200" : errText(b)}`];
  if (!a.ok) return warn("连续 system 被拒（中转做了官方没有的校验）", d);
  if (b.ok) return warn("空 messages 返回 200（中转往请求里塞了内容）", d);
  return ok("消息形态处理与官方一致", d);
}

async function sdkParamsCase(c: Ctx): Promise<Outcome> {
  const a = await chat(c, K.body(c, "Reply OK.", { seed: 42 }));
  const b = await chat(c, K.body(c, "What's the weather in Tokyo?", { tools: [K.WEATHER], parallel_tool_calls: false }, 1024));
  const d = [`seed：${a.ok ? "200" : errText(a)}`, `parallel_tool_calls=false：${b.ok ? `200，${b.toolCalls.length} 个调用` : errText(b)}`];
  return a.ok && b.ok ? ok("OpenAI SDK 常带参数被接受", d) : warn("常见 SDK 参数被拒（中转严格校验未声明字段）", d);
}

async function fixedSamplingCase(c: Ctx): Promise<Outcome> {
  if (!F(c).known) return info("未知模型，只记录");
  const probes: [string, Json][] = [["temperature=0.7", { temperature: 0.7 }], ["top_p=0.5", { top_p: 0.5 }], ["n=2", { n: 2 }], ["presence_penalty=0.5", { presence_penalty: 0.5 }]];
  const res = await Promise.all(probes.map(([, e]) => chat(c, K.body(c, "Say hi.", e))));
  const fixed = await chat(c, K.body(c, "Say hi.", { temperature: 1.0 }));
  const d = [...probes.map(([n], i) => `${n}：${res[i].ok ? "200" : errText(res[i])}`), `temperature=1.0：${fixed.ok ? "200" : errText(fixed)}`];
  const accepted = res.filter((r) => r.ok).length;
  if (accepted === 4) return strictOr(c, fail("越界采样参数全部被接受：非 Moonshot 后端", d, { flags: ["non_official_backend"] }));
  if (accepted) return strictOr(c, fail(`${accepted} 项越界采样参数被接受（vLLM 形态线索）`, d));
  if (!fixed.ok) return strictOr(c, fail("固定值 temperature=1.0 被拒", d));
  return ok("固定采样参数校验与官方一致", d);
}

async function thinkingRulesCase(c: Ctx): Promise<Outcome> {
  const f = F(c);
  const q = "What is 17 * 23? Reply with the number only.";
  const d: string[] = [];
  if (!f.known) return info("未知模型，只记录");
  if (f.series === "k3") {
    const dis = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, reasoning_effort: "low", thinking: { type: "disabled" } });
    const med = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, reasoning_effort: "medium" });
    const max = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 4096, reasoning_effort: "max" });
    d.push(`thinking=disabled：${dis.ok ? `200，${dis.reasoning ? "仍在思考" : "不思考"}` : errText(dis)}`, `effort=medium：${med.ok ? "200" : errText(med)}`, `effort=max：${max.ok ? "200" : errText(max)}`);
    if (med.ok) return fail("非法档位 medium 被接受", d);
    if (!max.ok) return fail("默认档 max 被拒", d);
    if (dis.ok && dis.reasoning) return warn("thinking 字段被忽略", d);
    return ok("K3 思考参数规则与官方一致", d);
  }
  if (f.series === "k2.7") {
    const dis = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, thinking: { type: "disabled" } });
    d.push(`thinking=disabled：${dis.ok ? `200，${dis.reasoning ? "仍在思考" : "不思考"}` : errText(dis)}`);
    if (dis.ok && !dis.reasoning) return fail("不可关闭思考的型号关掉了思考", d, { flags: ["model_swapped"] });
    if (dis.ok) return warn("disabled 被接受但仍在思考", d);
    return ok("K2.7 拒绝关闭思考", d);
  }
  const dis = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, thinking: { type: "disabled" } });
  const en = await chat(c, { model: c.model, messages: [{ role: "user", content: q }], max_tokens: 2048, thinking: { type: "enabled", keep: "all" } });
  d.push(`disabled：${dis.ok ? `${dis.reasoning ? "仍在思考" : "不思考"}` : errText(dis)}`, `enabled：${en.ok ? `${en.reasoning ? "思考" : "不思考"}` : errText(en)}`);
  if (!dis.ok || !en.ok) return fail("K2.6 的官方思考写法被拒", d);
  if (dis.reasoning) return warn("禁用思考无效", d);
  if (!en.reasoning) return fail("开启思考后没有思考内容", d);
  return ok("K2.6 思考开关与官方一致", d);
}

async function k26DisableCase(c: Ctx): Promise<Outcome> {
  if (F(c).thinking !== "optional") return skip("只对可关闭思考的型号运行");
  const n = c.nonce.slice(-6);
  const r = await chat(c, { model: c.model, messages: [{ role: "user", content: `Reply with exactly: OK-${n}` }], max_tokens: 2048, thinking: { type: "disabled" } });
  if (!r.ok) return fail(`官方接受该字段却被拒：${errText(r)}`);
  const rt = r.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
  const d = [`reasoning ${r.reasoning.length} 字符，reasoning_tokens ${rt}`];
  if (r.reasoning && rt > 2) return fail("禁用思考无效（vLLM 未映射 thinking 字段）", d, { flags: ["non_official_backend"] });
  if (r.reasoning || rt > 2) return warn("思考文本与计数只出现其一", d);
  if (!r.content) return fail("content 为空", d);
  return r.content.includes(n) ? ok("思考已关闭", d) : warn("content 不含 nonce", d);
}

async function keepRulesCase(c: Ctx): Promise<Outcome> {
  const f = F(c);
  if (f.series === "k3" || !f.known) return skip("K3 系列没有 thinking 字段");
  const legal = await chat(c, { model: c.model, messages: [{ role: "user", content: "Say hi." }], max_tokens: 2048, thinking: f.series === "k2.7" ? { type: "enabled" } : { type: "enabled", keep: "all" } });
  const bogus = await chat(c, { model: c.model, messages: [{ role: "user", content: "Say hi." }], max_tokens: 2048, thinking: { type: "enabled", keep: "none" } });
  const d = [`合法写法：${legal.ok ? "200" : errText(legal)}`, `keep=none：${bogus.ok ? "200" : errText(bogus)}`];
  if (!legal.ok) return fail("官方文档写法被拒", d);
  if (bogus.ok) return strictOr(c, warn("非法 keep 被接受（没有网关参数校验）", d));
  return ok("keep 取值校验与官方一致", d);
}

async function partialCase(c: Ctx): Promise<Outcome> {
  const r = await chat(c, { model: c.model, messages: [{ role: "user", content: "Complete the sentence." }, { role: "assistant", content: "The capital of France is", partial: true }], max_tokens: 64, ...K.cheap(c) });
  if (!r.ok) return strictOr(c, warn(`partial 字段被拒：${errText(r)}`));
  const d = [r.content.slice(0, 80)];
  if (/capital of france is/i.test(r.content)) return strictOr(c, warn("重复了前缀（partial 被忽略）", d));
  return /paris/i.test(r.content) ? ok("按前缀续写", d) : strictOr(c, warn("续写内容不符", d));
}

async function undefinedFieldsCase(c: Ctx): Promise<Outcome> {
  const probes: [string, Json][] = [["seed", { seed: 7 }], ["user", { user: "kimicheck" }], ["logit_bias", { logit_bias: { "1": 1 } }], ["functions", { functions: [K.WEATHER.function] }]];
  const res = await Promise.all(probes.map(([, e]) => chat(c, K.body(c, "Say hi.", e))));
  return info("未定义字段处理已记录", probes.map(([n], i) => `${n}：${res[i].ok ? "200" : errText(res[i])}`));
}

async function dynamicToolsCase(c: Ctx): Promise<Outcome> {
  const calc = { type: "function", function: { name: "calculate", description: "Evaluate an arithmetic expression.", parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] } } };
  const a = await chat(c, { model: c.model, messages: [{ role: "user", content: "Compute 23 * 47. You must call calculate." }, { role: "system", tools: [calc] }], max_tokens: 2048, ...K.cheap(c) });
  const d = [`只带 tools 的 system：${a.ok ? `200，调用 ${a.toolCalls.map((t) => t.name).join(",") || "无"}` : errText(a)}`];
  if (F(c).series !== "k3") return a.ok && c.official ? warn("非 K3 型号接受了动态工具", d) : ok("非 K3 型号拒绝动态工具，与官方一致", d);
  if (!a.ok) return fail(/empty/i.test(a.text) ? "中转按「system 必须有 content」校验，挡掉了官方能力" : "动态工具加载被拒", d);
  if (!a.toolCalls.some((t) => t.name === "calculate")) return warn("没有调用 calculate（只带 tools 的 system 可能被丢弃）", d);
  const b = await chat(c, { model: c.model, messages: [{ role: "user", content: "Hi" }, { role: "system", content: "x", tools: [calc] }], max_tokens: 2048, ...K.cheap(c) });
  d.push(`同时带 content：${b.ok ? "200" : errText(b)}`);
  return b.ok ? strictOr(c, warn("content 与 tools 同时出现被接受", d)) : ok("动态工具加载与官方一致", d);
}

async function toolResultCase(c: Ctx): Promise<Outcome> {
  const t1 = await chat(c, { model: c.model, messages: [{ role: "user", content: "What's the weather in Tokyo? Call get_weather." }], tools: [K.WEATHER], max_tokens: 4096, ...thinkingOn("kimi", c.model), ...(F(c).series === "k3" ? { reasoning_effort: "low" } : {}) });
  const call = t1.toolCalls[0];
  if (!t1.ok || !call) return skip("没有拿到工具调用");
  const nn = 10 + (c.nonce.charCodeAt(1) % 80);
  const t2 = await chat(c, { model: c.model, messages: [{ role: "user", content: "What's the weather in Tokyo?" }, structuredClone(t1.choices[0].message), { role: "tool", tool_call_id: call.id, content: JSON.stringify({ city: "Tokyo", temperature_c: nn, condition: "cloudy" }) }], tools: [K.WEATHER], max_tokens: 4096, ...(F(c).series === "k3" ? { reasoning_effort: "low" } : thinkingOn("kimi", c.model)) });
  if (!t2.ok) return fail(/signature/i.test(t2.text) ? "回传被拒且提到 signature：Anthropic 协议转换层" : /tool_call/i.test(t2.text) ? "渠道不认自己返回的 tool_call id" : "思考回传被拒", [errText(t2)], /signature/i.test(t2.text) ? { flags: ["protocol_shim"] } : undefined);
  return t2.content.includes(String(nn)) ? ok("工具结果回传正常") : fail("回答没有引用工具结果", [t2.content.slice(0, 120)]);
}

async function imageCase(c: Ctx): Promise<Outcome> {
  const r = await chat(c, K.body(c, "", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: dataUrl(redPng(8)) } }, { type: "text", text: "What colour is this image? One word." }] }] }, 2048));
  const pub = await chat(c, K.body(c, "", { messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: "https://example.com/kimicheck.png" } }, { type: "text", text: "Describe this image." }] }] }, 2048));
  const d = [r.ok ? r.content.slice(0, 40) : errText(r), `公网 URL：${pub.ok ? "200" : errText(pub)}`];
  if (!r.ok) return warn("图片部件被拒（名字背后可能是纯文本模型）", d);
  if (!/red|红/i.test(r.content)) return warn("没有答出红色", d);
  if (pub.ok && c.official) return warn("公网 URL 被接受（vLLM 迹象）", d);
  return ok("图片输入正常", d);
}

async function effortCompare(c: Ctx): Promise<Outcome> {
  if (F(c).series !== "k3") return skip("只对 K3 系列运行");
  return K.effortGradientCase("low", "high")(c);
}

export const KIMI_CASES = defineCases("kimi", [
  ["basic", "连通性 / 端点画像", "基础对话", 2, ["pre"], "最省 token 的请求要求回复 OK-<nonce>（K3 effort=low、K2.6 关思考），校验 200、role、content 含 nonce、带 usage。失败则其余用例全部跳过。", K.basicCase],
  ["backend", "连通性 / 端点画像", "后端判定", 0, ["ref", "pre"], "按 id 形态（官方 chatcmpl- + 24 位 hex，前 8 位是时间戳）、system_fingerprint 与响应头判断后端。不计分。", K.backendCase, { officialWeight: 0 }],
  ["endpoint", "连通性 / 端点画像", "端点画像（国际站 / 国内站 / 中转）", 0, ["ref", "pre"], "按 base_url 判定国际站、国内站、Kimi Code 订阅端点或中转。不发请求。", K.endpointProfileCase([[/api\.moonshot\.ai/, "Moonshot 国际站"], [/api\.moonshot\.cn/, "Moonshot 国内站"], [/api\.kimi\.com\/coding/, "Kimi Code 订阅端点"]]), { officialWeight: 0 }],
  ["model_echo", "连通性 / 端点画像", "模型名回显", 2, [], "model 字段应回显请求的 Kimi 型号（去掉厂商前缀与路由后缀后比较）。非 Kimi 名字或更低代际判模型被替换；同系列同代的另一 id 给警告。", K.modelEchoCase(/kimi|moonshot/i, /highspeed|k3\.1|k2\.7-code/i)],
  ["id_shape", "连通性 / 端点画像", "ID 形态", 0, ["ref"], "官方 id 为 chatcmpl- + 24 位小写 hex，前 8 位是接近 created 的时间戳；非流式响应不带 system_fingerprint。", K.idShapeCase, { officialWeight: 2 }],
  ["models", "连通性 / 端点画像", "/models 列表", 0, ["ref"], "GET /models：官方只列 Kimi 模型并带 context_length 等字段；出现其它厂商模型是面板汇总列表。", K.modelsListCase(/kimi|moonshot/i, "moonshot"), { officialWeight: 0 }],
  ["signature", "连通性 / 端点画像", "请求签名（X-Msh-Request-Nonce）", 0, ["ref"], "请求带 X-Msh-Request-Nonce 时，Moonshot 网关在响应头返回时间戳与签名，可经 /signatures/verify 验证；验签失败说明 model 被改写或签名伪造。", signatureCase, { officialWeight: 3 }],
  ["headers", "连通性 / 端点画像", "响应头指纹", 0, ["ref"], "记录响应头并标注 msh-* 官方网关头、uvicorn、Cloudflare、OpenRouter 与中转层头。", K.headersCase(/^msh-/), { officialWeight: 0 }],
  ["balance", "连通性 / 端点画像", "/users/me/balance", 0, ["ref"], "官方返回余额对象，或在 key 未开放时返回 403；404 / HTML 等说明中转未代理该接口。数值不展示。", K.balanceCase("/users/me/balance"), { officialWeight: 0 }],
  ["error_contract", "连通性 / 端点画像", "错误契约", 0, ["ref"], "未知模型、畸形 JSON、错误 key 三种非法请求：错误体应为 {error:{type,message}}；vLLM / Anthropic / 中转形态各记线索。", K.errorContractCase, { officialWeight: 2 }],
  ["cache_options", "usage 计费完整性", "缓存选项（prompt_cache_options / 显式断点）", 1, [], "K3 系列：带 ttl=1h 的缓存选项应写入 1h 档并报告 cache_write_tokens；非法 ttl=2h 应 400。", cacheOptionsCase],
  ["usage_shape", "usage 计费完整性", "usage 字段形态", 2, [], "极短提示打开思考，只看 usage 形态：三键齐全、total 算术成立、有思考时有 reasoning_tokens、K2.x 不应报告缓存写入。", usageShapeCase],
  ["output_count", "usage 计费完整性", "输出 token 计数（0 输出客诉）", 3, ["critical"], "写约 80 词的散文：completion_tokens 应 ≥ 1、≥ 0.4× 可见文本估算、≤ 4×（可见 + 思考）+ 64；0 或远超都判 usage 造假。", K.outputCountCase],
  ["cache_semantics", "usage 计费完整性", "缓存命中计数语义", 3, ["critical"], "本次运行独有的约 2.5K token 前缀发三次：cached ≤ prompt、cached + cache_write ≤ prompt；从未见过的前缀报告大额命中判伪造缓存折扣。", K.cachedTokensCase],
  ["max_tokens_trunc", "usage 计费完整性", "max_tokens 截断与计数", 2, [], "要求数到 200 但 max_tokens=24：应 finish_reason=length 且 completion_tokens 在 1..26（思考模型可多几个模板 token）。", K.maxTokensTruncCase(24)],
  ["estimate_endpoint", "usage 计费完整性", "估算分词接口", 0, ["ref"], "/tokenizers/estimate-token-count 取官方计数，与同一组消息的 prompt_tokens 比较：|Δ| ≤ max(16, 8%) 通过。", K.tokenizerEndpointCase("/tokenizers/estimate-token-count", (j) => j?.data?.total_tokens, (c, m) => ({ model: c.model, messages: m }), (n) => Math.max(16, n * 0.08)), { officialWeight: 1 }],
  ["usage_invariants", "usage 计费完整性", "usage 一致性审计（收尾）", 3, ["critical", "final"], "汇总本次运行每个 200 响应的 usage：三键齐全、total 算术、cached + cache_write ≤ prompt、reasoning ≤ completion、有输出则 completion ≥ 1。硬违规判 usage 造假。", K.usageInvariantsCase],
  ["ref_tool_tokens", "与官方对照（精度 / 性能）", "对照官方：工具定义的 token 计数", 1, [], "不带工具、带 1 个与 12 个工具分别发给被测与官方，用差值比较工具定义占用的 token：偏离说明工具被改写或模板不同。需要对照端点。", refToolTokensCase, { needsRef: true }],
  ["precision_suite", "与官方对照（精度 / 性能）", "精度题组（机械任务）", 3, [], "6 道本地判分的机械题按默认思考发送（Kimi 固定采样，没有贪心探针）：S ≥ 0.90 且算术链全对为一致，失分产出弱 / 强精度证据。", (c) => precisionSuiteCase(c, { s: 0.9, failBelow: 0.6 })],
  ["multi_needle", "与官方对照（精度 / 性能）", "64K 多针召回", 3, [], "约 64K 填充文本中埋 12 根同形式的针与干扰项：命中 ≥ 11 为一致，9–10 弱证据，≤ 8 强证据；64K 被拒说明上下文被截断。", (c) => multiNeedleCase(c, Math.min(64_000, ladderMax(c)))],
  ["kv_diff", "与官方对照（精度 / 性能）", "KV 缓存差分复制", 2, [], "300 字符随机串在短档与约 48K 长档分别复制：官方长档应 0 错，错误率越高精度证据越强。", (c) => kvDiffCase(c, Math.min(48_000, Math.floor(F(c).window / 3), ladderMax(c)))],
  ["throughput_floor", "与官方对照（精度 / 性能）", "吞吐与首字延迟下限", 2, ["critical"], "三次流式数数探针：中位吞吐低于官方速度的 0.35×（highspeed 0.25×）且三次都低判性能过低；首字中位 > 15 s 警告。", (c) => refThroughputCase(c, F(c).officialSpeed * (/highspeed/.test(c.model) ? 0.25 : 0.35))],
  ["ref_tokenizer", "与官方对照（精度 / 性能）", "对照官方：分词一致", 3, ["critical"], "固定文本分别发给被测与官方逐段比较 prompt_tokens：Kimi 全系共用同一词表，同一模型应逐段相等或只差恒定模板偏移。需要对照端点。", refTokenizerCase, { needsRef: true }],
  ["ref_throughput", "与官方对照（精度 / 性能）", "对照官方：吞吐 / 首字延迟", 2, ["critical"], "与吞吐下限相同的探针，被测与官方交错各发 3 次，逐对比值中位 < 0.4 且首字不更快判性能过低。需要对照端点。", (c) => refThroughputCase(c, F(c).officialSpeed * 0.35), { needsRef: true }],
  ["ref_thinking", "与官方对照（精度 / 性能）", "对照官方：思考画像", 1, [], "同一组合计数题并发发给被测与官方，被测答错而官方答对给弱精度证据。需要对照端点。", (c) => thinkingProfileCase(c, thinkingOn("kimi", c.model)), { needsRef: true }],
  ["second_model", "与官方对照（精度 / 性能）", "跨模型相似度（second_model）", 1, [], "5 个事实短问分别发给本次模型与第二模型：Kimi 固定 temperature 1.0 采样，≥ 4/5 题几乎相同说明两个名字指向同一后端。", secondModelCase, { needsSecond: true }],
  ["precision_verdict", "与官方对照（精度 / 性能）", "精度综合判定（收尾）", 2, ["critical", "final"], "汇总各精度用例：强证据 2 分、弱证据 1 分，合计 ≥ 4 才判疑似低精度。", precisionVerdictCase],
  ["context_ladder", "上下文窗口", "上下文阶梯", 4, ["critical"], "8K / 32K / 64K / 120K / 200K 及官方窗口 90% 边缘档逐档送入（填充放在 system），三针全中且 prompt_tokens ≥ 0.6×档位才通过。官方窗口以内被拒或丢针判上下文被截断。", (c) => contextLadderCase(c, { tiers: [8000, 32000, 64000, 120000, 200000, Math.floor((0.9 * F(c).window) / 1000) * 1000], window: F(c).window, ladderMax: ladderMax(c), systemFiller: true })],
  ["overflow_contract", "上下文窗口", "超窗错误契约", 2, ["optional"], "送入约 1.05×官方窗口的文本：官方 400「Input token length too long」；200 说明静默裁剪。只在档位上限 ≥ 官方窗口时运行，默认不勾选。", overflowContractCase],
  ["output_clamp", "上下文窗口", "输出预算裁剪", 1, [], "max_tokens 设为整个官方窗口：官方会自动下调输出预算并 200；vLLM 风格 400 说明行为不等价。", outputClampCase],
  ["message_shape", "参数校验 / 协议保真", "消息形态（连续 system / 空 messages）", 1, [], "连续两条 system 官方接受；空 messages 官方 400。", messageShapeCase],
  ["sdk_params", "参数校验 / 协议保真", "OpenAI SDK 常带参数（seed / parallel_tool_calls）", 1, [], "seed 与 parallel_tool_calls=false 官方都接受；被 400 说明中转对未声明字段做了严格校验。", sdkParamsCase],
  ["fixed_sampling", "参数校验 / 协议保真", "固定采样参数校验", 0, ["ref"], "官方固定 temperature 1.0、top_p 0.95、n 1、penalty 0：传其它值应 400，显式传固定值应 200。越界值被接受是 vLLM 形态线索。", fixedSamplingCase, { officialWeight: 3 }],
  ["thinking_rules", "参数校验 / 协议保真", "thinking / reasoning_effort 参数规则", 3, ["critical"], "按代际探测：K3 的 effort 枚举为 low / high / max；K2.7 不可关闭思考；K2.6 可用 thinking 字段开关。能否关掉思考取决于模型本身，两种模式都计分。", thinkingRulesCase],
  ["json_mode", "参数校验 / 协议保真", "JSON 模式 / json_schema", 2, [], "json_object 输出须可解析；官方支持 strict json_schema，输出须符合 schema；非法 schema 官方 400。", K.jsonModeCase("support")],
  ["stop", "参数校验 / 协议保真", "stop 词", 1, [], "stop=[\"five\"] 用英文从 one 数到 seven：应在 five 处截断且不含 five 之后的词；6 个 stop 词（官方上限 5）应被拒。", K.stopCase("words")],
  ["partial", "参数校验 / 协议保真", "Partial 续写", 0, ["ref"], "以 partial:true 的 assistant 前缀结尾：官方只返回续写部分（提到 Paris），重复前缀说明 partial 被忽略。", partialCase, { officialWeight: 1 }],
  ["undefined_fields", "参数校验 / 协议保真", "未定义字段处理（参考）", 0, ["ref", "optional"], "seed、user、logit_bias、旧版 functions 各发一次，只记录状态。默认不勾选。", undefinedFieldsCase, { officialWeight: 0 }],
  ["reasoning_present", "思考模式", "思考内容存在与计数", 3, ["critical"], "默认思考强度的组合计数题：思考应在 reasoning_content 返回且 reasoning_tokens 与思考长度相称；完全没有思考痕迹判模型被替换。", K.reasoningPresentCase],
  ["effort_compare", "思考模式", "reasoning_effort 低 / 高档对比", 2, [], "K3 系列同一题以 low 与 high 发送，高档思考应明显更长；两档无差别说明 effort 被忽略。", effortCompare],
  ["k26_disable", "思考模式", "K2.6 关闭思考", 2, [], "thinking=disabled 要求回复 OK-<nonce>：应无 reasoning_content、reasoning_tokens ≤ 2，content 含 nonce。", k26DisableCase],
  ["thinking_roundtrip", "思考模式", "思考内容回传", 2, [], "第 1 轮拿到带 reasoning_content 的 assistant 消息，第 2 轮原样回传：官方应 200；报错提到 signature 说明是 Anthropic 协议转换层。", K.thinkingRoundtripCase],
  ["keep_rules", "思考模式", "thinking.keep 取值规则", 0, ["ref"], "K2.x 的 keep 枚举：合法写法应 200，keep=none 应 400；非法值被接受说明没有网关参数校验。", keepRulesCase, { officialWeight: 1 }],
  ["dynamic_tools", "工具调用", "动态加载工具（system 消息只带 tools）", 2, [], "messages 里插入只带 tools 的 system 消息：K3 系列应 200 并调用该工具；同一条消息同时带 content 官方 400。", dynamicToolsCase],
  ["tool_basic", "工具调用", "工具调用基础", 3, [], "带 get_weather 工具查东京天气：finish_reason=tool_calls、arguments 含 city；官方模式下按 tool_call id 形态判后端。", K.toolRoundtripCase(kimiIdRule)],
  ["tool_result", "工具调用", "工具结果回传", 2, [], "原样回传 assistant 消息（含思考与 tool_calls）并附带 nonce 派生温度的工具结果，回答须引用该温度。", toolResultCase],
  ["tool_choice_rules", "工具调用", "tool_choice 规则", 2, [], "required 仅 K3 支持；思考开启时指定工具官方 400；指定未声明的工具官方 400。", (c) => K.toolChoiceRulesCase({ requiredOk: F(c).series === "k3", namedOk: false, thinkingBlocksNamed: true })(c)],
  ["tool_choice_none", "工具调用", "tool_choice=none", 1, [], "明确要求调用工具但 tool_choice=none：应没有 tool_calls 且 content 非空。", K.toolChoiceNoneCase],
  ["tool_schema", "工具调用", "工具定义校验", 0, ["ref"], "同名工具、非法函数名：官方 400；被接受说明后端没有做工具定义校验。", K.toolSchemaCase(128), { officialWeight: 1 }],
  ["sse_syntax", "流式", "流式语法", 3, [], "流式数 1 到 15：data 块为 chat.completion.chunk、id / created 一致、首块 delta 为 {role:assistant, content:\"\"}、没有 event: 行、恰好一个 finish 块、以 [DONE] 结束。", K.sseSyntaxCase],
  ["stream_fingerprint", "流式", "流式 system_fingerprint", 0, ["ref"], "官方每个流式块都带相同的 fpv0_ + 8 位 hex 指纹；缺失、为 null 或其它形态各记线索。", K.streamFingerprintCase(/^fpv0_[0-9a-f]{8}$/), { officialWeight: 2 }],
  ["stream_usage", "流式", "流式 usage 块", 2, [], "默认流的 usage 应在 finish 块；开启 include_usage 时应有 choices 为空的独立末块；两次相同请求的 prompt_tokens 应一致。", K.streamUsageBlockCase],
  ["stream_reasoning", "流式", "流式思考顺序", 2, [], "流式组合计数题：思考以 reasoning_content 增量输出且全部先于正文；正文出现 <think> 判失败。", K.streamReasoningOrderCase],
  ["stream_tools", "流式", "流式工具调用", 2, [], "流式查东京天气：工具调用拆成共享 index 的增量，首片带 id / name，重组后 arguments 为合法 JSON。", K.toolStreamCase()],
  ["video", "身份 / 成分", "视频输入（base64 MP4）", 1, [], "官方在役型号接受 video_url 部件。本项目无法在服务端生成 H.264 视频，跳过。", async () => skip("无法在服务端生成 H.264 视频，跳过")],
  ["identity", "身份 / 成分", "自述身份", 2, [], "中英文身份提问：没有 system 时只泛称「AI 助手」属官方行为；两条都自称其它厂商判模型被替换。", (c) => identityCase(c, /kimi|moonshot|月之暗面/i, "Kimi")],
  ["hidden_prompt", "身份 / 成分", "隐藏系统提示探测", 2, ["critical"], "要求逐字复述此前收到的所有 system / developer 指令，没有就回 NONE。出现 Claude Code / new-api 等强特征判注入。", hiddenPromptCase],
  ["tokenizer", "身份 / 成分", "分词器指纹", 3, ["critical"], "差分计数探针识别上游分词器，与 Kimi 官方词表比对；分词器属于另一家判模型被替换。", tokenizerCase],
  ["image", "身份 / 成分", "图片输入", 1, [], "8×8 纯红 PNG 问颜色应答红；再发公网图片 URL，官方 400，被接受在官方模式记 vLLM 迹象。", imageCase],
]);
