#!/usr/bin/env python3
"""One-shot importer: feed candidate chunks from PERO's chunks-handbook into
the WordLoom chunks API.

Filter standard ("not too simple"):
  - Must have a teaching trap: preposition lock / register lock / metaphor /
    inverted form / virtual subject / fixed slot — anything where a learner
    couldn't just look it up in a dictionary and write it correctly.
  - Free combinations (the answer to the question / show interest in /
    in addition / my favorite X) DROPPED — those are dictionary-level,
    no coreMechanic value.
  - The AI is_chunk filter is still the safety net (returns not_chunk for
    anything that slips through).

Usage:
  python3 tools/import-chunks.py          # run all
  python3 tools/import-chunks.py --dry    # just print the list
"""

import json
import sys
import time
import urllib.request
import urllib.error

API = "http://localhost:3001/api/chunks/generate"
ORIGIN = "http://localhost:3001"
SLEEP_BETWEEN = 0.4
TIMEOUT = 120

# ---------------------------------------------------------------------------
# Hand-curated, post-filter candidates from chunks-handbook.md
# Removed (too-simple collocations the learner can already produce):
#   §1 single-prep pairs · §3.1 basic delexical (show interest in, take part in,
#   pay attention to, keep in mind, get rid of, get used to) ·
#   §4 basic N+prep (the answer to, the solution to, the key to, the importance
#   of, awareness of, faith in, trust in, a problem with, concern about,
#   doubt about, pressure on, a relationship with) ·
#   §5 textbook discourse markers (However, In addition, On the other hand,
#   Therefore, As a result, For instance, For example, Indeed, In fact,
#   In contrast, Similarly, Likewise, In short, In other words, Specifically,
#   Notably, More importantly) ·
#   §3.2 generic intensifiers (extremely difficult, completely different) ·
#   §8 surface stems (from X point of view, my favorite X, introductory X
#   course, turn X into Y)
# ---------------------------------------------------------------------------

CANDIDATES = [
    # --- §2 Sentence stems with traps ---
    "There is no point in V-ing",
    "It's worth V-ing",
    "It's no use V-ing",
    "The best way to do X is to do Y",
    "We might as well V",
    "It would make sense to V",
    "The reason why X is that Y",
    "It follows that X",
    "Even though X",
    "Despite X",
    "In spite of X",
    "While X",
    "Whereas X",
    "Provided that X",
    "Had I done X, I would have done Y",
    "The more X, the more Y",
    "A is to B what C is to D",
    "Not so much X as Y",
    "It is X that Y",
    "What sb does is X",
    "Not until X did Y",
    "A is among Bs",
    "It's not just that X, it's also that Y",
    "What is X, after all, but Y",
    "nothing but X",
    "anything but X",
    "all but X",
    "cannot help but V",
    "To the extent that X",
    "Insofar as X",

    # --- §3.1 Delexical V+N (kept only trap-bearing) ---
    "make a difference",
    "make a case for X",
    "make an argument for X",
    "make a distinction",
    "take advantage of X",
    "take responsibility for X",
    "have an impact on X",
    "have a tendency to V",
    "give priority to X",
    "give rise to X",
    "give way to X",
    "pay tribute to X",
    "put emphasis on X",
    "put forward X",
    "keep an eye on X",
    "keep track of X",
    "keep up with X",
    "place emphasis on X",
    "lay stress on X",
    "put a premium on X",

    # --- §3.2 Intensifier collocations (highest teaching value) ---
    "deeply moved",
    "deeply rooted",
    "highly likely",
    "fully aware",
    "bitterly disappointed",

    # --- §3.3 Adv+V (register / intensifier locks) ---
    "firmly believe",
    "deeply regret",
    "dramatically change",
    "fundamentally differ",
    "heavily rely on X",

    # --- §4 Noun+prep (kept only G2-trap entries) ---
    "the approach to X",
    "the attitude toward X",
    "an alternative to X",
    "an exception to the rule",
    "the reason for X",
    "a passion for X",
    "responsibility for X",
    "confidence in X",
    "an increase in X",
    "a sense of X",
    "the effect on X",
    "the impact on X",
    "an influence on X",
    "an opinion on X",
    "emphasis on X",
    "familiarity with X",
    "an acquaintance with X",
    "advice on X",
    "research on X",

    # --- §5 Discourse markers (kept only register-locked / fixed-form) ---
    "Furthermore",
    "Moreover",
    "Not only X but also Y",
    "Nevertheless",
    "Nonetheless",
    "That being said",
    "Having said that",
    "Consequently",
    "Hence",
    "To illustrate",
    "A case in point is X",
    "In a nutshell",
    "In conclusion",
    "First and foremost",
    "Last but not least",
    "Granted, X",
    "Admittedly, X",
    "While it is true that X",
    "It is worth noting that X",

    # --- §6.1 Academic V+N ---
    "draw a distinction between A and B",
    "draw a parallel between A and B",
    "draw a conclusion from X",
    "draw attention to X",
    "draw inspiration from X",
    "reach a consensus on X",
    "reach a verdict on X",
    "offer an explanation for X",
    "offer insight into X",
    "put forward a proposal",
    "raise a question about X",
    "raise an objection to X",
    "raise concerns about X",
    "shed light on X",
    "cast doubt on X",
    "call into question X",
    "lend support to X",

    # --- §6.2 Academic preposition stems ---
    "on the assumption that X",
    "on the grounds that X",
    "on the premise that X",
    "on the basis of X",
    "in light of X",
    "in view of X",
    "in the wake of X",
    "in response to X",
    "with respect to X",
    "with a view to V-ing",
    "by virtue of X",
    "by means of X",
    "by way of X",
    "given that X",
    "contrary to X",
    "as opposed to X",

    # --- §6.3 Virtual-subject stems (hedged academic claims) ---
    "It is no exaggeration to say that X",
    "It goes without saying that X",
    "It stands to reason that X",
    "It is widely acknowledged that X",
    "It cannot be denied that X",
    "It is no coincidence that X",
    "It is hardly surprising that X",
    "It would be a mistake to V",
    "It is tempting to think that X, but Y",
    "There is little doubt that X",
    "There is no question that X",
    "There is reason to believe that X",
    "There is much to be said for X",
    "One could argue that X",
    "One might wonder whether X",

    # --- §6.4 Advanced concession ---
    "This is not to say that X",
    "While it may be true that X",
    "However plausible this may seem",
    "Far from V-ing",
    "Be that as it may",
    "For all their X",
    "Even granting that X",
    "Notwithstanding X",

    # --- §6.5 Academic causation ---
    "result from X",
    "stem from X",
    "arise from X",
    "account for X",
    "be attributed to X",

    # --- §6.6 Academic relation ---
    "have a bearing on X",
    "be at odds with X",
    "be consistent with X",
    "go hand in hand with X",
    "be intertwined with X",

    # --- §8 Recognition-side patterns (Pinker prologue traps) ---
    "in X terms",
    "the way things are",
    "Nothing that X can V",
    "all the more X",
    "with a growing sense of X",
    "seek to do X",
    "lead sb to do X",
    "lacking X",
    "struggle when V-ing",
    "vainly V-ing",
    "in V-ing",
    "be assigned X",
    "be perched",
    "explain X to Y",
    "steer X away from Y and toward Z",
    "intuitive feel for X",
    "a tenuous grasp of X",
    "ever since X has been Y",
    "the heart of X",
    "engage the human mind",
    "outdistance X",
    "in the position of V-ing",
    "in a position to V",
    "the writer's ear",
]


def post_chunk(input_str: str) -> dict:
    body = json.dumps({"input": input_str}).encode("utf-8")
    req = urllib.request.Request(
        API,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "Origin": ORIGIN,
        },
    )
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main(dry: bool) -> int:
    total = len(CANDIDATES)
    print(f"=== Importing {total} candidate chunks ===")
    print(f"(API: {API})")
    print()

    if dry:
        for i, c in enumerate(CANDIDATES, 1):
            print(f"  {i:3d}. {c}")
        print(f"\nTotal: {total}")
        return 0

    stats = {"chunk": 0, "borderline": 0, "not_chunk": 0, "err": 0}
    rejected = []

    start = time.time()
    for i, c in enumerate(CANDIDATES, 1):
        elapsed = int(time.time() - start)
        try:
            d = post_chunk(c)
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode("utf-8"))
                reason = err_body.get("error", str(e))
            except Exception:
                reason = str(e)
            stats["err"] += 1
            print(f"  {i:3d}/{total} [{elapsed:4d}s] ! HTTP {e.code} — {c}\n        {reason}")
            time.sleep(SLEEP_BETWEEN)
            continue
        except Exception as e:
            stats["err"] += 1
            print(f"  {i:3d}/{total} [{elapsed:4d}s] ! {type(e).__name__}: {e} — {c}")
            time.sleep(SLEEP_BETWEEN)
            continue

        v = d.get("verdict", "?")
        stats[v] = stats.get(v, 0) + 1
        marker = {"chunk": "✓", "borderline": "~", "not_chunk": "✗"}.get(v, "?")
        canonical = (d.get("payload") or {}).get("form") or ""
        if canonical and canonical.lower() != c.lower():
            tail = f"→ {canonical}"
        else:
            tail = ""
        print(f"  {i:3d}/{total} [{elapsed:4d}s] {marker} {v:10} {c} {tail}")
        if v == "not_chunk":
            rejected.append((c, d.get("reason", "")))

        time.sleep(SLEEP_BETWEEN)

    dur = int(time.time() - start)
    print()
    print(f"=== Summary ({dur}s) ===")
    print(f"  ✓ chunk:      {stats.get('chunk', 0)}")
    print(f"  ~ borderline: {stats.get('borderline', 0)}")
    print(f"  ✗ not_chunk:  {stats.get('not_chunk', 0)}")
    print(f"  ! errors:     {stats.get('err', 0)}")
    if rejected:
        print()
        print("Rejected (not_chunk):")
        for c, r in rejected:
            print(f"  - {c!r}: {r}")
    return 0


if __name__ == "__main__":
    dry = "--dry" in sys.argv
    sys.exit(main(dry))
