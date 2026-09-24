#!/usr/bin/env python3
"""Scan a unified diff for git-diff-check issues; write hits to .ws-hits.txt"""
from pathlib import Path

PATCH = Path("/home/runner/work/_temp/maxwell-208/changes.patch")
OUT = Path("/home/runner/work/cursor-control/cursor-control/target/.ws-hits.txt")

hits = []
current = None
for i, raw in enumerate(PATCH.read_bytes().splitlines(True), 1):
    line = raw.decode("utf-8", "replace")
    if line.startswith("+++ b/"):
        current = line[6:].rstrip("\r\n")
        continue
    if line.startswith("+") and not line.startswith("+++"):
        body = line[1:].rstrip("\r\n")
        reasons = []
        if body.endswith(" ") or body.endswith("\t"):
            reasons.append("trailing_whitespace")
        if body.startswith("<<<<<<< ") or body.startswith("<<<<<<<\t") or body == "<<<<<<<":
            reasons.append("conflict")
        if body.startswith(">>>>>>> ") or body == ">>>>>>>":
            reasons.append("conflict")
        if body.startswith("======="):
            reasons.append("conflict")
        if body != body.rstrip(" \t") or (body and body.strip() == "" and body != ""):
            # blank line with spaces: '+' followed by spaces/tabs only
            if body != "" and body.strip() == "":
                reasons.append("blank_with_ws")
        if reasons:
            hits.append(f"{i}\t{current}\t{','.join(sorted(set(reasons)))}\t{body!r}\n")

OUT.write_text(f"hits={len(hits)}\n" + "".join(hits), encoding="utf-8")
print(f"wrote {len(hits)} hits to {OUT}")
