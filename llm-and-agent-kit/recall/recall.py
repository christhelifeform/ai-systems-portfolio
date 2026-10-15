"""Smart recall: a fast librarian pass plans a search, then targeted excerpts
from tonight's transcript and/or archived shows are injected into the assistant's brain.

Flow (only on recall-cue turns — see prompts.wants_recall):
  1. plan_search(): tiny fast LLM call (fallback/8b model) → JSON search plan
     {scope, shows_ago, terms}.
  2. search_excerpts(): keyword search over the scoped transcript(s), matched
     lines +/- context, capped — 2k relevant chars beat 24k recent ones.
If planning or search yields nothing, callers fall back to a widened context.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

from src.memory.archive import list_show_files

log = logging.getLogger("quinn")

LIBRARIAN_SYSTEM = """You plan transcript searches for a live-show producer AI.
Given the hosts' recent lines, output ONLY a JSON object:
{"scope": "current" | "current_start" | "shows_ago" | "all_shows",
 "shows_ago": <int, only when scope is "shows_ago"; 1 = the previous show>,
 "terms": ["2-5 short search terms/synonyms for the thing being recalled"]}

Scope rules:
- "current": earlier in tonight's show ("earlier", "you said before").
- "current_start": explicitly the beginning of tonight ("at the start", "right at the beginning").
- "shows_ago": a specific past show ("last show" = 1, "two shows ago" = 2).
- "all_shows": a past show without saying which ("that one episode", "a while back").
Terms: the topic words to search for, plus likely synonyms (e.g. "robot surgeon" -> ["surgie","robot","surgery"]). Lowercase."""

EXCERPT_CONTEXT_LINES = 2
MAX_EXCERPT_CHARS = 3500
CURRENT_START_FRACTION = 0.35


def plan_search(client, model: str, recent_lines: str) -> dict | None:
    """One fast call to the small model → search plan, or None on failure."""
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": LIBRARIAN_SYSTEM},
                {"role": "user", "content": f"RECENT LINES:\n{recent_lines}"},
            ],
            temperature=0.0,
            max_tokens=150,
            response_format={"type": "json_object"},
        )
        plan = json.loads(resp.choices[0].message.content or "{}")
        terms = [str(t).strip() for t in plan.get("terms", []) if str(t).strip()]
        if not terms:
            return None
        plan["terms"] = terms
        return plan
    except Exception:
        log.exception("Recall librarian failed")
        return None


def _excerpt_blocks(text: str, terms: list[str]) -> str:
    """Matched lines +/- context, consecutive lines grouped, '…' between gaps."""
    lines = text.splitlines()
    lowered = [ln.lower() for ln in lines]
    keep: set[int] = set()
    for i, low in enumerate(lowered):
        if any(t.lower() in low for t in terms):
            for j in range(max(0, i - EXCERPT_CONTEXT_LINES), min(len(lines), i + EXCERPT_CONTEXT_LINES + 1)):
                keep.add(j)
    if not keep:
        return ""
    out: list[str] = []
    prev = None
    for idx in sorted(keep):
        if prev is not None and idx > prev + 1:
            out.append("…")
        out.append(lines[idx])
        prev = idx
    return "\n".join(out)


def search_excerpts(plan: dict, current_transcript: str, root: Path) -> str:
    """Return labeled excerpt blocks for the planned scope, capped in size."""
    terms = plan.get("terms", [])
    scope = str(plan.get("scope", "current"))
    sources: list[tuple[str, str]] = []

    if scope == "current":
        sources.append(("EARLIER TONIGHT", current_transcript))
    elif scope == "current_start":
        lines = current_transcript.splitlines()
        head = "\n".join(lines[: max(20, int(len(lines) * CURRENT_START_FRACTION))])
        sources.append(("START OF TONIGHT'S SHOW", head))
    elif scope == "shows_ago":
        n = max(1, int(plan.get("shows_ago", 1) or 1))
        shows = list_show_files(root)
        if len(shows) >= n:
            path = shows[-n]
            sources.append((f"{n} SHOW(S) AGO ({path.stem})", path.read_text(encoding="utf-8")))
    else:  # all_shows
        for path in list_show_files(root):
            sources.append((f"PAST SHOW ({path.stem})", path.read_text(encoding="utf-8")))
        # the asked-about moment may also be from earlier tonight
        sources.append(("EARLIER TONIGHT", current_transcript))

    chunks: list[str] = []
    budget = MAX_EXCERPT_CHARS
    for label, text in sources:
        block = _excerpt_blocks(text, terms)
        if not block:
            continue
        block = block[:budget]
        chunks.append(f"--- {label} ---\n{block}")
        budget -= len(block)
        if budget <= 0:
            break
    return "\n\n".join(chunks)

