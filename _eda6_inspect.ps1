# EDA6 inspection script — run when Shell is available. No commit/push/.env.
$ErrorActionPreference = "Continue"
Set-Location "C:\Users\Naro\PyBot-Web"

Write-Host "=== 1. HEAD ==="
git rev-parse HEAD

Write-Host "=== 2. status --short ==="
git status --short

Write-Host "=== 3. branch ==="
git branch --show-current

$cmp = Join-Path $PWD "_eda6_cmp"
New-Item -ItemType Directory -Force -Path $cmp | Out-Null

$h0 = "0d44106ec8eee6520ed951b24183b699b424be4c"
$h1 = "ab2159515b3e4be8329d0c3715efe9f981882575"
$pre = "ef66bf00^"

git show "${h0}:src/assets/EDA6.py" | Out-File -Encoding utf8NoBOM (Join-Path $cmp "EDA6_0d44106.py")
git show "${h1}:src/assets/EDA6.py" | Out-File -Encoding utf8NoBOM (Join-Path $cmp "EDA6_ab21595.py")
git show "${pre}:src/assets/EDA6.py" | Out-File -Encoding utf8NoBOM (Join-Path $cmp "EDA6_pre_ef66.py")

Write-Host "=== 4. HASHES (SHA256) ==="
Get-FileHash "src\assets\EDA6.py", (Join-Path $cmp "EDA6_0d44106.py"), (Join-Path $cmp "EDA6_ab21595.py"), (Join-Path $cmp "EDA6_pre_ef66.py") -Algorithm SHA256 | Format-List

Write-Host "=== DIFF current vs 0d44106 ==="
git diff --no-index -- (Join-Path $cmp "EDA6_0d44106.py") "src\assets\EDA6.py"
Write-Host "exit:$LASTEXITCODE"

Write-Host "=== DIFF current vs ab21595 ==="
git diff --no-index -- (Join-Path $cmp "EDA6_ab21595.py") "src\assets\EDA6.py"
Write-Host "exit:$LASTEXITCODE"

Write-Host "=== DIFF current vs pre-ef66 ==="
git diff --no-index -- (Join-Path $cmp "EDA6_pre_ef66.py") "src\assets\EDA6.py"
Write-Host "exit:$LASTEXITCODE"

Write-Host "=== DIFF 0d44106 vs ab21595 ==="
git diff --no-index -- (Join-Path $cmp "EDA6_0d44106.py") (Join-Path $cmp "EDA6_ab21595.py")
Write-Host "exit:$LASTEXITCODE"

Write-Host "=== 5. parent ef66bf00 ==="
git rev-parse ef66bf00^

Write-Host "=== 6. ef66bf00 --stat ==="
git show ef66bf00 --stat

Write-Host "=== 7. ef66bf00 EDA6-related ==="
git show ef66bf00 -- src/assets/EDA6.py src/eda6Ensure.js src/hardwareBridge.js

Write-Host "=== 8. ca457230 --stat ==="
git show ca457230 --stat
Write-Host "=== ca457230 EDA6 ==="
git show ca457230 -- src/assets/EDA6.py src/eda6Ensure.js src/hardwareBridge.js

Write-Host "=== 9. restore if needed ==="
$diffPre = git diff --no-index --quiet -- (Join-Path $cmp "EDA6_pre_ef66.py") "src\assets\EDA6.py"; $code = $LASTEXITCODE
if ($code -ne 0) {
  Write-Host "CURRENT DIFFERS from pre-ef66 — restoring from ef66bf00^"
  git show "ef66bf00^:src/assets/EDA6.py" | Out-File -Encoding utf8NoBOM "src\assets\EDA6.py"
  Write-Host "RESTORED=yes"
} else {
  Write-Host "RESTORED=no (already identical to ef66bf00^)"
}

Write-Host "=== FINAL status ==="
git status --short
git rev-parse HEAD
