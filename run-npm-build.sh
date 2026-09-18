#!/usr/bin/env bash
# Prefer: npm ci && npm run build
set -euo pipefail
cd "$(dirname "$0")"
npm ci
npm run build
