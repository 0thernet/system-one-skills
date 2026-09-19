#!/usr/bin/env python3
"""Privacy-preserving aggregate analysis of Codex + Devin CLI session transcripts.

Emits only aggregate statistics: tool-call counts, output-byte volumes,
token totals, command-head frequencies (allowlisted), and keyword task
categories. No message bodies, file paths, or command arguments are stored.
"""

import json
import os
import re
import sys
import collections

CODEX_DIR = os.path.expanduser("~/.codex/sessions")
DEVIN_DIR = os.path.expanduser("~/.local/share/devin/cli/transcripts")
SINCE = "2026-09-12"  # last week of sessions

CMD_ALLOW = {
    "git", "npm", "npx", "bun", "bunx", "node", "deno", "yarn", "pnpm",
    "cargo", "rustc", "rustup", "go", "python", "python3", "pip", "pip3",
    "uv", "pytest", "jest", "vitest", "mocha", "tsc", "eslint", "biome",
    "prettier", "ls", "find", "fd", "rg", "grep", "cat", "head", "tail",
    "less", "more", "sed", "awk", "jq", "yq", "echo", "printf", "touch",
    "mkdir", "cp", "mv", "rm", "chmod", "ln", "cd", "pwd", "which", "env",
    "export", "source", "xargs", "tee", "diff", "patch", "tar", "zip",
    "unzip", "curl", "wget", "http", "ssh", "scp", "rsync", "docker",
    "docker-compose", "kubectl", "helm", "terraform", "make", "cmake",
    "gh", "glab", "codex", "devin", "claude", "algal", "vercel", "flyctl",
    "railway", "supabase", "stripe", "brew", "apt", "xcodebuild", "swift",
    "open", "pbcopy", "pbpaste", "mdfind", "sqlite3", "psql", "mysql",
    "redis-cli", "mongo", "tmux", "screen", "kill", "pkill", "ps", "top",
    "sleep", "date", "seq", "sort", "uniq", "wc", "tr", "cut", "shasum",
    "sh", "bash", "zsh", "fish", "test", "true", "false", "wait", "nohup",
    "o(pa)?run", "oompa-host-run", "nohup", "watch", "time", "hyperfine",
    "for", "while", "if", "cd &&", "sudo", "brew", "npm-run", "just",
    "task", "mise", "asdf", "poetry", "uvicorn", "gunicorn", "flask",
    "django-admin", "rails", "rake", "bundle", "gem", "mvn", "gradle",
    "dotnet", "zig", "clang", "gcc", "g++", "cc", "ld", "ar", "nm",
    "rg --", "ls -", "git -C",
}

TASK_RULES = [
    ("release/publish/deploy", r"\b(publish|release|deploy|ship|version bump|changelog|npm publish|tag)\b"),
    ("bugfix/debug", r"\b(fix|bug|error|fail|broken|crash|regression|debug|stack ?trace|exception|panic)\b"),
    ("feature/implement", r"\b(add|implement|build|create|make|feature|support|introduce|write)\b"),
    ("refactor/cleanup", r"\b(refactor|cleanup|clean up|rename|reorganize|simplify|dedupe|migrate)\b"),
    ("test/verify", r"\b(test|verify|check|coverage|ci|lint|typecheck|prove|validate)\b"),
    ("review/audit", r"\b(review|audit|inspect|assess|evaluate|analy[sz]e|investigate|look at)\b"),
    ("docs/explain", r"\b(document|docs|explain|describe|readme|comment)\b"),
    ("explore/find", r"\b(find|where|search|locate|explore|show me|what is|which file)\b"),
    ("config/setup", r"\b(config|setup|set up|install|provision|env|secret|credential|connect)\b"),
    ("git/branch/merge", r"\b(commit|merge|rebase|branch|pull request|\bpr\b|push)\b"),
    ("data/query", r"\b(query|database|sql|csv|json|parse|extract|enrich|scrape|fetch)\b"),
    ("plan/design", r"\b(plan|design|architect|spec|proposal|strategy|approach)\b"),
]

CALL_ID_RE = re.compile(r'"call_id"\s*:\s*"([^"]+)"')
CMD_RE = re.compile(r'cmd\\?"?\s*:\s*\\?"((?:[^"\\]|\\.)*)')


def norm_cmd_head(raw: str) -> str:
    raw = raw.strip()
    if not raw:
        return "other"
    # unwrap common wrappers
    toks = raw.split()
    while toks and toks[0] in {"cd", "env", "time", "nice", "sudo", "command", "xargs", "nohup"}:
        if toks[0] == "cd" and len(toks) > 1 and not toks[1].startswith("-"):
            toks = toks[2:] if "&&" in raw else toks[1:]
            continue
        toks = toks[1:]
    if not toks:
        return "other"
    head = toks[0]
    head = head.split("/")[-1]  # strip path prefix
    head = head.split("=")[0] if "=" in head and not head.startswith("=") else head
    head = head.lower()
    if head in CMD_ALLOW:
        sub = ""
        if len(toks) > 1 and head in {"git", "npm", "cargo", "gh", "docker", "kubectl", "bun", "go", "python3", "python", "node", "brew", "make", "just", "task", "stripe", "supabase", "vercel", "railway", "codex", "devin"}:
            cand = re.sub(r"[^a-z0-9:_-]", "", toks[1].lower())
            if cand and not cand.startswith("-") and len(cand) < 24:
                sub = f"{head} {cand}"
        return sub or head
    if re.fullmatch(r"[a-z][a-z0-9_-]{0,20}", head):
        return f"bin:{head}"
    return "other"


def classify_task(text: str) -> str:
    t = text.lower()[:4000]
    for name, pat in TASK_RULES:
        if re.search(pat, t):
            return name
    return "other"


def analyze_codex(path: str, acc: dict):
    call_names = {}
    max_usage = {"input": 0, "output": 0, "cached": 0}
    first_user = None
    n_subagent = 0
    try:
        f = open(path, "r", encoding="utf-8", errors="replace")
    except OSError:
        return
    with f:
        for line in f:
            if '"type"' not in line:
                continue
            try:
                if '"session_meta"' in line:
                    d = json.loads(line)
                    pl = d.get("payload") or {}
                    src = pl.get("source")
                    if isinstance(src, dict) and src.get("subagent"):
                        n_subagent += 1
                        acc["tasks"][f"subagent:{src.get('subagent')}"] += 1
                    acc["meta"]["originator"][pl.get("originator", "?")] += 1
                    acc["meta"]["source"] = acc["meta"].get("source", collections.Counter())
                    skey = src if isinstance(src, str) else ("subagent" if isinstance(src, dict) else "?")
                    acc["meta"]["source"][skey] += 1
                    continue
                if '"token_count"' in line:
                    d = json.loads(line)
                    pl = d.get("payload") or {}
                    info = pl.get("info") or {}
                    tot = info.get("total_token_usage") or {}
                    max_usage["input"] = max(max_usage["input"], tot.get("input_tokens", 0))
                    max_usage["output"] = max(max_usage["output"], tot.get("output_tokens", 0))
                    max_usage["cached"] = max(max_usage["cached"], tot.get("cached_input_tokens", 0))
                    continue
                if '"custom_tool_call"' in line or '"function_call"' in line:
                    if '"custom_tool_call_output"' in line or '"function_call_output"' in line:
                        m = CALL_ID_RE.search(line)
                        cid = m.group(1) if m else "?"
                        name = call_names.get(cid, "?")
                        acc["tool_out_bytes"][name] += len(line)
                        continue
                    d = json.loads(line)
                    pl = d.get("payload") or {}
                    if pl.get("type") not in ("custom_tool_call", "function_call"):
                        continue
                    name = pl.get("name") or "?"
                    acc["tool_calls"][name] += 1
                    cid = pl.get("call_id") or pl.get("id") or "?"
                    call_names[cid] = name
                    inp = pl.get("input") or pl.get("arguments") or ""
                    acc["tool_in_bytes"][name] += len(inp)
                    if name in ("exec", "shell", "exec_command", "local_shell", "bash"):
                        m = CMD_RE.search(inp)
                        raw = m.group(1) if m else inp[:200]
                        acc["cmd_heads"][norm_cmd_head(raw)] += 1
                    continue
                if '"user_message"' in line or ('"message"' in line and '"user"' in line):
                    d = json.loads(line)
                    pl = d.get("payload") or {}
                    if pl.get("type") == "message" and pl.get("role") == "user":
                        parts = pl.get("content") or []
                        txt = " ".join(
                            str(x.get("text", "")) for x in parts if isinstance(x, dict)
                        )
                        if txt.strip() and not txt.lstrip().startswith(("#", "<environment", "<INSTRUCTIONS", "<user_instructions")):
                            first_user = txt
                    elif pl.get("type") == "user_message":
                        msg = pl.get("message") or pl.get("text") or ""
                        if isinstance(msg, list):
                            msg = " ".join(str(x.get("text", "")) for x in msg if isinstance(x, dict))
                        if msg.strip() and not msg.lstrip().startswith(("#", "<")):
                            first_user = msg
                    continue
                if '"compaction"' in line or '"compacted"' in line:
                    acc["compactions"] += 1
                    continue
            except (json.JSONDecodeError, KeyError, TypeError):
                continue
    acc["sessions"] += 1
    acc["subagent_sessions"] += 1 if n_subagent else 0
    acc["tokens"]["input"] += max_usage["input"]
    acc["tokens"]["output"] += max_usage["output"]
    acc["tokens"]["cached"] += max_usage["cached"]
    acc["session_input_max"].append(max_usage["input"])
    if first_user:
        acc["tasks"][classify_task(first_user)] += 1


def analyze_devin(path: str, acc: dict):
    try:
        d = json.load(open(path, encoding="utf-8", errors="replace"))
    except (OSError, json.JSONDecodeError):
        return
    acc["sessions"] += 1
    fm = d.get("final_metrics") or {}
    acc["tokens"]["input"] += fm.get("total_prompt_tokens", 0)
    acc["tokens"]["output"] += fm.get("total_completion_tokens", 0)
    acc["tokens"]["cached"] += fm.get("total_cached_tokens", 0)
    acc["session_input_max"].append(fm.get("total_prompt_tokens", 0))
    first_user = None
    for s in d.get("steps") or []:
        src = s.get("source")
        if src == "user" and first_user is None:
            first_user = s.get("message") or ""
        if src != "agent":
            continue
        for tc in s.get("tool_calls") or []:
            name = tc.get("function_name") or "?"
            acc["tool_calls"][name] += 1
            args = tc.get("arguments") or {}
            abytes = len(json.dumps(args))
            acc["tool_in_bytes"][name] += abytes
            if name == "exec":
                cmd = args.get("command") or ""
                acc["cmd_heads"][norm_cmd_head(cmd)] += 1
            if name == "read":
                acc["read_paths_bytes"] += len(str(args.get("file_path", "")))
        obs = s.get("observation") or {}
        for r in obs.get("results") or []:
            content = r.get("content") or ""
            # attribute output bytes to the step's tool calls (same order)
            tcs = s.get("tool_calls") or []
            name = tcs[0].get("function_name") if tcs else "?"
            acc["tool_out_bytes"][name or "?"] += len(str(content))
    if first_user:
        acc["tasks"][classify_task(first_user)] += 1


def new_acc():
    return {
        "sessions": 0,
        "subagent_sessions": 0,
        "compactions": 0,
        "tool_calls": collections.Counter(),
        "tool_in_bytes": collections.Counter(),
        "tool_out_bytes": collections.Counter(),
        "cmd_heads": collections.Counter(),
        "tasks": collections.Counter(),
        "tokens": {"input": 0, "output": 0, "cached": 0},
        "session_input_max": [],
        "meta": {"originator": collections.Counter()},
        "read_paths_bytes": 0,
    }


def main():
    out = {"codex": new_acc(), "devin": new_acc()}
    codex_files = []
    for root, _, files in os.walk(CODEX_DIR):
        for fn in files:
            if fn.endswith(".jsonl") and fn >= "rollout-" + SINCE:
                codex_files.append(os.path.join(root, fn))
    codex_files.sort()
    for i, p in enumerate(codex_files):
        analyze_codex(p, out["codex"])
        if i % 100 == 0:
            print(f"  codex {i}/{len(codex_files)}", file=sys.stderr)
    for fn in sorted(os.listdir(DEVIN_DIR)):
        if fn.endswith(".json"):
            analyze_devin(os.path.join(DEVIN_DIR, fn), out["devin"])

    # finalize
    for side in out.values():
        side["tool_calls"] = dict(side["tool_calls"].most_common(60))
        side["tool_in_bytes"] = dict(side["tool_in_bytes"].most_common(60))
        side["tool_out_bytes"] = dict(side["tool_out_bytes"].most_common(60))
        side["cmd_heads"] = dict(side["cmd_heads"].most_common(80))
        side["tasks"] = dict(side["tasks"].most_common())
        side["meta"]["originator"] = dict(side["meta"]["originator"])
        if isinstance(side["meta"].get("source"), collections.Counter):
            side["meta"]["source"] = dict(side["meta"]["source"])
        si = sorted(side["session_input_max"])
        side["session_input_p50"] = si[len(si) // 2] if si else 0
        side["session_input_p90"] = si[int(len(si) * 0.9)] if si else 0
        side["session_input_max"] = si[-1] if si else 0
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
