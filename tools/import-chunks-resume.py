#!/usr/bin/env python3
"""Resume runner for batch 2 after the example-register normalizer fix.

Reuses ALL logic from import-chunks-batch2.py (post, retry, summary) and only
trims the candidate list to those not yet successfully imported, so we don't
pay for redundant calls. Safe to re-run (server upserts by form+category).
"""
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("b2", "tools/import-chunks-batch2.py")
b2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(b2)

# Successfully imported before the fix (16 from the partial run) + the one
# re-verified manually after the fix. Everything else (incl. the 5 other
# register-drops) re-runs.
DONE = {
    "take X into consideration",
    "bear in mind that X",
    "come to terms with X",
    "play a role in X",
    "take steps to V",
    "carry out X",
    "bring about X",
    "pose a threat to X",
    "fall short of X",
    "live up to X",
    "run the risk of V-ing",
    "bring X to light",
    "set out to V",
    "lay the groundwork for X",
    "strike a balance between X and Y",
    "exercise caution",
    "take its toll on X",
}

b2.CANDIDATES = [c for c in b2.CANDIDATES if c not in DONE]
b2.STOP_AT = 300  # stop precisely when the library reaches 300
sys.exit(b2.main("--dry" in sys.argv))
