# Legacy Windows-only XPI builder. Kept as a thin wrapper around
# scripts/build-xpi.mjs so the file list lives in one place.
#
# Prefer: node scripts/build-xpi.mjs
#
# There is deliberately no PowerShell fallback here. The previous version
# carried its own copy of the file list, which had to be hand-updated in
# lockstep with scripts/xpi-files.mjs — the exact drift the shared list exists
# to prevent. It also stamped live modification times, so its output could
# never match the published SHA-256. A clear error beats a silently wrong XPI.
#
# Arguments are forwarded, so `./build-xpi.ps1 --out-dir C:\tmp` works.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $root "scripts/build-xpi.mjs") @args
    exit $LASTEXITCODE
}

Write-Error "Node.js is required to build the XPI: https://nodejs.org (the 'zip' CLI is also needed)"
exit 1
