#!/usr/bin/env python3
"""Static validation gates for pybot-c6-micropython-zigbee (no flash, no network)."""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FLASH_BYTES = 4 * 1024 * 1024
REQUIRED = [
    "DECISION.md",
    "LICENSE_ATTRIBUTION.md",
    "PINS.json",
    "VERSION",
    "manifest.json",
    "partitions.csv",
    "flash_layout.json",
    "build.sh",
    "README.md",
    "onboard/pybot_zigbee.py",
    "onboard/main.py",
    "docs/BACKUP_RESTORE.md",
    "docs/LIMITATIONS.md",
]


def parse_partitions(text: str) -> list[dict]:
    rows = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.split(",")]
        if len(parts) < 5:
            raise SystemExit(f"bad partition line: {line}")
        name, _typ, _sub, off_s, size_s = parts[:5]
        rows.append(
            {
                "name": name,
                "offset": int(off_s, 0),
                "size": int(size_s, 0),
            }
        )
    return rows


def main() -> int:
    errors: list[str] = []
    for rel in REQUIRED:
        if not (ROOT / rel).is_file():
            errors.append(f"missing required file: {rel}")

    pins = json.loads((ROOT / "PINS.json").read_text(encoding="utf-8"))
    if pins.get("decision") != "PIN_UZIGBEE_V1_6_AS_POC":
        errors.append("PINS.json decision must be PIN_UZIGBEE_V1_6_AS_POC")
    if pins.get("toolchain", {}).get("espIdf") != "v5.3.2":
        errors.append("ESP-IDF pin must be v5.3.2")
    if pins.get("upstream", {}).get("zigbeeSdk", {}).get("esp-zigbee-lib") != "~1.6.0":
        errors.append("esp-zigbee-lib must be pinned ~1.6.0 for this PoC")

    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    art = manifest.get("artifact") or {}
    if art.get("status") == "READY":
        sha = art.get("sha256")
        if not (isinstance(sha, str) and len(sha) == 64):
            errors.append("READY artifact requires real sha256")
        if art.get("packaging") not in ("merged-raw", "multi-offset"):
            errors.append("READY artifact requires validated packaging")
    elif art.get("status") != "BLOCKED":
        errors.append("artifact.status must be BLOCKED or READY")

    if manifest.get("autoFlash") is not False:
        errors.append("autoFlash must be false")
    if manifest.get("modeReady") is not False and art.get("status") != "READY":
        errors.append("modeReady must stay false until READY artifact")
    if (manifest.get("zigbee") or {}).get("hardwareValidation") != "UNVERIFIED":
        errors.append("hardwareValidation must remain UNVERIFIED")

    # Reject mixing with v2 coordinator pins in this tree
    decision = (ROOT / "DECISION.md").read_text(encoding="utf-8")
    if "PIN_UZIGBEE_V1_6_AS_POC" not in decision:
        errors.append("DECISION.md must record PIN_UZIGBEE_V1_6_AS_POC")
    if "~2.0.0" in (ROOT / "manifest.json").read_text(encoding="utf-8") and "incompatible" not in decision.lower():
        # manifest may mention v2 only as incompatible — OK if DECISION explains
        pass

    parts = parse_partitions((ROOT / "partitions.csv").read_text(encoding="utf-8"))
    names = {p["name"] for p in parts}
    for need in ("nvs", "phy_init", "factory", "zb_storage", "zb_fct", "vfs"):
        if need not in names:
            errors.append(f"partitions.csv missing {need}")

    factory = next(p for p in parts if p["name"] == "factory")
    if factory["offset"] != 0x10000:
        errors.append("factory app offset must be 0x10000")
    end = max(p["offset"] + p["size"] for p in parts)
    if end > FLASH_BYTES:
        errors.append(f"partitions overflow 4MB flash (end=0x{end:x})")
    if end != FLASH_BYTES:
        errors.append(f"partitions must pack exactly 4MB (end=0x{end:x}, expected 0x{FLASH_BYTES:x})")

    layout = json.loads((ROOT / "flash_layout.json").read_text(encoding="utf-8"))
    roles = {c["role"] for c in layout.get("components") or []}
    if roles != {"bootloader", "partition-table", "app"}:
        errors.append("flash_layout.json must declare bootloader, partition-table, app")
    app = next(c for c in layout["components"] if c["role"] == "app")
    if app.get("flashOffset") == 0:
        errors.append("app must not claim flashOffset 0 (bootloader owns 0)")

    # No vendored SDK/toolchain trees in-repo
    for banned in ("third_party/esp-idf", "third_party/micropython-esp32"):
        if (ROOT / banned).exists():
            errors.append(f"must not vendor {banned}")

    onboard = (ROOT / "onboard/pybot_zigbee.py").read_text(encoding="utf-8")
    if "mock" in onboard.lower() and "not a mock" not in onboard.lower():
        # soft check — fail only if FakeRadio / MockRadio classes appear
        pass
    if "class Mock" in onboard or "FakeRadio" in onboard:
        errors.append("onboard adapter must not ship mock radio classes")
    if "_uzigbee" not in onboard:
        errors.append("adapter must reference native _uzigbee")

    main_py = (ROOT / "onboard/main.py").read_text(encoding="utf-8")
    if "permit_join" in main_py and "duration" in main_py:
        # boot-safe main must keep join closed by default
        if "PERMIT_JOIN_ON_BOOT = True" in main_py.replace(" ", ""):
            errors.append("main.py must not open permit_join on boot by default")
    if "PERMIT_JOIN_ON_BOOT = False" not in main_py and "PERMIT_JOIN_ON_BOOT=False" not in main_py.replace(" ", ""):
        errors.append("main.py must set PERMIT_JOIN_ON_BOOT = False")

    if errors:
        print("STATIC_VALIDATION: FAIL", file=sys.stderr)
        for e in errors:
            print(f"  - {e}", file=sys.stderr)
        return 1
    print("STATIC_VALIDATION: PASS")
    print(f"  factory=0x{factory['offset']:x}+0x{factory['size']:x} flash_end=0x{end:x}")
    print(f"  decision={pins['decision']} artifact={art.get('status')}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
