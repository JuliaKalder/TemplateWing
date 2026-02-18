# GEMINI.md - Project Context: TemplateWing

This file provides essential project context and instructions for AI agents working on TemplateWing.

## Project Overview
TemplateWing is a Thunderbird 128+ MailExtension (WebExtension-based) that allows users to save, manage, and reuse email templates, including rich text and file attachments, directly within the Thunderbird compose window.

### Main Technologies
- **Vanilla JavaScript (ES6 Modules)**: No bundlers, transpilers, or external libraries.
- **Thunderbird MailExtension APIs**: Uses the `messenger.*` namespace (e.g., `messenger.compose`, `messenger.storage`).
- **Storage**: `messenger.storage.local` with `unlimitedStorage` permission.
- **I18n**: Support for English (`en`) and German (`de`) via `_locales`.
- **UI**: Standard HTML/CSS for the popup and options (management) pages.

### Architecture
- **`manifest.json`**: Manifest V2 configuration, targeting Thunderbird 128.0+.
- **`background.js` / `background.html`**: Service layer for context menus and storage listeners.
- **`modules/template-store.js`**: Core data access layer (CRUD) for templates.
- **`popup/`**: The "Compose Action" interface for selecting and inserting templates.
- **`options/`**: The management interface for creating and editing templates.

---

## Building and Running

### Development Mode (Loading in Thunderbird)
1. Open Thunderbird.
2. Go to **Menu (≡)** -> **Add-ons and Themes** (`Ctrl+Shift+A`).
3. Click the **Gear icon (⚙)** -> **Debug Add-ons**.
4. Click **Load Temporary Add-on…** and select `manifest.json` from this directory.
5. Click **Inspect** to access the developer tools/console.

### Building the XPI (Package)
The XPI is a simple zip archive of the source files.

**Windows (PowerShell):**
```powershell
./build-xpi.ps1
```

**Linux / macOS / Bash:**
```bash
zip -r ../templatewing.xpi manifest.json background.html background.js LICENSE modules/ popup/ options/ images/ _locales/ -x ".*"
```

---

## Development Conventions

### 1. No External Dependencies
Rigorously maintain the "vanilla" nature of the project. Do not introduce npm packages, bundlers, or CSS preprocessors unless explicitly requested.

### 2. ES6 Modules
- Use `<script type="module">` in all HTML files.
- Export/Import logic using standard ES6 syntax.
- All code should remain unminified and readable.

### 3. API Namespace
- Always use the `messenger.*` namespace for Thunderbird-specific APIs.
- Avoid using `browser.*` or `chrome.*` unless a specific cross-compatibility reason exists (not currently the case).

### 4. Internationalization (i18n)
- All user-facing strings must be localized.
- Update both `_locales/en/messages.json` and `_locales/de/messages.json` for every new string.
- Use `messenger.i18n.getMessage()` in JS or `data-i18n` attributes in HTML (if the project's helper script supports it).

### 5. CSP & Security
- Do not use inline scripts or inline event handlers (e.g., `onclick="..."`) in HTML files to remain compliant with Content Security Policy (CSP).
- Use `addEventListener` in JS files instead.

### 6. Template Schema
Templates are stored as objects with the following structure:
```javascript
{
  id: string,          // Unique identifier
  name: string,        // User-friendly name
  subject: string,     // Default email subject
  body: string,        // Rich text (HTML) content
  attachments: Array,  // Attached file data
  createdAt: number,   // Timestamp
  updatedAt: number    // Timestamp
}
```
