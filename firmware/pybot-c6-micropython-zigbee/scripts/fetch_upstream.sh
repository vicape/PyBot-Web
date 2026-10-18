#!/usr/bin/env bash
# Fetch pinned uZigbee sources into ignored third_party/ (no SDK binary redistribution).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "$ROOT/scripts/pins.env"

TP="$ROOT/third_party"
UZ_DIR="$TP/uzigbee"
mkdir -p "$TP"

if [[ -d "$UZ_DIR/.git" ]]; then
  git -C "$UZ_DIR" fetch --depth 1 origin "$UZIGBEE_COMMIT" || git -C "$UZ_DIR" fetch origin
  git -C "$UZ_DIR" checkout -f "$UZIGBEE_COMMIT"
else
  rm -rf "$UZ_DIR"
  git clone --filter=blob:none "$UZIGBEE_REPO" "$UZ_DIR"
  git -C "$UZ_DIR" checkout -f "$UZIGBEE_COMMIT"
fi

GOT="$(git -C "$UZ_DIR" rev-parse HEAD)"
if [[ "$GOT" != "$UZIGBEE_COMMIT" ]]; then
  echo "ERROR: uZigbee HEAD $GOT != pinned $UZIGBEE_COMMIT" >&2
  exit 1
fi

echo "[OK] uZigbee pinned at $GOT"
echo "[OK] ESP-IDF required: $ESP_IDF_TAG"
echo "[OK] MicroPython required: $MICROPYTHON_TAG"
echo "[OK] Zigbee libs: esp-zigbee-lib $ESP_ZIGBEE_LIB / esp-zboss-lib $ESP_ZBOSS_LIB"
