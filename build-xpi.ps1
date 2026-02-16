Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
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
    "popup/popup.html"
    "popup/popup.css"
    "popup/popup.js"
    "options/options.html"
    "options/options.css"
    "options/options.js"
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

$info = Get-Item $xpiPath
Write-Host "`nCreated: $($info.FullName) ($([math]::Round($info.Length / 1KB, 1)) KB)"
