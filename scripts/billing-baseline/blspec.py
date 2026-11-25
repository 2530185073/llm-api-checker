"""计费基准请求构造规范 billing-baseline-v1（Python 参考实现）。

src/lib/composition/billing/spec.ts 必须与本文件逐字节一致（以 template_sha256 校验）。
修改本文件、spec.ts 或 src/data/billing-baseline 下的素材，都需要重新采集基准。
"""
import hashlib, json, os

SPEC_VERSION = "billing-baseline-v1"
A = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "src", "data", "billing-baseline")
_cache = {}
def asset(name):
    if name not in _cache:
        p = os.path.join(A, name)
        _cache[name] = json.load(open(p, encoding="utf-8"))
        if name.startswith("corpus-"): _cache[name] = _cache[name]["text"]
    return _cache[name]

# 测试编号：从 64 个常见英文单词中按 Park–Miller 随机数取 6 个（每个词带前导空格时都是单个 token，换编号不改变 token 数）
WORDS = ("apple river stone cloud table green house water light music paper glass horse field bread chair "
         "night winter garden summer silver market window letter forest bridge pencil orange planet doctor family "
         "island mirror rocket school coffee yellow dinner animal engine circle button camera castle dragon finger "
         "flower hammer jacket ladder magnet needle pepper pillow pocket rabbit saddle shadow spider tunnel wallet "
         "basket candle travel").split()
assert len(WORDS) == 64
def nonce(seed):
    x = seed % 2147483647 or 1; out = []
    for _ in range(6):
        x = (x * 48271) % 2147483647; out.append(WORDS[x % 64])
    return " ".join(out)

_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()
def words(n):
    if n == 1000: return "one thousand"
    h, r = divmod(n, 100); p = []
    if h: p.append(_ONES[h] + " hundred")
    if r: p.append(_ONES[r] if r < 20 else _TENS[r // 10] + ("" if r % 10 == 0 else " " + _ONES[r % 10]))
    return " ".join(p)

OUTPUT_N = {"short": 20, "medium": 300, "long": 1000}
def task_text(output):
    if output == "tiny": return "不要调用任何工具。只回复两个字母：OK，不要输出任何其他内容。"
    if output == "trunc": return "不要调用任何工具。请写一篇关于城市公共交通发展史的中文长文，越长越好，不少于三万字，直接开始正文，不要标题。"
    n = OUTPUT_N[output]
    return (f"不要调用任何工具，不要写任何解释、标题或代码块。直接输出英文单词形式的数字 one 到 {words(n)}"
            f"（全部小写，用空格连接的写法如 twenty one，不要用连字符，不要用 and），每行一个，共 {n} 行，除此之外不输出任何内容。")
def expected_text(output):
    if output == "tiny": return "OK"
    if output in OUTPUT_N: return "\n".join(words(i) for i in range(1, OUTPUT_N[output] + 1))
    return None

CORPUS_FILE = {"code": "corpus-code.json", "zh": "corpus-zh.json", "en": "corpus-en.json", "json": "corpus-json.json"}
INTRO = {"code": "下面是项目里的若干源码文件，仅作为背景上下文，不需要阅读分析，也不需要调用任何工具。\n\n",
         "zh": "下面是一些中文参考资料，仅作为背景上下文，不需要阅读分析。\n\n",
         "en": "下面是一些英文参考资料，仅作为背景上下文，不需要阅读分析。\n\n",
         "json": "下面是一份商品数据导出（JSON），仅作为背景上下文，不需要阅读分析。\n\n"}

def cache_ctl(cache):
    if cache == "none": return {}
    return {"cache_control": {"type": "ephemeral", "ttl": "1h"}} if cache == "1h" else {"cache_control": {"type": "ephemeral"}}

def build_body(fx, nonce_text, model="claude-opus-5-5"):
    """fx: {corpus, extra_chars, output, max_tokens, stream, cache, agent_turn?}"""
    base = asset("base.json"); cc = cache_ctl(fx.get("cache", "5m"))
    system = [{"type": "text", "text": base["system"][0]}, {"type": "text", "text": base["system"][1]}, dict({"type": "text", "text": base["system"][2]}, **cc)]
    if fx.get("agent_turn") is not None:
        sc = asset("agent-script.json"); k = fx["agent_turn"]
        msgs = [{"role": "user", "content": [{"type": "text", "text": f"[测试编号 {nonce_text}]\n" + sc["task"]}]}]
        for i, t in enumerate(sc["turns"][:k]):
            tid = f"toolu_bl{i:04d}"
            msgs.append({"role": "assistant", "content": [{"type": "text", "text": "好的，继续。"}, {"type": "tool_use", "id": tid, "name": t["name"], "input": t["input"]}]})
            msgs.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": tid, "content": t["result"]}]})
        msgs[-1]["content"].append(dict({"type": "text", "text": "（测试指令：本轮不要调用任何工具，只回复两个字母：OK）"}, **cc))
    else:
        a = f"[测试编号 {nonce_text}]\n"
        if fx.get("extra_chars"):
            a += INTRO[fx["corpus"]] + asset(CORPUS_FILE[fx["corpus"]])[: fx["extra_chars"]] + "\n"
        msgs = [{"role": "user", "content": [dict({"type": "text", "text": a}, **cc), dict({"type": "text", "text": task_text(fx["output"])}, **cc)]}]
    return {"model": model, "max_tokens": fx.get("max_tokens", 16000), "stream": fx.get("stream", True),
            "output_config": {"effort": "low"}, "system": system, "tools": base["tools"], "messages": msgs}

def canonical(obj): return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
def template_sha256(fx, model="claude-opus-5-5"):
    return hashlib.sha256(canonical(build_body(fx, "<NONCE>", model)).encode("utf-8")).hexdigest()

# ---------------------------------------------------------------- 采集计划
CODE_LEVELS = {"0": 0, "10k": 26600, "30k": 79800, "60k": 159600, "100k": 266000, "160k": 425600}   # 代码语料约 2.66 字符/token
TYPE_LEVELS = {"zh": 26800, "en": 102000, "json": 60000}                                             # 约 3 万 token

def plan():
    """返回分组列表；组内请求按顺序发送，共用一个测试编号。"""
    G = []
    for lv, ch in CODE_LEVELS.items():
        for rep in range(2):
            base = dict(corpus="code", extra_chars=ch, stream=True, cache="5m")
            reqs = [dict(base, output="medium", role="cold"), dict(base, output="medium", role="warm"),
                    dict(base, output="tiny", role="prefix"), dict(base, output="short", role="prefix"), dict(base, output="long", role="prefix", max_tokens=32000)]
            if lv in ("0", "60k") and rep == 0:
                reqs += [dict(base, output="trunc", max_tokens=n, role="prefix") for n in (64, 512, 4096)]
            G.append(dict(group=f"core-{lv}-r{rep}", dim="core", level=lv, rep=rep, requests=reqs))
    for kind, ch in TYPE_LEVELS.items():
        for rep in range(2):
            base = dict(corpus=kind, extra_chars=ch, stream=True, cache="5m", output="medium")
            G.append(dict(group=f"type-{kind}-r{rep}", dim="content_type", level=kind, rep=rep, requests=[dict(base, role="cold"), dict(base, role="warm")]))
    for lv in ("0", "60k", "160k"):
        base = dict(corpus="code", extra_chars=CODE_LEVELS[lv], stream=True, cache="none", output="medium")
        G.append(dict(group=f"nocache-{lv}", dim="no_cache_control", level=lv, rep=0, requests=[dict(base, role="cold"), dict(base, role="repeat")]))
    for lv in ("0", "60k"):
        base = dict(corpus="code", extra_chars=CODE_LEVELS[lv], stream=False, cache="5m", output="medium")
        G.append(dict(group=f"nonstream-{lv}", dim="non_stream", level=lv, rep=0, requests=[dict(base, role="cold"), dict(base, role="warm")]))
    base = dict(corpus="code", extra_chars=CODE_LEVELS["60k"], stream=True, cache="1h", output="medium")
    G.append(dict(group="ttl1h-60k", dim="ttl_1h", level="60k", rep=0, requests=[dict(base, role="cold"), dict(base, role="warm")]))
    n_turns = len(asset("agent-script.json")["turns"])
    for rep in range(2):
        G.append(dict(group=f"agent-r{rep}", dim="agent_session", level="8turns", rep=rep,
                      requests=[dict(agent_turn=k, stream=True, cache="5m", output="tiny", role="turn") for k in range(n_turns + 1)]))
    return G
