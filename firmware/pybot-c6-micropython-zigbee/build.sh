#!/usr/bin/env bash
# Reproducible custom MicroPython + native Zigbee (uZigbee v1.6 PoC) build.
# Requires: ESP-IDF v5.3.2 exported, network for Component Registry + git clones.
#
# NEVER marks READY with app-only .bin at flashOffset 0.
# NEVER auto-flashes. NEVER redistributes Zigbee SDK binaries into git.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# shellcheck source=/dev/null
source "$ROOT/scripts/pins.env"

ARTIFACT_DIR="$ROOT/build-artifact"
mkdir -p "$ARTIFACT_DIR"

write_blocked() {
  local reason="$1"
  python3 - "$reason" "$ESP_IDF_TAG" "$MICROPYTHON_TAG" "$UZIGBEE_COMMIT" <<'PY'
import json, pathlib, sys
reason, idf, mpy, uz = sys.argv[1:5]
status = {
  "status": "BLOCKED",
  "reason": reason,
  "espIdfRequired": idf,
  "micropythonRequired": mpy,
  "uzigbeeCommit": uz,
  "espZigbeeLib": "~1.6.0",
  "espZbossLib": "~1.6.0",
  "target": "esp32c6",
  "filename": None,
  "sha256": None,
  "size": None,
  "packaging": None,
  "components": None,
  "nextStep": (
    "Install ESP-IDF v5.3.2, run scripts/fetch_upstream.sh, then "
    "third_party/uzigbee/tools/bootstrap_third_party.sh and re-run build.sh"
  ),
}
pathlib.Path("build-artifact/BUILD_STATUS.json").write_text(
  json.dumps(status, indent=2) + "\n", encoding="utf-8"
)
print("BLOCKED:", reason, file=sys.stderr)
PY
}

# Static gates always run first
python3 "$ROOT/scripts/validate_static.py" || {
  write_blocked "static validation failed"
  exit 1
}

if ! command -v idf.py >/dev/null 2>&1; then
  write_blocked "idf.py not found — install ESP-IDF ${ESP_IDF_TAG} and run: . \$IDF_PATH/export.sh"
  echo "BLOCKED: ESP-IDF not available (see build-artifact/BUILD_STATUS.json)" >&2
  exit 2
fi

IDF_VER="$(idf.py --version 2>/dev/null || true)"
if [[ "$IDF_VER" != *"${ESP_IDF_TAG}"* ]]; then
  write_blocked "Unsupported ESP-IDF version. Required ${ESP_IDF_TAG}, got: ${IDF_VER}"
  exit 2
fi

echo "Using: $IDF_VER"

# Fetch pinned uZigbee (MIT source only; SDK libs pulled by IDF component manager later)
bash "$ROOT/scripts/fetch_upstream.sh"

UZ="$ROOT/third_party/uzigbee"
if [[ ! -f "$UZ/build_firmware.sh" ]]; then
  write_blocked "uZigbee tree incomplete after fetch"
  exit 1
fi

# Overlay our Waveshare-oriented 4MB partition table into the upstream build tree
cp -f "$ROOT/partitions.csv" "$UZ/firmware/partitions.csv"

# Bootstrap MicroPython + IDF third_party pins inside uZigbee (large download)
if [[ ! -d "$UZ/third_party/micropython-esp32" ]]; then
  echo "[INFO] Bootstrapping uZigbee third_party (MicroPython ${MICROPYTHON_TAG})…"
  bash "$UZ/tools/bootstrap_third_party.sh" || {
    write_blocked "uZigbee bootstrap_third_party.sh failed — see console log"
    exit 1
  }
fi

BUILD_NAME="build-ESP32_GENERIC_C6-pybot-uzigbee"
(
  cd "$UZ"
  ./build_firmware.sh \
    --board "$BOARD" \
    --profile esp32-c6-devkit \
    --build "$BUILD_NAME" \
    --skip-submodules \
    --jobs "${JOBS:-$(nproc 2>/dev/null || echo 2)}"
) || {
  write_blocked "uZigbee build_firmware.sh failed — see console log for size/link errors"
  exit 1
}

BUILD_PATH="$UZ/third_party/micropython-esp32/ports/esp32/$BUILD_NAME"
BOOTLOADER_BIN="$BUILD_PATH/bootloader/bootloader.bin"
PARTITION_BIN="$BUILD_PATH/partition_table/partition-table.bin"
APP_BIN="$BUILD_PATH/micropython.bin"
FLASH_ARGS="$BUILD_PATH/flash_args"

for f in "$BOOTLOADER_BIN" "$PARTITION_BIN" "$APP_BIN" "$FLASH_ARGS"; do
  if [[ ! -f "$f" ]]; then
    write_blocked "Missing required build output: $f"
    exit 1
  fi
done

VERSION="$(tr -d '[:space:]' < VERSION)"
export VERSION ARTIFACT_DIR BOOTLOADER_BIN PARTITION_BIN APP_BIN FLASH_ARGS IDF_VER
export UZIGBEE_COMMIT MICROPYTHON_TAG ESP_IDF_TAG

python3 <<'PY'
import hashlib, json, os, pathlib, datetime

artifact_dir = pathlib.Path(os.environ["ARTIFACT_DIR"])
version = os.environ["VERSION"]
built_at = datetime.datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%SZ")

def sha256_file(path: pathlib.Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()

components_spec = [
    ("bootloader", 0x0, pathlib.Path(os.environ["BOOTLOADER_BIN"])),
    ("partition-table", 0x8000, pathlib.Path(os.environ["PARTITION_BIN"])),
    ("app", 0x10000, pathlib.Path(os.environ["APP_BIN"])),
]

# Prefer offsets from flash_args when present
flash_args_text = pathlib.Path(os.environ["FLASH_ARGS"]).read_text(encoding="utf-8", errors="replace")
parsed_offsets = {}
tokens = flash_args_text.replace("\n", " ").split()
i = 0
while i < len(tokens) - 1:
    tok = tokens[i]
    if tok.startswith("0x") or tok.isdigit():
        try:
            off = int(tok, 0)
            path = tokens[i + 1]
            base = path.replace("\\", "/").rsplit("/", 1)[-1].lower()
            if "bootloader" in base:
                parsed_offsets["bootloader"] = off
            elif "partition" in base:
                parsed_offsets["partition-table"] = off
            elif "micropython" in base or base.endswith(".bin"):
                if "bootloader" not in base and "partition" not in base:
                    parsed_offsets.setdefault("app", off)
            i += 2
            continue
        except ValueError:
            pass
    i += 1

components = []
have = {"bootloader": False, "partition-table": False, "app": False}
for role, default_off, src in components_spec:
    off = parsed_offsets.get(role, default_off)
    data = src.read_bytes()
    dest_name = f"pybot-c6-micropython-zigbee-{version}-{role}.bin"
    dest = artifact_dir / dest_name
    dest.write_bytes(data)
    have[role] = True
    components.append({
        "role": role,
        "filename": dest_name,
        "path": f"build-artifact/{dest_name}",
        "flashOffset": off,
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
    })

if not all(have.values()):
    raise SystemExit("incomplete flash components")

app = next(c for c in components if c["role"] == "app")
if app["flashOffset"] == 0:
    raise SystemExit("refusing app-only layout at flashOffset 0")

# Occupancy vs factory 0x390000
factory_size = 0x390000
app_size = app["size"]
occupancy_pct = round(100.0 * app_size / factory_size, 2)

status = {
    "status": "READY",
    "reason": None,
    "packaging": "multi-offset",
    "filename": app["filename"],
    "sha256": app["sha256"],
    "size": app_size,
    "flashOffset": app["flashOffset"],
    "path": app["path"],
    "components": components,
    "builtAt": built_at,
    "appOccupancyBytes": app_size,
    "factoryPartitionBytes": factory_size,
    "appOccupancyPercentOfFactory": occupancy_pct,
    "printedVersions": {
        "espIdf": os.environ.get("IDF_VER"),
        "espIdfTagRequired": os.environ.get("ESP_IDF_TAG"),
        "micropython": os.environ.get("MICROPYTHON_TAG"),
        "uzigbeeCommit": os.environ.get("UZIGBEE_COMMIT"),
        "espZigbeeLib": "~1.6.0",
        "espZbossLib": "~1.6.0",
    },
    "heapRamMargins": None,
    "note": "heap/RAM margins require on-device measurement; not fabricated here",
    "autoFlash": False,
}

(artifact_dir / "BUILD_STATUS.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")

# Mirror READY into versioned manifest.json (operator bump)
manifest_path = pathlib.Path("manifest.json")
manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
manifest["artifact"] = {
    "status": "READY",
    "blockReason": None,
    "filename": status["filename"],
    "sha256": status["sha256"],
    "size": status["size"],
    "flashOffset": status["flashOffset"],
    "builtAt": built_at,
    "path": status["path"],
    "packaging": "multi-offset",
    "components": components,
    "appOccupancyBytes": app_size,
    "factoryPartitionBytes": factory_size,
    "heapRamMargins": None,
    "printedVersions": status["printedVersions"],
}
# modeReady stays false until operator also validates boot on hardware — keep false
manifest["modeReady"] = False
manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

sums = artifact_dir / "SHA256SUMS.txt"
lines = [f"{c['sha256']}  {c['filename']}" for c in components]
sums.write_text("\n".join(lines) + "\n", encoding="utf-8")

print("[OK] multi-offset artifact READY (modeReady still false until hardware boot proof)")
print(f"[OK] app {app_size} bytes ({occupancy_pct}% of factory 0x{factory_size:x})")
for c in components:
    print(f"[OK] {c['role']} @ 0x{c['flashOffset']:x} sha256={c['sha256'][:12]}…")
PY

echo "Build complete. autoFlash=false. Do NOT flash from CI."
exit 0
