#!/usr/bin/env python3
"""AI DJ agent for SYNK//LAB: decides how every transition is mixed.

It listens to the local mixer events (see AGENT_API.md) and, shortly before a track ends, asks an AI
for the next transition (length, EQ mode, effect, amount, filter, optionally which track is next).
The AI is reached through the command line tools you are already logged into with your subscription,
so no API keys are used:

    --provider claude   -> `claude -p`      (Claude subscription, Claude Code CLI)
    --provider codex    -> `codex exec`     (ChatGPT/OpenAI subscription, Codex CLI)
    --provider rules    -> no AI, randomized rules (also the automatic fallback if the AI is too slow)

Usage:
    python3 dj_agent.py --provider claude --start
    python3 dj_agent.py --provider codex --style "dark hypnotic, long blends"
    python3 dj_agent.py --simulate --provider claude        # asks once with a sample pair, no app needed

Requirements: the app open in the browser with "PERMITIR CONTROL POR AGENTE" ticked.
Standard library only.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

EQ = ("off", "bass", "blend")
FX = ("off", "echo", "reverb", "flanger")

SYSTEM = (
    "You are the decision brain of an automatic techno DJ. You only choose how ONE transition between two "
    "tracks is mixed; the software does the beat alignment, crossfade and automation. "
    "Answer with a single JSON object and nothing else (no markdown, no prose)."
)

INSTRUCTIONS = """Choose the transition from the CURRENT track (ending) to the NEXT one.

Return exactly this JSON:
{"fade": <seconds 4-48>, "eq": "off|bass|blend", "fx": "off|echo|reverb|flanger",
 "fx_amount": <0-100>, "filter": <true|false>, "next_id": "<optional id from candidates>", "reason": "<one short sentence>"}

Guidance:
- fade: long (24-48) when BPM gap <= 3, keys are compatible (same Camelot number, or +-1 with the same letter) and beats are aligned;
  medium (12-24) for ordinary pairs; short (4-8) with echo when BPM differs a lot (> 8%) or beats are not aligned.
- eq "bass" swaps the bass lines mid-mix (default for bass-heavy pairs); "blend" also trims mids/highs of the outgoing track; "off" leaves EQ alone.
- fx adds a tail on the outgoing track: echo = rhythmic, reverb = washy/atmospheric, flanger = movement. Use "off" when the mix is already clean.
- filter true adds a low-pass sweep on the outgoing track and a high-pass riser on the incoming one.
- Estimated keys with confidence < 0.5 are unreliable; trust BPM and bass more.
- VARY your choices: do not repeat the same combination more than twice in a row (see the recent decisions).
- next_id is optional: only use it to swap to a better candidate for the NEXT slot; omit it to keep the queue order."""


def http(base: str, path: str, body: dict | None = None, timeout: float = 40) -> dict:
    req = urllib.request.Request(
        base + path,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"content-type": "application/json"},
        method="POST" if body is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read()).get("detail", "")
        except Exception:  # noqa: BLE001
            detail = ""
        raise RuntimeError(f"HTTP {e.code}: {detail}") from None


def command(base: str, action: str, args: dict | None = None, timeout: float = 30):
    out = http(base, "/api/agent/command", {"action": action, "args": args or {}, "timeout": timeout}, timeout + 5)
    if not out.get("ok"):
        raise RuntimeError(out.get("error") or "command failed")
    return out.get("result")


# ----------------------------------------------------------------------------- music helpers
def camelot(k: str | None):
    if not k or len(k) < 2 or not k[:-1].isdigit() or k[-1] not in "AB":
        return None
    return int(k[:-1]), k[-1]


def key_compatible(a: str | None, b: str | None):
    x, y = camelot(a), camelot(b)
    if not x or not y:
        return None
    if x[0] == y[0]:
        return True
    d = min((x[0] - y[0]) % 12, (y[0] - x[0]) % 12)
    return d == 1 and x[1] == y[1]


def pair_notes(a: dict, b: dict) -> dict:
    bpm_a, bpm_b = a.get("bpm"), b.get("bpm")
    ga, gb = a.get("beatgrid") or {}, b.get("beatgrid") or {}
    ta, tb = a.get("tonal") or {}, b.get("tonal") or {}
    return {
        "bpm_delta": round(bpm_b - bpm_a, 1) if bpm_a and bpm_b else None,
        "bpm_gap_pct": round(abs(bpm_b - bpm_a) / bpm_a * 100, 1) if bpm_a and bpm_b else None,
        "keys": f"{a.get('key')} -> {b.get('key')}",
        "key_compatible": key_compatible(a.get("key"), b.get("key")),
        "key_confidence": [ta.get("confidence"), tb.get("confidence")],
        "bass_ratio": [ta.get("bass_ratio"), tb.get("bass_ratio")],
        "beats_alignable": bool(ga.get("reliable") and gb.get("reliable")),
    }


def brief(t: dict) -> dict:
    return {k: t.get(k) for k in ("id", "title", "artist", "bpm", "key", "energy", "duration_s", "tonal", "intro")} | {
        "beatgrid_reliable": bool((t.get("beatgrid") or {}).get("reliable"))
    }


# ----------------------------------------------------------------------------- deciders
def rules_decision(cur: dict, nxt: dict) -> dict:
    n = pair_notes(cur, nxt)
    gap = n["bpm_gap_pct"]
    if gap is not None and gap > 8:
        return {"fade": 6, "eq": "bass", "fx": "echo", "fx_amount": 70, "filter": False,
                "reason": f"BPM gap {gap}%: short echo-out"}
    compatible = n["key_compatible"] is True
    if n["beats_alignable"] and compatible and (gap or 0) <= 3:
        return {"fade": random.choice([24, 32, 32, 40]), "eq": random.choice(["blend", "bass"]),
                "fx": random.choice(["reverb", "flanger", "off"]), "fx_amount": random.randint(30, 60), "filter": True,
                "reason": "compatible and aligned: long blend"}
    return {"fade": random.choice([12, 16, 16, 24]), "eq": "bass", "fx": random.choice(["echo", "reverb", "flanger"]),
            "fx_amount": random.randint(35, 75), "filter": random.random() < .8, "reason": "standard blend"}


def extract_json(text: str) -> dict | None:
    dec = json.JSONDecoder()
    for i, ch in enumerate(text):
        if ch == "{":
            try:
                obj, _ = dec.raw_decode(text[i:])
            except ValueError:
                continue
            if isinstance(obj, dict) and "fade" in obj:
                return obj
    return None


def run_cli(provider: str, prompt: str, model: str | None, timeout: float) -> str:
    work = tempfile.mkdtemp(prefix="synklab-agent-")
    try:
        if provider == "claude":
            exe = shutil.which("claude")
            if not exe:
                raise RuntimeError("`claude` no está instalado")
            cmd = [exe, "-p", "--output-format", "text", "--tools", "", "--no-session-persistence",
                   "--disable-slash-commands", "--strict-mcp-config", "--setting-sources", "",
                   "--system-prompt", SYSTEM]
            if model:
                cmd += ["--model", model]
            env = dict(os.environ, CLAUDE_CODE_DISABLE_CLAUDE_MDS="1")
            res = subprocess.run(cmd, input=prompt, capture_output=True, text=True, timeout=timeout, cwd=work, env=env)
            if res.returncode != 0:
                raise RuntimeError((res.stderr or res.stdout).strip()[:300] or f"claude exit {res.returncode}")
            return res.stdout
        if provider == "codex":
            exe = shutil.which("codex")
            if not exe:
                raise RuntimeError("`codex` no está instalado")
            out = os.path.join(work, "last.txt")
            cmd = [exe, "exec", "--ephemeral", "--skip-git-repo-check", "-s", "read-only", "--color", "never",
                   "-C", work, "-o", out]
            if model:
                cmd += ["-m", model]
            res = subprocess.run(cmd + [SYSTEM + "\n\n" + prompt], capture_output=True, text=True, timeout=timeout, cwd=work)
            if res.returncode != 0:
                raise RuntimeError((res.stderr or res.stdout).strip()[-300:] or f"codex exit {res.returncode}")
            return open(out, encoding="utf-8").read() if os.path.exists(out) else res.stdout
        raise RuntimeError(f"provider desconocido: {provider}")
    finally:
        shutil.rmtree(work, ignore_errors=True)


def sanitize(d: dict, candidate_ids: set[str]) -> dict:
    out: dict = {}
    out["fade"] = max(4, min(48, float(d.get("fade", 16))))
    out["eq"] = d.get("eq") if d.get("eq") in EQ else "bass"
    out["fx"] = d.get("fx") if d.get("fx") in FX else "off"
    out["fx_amount"] = max(0, min(100, float(d.get("fx_amount", 50))))
    out["filter"] = bool(d.get("filter", True))
    if d.get("next_id") in candidate_ids:
        out["next_id"] = d["next_id"]
    return out


def decide(provider: str, model: str | None, style: str, cur: dict, cands: list[dict], remaining: float,
           history: list[dict], timeout: float) -> tuple[dict, str, str]:
    nxt = cands[0]
    ctx = {
        "style_brief": style or "peak-time techno, tasteful and varied",
        "current_track": brief(cur) | {"remaining_s": remaining},
        "next_candidates": [brief(c) | {"vs_current": pair_notes(cur, c)} for c in cands],
        "recent_decisions": history[-5:],
    }
    fallback = rules_decision(cur, nxt)
    if provider == "rules":
        return sanitize(fallback, {c["id"] for c in cands}) | {"reason": fallback["reason"]}, "rules", ""
    # The mixer starts the transition ~fade+5 s before the end: an answer after that point would be discarded.
    budget = min(timeout, remaining - 24)
    if budget < 6:
        return sanitize(fallback, {c["id"] for c in cands}) | {"reason": fallback["reason"]}, "rules(sin tiempo)", f"{remaining:.0f}s restantes"
    prompt = INSTRUCTIONS + "\n\nDATA:\n" + json.dumps(ctx, ensure_ascii=False)
    t0 = time.time()
    try:
        raw = run_cli(provider, prompt, model, budget)
        obj = extract_json(raw)
        if not obj:
            raise RuntimeError("la IA no devolvió JSON válido: " + raw.strip()[:120])
        dec = sanitize(obj, {c["id"] for c in cands}) | {"reason": str(obj.get("reason", ""))[:200]}
        return dec, provider, f"{time.time() - t0:.0f}s"
    except Exception as e:  # noqa: BLE001
        return sanitize(fallback, {c["id"] for c in cands}) | {"reason": fallback["reason"]}, "rules(fallback)", str(e)[:160]


# ----------------------------------------------------------------------------- main loop
def title(t: dict | None) -> str:
    return f"{t.get('artist') + ' - ' if t and t.get('artist') else ''}{t.get('title') if t else '?'}"


def handle_track_ending(args, base, ev, history):
    data = ev["data"]
    state = command(base, "state")
    tracks = {t["id"]: t for t in state["tracks"]}
    cur = tracks.get(data["track"]["id"])
    if not cur:
        return
    queue = state["queue"]
    if cur["id"] not in queue:
        return
    nxt_ids = queue[queue.index(cur["id"]) + 1:][:3]
    cands = [tracks[i] for i in nxt_ids if i in tracks]
    if not cands:
        print("· último tema del set: nada que decidir")
        return
    remaining = float(data.get("remaining_s") or 60)
    dec, who, info = decide(args.provider, args.model, args.style, cur, cands, remaining, history, args.timeout)
    plan = {k: dec[k] for k in ("fade", "eq", "fx", "fx_amount", "filter", "next_id") if k in dec} | {"from_id": cur["id"]}
    try:
        command(base, "plan_transition", plan)
    except RuntimeError as e:
        if "tardío" in str(e):
            print(f"· decisión descartada: la mezcla de «{title(cur)}» ya había empezado")
            return
        raise
    history.append({"from": cur["title"], "fade": dec["fade"], "eq": dec["eq"], "fx": dec["fx"], "fx_amount": dec["fx_amount"],
                    "filter": dec["filter"]})
    nxt = tracks.get(dec.get("next_id", cands[0]["id"]), cands[0])
    print(f"→ {title(cur)}  ⇒  {title(nxt)}")
    print(f"  [{who}{' ' + info if info else ''}] fade {dec['fade']:.0f}s · EQ {dec['eq']} · FX {dec['fx']} {dec['fx_amount']:.0f}% · filtro {dec['filter']}")
    if dec.get("reason"):
        print(f"  «{dec['reason']}»")


def simulate(args):
    cur = {"id": "a", "title": "Sample A", "artist": "", "bpm": 128, "key": "9B", "energy": None, "duration_s": 380,
           "tonal": {"confidence": .84, "bass_ratio": .81}, "intro": None, "beatgrid": {"reliable": True}}
    nxt = {"id": "b", "title": "Sample B", "artist": "", "bpm": 130, "key": "5A", "energy": None, "duration_s": 350,
           "tonal": {"confidence": .69, "bass_ratio": .74}, "intro": None, "beatgrid": {"reliable": True}}
    dec, who, info = decide(args.provider, args.model, args.style, cur, [nxt], 60, [], args.timeout)
    print(json.dumps({"provider": who, "info": info, "decision": dec}, ensure_ascii=False, indent=2))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--provider", choices=("claude", "codex", "rules"), default="claude")
    ap.add_argument("--model", help="optional model name passed to the CLI")
    ap.add_argument("--style", default="", help="free text taste brief, e.g. 'dark hypnotic, long blends'")
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--timeout", type=float, default=45, help="max seconds to wait for the AI before using the rules")
    ap.add_argument("--start", action="store_true", help="analyze, apply the suggested order and start the set")
    ap.add_argument("--simulate", action="store_true", help="ask the AI once with a sample pair and exit (no app needed)")
    args = ap.parse_args()

    if args.simulate:
        return simulate(args)

    try:
        st = http(args.base, "/api/agent/status")
    except Exception as e:  # noqa: BLE001
        sys.exit(f"No puedo hablar con {args.base}: {e}")
    if not st.get("page_connected"):
        sys.exit("La app no está conectada: abrila en el navegador y tildá «Permitir control por agente».")

    if args.start:
        print("Analizando el set…")
        command(args.base, "analyze", timeout=280)
        plan = command(args.base, "plan_set", timeout=60)
        command(args.base, "apply_plan")
        print("Orden:", " → ".join(title(t) for t in plan["order"]))
        command(args.base, "start", {"prepare": False}, timeout=40)

    print(f"Agente DJ activo ({args.provider}). Ctrl+C para salir.")
    last = http(args.base, "/api/agent/status").get("last_event", 0)
    history: list[dict] = []
    while True:
        try:
            out = http(args.base, f"/api/agent/events?after={last}&wait=25", timeout=40)
        except Exception as e:  # noqa: BLE001
            print("· sin conexión con la app:", e)
            time.sleep(4)
            continue
        for ev in out.get("events", []):
            last = max(last, ev["seq"])
            kind = ev["type"]
            if kind == "track_ending":
                try:
                    handle_track_ending(args, args.base, ev, history)
                except Exception as e:  # noqa: BLE001
                    print("· no pude planificar esta mezcla:", e)
            elif kind == "transition_start":
                d = ev["data"]
                print(f"♪ mezclando: {title(d['from'])} → {title(d['to'])} ({d['seconds']}s, {d['fx']}, EQ {d['eq']}, {'alineada' if d['beat_aligned'] else 'sin alinear'})")
            elif kind == "set_ended":
                print("Set terminado.")
                return


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print()
