import {
  consistencyCase,
  contextLadderCase,
  greedyDivergenceCase,
  identityCase,
  kvDiffCase,
  multiNeedleCase,
  precisionSuiteCase,
  precisionVerdictCase,
  realStreamCase,
  refThroughputCase,
  refTokenizerCase,
  secondModelCase,
  systemCase,
  thinkingProfileCase,
  tokenizerCase,
  ttftCase,
  unicodeCase,
} from "../common";
import * as K from "../compat";
import { defineCases } from "../engine";
import { compatFacts } from "../facts";
import type { Ctx } from "../http";
import { chat } from "../protocols";

const F = (c: Ctx) => compatFacts("glm", c.model);
const ladderMax = (c: Ctx) => (c.state.get("ladderMax") as number) ?? 262_144;
const glmIdRule = (id: string) => (/^chatcmpl-tool-/.test(id) ? "vLLM 合成 id" : /^toolu_/.test(id) ? "Anthropic 协议转换 id" : /^call_[A-Za-z0-9]{24}$/.test(id) ? "OpenAI 风格 id" : null);

export const GLM_CASES = defineCases("glm", [
  ["basic", "连通性 / 端点画像", "基础对话", 2, ["pre"], "最简 chat/completions 请求要求回复 OK-<nonce>，校验 200、role=assistant、content 含 nonce、finish_reason=stop、带 usage。鉴权或 404 失败则其余用例全部跳过。", K.basicCase],
  ["backend", "连通性 / 端点画像", "后端判定", 0, ["ref", "pre"], "按响应 id 形态（z.ai 为 14 位时间戳 + 16 位随机）、request_id 与 Server / cf-ray 等响应头判断后端；结果供其它用例参考。不计分。", K.backendCase, { officialWeight: 0 }],
  ["endpoint", "连通性 / 端点画像", "端点画像（标准 / Coding / bigmodel）", 0, ["ref", "pre"], "按 base_url 判定标准 API、Coding Plan 或 open.bigmodel.cn；中转地址记录主机名。结果决定 effort 枚举等预期。", K.endpointProfileCase([[/api\.z\.ai\/api\/coding/, "z.ai Coding Plan"], [/api\.z\.ai/, "z.ai 标准 API"], [/bigmodel\.cn/, "open.bigmodel.cn"]]), { officialWeight: 0, protocols: [] }],
  ["model_echo", "连通性 / 端点画像", "模型名回显", 2, [], "model 字段应回显请求的 GLM 型号。回显非 GLM 名字或更低代际的官方名判模型被替换；同代际的另一型号给警告；其它自定义名在等价模式只记录。", K.modelEchoCase(/glm/i, /glm-\d+(\.\d+)?-(flash|air|x)/i)],
  ["id_shape", "连通性 / 端点画像", "ID / request_id 形态", 0, ["ref"], "z.ai 响应 id 为 14 位时间戳 + 16 位随机，并原样回显请求里的 request_id。chatcmpl- / UUID / msg_ 为非 z.ai 形态。", K.idShapeCase, { officialWeight: 2 }],
  ["models", "连通性 / 端点画像", "/models 与面板指纹（参考）", 0, ["ref"], "GET /models：列表里出现非 GLM 模型说明是面板汇总列表，记为中转痕迹；vLLM 风格列表在等价模式只记录。", K.modelsListCase(/glm/i), { officialWeight: 0, protocols: [] }],
  ["usage_invariants", "usage 计费完整性", "usage 不变量（全局）", 3, ["critical", "final"], "汇总本次运行每个 200 响应的 usage：四个键齐全、total = prompt + completion、0 ≤ cached ≤ prompt、有内容时 completion ≥ 1。算术不成立判 usage 造假；只缺键按模式记警告或只记录。", K.usageInvariantsCase, { protocols: [] }],
  ["zero_output", "usage 计费完整性", "非流式 0 输出 token", 3, [], "三条提示分别要求约 1 / 50 / 300 词的回答。completion_tokens 不应为 0、不应低于可见文本估算的一半，扣掉思考后应随长度递增；三档完全相同为常数填充。", K.zeroOutputNonStreamCase],
  ["zero_output_stream", "usage 计费完整性", "流式 0 输出 token / 末块 usage", 3, [], "同样三条提示以流式发送：应恰有带 usage 的末块、completion_tokens > 0、以 [DONE] 结束。等价模式下默认流缺 usage 时补发 include_usage，补发后正常只记录。", K.zeroOutputStreamCase],
  ["cached_tokens", "usage 计费完整性", "cached_tokens 语义（首发 0、复发 >0、≤ prompt）", 3, [], "用本用例独有的约 3K token 前缀发三次：首发不应大额命中，完全相同的复发应命中，cached 不得超过 prompt；首发就大额命中且三次恒等为常数填充。", K.cachedTokensCase],
  ["completion_vs_thinking", "usage 计费完整性", "completion_tokens 与可见 / 思考文本一致", 2, [], "较长推理题：completion_tokens 应不低于（思考 + 可见文本）估算的一半；思考存在却计数不足一半为少报，思考缺失却计数远超可见文本为剥离思考。", K.outputCountCase],
  ["tokenizer_endpoint", "usage 计费完整性", "/tokenizer 计数 vs prompt_tokens", 0, ["ref"], "POST /tokenizer 取官方分词计数，与同一组消息的 prompt_tokens 比较：差值 ≤ 16 为模板开销；多出 60 以上判注入系统提示。接口不存在则跳过。", K.tokenizerEndpointCase("/tokenizer", (j) => j?.usage?.prompt_tokens ?? j?.data?.total_tokens, (c, m) => ({ model: c.model, messages: m }), () => 16), { officialWeight: 2 }],
  ["max_tokens_usage", "usage 计费完整性", "max_tokens 截断时的 usage", 2, [], "要求写 300 词短文但 max_tokens=16：官方 finish_reason=length 且 completion_tokens 在 1..17。为 0 或超过 17 判 usage 造假；思考吃掉预算时会单独标注。", K.maxTokensTruncCase(16)],
  ["prompt_delta", "usage 计费完整性", "prompt_tokens 注入差值", 2, [], "最短的 \"Say hi.\" 官方 prompt_tokens 约 10–40；40–120 警告可能注入了系统提示，>120 判注入。再带一个工具定义重发，只记录差值。", K.promptDeltaCase([10, 40])],
  ["precision_suite", "与官方对照（精度 / 性能）", "精度题组（复制 / 排序 / 召回 / 变换 / 算术链）", 3, [], "6 道本地判分的机械题（随机串复制、排序、报告字段召回、逐项加 7、两条算术链），由本次运行的 nonce 播种。有对照时按 ΔS 判定，无对照按代际绝对线判定，产出精度证据。", (c) => precisionSuiteCase(c, F(c).series === "glm5" ? { s: 0.85, a: 0.97, b: 0.9, failBelow: 0.6 } : { s: 0.75, failBelow: 0.5 })],
  ["multi_needle", "与官方对照（精度 / 性能）", "长上下文多针召回（12 针 + 2 密钥）", 2, [], "在长填充文本中均匀埋入 12 根同形式的针及干扰项，再加两把 48 字符密钥，要求按序列出并逐字复制。按命中数与密钥字符错误率产出精度证据。", (c) => multiNeedleCase(c, Math.min(F(c).window >= 200_000 ? 64_000 : 32_000, ladderMax(c)))],
  ["kv_diff", "与官方对照（精度 / 性能）", "KV 缓存差分复制（短 / 长上下文）", 2, [], "同一个 300 字符随机串分别在无填充与长填充前复制，看字符错误率的差值：差值随上下文放大是 KV 缓存量化的特征。", (c) => kvDiffCase(c, Math.min(48_000, Math.floor(F(c).window / 3), ladderMax(c)))],
  ["ref_greedy", "与官方对照（精度 / 性能）", "贪心解码分歧点（对照官方）", 3, [], "四个中熵提示以贪心解码交错发给官方与被测，比较逐字符最长公共前缀相对官方自基线的比值；重量化权重会更早分歧。需要对照端点。", (c) => greedyDivergenceCase(c, { do_sample: false, temperature: 0, ...(F(c).efforts.includes("high") ? { reasoning_effort: "high" } : {}) }), { needsRef: true }],
  ["ref_tokenizer", "与官方对照（精度 / 性能）", "分词计数比对（对照官方）", 3, ["critical"], "固定文本分别发给被测与官方，逐段比较 prompt_tokens：恒定偏移是模板差异，个别段偏离说明词表不同（换模），整体多出 60 以上说明注入。需要对照端点。", refTokenizerCase, { needsRef: true }],
  ["ref_throughput", "与官方对照（精度 / 性能）", "解码吞吐 / 首字延迟（对照官方）", 2, ["critical", "final"], "收尾独占运行：被测与官方交错发流式数数请求，按逐对比值判定；无对照或对照失败时按绝对阈值判定。", (c) => refThroughputCase(c, /flashx/.test(c.model) ? 50 : 10)],
  ["thinking_profile", "与官方对照（精度 / 性能）", "思考画像：正确性 / 绕圈 / 耗尽", 1, [], "组合计数题与 15 步算术链：核对答案、思考的 8-gram 重复率与是否耗尽预算；有对照时与官方比较，产出精度证据。", (c) => thinkingProfileCase(c, {})],
  ["precision_verdict", "与官方对照（精度 / 性能）", "精度综合判定（收尾）", 2, ["critical", "final"], "汇总各精度用例：强证据 2 分、弱证据 1 分，合计 ≥ 4 才判疑似低精度；单个精度用例不会单独下结论。", precisionVerdictCase, { protocols: [] }],
  ["context_ladder", "上下文窗口", "上下文阶梯三针检索（8K→270K）", 3, ["critical"], "逐档送入填充文本并在 3% / 50% / 97% 埋三根互不相关的针，要求按序答出；三针全中且 prompt_tokens ≥ 0.6×档位才算通过，遇到第一个失败档即停。官方窗口以内失败判上下文被截断。", (c) => contextLadderCase(c, { tiers: [8000, 32000, 64000, 128000, 200000, 230000, 270000], window: F(c).window, ladderMax: ladderMax(c) })],
  ["max_tokens_contract", "上下文窗口", "max_tokens 上限契约", 2, [], "max_tokens=131072 应被接受；131073 官方应 400，被接受在官方模式警告、等价模式只记录。", async (c) => {
    const a = K.body(c, "Reply OK.");
    const okR = await chat(c, { ...a, max_tokens: 131072 });
    const over = await chat(c, { ...a, max_tokens: 131073 });
    const d = [`131072：${okR.ok ? "200" : okR.status}`, `131073：${over.ok ? "200" : over.status}`];
    if (!okR.ok) return { status: "fail", summary: "官方范围内的 max_tokens 被拒（后端输出上限更低）", details: d };
    if (over.ok) return c.official ? { status: "warn", summary: "超出上限仍被接受", details: d } : { status: "info", summary: "超出上限被接受（自部署不校验）", details: d };
    return { status: "pass", summary: "上限契约与官方一致", details: d };
  }],
  ["param_range", "参数校验 / 协议保真", "参数范围校验（6 项）", 0, ["ref"], "逐项发送越界参数（max_tokens=0、超上限、过短 user_id / request_id、只有 system、129 个工具）：官方都 400；≥ 2 项被接受判非 z.ai 后端。", K.paramRangeCase, { officialWeight: 2 }],
  ["unknown_model", "参数校验 / 协议保真", "未知模型错误码 1211", 0, ["ref"], "model=glm-9.9-nonexistent：官方 400 code 1211；200 说明上游把未知模型映射到了别的模型；vLLM 风格 404 判非 z.ai 后端。", K.unknownModelCase, { officialWeight: 2 }],
  ["error_leak", "参数校验 / 协议保真", "错误体形态与泄露", 0, ["ref"], "畸形 JSON、缺少 messages、300 KB 垃圾正文：官方错误体为 {error:{code,message}}；错误体里出现中转产品名 / 堆栈 / 路径判中转痕迹。", K.errorLeakCase, { officialWeight: 2 }],
  ["tool_choice_auto", "参数校验 / 协议保真", "tool_choice 仅 auto", 0, ["ref"], "官方 tool_choice 只支持 auto：分别发 required、指定函数与 none。强制形式真的产生了调用说明后端执行了强制 tool_choice（非 z.ai 后端）。", K.toolChoiceAutoOnlyCase, { officialWeight: 2 }],
  ["json_mode", "参数校验 / 协议保真", "JSON 模式 / json_schema", 2, [], "response_format=json_object 应返回可直接解析的纯 JSON；json_schema 官方未支持，若被实现只在官方模式警告。", K.jsonModeCase("reject")],
  ["foreign_params", "参数校验 / 协议保真", "外来参数（n / logprobs / seed / penalties）", 0, ["ref"], "发送 z.ai 文档没有的 OpenAI 参数：返回 logprobs 对象说明后端是 vLLM；n=2 返回两个 choice 给警告；其余只记录。", K.foreignParamsCase, { officialWeight: 2 }],
  ["greedy", "参数校验 / 协议保真", "do_sample=false 贪心一致性", 2, [], "同一提示以 do_sample=false + temperature=0 发 3 次，两两词集相似度最高值 ≥ 0.8 通过，0.6–0.8 警告，< 0.6 判贪心未生效。", K.greedyConsistencyCase],
  ["stop", "参数校验 / 协议保真", "stop 截断", 1, [], "从 1 数到 20、stop=[\"7\"]：应在 7 处截断且 finish_reason=stop，出现 20 判 stop 未生效。", K.stopCase("digits")],
  ["system", "参数校验 / 协议保真", "system 生效", 1, [], "system 要求只回复 PINEAPPLE，user 问天气；丢掉 system 或并进 user 的中转会正常回答天气。", systemCase],
  ["unicode", "参数校验 / 协议保真", "Unicode / 中文标点保真", 1, [], "要求原样复制一句含弯引号、直角引号、全角标点与破折号的中文，校验字符没有被改成半角。", (c) => unicodeCase(c)],
  ["message_roles", "参数校验 / 协议保真", "messages 角色规则", 0, ["ref"], "只有 assistant 的 messages、不带 tool_call_id 的 tool 消息：官方预期 400，被接受给警告。", K.messageRolesCase, { officialWeight: 1 }],
  ["error_language", "参数校验 / 协议保真", "错误信息语言（参考）", 0, ["ref"], "用未知模型触发错误，分别带 Accept-Language: zh-CN 与 en-US，记录错误信息是否本地化。", K.errorLanguageCase, { officialWeight: 0 }],
  ["disable_thinking", "思考模式", "glm-5.3 禁用思考必失败", 3, ["critical"], "强制思考的型号官方对 thinking=disabled 返回 400；200 且真的不思考说明背后是可关闭思考的旧型号或 vLLM。等价模式下会再发一条默认请求区分自部署行为。", K.glmDisableThinkingCase],
  ["reasoning_present", "思考模式", "reasoning_content 存在且无 <think> 泄露", 3, [], "默认 effort 的组合计数题：思考应在 reasoning_content 返回；content 里出现 <think> 说明未配置 reasoning parser；字段名为 reasoning 是协议转换层。", K.reasoningPresentCase],
  ["effort_gradient", "思考模式", "effort low / max 梯度与枚举校验", 2, [], "同一题分别以 low 与 max 发送，max 的思考应 ≥ 1.3× low；< 1.1× 判 effort 未生效。再校验非法档位 ultra。", K.effortGradientCase("low", "max")],
  ["clear_thinking", "思考模式", "clear_thinking=false 回传", 2, [], "第 1 轮带工具与 clear_thinking=false 拿到 reasoning_content 与 tool_calls，第 2 轮原样回传并附工具结果：官方应 200 且回复引用结果。", K.thinkingRoundtripCase],
  ["stream_reasoning", "思考模式", "流式 reasoning 增量", 2, [], "流式组合计数题：思考以 delta.reasoning_content 输出且全部先于正文；正文出现 <think> 判失败，字段名为 reasoning 是协议转换层。", K.streamReasoningOrderCase],
  ["tool_roundtrip", "工具调用", "函数调用往返与 id 形态", 3, [], "第 1 轮要求查东京天气：finish_reason=tool_calls、arguments 为可解析 JSON；第 2 轮回传工具结果，回答须引用 17 与 rain。官方模式下按 tool_call id 形态判定后端。", K.toolRoundtripCase(glmIdRule)],
  ["tool_stream", "工具调用", "tool_stream 流式参数增量", 2, [], "流式 + tool_stream=true：工具调用应拆成多片 delta.tool_calls 增量，拼接后可解析，finish_reason=tool_calls。", K.toolStreamCase({ tool_stream: true })],
  ["parallel_tools", "工具调用", "并行工具调用", 0, ["unscored"], "一次提问要求分别查东京与巴黎天气，记录一条消息里的 tool_calls 数量。只记录。", K.parallelToolsCase],
  ["web_search", "工具调用", "内置 web_search 工具", 0, ["ref"], "带 z.ai 专有的 web_search 工具提问今日新闻：官方返回顶层 web_search 数组；400 判非 z.ai 后端，200 但无数组说明工具被剥离。", K.webSearchToolCase, { officialWeight: 2 }],
  ["tool_schema", "工具调用", "工具 schema 校验", 0, ["ref"], "同名工具、非法函数名、65 字符函数名：官方预期 400，被接受说明后端没有做 z.ai 的工具 schema 校验。", K.toolSchemaCase(64), { officialWeight: 1 }],
  ["tool_tamper", "工具调用", "工具参数篡改（固定安装命令）", 1, [], "要求用且仅用 pip install requests==2.32.3 调用 run_shell：工具参数必须逐字节一致，中转改写参数会在这里暴露。", K.toolArgTamperCase],
  ["sse_syntax", "流式", "SSE 块语法与终止", 3, [], "流式数 1 到 30：每个 data 块都是 JSON、没有 event: 行、id 与 created 一致、恰好一个 finish 块、带 usage、以 data: [DONE] 结束。", K.sseSyntaxCase],
  ["real_stream", "流式", "真流式 vs 伪流式（时序）", 2, [], "同一提示各发一次流式与非流式，记录每个块的到达时刻：所有块挤在 150 ms 内且 TTFT ≈ 非流式耗时判伪流式。", realStreamCase],
  ["stream_length", "流式", "流式 length 终止", 1, [], "流式 max_tokens=16 写长文：末块应 finish_reason=length 并带 usage，completion_tokens ≤ 17。", K.streamLengthCase],
  ["ttft", "流式", "TTFT ×5", 1, [], "1 次预热后连发 5 次流式最简请求，按中位 TTFT 判定：≤ 3 s 通过，3–8 s 警告，> 8 s 失败。", (c) => ttftCase(c, 5, "median")],
  ["identity", "身份 / 成分", "模型自述（含注入包裹）", 1, [], "中英文身份提问：官方自述为 GLM / 智谱 / Z.ai；全部自称其它厂商判模型被替换，提到代理 / 中转说明注入了身份改写提示。", (c) => identityCase(c, /glm|智谱|zhipu|z\.ai/i, "GLM")],
  ["tokenizer", "身份 / 成分", "分词器指纹（固定文本 prompt_tokens）", 3, ["critical"], "用差分计数探针测出上游分词器，与 GLM 官方分词器（GLM-5 / GLM-4 词表）比对；分词器是另一家的则判模型被替换。", tokenizerCase],
  ["meow", "身份 / 成分", "系统提示泄露 / 喵测试", 2, [], "system 要求只回「喵」，user 问 1+1：官方严格执行。再用三条提取提示查隐藏文本，出现 Claude Code / new-api 等强特征判注入。", K.meowCase],
  ["consistency", "身份 / 成分", "多请求一致性 / 混合池", 2, [], "同一确定性任务以贪心解码连发 5 次：model 回显、id 形态、prompt_tokens 应一致，id 不应重复，输出相似度应 ≥ 0.7。", (c) => consistencyCase(c, (id) => K.backendOf("glm", id))],
  ["second_model", "身份 / 成分", "两个模型名是否同一模型", 1, [], "同一组短问分别发给本次模型与第二模型，输出几乎逐字相同说明两个名字背后是同一个模型。需要填写第二模型。", secondModelCase, { needsSecond: true }],
  ["vision", "身份 / 成分", "视觉（flash）/ 文本模型拒图", 2, [], "1×1 纯红 PNG 问颜色：视觉模型应答 red，纯文本模型官方报错；文本模型却答出红色说明被路由到了多模态模型。", K.visionCase],
  ["content_filter", "身份 / 成分", "content_filter 字段（参考）", 0, ["ref"], "记录响应是否带顶层 content_filter 数组及其形态。", K.contentFilterCase, { officialWeight: 0 }],
  ["headers", "身份 / 成分", "响应头指纹（参考）", 0, ["ref"], "记录全部响应头并标注 Cloudflare、推理框架、OpenRouter 与中转层痕迹。", K.headersCase(), { officialWeight: 0 }],
  ["throughput_profile", "身份 / 成分", "TTFT / 吞吐画像", 1, [], "1 次预热后 3 次流式短文请求，取中位 TTFT 与生成吞吐；吞吐 < 25 tok/s 或 TTFT > 4 s 只给警告。", K.throughputProfileCase],
  ["context_ladder_1m", "压力（可选）", "上下文阶梯 1M（300K→900K）", 2, ["critical"], "阶梯的延伸，验证 1M 窗口顶部（300K / 530K / 900K）；只对官方 1M 窗口的型号有意义，需把档位上限调到 1000000。默认不勾选。", (c) => (F(c).window < 1_000_000 ? Promise.resolve({ status: "skip" as const, summary: "该型号官方窗口不足 1M" }) : contextLadderCase(c, { tiers: [300000, 530000, 900000], window: F(c).window, ladderMax: ladderMax(c) }))],
  ["long_output", "压力（可选）", "长输出上限", 1, ["optional"], "逐行输出 1 到 6000（max_tokens=32000）：应 finish_reason=stop 且写完；completion_tokens 少于行数一半判 usage 造假。默认不勾选。", K.longOutputCase],
  ["concurrency", "压力（可选）", "并发放大与 429 契约", 1, ["optional"], "先发 1 条单独请求，再同时发 7 条：放大系数 ≤ 2 通过、2–3 警告、> 3 或多条失败判失败。默认不勾选。", K.concurrencyCase],
  ["keepalive", "压力（可选）", "长思考期间的保活", 0, ["unscored", "optional"], "effort=max 流式求解组合计数题，记录首个思考增量前是否先收到保活事件以及等待时长。默认不勾选。", K.keepaliveCase],
]);
