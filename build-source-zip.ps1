# Legacy Windows-only source-archive builder. Kept as a thin wrapper around
# scripts/build-source-zip.mjs so the file list lives in one place.
#
# Prefer: node scripts/build-source-zip.mjs
#
# The previous version of this script carried its own hand-maintained file
# list, which fell behind the XPI and shipped incomplete source to reviewers.
# There is deliberately no PowerShell fallback list here — an out-of-date
# source archive is worse than a clear error telling you to install Node.

# Arguments are forwarded, so `./build-source-zip.ps1 --out-dir C:\tmp` works.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $root "scripts/build-source-zip.mjs") @args
    exit $LASTEXITCODE
}

Write-Error "Node.js is required to build the source archive: https://nodejs.org (the 'zip' CLI is also needed)"
exit 1
