# Legacy Windows-only XPI builder. Kept as a thin wrapper around
# scripts/build-xpi.mjs so the file list lives in one place.
#
# Prefer: node scripts/build-xpi.mjs
#
# This script is retained because v2.6 release notes reference it; in v2.8+ it
# can go away if no users complain.

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Get-Command node -ErrorAction SilentlyContinue) {
    & node (Join-Path $root "scripts/build-xpi.mjs")
    exit $LASTEXITCODE
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$manifest = Get-Content (Join-Path $root "manifest.json") | ConvertFrom-Json
$version = $manifest.version
$xpiPath = Join-Path (Split-Path $root) "templatewing-$version.xpi"

if (Test-Path $xpiPath) { Remove-Item $xpiPath }

$zip = [System.IO.Compression.ZipFile]::Open($xpiPath, 'Create')

$files = @(
    "manifest.json"
    "background.html"
    "background.js"
    "LICENSE"
    "modules/template-store.js"
    "modules/template-insert.js"
    "modules/validation.js"
    "modules/compose-script.js"
    "modules/compose-utils.js"
    "modules/message-utils.js"
    "modules/ui-helpers.js"
    "modules/prompt-collector.js"
    "modules/template-lint.js"
    "modules/usage-stats.js"
    "popup/popup.html"
    "popup/popup.css"
    "popup/popup.js"
    "options/options.html"
    "options/options.css"
    "options/options.js"
    "prompt-dialog/dialog.html"
    "prompt-dialog/dialog.css"
    "prompt-dialog/dialog.js"
    "images/icon-16.png"
    "images/icon-32.png"
    "images/icon-64.png"
    "images/icon-128.png"
    "_locales/en/messages.json"
    "_locales/de/messages.json"
    "_locales/fr/messages.json"
    "_locales/es/messages.json"
    "_locales/it/messages.json"
    "_locales/nl/messages.json"
    "_locales/pt/messages.json"
)

foreach ($f in $files) {
    $fullPath = Join-Path $root ($f.Replace("/", "\"))
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $f) | Out-Null
    Write-Host "  + $f"
}

$zip.Dispose()

$info = Get-Item $xpiPath
Write-Host "`nCreated: $($info.FullName) ($([math]::Round($info.Length / 1KB, 1)) KB)"
