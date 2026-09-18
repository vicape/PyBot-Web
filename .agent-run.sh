#!/usr/bin/env bash
set -euo pipefail
cd /home/runner/work/cursor-control/cursor-control/pybot
echo "=== STEP1: npm ci ==="
npm ci 2>&1 | tee /tmp/npm-ci.out
echo "EXIT_CODE_CI:${PIPESTATUS[0]}"
echo "=== STEP2: npm run build ==="
npm run build 2>&1 | tee /tmp/npm-build.out
echo "EXIT_CODE_BUILD:${PIPESTATUS[0]}"
if [[ "${PIPESTATUS[0]:-1}" -eq 0 ]] || [[ -d dist ]]; then
  echo "=== STEP3: viewport validate ==="
  npx --yes playwright-core 2>/dev/null || true
  if ! node -e "require('playwright-core')" 2>/dev/null && ! node -e "import('playwright-core')" 2>/dev/null; then
    npm i -D playwright-core
    npx playwright install-deps chromium || npx playwright install chromium
  fi
  node scripts/validate-login-viewport.mjs 2>&1 | tee /tmp/viewport.out
  echo "EXIT_CODE_VIEWPORT:${PIPESTATUS[0]}"
fi
echo "=== DONE ==="
