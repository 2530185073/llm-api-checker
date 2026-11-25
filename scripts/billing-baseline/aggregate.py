"""把采集到的原始样本整理成仓库使用的基准文件 src/data/billing-baseline/<model>.json。"""
import json, os, statistics as st, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blspec

samples_path, out_json, out_raw = sys.argv[1], sys.argv[2], sys.argv[3]
rows = [json.loads(l) for l in open(samples_path, encoding="utf-8")]
rows = [r for r in rows if "error" not in r and r.get("usage")]

def ctx(u): return (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)
def stat(v): return {"median": st.median(v), "min": min(v), "max": max(v), "n": len(v)}
def valid(r):
    exp = blspec.expected_text(r["fixture"].get("output"))
    if exp is None: return r["stop"] == "max_tokens" and r["usage"]["output_tokens"] == r["fixture"]["max_tokens"]
    return "\n".join(l.strip() for l in r["text"].strip().splitlines() if l.strip()) == exp

bad = [r for r in rows if not valid(r)]
fx = {}
for r in rows:
    if not valid(r): continue
    e = fx.setdefault(r["template_sha256"], {"fixture": r["fixture"], "rows": []}); e["rows"].append(r)

out = {}
for sha, e in fx.items():
    R = e["rows"]; f = e["fixture"]; C = [ctx(r["usage"]) for r in R]; cm = st.median(C)
    split = {}
    for role in sorted({r["role"] for r in R}):
        S = [r["usage"] for r in R if r["role"] == role]
        cc = lambda u, k: (u.get("cache_creation") or {}).get(k) or 0
        obs = {"input": st.median(u.get("input_tokens") or 0 for u in S),
               "cache_write_5m": st.median(cc(u, "ephemeral_5m_input_tokens") for u in S),
               "cache_write_1h": st.median(cc(u, "ephemeral_1h_input_tokens") for u in S),
               "cache_read": st.median(u.get("cache_read_input_tokens") or 0 for u in S)}
        # 冷启动（含 Agent 第 0 轮）按"全新会话、全部写入缓存"的官方规则计价；不带缓存标记的按全价输入计价
        if f.get("cache") == "none":
            obs = {"input": cm, "cache_write_5m": 0, "cache_write_1h": 0, "cache_read": 0}
        elif role == "cold" or (role == "turn" and f.get("agent_turn") == 0):
            w = cm - obs["input"]
            obs = {"input": obs["input"], "cache_write_5m": 0 if f.get("cache") == "1h" else w, "cache_write_1h": w if f.get("cache") == "1h" else 0, "cache_read": 0}
        split[role] = obs
    out[sha] = {"fixture": f, "context": stat(C), "output": stat([r["usage"]["output_tokens"] for r in R]),
                "thinking": stat([(r["usage"].get("output_tokens_details") or {}).get("thinking_tokens") or 0 for r in R]),
                "ttft_ms": st.median([r["ttft_ms"] for r in R if r.get("ttft_ms")] or [0]), "total_ms": st.median(r["total_ms"] for r in R),
                "split": split, "groups": sorted({f'{r["group"]}#{r["idx"]}:{r["role"]}' for r in R})}

ref = next(r for r in rows if r.get("events"))
baseline = {
    "spec_version": blspec.SPEC_VERSION, "model": "claude-opus-5-5",
    "captured_at": min(r["ts"] for r in rows)[:10],
    "source": "采集自经 Anthropic 官方订阅交叉验证、逐 token 一致的接口（固定输出任务的 output_tokens、输入差值与官方完全相同）",
    "pricing_usd_per_mtok": {"input": 4, "output": 20, "cache_write_5m": 5, "cache_write_1h": 8, "cache_read": 0.2},
    "samples": len(rows), "invalid_samples": len(bad),
    # 冷启动时若官方恰好命中了 system + tools 的缓存，缓存读取就是这个长度（用于按同样的缓存状态计算真实账单）
    "system_prefix_tokens": st.median([r["usage"]["cache_read_input_tokens"] for r in rows if r["role"] == "cold" and (r["usage"].get("cache_read_input_tokens") or 0) > 0]),
    "response_shape": {"message_keys": ref["keys"], "usage_keys": sorted(ref["usage"].keys()), "stream_events": ref["events"], "id_example": ref["id"]},
    "fixtures": out,
}
json.dump(baseline, open(out_json, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
with open(out_raw, "w", encoding="utf-8") as fo:
    for r in rows:
        fo.write(json.dumps({k: v for k, v in r.items() if k not in ("text",)} | {"text_ok": valid(r), "text_chars": len(r["text"])}, ensure_ascii=False) + "\n")
print(f"样本 {len(rows)}，作废 {len(bad)}，fixture {len(out)}")
for r in bad: print("  作废", r["group"], r["idx"], r["role"], r["fixture"].get("output"), repr(r["text"][:60]))
