#!/usr/bin/env bash
# Reproducible build for PyBot ESP32-C6 Zigbee coordinator.
# Requires: ESP-IDF v5.5.4 exported (idf.py on PATH), network for Component Registry.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

ARTIFACT_DIR="$ROOT/build-artifact"
mkdir -p "$ARTIFACT_DIR"

if ! command -v idf.py >/dev/null 2>&1; then
  cat >"$ARTIFACT_DIR/BUILD_STATUS.json" <<'EOF'
{
  "status": "BLOCKED",
  "reason": "idf.py not found — install ESP-IDF v5.5.4 and run: . $IDF_PATH/export.sh",
  "espIdfRequired": "v5.5.4",
  "espZigbeeLib": "~2.0.0",
  "target": "esp32c6"
}
EOF
  echo "BLOCKED: ESP-IDF not available (see build-artifact/BUILD_STATUS.json)" >&2
  exit 2
fi

IDF_VER="$(idf.py --version 2>/dev/null || true)"
echo "Using: $IDF_VER"

idf.py set-target esp32c6
idf.py build

APP_BIN="$(python3 - <<'PY'
import json, os
p = "build/flasher_args.json"
if os.path.isfile(p):
    d = json.load(open(p))
    for _off, path in d.get("flash_files", {}).items():
        if path.endswith(".bin") and "bootloader" not in path and "partition" not in path:
            print(path)
            break
PY
)"

if [[ -z "${APP_BIN}" || ! -f "${APP_BIN}" ]]; then
  APP_BIN="$(find build -maxdepth 1 -name '*.bin' ! -name 'bootloader.bin' ! -name 'partition-table.bin' | head -1 || true)"
fi

if [[ -z "${APP_BIN}" || ! -f "${APP_BIN}" ]]; then
  echo "ERROR: built app binary not found" >&2
  exit 1
fi

VERSION="$(tr -d '[:space:]' < VERSION)"
OUT_NAME="pybot-esp32c6-zigbee-coordinator-${VERSION}.bin"
cp -f "$APP_BIN" "$ARTIFACT_DIR/$OUT_NAME"
SHA="$(sha256sum "$ARTIFACT_DIR/$OUT_NAME" | awk '{print $1}')"
SIZE="$(wc -c < "$ARTIFACT_DIR/$OUT_NAME" | tr -d ' ')"
BUILT_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

export OUT_NAME SHA SIZE BUILT_AT IDF_VER
python3 <<'PY'
import json, os, pathlib
man = json.loads(pathlib.Path("manifest.json").read_text())
man["artifact"] = {
  "status": "READY",
  "blockReason": None,
  "filename": os.environ["OUT_NAME"],
  "sha256": os.environ["SHA"],
  "size": int(os.environ["SIZE"]),
  "flashOffset": 0,
  "builtAt": os.environ["BUILT_AT"],
  "path": f"build-artifact/{os.environ['OUT_NAME']}",
}
pathlib.Path("manifest.json").write_text(json.dumps(man, indent=2) + "\n")
pathlib.Path("build-artifact/BUILD_STATUS.json").write_text(json.dumps({
  "status": "READY",
  "filename": os.environ["OUT_NAME"],
  "sha256": os.environ["SHA"],
  "size": int(os.environ["SIZE"]),
  "espIdf": os.environ.get("IDF_VER", ""),
}, indent=2) + "\n")
print(f"READY sha256={os.environ['SHA']} size={os.environ['SIZE']} file=build-artifact/{os.environ['OUT_NAME']}")
PY
