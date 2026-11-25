"""采集计费基准：按 blspec.plan() 向已验证的接口发送全部固定请求，记录完整结果。可断点续跑。"""
import json, os, random, sys, threading, time, urllib.error, urllib.request
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blspec

BASE, KEY = sys.argv[1].rstrip("/"), sys.argv[2]
OUT = sys.argv[3]; os.makedirs(OUT, exist_ok=True)
SAMPLES = os.path.join(OUT, "samples.jsonl"); lock = threading.Lock()

def send(body):
    H = {"x-api-key": KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    t0 = time.time(); ttft = None
    r = urllib.request.urlopen(urllib.request.Request(BASE + "/v1/messages", json.dumps(body, ensure_ascii=False).encode("utf-8"), H), timeout=1800)
    if not body.get("stream"):
        m = json.loads(r.read()); total = time.time() - t0
        text = "".join(b.get("text", "") for b in m.get("content", []) if b.get("type") == "text")
        th = [b for b in m.get("content", []) if b.get("type") == "thinking"]
        return dict(status=r.status, keys=sorted(m.keys()), id=m.get("id"), model=m.get("model"), usage=m.get("usage"), stop=m.get("stop_reason"),
                    stop_details=m.get("stop_details"), text=text, thinking_blocks=len(th), thinking_chars=sum(len(b.get("thinking", "")) for b in th),
                    block_types=[b.get("type") for b in m.get("content", [])], events=None, ttft_ms=None, total_ms=round(total * 1000))
    u = {}; blocks = {}; seq = []; msg_keys = []; mid = model = stop = stop_details = None
    for raw in r:
        line = raw.decode("utf-8").strip()
        if not line.startswith("data:"): continue
        d = json.loads(line[5:]); t = d.get("type")
        if seq and seq[-1][0] == t: seq[-1][1] += 1
        else: seq.append([t, 1])
        if t == "message_start":
            m = d["message"]; msg_keys = sorted(m.keys()); mid, model = m.get("id"), m.get("model"); u.update(m.get("usage") or {})
        elif t == "content_block_start": blocks[d["index"]] = dict(d["content_block"])
        elif t == "content_block_delta":
            if ttft is None: ttft = time.time() - t0
            b = blocks.setdefault(d["index"], {}); dl = d["delta"]
            if dl.get("type") == "text_delta": b["text"] = b.get("text", "") + dl["text"]
            elif dl.get("type") == "thinking_delta": b["thinking"] = b.get("thinking", "") + dl["thinking"]
        elif t == "message_delta":
            for k, v in (d.get("usage") or {}).items(): u[k] = v
            stop = d["delta"].get("stop_reason"); stop_details = d["delta"].get("stop_details")
        elif t == "error": raise RuntimeError(json.dumps(d, ensure_ascii=False))
    total = time.time() - t0; bl = [blocks[i] for i in sorted(blocks)]
    th = [b for b in bl if b.get("type") == "thinking"]
    return dict(status=r.status, keys=msg_keys, id=mid, model=model, usage=u, stop=stop, stop_details=stop_details,
                text="".join(b.get("text", "") for b in bl if b.get("type") == "text"), thinking_blocks=len(th), thinking_chars=sum(len(b.get("thinking", "")) for b in th),
                block_types=[b.get("type") for b in bl], events=seq, ttft_ms=round(ttft * 1000) if ttft else None, total_ms=round(total * 1000))

def run_group(g, done):
    seed = random.randrange(1, 2147483646); nz = blspec.nonce(seed)
    for i, fx in enumerate(g["requests"]):
        if (g["group"], i) in done: continue
        spec = {k: v for k, v in fx.items() if k != "role"}
        body = blspec.build_body(spec, nz)
        for attempt in range(4):
            try: res = send(body); break
            except Exception as e:
                res = {"error": str(e)[:300]}; time.sleep(10 * (attempt + 1))
        row = dict(group=g["group"], dim=g["dim"], level=g["level"], rep=g["rep"], idx=i, role=fx["role"], fixture=spec,
                   template_sha256=blspec.template_sha256(spec), nonce_seed=seed, nonce=nz,
                   ts=time.strftime("%Y-%m-%dT%H:%M:%S%z"), **res)
        with lock: open(SAMPLES, "a", encoding="utf-8").write(json.dumps(row, ensure_ascii=False) + "\n")
        u = res.get("usage") or {}
        print(f"{g['group']:<18} #{i} {fx['role']:<6} {fx.get('output','-'):<6} "
              + (f"in={u.get('input_tokens')} cw={u.get('cache_creation_input_tokens')} cr={u.get('cache_read_input_tokens')} out={u.get('output_tokens')} think={(u.get('output_tokens_details') or {}).get('thinking_tokens')} stop={res.get('stop')} ok={res.get('text','').strip()==(blspec.expected_text(fx.get('output')) or res.get('text','').strip())}"
                 if "error" not in res else "ERROR " + res["error"][:120]), flush=True)

if __name__ == "__main__":
    plan = blspec.plan()
    done = set()
    if os.path.exists(SAMPLES):
        for l in open(SAMPLES, encoding="utf-8"):
            r = json.loads(l)
            if "error" not in r: done.add((r["group"], r["idx"]))
    print(f"共 {len(plan)} 组 {sum(len(g['requests']) for g in plan)} 个请求，已完成 {len(done)}", flush=True)
    # 预热：让系统提示词与工具定义进入缓存，使后续"冷启动"统一表示"系统部分已缓存、用户内容全新"
    warm = blspec.build_body(dict(corpus="code", extra_chars=0, output="tiny", stream=True, cache="5m"), blspec.nonce(7))
    try: w = send(warm); print("预热完成", w.get("usage"), flush=True)
    except Exception as e: print("预热失败", e, flush=True)
    with ThreadPoolExecutor(int(os.environ.get("PAR", "3"))) as ex:
        list(ex.map(lambda g: run_group(g, done), plan))
    json.dump({"spec_version": blspec.SPEC_VERSION, "finished": time.strftime("%Y-%m-%dT%H:%M:%S%z")}, open(os.path.join(OUT, "capture_meta.json"), "w"))
    print("采集完成", flush=True)
