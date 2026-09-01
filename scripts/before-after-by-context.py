"""Before/after kata at matched context depth.

The plain before/after (before-after.py) cannot separate "the tool" from "the
sessions happened to be shorter". This one buckets every turn by the prompt
size the model actually saw — input + cache_creation + cache_read tokens on the
first assistant reply of the turn — and compares before against after inside
each bucket, per model. The owner's complaint was specifically long contexts,
so the >=150k buckets are the ones that matter.

Same proxies as before-after.py: tools per turn, tool-result errors per tool,
user-correction rate. Same exclusion of the sessions spent building this tool.
"""
import io, json, os, re
from collections import defaultdict

BASE = r"C:/Users/YAP/.claude/projects"
INSTALL = "2026-08-30"
KATA_DEV = ("CustomSequentialThinkingMcp", "kata-mcp", "kata-chains")
BUCKETS = [(0, "<50k"), (50_000, "50-100k"), (100_000, "100-150k"), (150_000, "150-200k"), (200_000, ">=200k")]
CORRECTION = re.compile(
    r"退回|不對|不对|錯了|错了|不是這|不是这|重來|重来|怎麼會|怎么会|為何沒|为何没|為什麼沒|为什么没|又壞|又坏|還是不|还是不|仍然|revert|undo|wrong|not what|again\b|你沒|你没",
    re.I,
)

def bucket(tokens):
    label = BUCKETS[0][1]
    for lo, name in BUCKETS:
        if tokens >= lo: label = name
    return label

def is_real_user(e):
    if e.get("type") != "user": return False
    c = (e.get("message") or {}).get("content")
    if isinstance(c, list):
        return not any(isinstance(b, dict) and b.get("type") == "tool_result" for b in c)
    return isinstance(c, str)

def text_of(e):
    c = (e.get("message") or {}).get("content")
    if isinstance(c, str): return c
    if isinstance(c, list):
        return " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text")
    return ""

def errors_in(e):
    c = (e.get("message") or {}).get("content")
    if not isinstance(c, list): return 0
    return sum(1 for b in c if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"))

def tool_uses(e):
    c = (e.get("message") or {}).get("content")
    return sum(1 for b in c if isinstance(b, dict) and b.get("type") == "tool_use") if isinstance(c, list) else 0

def short_model(m):
    return re.sub(r"-\d{8}$", "", (m or "?").replace("claude-", ""))

def ctx_tokens(e):
    u = (e.get("message") or {}).get("usage") or {}
    return (u.get("input_tokens") or 0) + (u.get("cache_creation_input_tokens") or 0) + (u.get("cache_read_input_tokens") or 0)

ZERO = lambda: {"turns": 0, "tools": 0, "errors": 0, "corrected": 0}
agg = defaultdict(ZERO)          # (period, model, bucket)
sess_len = defaultdict(list)     # period -> turns per session
sess_ctx = defaultdict(list)     # period -> max ctx tokens per session

def flush(turn, next_text):
    if not turn or turn["model"] is None: return
    a = agg[(turn["period"], turn["model"], bucket(turn["ctx"]))]
    a["turns"] += 1; a["tools"] += turn["tools"]; a["errors"] += turn["errors"]
    a["corrected"] += 1 if next_text and CORRECTION.search(next_text) else 0

files = 0
for root, _d, names in os.walk(BASE):
    project = os.path.basename(root)
    if project.startswith("wf_") or project == "subagents" or any(k in project for k in KATA_DEV): continue
    for name in names:
        if not name.endswith(".jsonl"): continue
        files += 1
        try: fh = io.open(os.path.join(root, name), encoding="utf-8", errors="replace")
        except OSError: continue
        with fh:
            turn = None; period = None; n_turns = 0; max_ctx = 0
            for line in fh:
                try: e = json.loads(line)
                except Exception: continue
                if is_real_user(e):
                    flush(turn, text_of(e))
                    ts = e.get("timestamp") or ""
                    period = "after" if ts[:10] >= INSTALL else "before"
                    turn = {"period": period, "model": None, "ctx": 0, "tools": 0, "errors": 0}
                    n_turns += 1
                    continue
                if turn is None: continue
                if e.get("type") == "assistant":
                    if turn["model"] is None:
                        turn["model"] = short_model((e.get("message") or {}).get("model"))
                        turn["ctx"] = ctx_tokens(e)
                        max_ctx = max(max_ctx, turn["ctx"])
                    turn["tools"] += tool_uses(e)
                elif e.get("type") == "user":
                    turn["errors"] += errors_in(e)
            flush(turn, "")
            if period and n_turns:
                sess_len[period].append(n_turns); sess_ctx[period].append(max_ctx)

def med(xs):
    if not xs: return 0
    s = sorted(xs); return s[len(s) // 2]

print(f"transcripts (non-kata, interactive): {files}   cutoff {INSTALL}\n")
print("=== session shape baseline ===")
for p in ("before", "after"):
    print(f"{p:6}  sessions {len(sess_len[p]):4d}   median turns/session {med(sess_len[p]):3d}   median peak context {med(sess_ctx[p])/1000:6.0f}k tokens")

print("\n=== matched context depth: before vs after, per model ===")
print("model      bucket     period   turns  tools/turn  err/tool  corrected")
models = sorted({m for (_p, m, _b) in agg})
for m in models:
    if m == "?": continue
    for _lo, b in BUCKETS:
        rows = [(p, agg.get((p, m, b))) for p in ("before", "after")]
        if not all(r and r["turns"] >= 10 for _p, r in rows): continue
        for p, a in rows:
            t = a["turns"]
            print(f"{m:10} {b:9}  {p:6}  {t:6d}  {a['tools']/t:9.1f}  {100*a['errors']/max(a['tools'],1):7.1f}%  {100*a['corrected']/t:8.1f}%")
        print()
print("(a bucket is printed only when both periods have >= 10 turns in it for that model)")
