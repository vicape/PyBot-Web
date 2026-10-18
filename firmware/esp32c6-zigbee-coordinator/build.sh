#!/usr/bin/env bash
# Reproducible build for PyBot ESP32-C6 Zigbee coordinator.
# Requires: ESP-IDF v5.5.4 exported (idf.py on PATH), network for Component Registry.
#
# Packaging rule (ESP32-C6): NEVER mark READY with an app-only .bin at flashOffset 0.
# Produce either:
#   - merged raw image via `idf.py merge-bin -f raw` (flash at offset 0), or
#   - multi-file bundle with bootloader + partition-table + app at official offsets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ARTIFACT_DIR="$ROOT/build-artifact"
mkdir -p "$ARTIFACT_DIR"

write_blocked() {
  # No-IDF / pre-build guard: status file only — do not invent filename/hash
  # and do not mutate the versioned manifest mirror (JS stays in sync in-repo).
  local reason="$1"
  python3 - "$reason" <<'PY'
import json, pathlib, sys
reason = sys.argv[1]
status = {
  "status": "BLOCKED",
  "reason": reason,
  "espIdfRequired": "v5.5.4",
  "espZigbeeLib": "~2.0.0",
  "target": "esp32c6",
  "filename": None,
  "sha256": None,
  "size": None,
}
pathlib.Path("build-artifact/BUILD_STATUS.json").write_text(
  json.dumps(status, indent=2) + "\n"
)
print("BLOCKED", file=sys.stderr)
PY
}

if ! command -v idf.py >/dev/null 2>&1; then
  write_blocked "idf.py not found — install ESP-IDF v5.5.4 and run: . \$IDF_PATH/export.sh"
  echo "BLOCKED: ESP-IDF not available (see build-artifact/BUILD_STATUS.json)" >&2
  exit 2
fi

IDF_VER="$(idf.py --version 2>/dev/null || true)"
echo "Using: $IDF_VER"

idf.py set-target esp32c6
idf.py build

# Official flash map from the build (bootloader + partition table + app).
if [[ ! -f build/flasher_args.json ]]; then
  write_blocked "flasher_args.json missing after build — incomplete IDF output"
  exit 1
fi

VERSION="$(tr -d '[:space:]' < VERSION)"
MERGED_NAME="pybot-esp32c6-zigbee-coordinator-${VERSION}-merged.bin"
MERGED_PATH="$ARTIFACT_DIR/$MERGED_NAME"

# Prefer fused/merged raw image flashable at offset 0 (idf.py merge-bin).
MERGE_OK=0
if idf.py merge-bin -o "$MERGED_PATH" -f raw; then
  if [[ -f "$MERGED_PATH" ]]; then
    MERGE_OK=1
  fi
fi

export VERSION MERGED_NAME MERGED_PATH IDF_VER ARTIFACT_DIR MERGE_OK
python3 <<'PY'
import hashlib, json, os, pathlib, sys

artifact_dir = pathlib.Path(os.environ["ARTIFACT_DIR"])
merged_path = pathlib.Path(os.environ["MERGED_PATH"])
merge_ok = os.environ.get("MERGE_OK") == "1"
idf_ver = os.environ.get("IDF_VER", "")
version = os.environ["VERSION"]
built_at = __import__("datetime").datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

flasher = json.loads(pathlib.Path("build/flasher_args.json").read_text())
flash_files = flasher.get("flash_files") or {}

def classify(path: str) -> str:
    lower = path.replace("\\", "/").lower()
    base = lower.rsplit("/", 1)[-1]
    if "bootloader" in base:
        return "bootloader"
    if "partition" in base:
        return "partition-table"
    return "app"

components = []
have = {"bootloader": False, "partition-table": False, "app": False}
for off_s, rel in sorted(flash_files.items(), key=lambda kv: int(str(kv[0]), 0)):
    off = int(str(off_s), 0)
    src = pathlib.Path(rel)
    if not src.is_file():
        src = pathlib.Path("build") / rel
    if not src.is_file():
        print(f"ERROR: missing flash component {rel}", file=sys.stderr)
        sys.exit(1)
    data = src.read_bytes()
    role = classify(str(src))
    have[role] = True
    dest_name = f"pybot-esp32c6-zigbee-coordinator-{version}-{role}.bin"
    dest = artifact_dir / dest_name
    dest.write_bytes(data)
    components.append({
        "role": role,
        "filename": dest_name,
        "path": f"build-artifact/{dest_name}",
        "flashOffset": off,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    })

if not (have["bootloader"] and have["partition-table"] and have["app"]):
    reason = (
        "Incomplete flash layout — bootloader, partition-table, and app are all required; "
        f"found bootloader={have['bootloader']} partition-table={have['partition-table']} app={have['app']}"
    )
    status = {
        "status": "BLOCKED",
        "reason": reason,
        "espIdfRequired": "v5.5.4",
        "espZigbeeLib": "~2.0.0",
        "target": "esp32c6",
        "filename": None,
        "sha256": None,
        "size": None,
        "espIdf": idf_ver,
    }
    (artifact_dir / "BUILD_STATUS.json").write_text(json.dumps(status, indent=2) + "\n")
    man = json.loads(pathlib.Path("manifest.json").read_text())
    man["artifact"] = {
        "status": "BLOCKED",
        "blockReason": reason,
        "filename": None,
        "sha256": None,
        "size": None,
        "flashOffset": None,
        "builtAt": built_at,
        "path": None,
        "packaging": None,
        "components": components or None,
    }
    pathlib.Path("manifest.json").write_text(json.dumps(man, indent=2) + "\n")
    print("BLOCKED: missing required flash components", file=sys.stderr)
    sys.exit(1)

# App-only at offset 0 is forbidden. Prefer merged raw @ 0; else multi-offset bundle.
if merge_ok and merged_path.is_file():
    data = merged_path.read_bytes()
    # Sanity: merged image must be larger than app-only and include bootloader region.
    app_comp = next(c for c in components if c["role"] == "app")
    if len(data) <= app_comp["size"]:
        reason = "merge-bin output is not larger than app-only — refusing unsafe READY"
        status = {
            "status": "BLOCKED",
            "reason": reason,
            "espIdf": idf_ver,
            "filename": None,
            "sha256": None,
            "size": None,
        }
        (artifact_dir / "BUILD_STATUS.json").write_text(json.dumps(status, indent=2) + "\n")
        man = json.loads(pathlib.Path("manifest.json").read_text())
        man["artifact"] = {
            "status": "BLOCKED",
            "blockReason": reason,
            "filename": None,
            "sha256": None,
            "size": None,
            "flashOffset": None,
            "builtAt": built_at,
            "path": None,
            "packaging": None,
            "components": components,
        }
        pathlib.Path("manifest.json").write_text(json.dumps(man, indent=2) + "\n")
        print("BLOCKED: invalid merged image", file=sys.stderr)
        sys.exit(1)

    sha = hashlib.sha256(data).hexdigest()
    size = len(data)
    out_name = os.environ["MERGED_NAME"]
    packaging = "merged-raw"
    flash_offset = 0
    primary_path = f"build-artifact/{out_name}"
else:
    # Multi-file bundle with official per-component offsets (not app-only @ 0).
    packaging = "multi-offset"
    flash_offset = None
    out_name = None
    sha = None
    size = None
    primary_path = None
    # Bundle index for operators
    bundle = {
        "packaging": packaging,
        "components": components,
        "note": "Flash each component at its flashOffset (esptool write_flash). Do not flash app alone at 0.",
    }
    (artifact_dir / "FLASH_BUNDLE.json").write_text(json.dumps(bundle, indent=2) + "\n")

man = json.loads(pathlib.Path("manifest.json").read_text())
man["artifact"] = {
    "status": "READY",
    "blockReason": None,
    "filename": out_name,
    "sha256": sha,
    "size": size,
    "flashOffset": flash_offset,
    "builtAt": built_at,
    "path": primary_path,
    "packaging": packaging,
    "components": components,
    "source": {
        "project": "firmware/esp32c6-zigbee-coordinator",
        "idfVersion": idf_ver,
        "espZigbeeLib": "~2.0.0",
        "target": "esp32c6",
    },
}
pathlib.Path("manifest.json").write_text(json.dumps(man, indent=2) + "\n")

status = {
    "status": "READY",
    "filename": out_name,
    "sha256": sha,
    "size": size,
    "flashOffset": flash_offset,
    "packaging": packaging,
    "components": components,
    "espIdf": idf_ver,
}
(artifact_dir / "BUILD_STATUS.json").write_text(json.dumps(status, indent=2) + "\n")

if packaging == "merged-raw":
    print(f"READY packaging=merged-raw sha256={sha} size={size} file={primary_path} flashOffset=0")
else:
    print(
        "READY packaging=multi-offset components="
        + ",".join(f"{c['role']}@0x{c['flashOffset']:x}" for c in components)
    )
PY
