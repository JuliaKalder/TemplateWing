Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$manifest = Get-Content (Join-Path $root "manifest.json") | ConvertFrom-Json
$version = $manifest.version
$zipPath = Join-Path (Split-Path $root) "templatewing-$version-source.zip"

if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

$zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')

$files = @(
    "SOURCE_README.md"
    "manifest.json"
    "background.html"
    "background.js"
    "build-xpi.ps1"
    "LICENSE"
    "modules/template-store.js"
    "popup/popup.html"
    "popup/popup.css"
    "popup/popup.js"
    "options/options.html"
    "options/options.css"
    "options/options.js"
    "images/icon.svg"
    "images/icon-16.png"
    "images/icon-32.png"
    "images/icon-64.png"
    "images/icon-128.png"
    "_locales/en/messages.json"
    "_locales/de/messages.json"
)

foreach ($f in $files) {
    $fullPath = Join-Path $root ($f.Replace("/", "\"))
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $f) | Out-Null
    Write-Host "  + $f"
}

$zip.Dispose()

$info = Get-Item $zipPath
Write-Host "`nCreated: $($info.FullName) ($([math]::Round($info.Length / 1KB, 1)) KB)"
