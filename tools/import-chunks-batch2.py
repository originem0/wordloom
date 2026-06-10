#!/usr/bin/env python3
"""Batch 2 importer: grow the chunks library from ~167 toward 300.

Same pipeline as tools/import-chunks.py — each candidate string is POSTed to
/api/chunks/generate, the AI judges verdict (chunk/borderline/not_chunk) and
fills the rich payload, and chunk/borderline results are upserted by
(form, category). Re-running is safe (upsert, not insert).

Selection standard (inherited from batch 1):
  - Classic + high-frequency, BUT must carry a teaching trap: a preposition
    lock, fixed slot, inversion, subjunctive, register lock, or metaphor —
    something a learner can't just look up and write correctly.
  - Every candidate below was de-duplicated against the existing rows.
  - Weighted toward the thin categories (noun-prep, prep-intuition,
    discourse-marker) while topping up verb-collocation / sentence-stem.

Usage:
  python3 tools/import-chunks-batch2.py --dry    # print the list only
  python3 tools/import-chunks-batch2.py          # run live against the server
"""

import json
import sys
import time
import urllib.request
import urllib.error

API = "http://localhost:3001/api/chunks/generate"
ORIGIN = "http://localhost:3001"
COUNT_API = "http://localhost:3001/api/chunks?limit=1"
SLEEP_BETWEEN = 3.2  # stay under the 20-req/60s rate limit on /generate
TIMEOUT = 180
MAX_RETRY_429 = 4
STOP_AT = None  # if set, stop once the DB chunk count reaches this target

CANDIDATES = [
    # --- verb-collocation (delexical / metaphor / phrasal locks) ---
    "take X into consideration",
    "bear in mind that X",
    "come to terms with X",
    "play a role in X",
    "take steps to V",
    "carry out X",
    "bring about X",
    "pose a threat to X",
    "meet the needs of X",
    "fall short of X",
    "live up to X",
    "run the risk of V-ing",
    "bring X to light",
    "set out to V",
    "lay the groundwork for X",
    "open the door to X",
    "take its toll on X",
    "strike a balance between X and Y",
    "exert pressure on X",
    "exercise caution",
    "hold sb accountable for X",
    "attribute X to Y",
    "result in X",
    "contribute to X",
    "boil down to X",
    "make the most of X",
    "take charge of X",
    "put X into practice",
    "get to grips with X",
    "resort to X",

    # --- sentence-stem (inversion / subjunctive / cleft / fixed frame) ---
    "If it were not for X, Y",
    "Were it not for X, Y",
    "No sooner had X than Y",
    "Hardly had X when Y",
    "Only by V-ing can sb V",
    "Such is X that Y",
    "The fact that X does not mean Y",
    "What matters most is X",
    "What strikes me about X is Y",
    "The point is that X",
    "There is no denying that X",
    "It is high time sb V-ed",
    "It occurs to me that X",
    "It turns out that X",
    "Suffice it to say that X",
    "Chances are that X",
    "Little did sb know that X",
    "Rarely does sb V",
    "Under no circumstances should sb V",
    "Not that X, but Y",
    "If anything, X",
    "Now that X, Y",
    "Just as X, so Y",
    "No matter how X, Y",
    "As things stand, X",
    "Whether or not X, Y",
    "It is not until X that Y",
    "There is something to be said for V-ing",

    # --- prep-intuition (prepositional schemas) ---
    "in addition to X",
    "apart from X",
    "regardless of X",
    "owing to X",
    "due to X",
    "thanks to X",
    "prior to X",
    "in favor of X",
    "at the expense of X",
    "on behalf of X",
    "in the face of X",
    "in the absence of X",
    "in accordance with X",
    "in line with X",
    "in terms of X",
    "with regard to X",
    "by virtue of X",
    "in the event of X",
    "for the sake of X",
    "for fear of V-ing",
    "in exchange for X",
    "short of V-ing",
    "barring X",
    "in spite of X",
    "on account of X",
    "ahead of X",
    "as to X",
    "pending X",

    # --- noun-prep (the preposition is the trap) ---
    "a demand for X",
    "a need for X",
    "a solution to X",
    "a key to X",
    "an answer to X",
    "the cause of X",
    "an effect on X",
    "a relationship between X and Y",
    "a connection between X and Y",
    "a link between X and Y",
    "a correlation between X and Y",
    "the difference between X and Y",
    "the distinction between X and Y",
    "the gap between X and Y",
    "access to X",
    "exposure to X",
    "resistance to X",
    "a threat to X",
    "a barrier to X",
    "a reaction to X",
    "knowledge of X",
    "an understanding of X",
    "a lack of X",
    "a shortage of X",
    "the role of X in Y",
    "a tendency toward X",
    "insight into X",
    "a preference for X",
    "respect for X",
    "sympathy for X",
    "a stance on X",
    "a perspective on X",
    "reliance on X",
    "a focus on X",
    "a ban on X",

    # --- discourse-marker (multi-word, fixed / trap-bearing only) ---
    "needless to say",
    "by and large",
    "more often than not",
    "all things considered",
    "all in all",
    "when all is said and done",
    "to be fair, X",
    "to put it bluntly",
    "so to speak",
    "for that matter",
    "come to think of it",
    "that said, X",
    "as such",
    "on balance",
    "at any rate",
    "in any case",
    "for one thing, X",
    "not to mention X",
    "let alone X",
    "to say nothing of X",
    "that is to say",
    "with that in mind",
    "on the contrary",
    "by the same token",
]


def get_total() -> int:
    try:
        with urllib.request.urlopen(COUNT_API, timeout=10) as resp:
            return int(json.loads(resp.read().decode("utf-8")).get("total", -1))
    except Exception:
        return -1


def post_chunk(input_str: str) -> dict:
    body = json.dumps({"input": input_str}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json", "Origin": ORIGIN},
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main(dry: bool) -> int:
    total = len(CANDIDATES)
    print(f"=== Batch 2: {total} candidate chunks ===")

    if dry:
        for i, c in enumerate(CANDIDATES, 1):
            print(f"  {i:3d}. {c}")
        print(f"\nTotal candidates: {total}")
        return 0

    before = get_total()
    print(f"(API: {API})  DB total before: {before}")
    print()

    stats = {"chunk": 0, "borderline": 0, "not_chunk": 0, "err": 0}
    rejected = []
    start = time.time()

    for i, c in enumerate(CANDIDATES, 1):
        elapsed = int(time.time() - start)
        d = None
        for attempt in range(MAX_RETRY_429 + 1):
            try:
                d = post_chunk(c)
                break
            except urllib.error.HTTPError as e:
                if e.code == 429 and attempt < MAX_RETRY_429:
                    time.sleep(8 * (attempt + 1))  # back off on rate limit / AI_BUSY
                    continue
                try:
                    reason = json.loads(e.read().decode("utf-8")).get("error", str(e))
                except Exception:
                    reason = str(e)
                stats["err"] += 1
                print(f"  {i:3d}/{total} [{elapsed:4d}s] ! HTTP {e.code} — {c}\n        {reason}")
                break
            except Exception as e:
                stats["err"] += 1
                print(f"  {i:3d}/{total} [{elapsed:4d}s] ! {type(e).__name__}: {e} — {c}")
                break

        if d is None:
            time.sleep(SLEEP_BETWEEN)
            continue

        v = d.get("verdict", "?")
        stats[v] = stats.get(v, 0) + 1
        marker = {"chunk": "✓", "borderline": "~", "not_chunk": "✗"}.get(v, "?")
        payload = d.get("payload") or {}
        canonical = payload.get("form") or ""
        cat = payload.get("category") or ""
        tail = f"[{cat}]" if cat else ""
        if canonical and canonical.lower() != c.lower():
            tail += f" → {canonical}"
        print(f"  {i:3d}/{total} [{elapsed:4d}s] {marker} {v:10} {c:42} {tail}")
        if v == "not_chunk":
            rejected.append((c, d.get("reason", "")))

        # Stop precisely at the target (count only changes on chunk/borderline).
        if STOP_AT is not None and v in ("chunk", "borderline"):
            if get_total() >= STOP_AT:
                print(f"\n  >> reached target {STOP_AT}; stopping early.")
                break

        time.sleep(SLEEP_BETWEEN)

    after = get_total()
    dur = int(time.time() - start)
    print()
    print(f"=== Summary ({dur}s) ===")
    print(f"  ✓ chunk:      {stats.get('chunk', 0)}")
    print(f"  ~ borderline: {stats.get('borderline', 0)}")
    print(f"  ✗ not_chunk:  {stats.get('not_chunk', 0)}")
    print(f"  ! errors:     {stats.get('err', 0)}")
    print(f"  DB total: {before} → {after}  (net +{after - before})")
    if rejected:
        print("\nRejected (not_chunk):")
        for c, r in rejected:
            print(f"  - {c!r}: {r}")
    return 0


if __name__ == "__main__":
    sys.exit(main("--dry" in sys.argv))
