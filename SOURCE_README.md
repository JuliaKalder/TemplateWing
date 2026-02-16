# TemplateWing — Source Code & Build Instructions

## Overview

TemplateWing is a Thunderbird 128+ MailExtension (WebExtension-based).
The source code is plain, unminified, untranspiled vanilla JavaScript.
No bundler, transpiler, or preprocessor is used. The XPI contains the
source files as-is.

## Build Environment

- **OS:** Any (Windows, macOS, Linux)
- **Required software:** PowerShell (included in Windows 10+) or any
  zip utility

## Building the XPI

### Option A: PowerShell script (Windows)

```powershell
powershell -ExecutionPolicy Bypass -File build-xpi.ps1
```

This creates `templatewing-<version>.xpi` in the parent directory.

### Option B: Manual zip (any OS)

From the project root:

```bash
zip -r ../templatewing.xpi manifest.json background.html background.js \
  LICENSE modules/ popup/ options/ images/ _locales/ \
  -x ".*" -x "*.md" -x "build-xpi.ps1"
```

## Included Files

```
manifest.json              — Extension manifest (Manifest V2)
background.html            — Background page (loads background.js)
background.js              — Context menu, message listeners
modules/template-store.js  — CRUD operations for storage.local
popup/popup.html           — Compose-action popup UI
popup/popup.css            — Popup styles
popup/popup.js             — Popup logic (list & insert templates)
options/options.html       — Options/template editor UI
options/options.css        — Options styles
options/options.js         — Template editor logic
images/icon-*.png          — Extension icons (16, 32, 64, 128 px)
images/icon.svg            — Icon source (SVG)
_locales/en/messages.json  — English strings
_locales/de/messages.json  — German strings
LICENSE                    — Mozilla Public License 2.0
build-xpi.ps1             — Build script for XPI packaging
```

## Notes

- No external dependencies or libraries are used.
- All JavaScript is vanilla ES6 modules (`<script type="module">`).
- The distributed XPI is byte-identical to a zip of these source files.
