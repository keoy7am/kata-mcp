"""Before/after kata on observable proxies, stratified by model and Claude Code version.

Unit: one real user prompt and the assistant work that follows it, up to the
next real prompt. Interactive sessions only (no wf_* / subagents).

Proxies (none is "quality"; each is something that goes wrong when work goes
wrong):
  tools      assistant tool_use blocks in the turn            (thrash / loop length)
  errors     tool_result blocks flagged is_error              (things breaking)
  corrected  next user prompt reads like a correction         (user had to push back)
  long       turn began with >= LONG_CHARS of prior context   (the owner's pain case)

Stratifying by model and version is the only control available for the two
confounds the owner could not separate by feel.
"""
import io, json, os, re, sys
from collections import defaultdict

BASE = r"C:/Users/YAP/.claude/projects"
INSTALL = "2026-08-30"
LONG_CHARS = 150_000
CORRECTION = re.compile(
    r"退回|不對|不对|錯了|错了|不是這|不是这|重來|重来|怎麼會|怎么会|為何沒|为何没|為什麼沒|为什么没|又壞|又坏|還是不|还是不|仍然|revert|undo|wrong|not what|again\b|你沒|你没",
    re.I,
)

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

def is_error_result(e):
    c = (e.get("message") or {}).get("content")
    if not isinstance(c, list): return 0
    return sum(1 for b in c if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error"))

def tool_uses(e):
    if e.get("type") != "assistant": return 0
    c = (e.get("message") or {}).get("content")
    return sum(1 for b in c if isinstance(b, dict) and b.get("type") == "tool_use") if isinstance(c, list) else 0

def short_model(m):
    if not m: return "?"
    m = m.replace("claude-", "")
    return re.sub(r"-\d{8}$", "", m)

def short_version(v):
    return v or "?"

# The kata development sessions are conversational, human-in-the-loop turns;
# comparing them against autonomous development is comparing task types, not
# the tool. They are reported separately and excluded from the headline.
KATA_DEV = ("CustomSequentialThinkingMcp", "kata-mcp", "kata-chains")
def is_kata_dev(project):
    return any(k in project for k in KATA_DEV)

# key -> aggregates
agg = defaultdict(lambda: {"turns": 0, "tools": 0, "errors": 0, "corrected": 0,
                           "long_turns": 0, "long_errors": 0, "long_corrected": 0})

def flush(turn, next_prompt_text, key):
    if turn is None: return
    a = agg[key]
    a["turns"] += 1
    a["tools"] += turn["tools"]
    a["errors"] += turn["errors"]
    corrected = 1 if next_prompt_text and CORRECTION.search(next_prompt_text) else 0
    a["corrected"] += corrected
    if turn["long"]:
        a["long_turns"] += 1
        a["long_errors"] += turn["errors"]
        a["long_corrected"] += corrected

files = 0
for root, _d, names in os.walk(BASE):
    project = os.path.basename(root)
    if project.startswith("wf_") or project == "subagents": continue
    for name in names:
        if not name.endswith(".jsonl"): continue
        files += 1
        try: fh = io.open(os.path.join(root, name), encoding="utf-8", errors="replace")
        except OSError: continue
        with fh:
            turn = None; key = None; chars = 0
            for line in fh:
                try: e = json.loads(line)
                except Exception: continue
                if is_real_user(e):
                    txt = text_of(e)
                    flush(turn, txt, key)
                    ts = e.get("timestamp") or ""
                    period = "after" if ts[:10] >= INSTALL else "before"
                    if period == "after" and is_kata_dev(project):
                        period = "after-katadev"
                    key = (period, short_version(e.get("version")), None, project[:32])  # model filled from first assistant
                    turn = {"tools": 0, "errors": 0, "long": chars >= LONG_CHARS}
                    chars += len(txt)
                    continue
                if turn is None: continue
                if e.get("type") == "assistant":
                    m = (e.get("message") or {}).get("model")
                    if key[2] is None and m:
                        key = (key[0], key[1], short_model(m), key[3])
                    turn["tools"] += tool_uses(e)
                    chars += len(text_of(e))
                elif e.get("type") == "user":
                    turn["errors"] += is_error_result(e)
            flush(turn, "", key)

def fmt(a):
    t = a["turns"] or 1
    lt = a["long_turns"] or 1
    return (f"{a['turns']:5d}  {a['tools']/t:5.1f}  {100*a['errors']/max(a['tools'],1):5.1f}%  {100*a['corrected']/t:5.1f}%"
            f"   {a['long_turns']:4d}  {100*a['long_corrected']/lt:5.1f}%")

ZERO = lambda: {"turns":0,"tools":0,"errors":0,"corrected":0,"long_turns":0,"long_errors":0,"long_corrected":0}
def add(d, a):
    for k in d: d[k] += a[k]

print(f"transcripts: {files}   install cutoff: {INSTALL}   long-context threshold: {LONG_CHARS:,} chars")
print("(model '?' = turns with no assistant reply: slash commands, interrupts, system echoes — ignore)\n")
HDR = "period         model       turns  tools/turn  err/tool  corrected   long-turns  corrected@long"

print("=== A. by period × model (kata-dev sessions split out) ===")
print(HDR)
pm = defaultdict(ZERO)
for (period, _v, m, _p), a in agg.items():
    add(pm[(period, m)], a)
for (period, m), a in sorted(pm.items(), key=lambda kv: (["before","after","after-katadev"].index(kv[0][0]), kv[0][1] or "")):
    if a["turns"] < 15 or m is None: continue
    print(f"{period:14} {(m or '?'):11} {fmt(a)}")

print("\n=== B. after (non-kata) by project — the owner's real work ===")
print("project                           model       turns  tools/turn  err/tool  corrected   long-turns  corrected@long")
pp = defaultdict(ZERO)
for (period, _v, m, p), a in agg.items():
    if period == "after" and m: add(pp[(p, m)], a)
for (p, m), a in sorted(pp.items(), key=lambda kv: -kv[1]["turns"]):
    if a["turns"] < 10: continue
    print(f"{p:33} {m:11} {fmt(a)}")

print("\n=== C. Claude Code version present in each period (to see whether 'after' is also 'newer') ===")
pv = defaultdict(int)
for (period, v, m, _p), a in agg.items():
    if m: pv[(period, v)] += a["turns"]
for (period, v), n in sorted(pv.items(), key=lambda kv: (kv[0][0], kv[0][1])):
    if n >= 15: print(f"{period:14} {v:10} {n:5d} turns")
