# AI Chat Export

A browser extension for exporting conversations from **ChatGPT, Claude, Grok, and DeepSeek** to local Markdown and HTML files, with optional local copies of attachments.

Current version: **0.1.37**

## Supported providers

- ChatGPT — `chatgpt.com`
- Claude — `claude.ai`
- Grok — `grok.com`
- DeepSeek — `chat.deepseek.com`

The extension uses a shared export pipeline with provider-specific conversation, selection, and attachment adapters.

## Features

- Export the current active conversation branch from ChatGPT, Claude, Grok, or DeepSeek.
- Export all messages or select individual messages directly in the provider UI.
- Shift-click range selection for currently represented messages.
- Enable Markdown and HTML independently.
- Save supported uploads, generated images, audio, files, and provider-generated artifacts locally.
- Preserve original attachment filenames when the provider supplies them.
- Keep images clickable in Markdown and HTML.
- Preserve message date/time when available.
- Optionally omit the original conversation link from Markdown and HTML.
- Mark omitted beginning, internal gaps, and omitted end in partial Markdown/HTML exports.
- Optional separate folder for attachments.
- Long-export progress survives closing and reopening the extension popup.
- Cancel a long-running export without losing the current message selection.
- Download attachments concurrently while preserving deterministic export order.
- Use Blob/Object URL downloads for large ZIP archives instead of whole-archive base64 data URLs.
- Render supported math and Mermaid diagrams in exported HTML.
- Preserve Claude custom visual widgets as standalone SVG attachments when available.
- Shared Chromium and Firefox codebase with browser-specific release packaging.
- English and Russian UI.
- No external CSS or JavaScript is required by exported HTML.

## Installation

There is currently no browser-store release. Ready-to-use browser packages are attached to each GitHub Release.

### Chromium

1. Download `ai-chat-export-<version>-chromium.zip` from the latest GitHub Release.
2. Unpack the archive.
3. Open `chrome://extensions` in Chrome, Vivaldi, or another Chromium-based browser.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unpacked extension directory.
6. Open or refresh a supported conversation.
7. Click the extension button in the browser toolbar.

### Firefox

Firefox 140 or later is supported.

1. Download `ai-chat-export-<version>-firefox.zip` from the latest GitHub Release.
2. Unpack the archive.
3. Open `about:debugging`.
4. Choose **This Firefox** → **Load Temporary Add-on…**.
5. Select `manifest.json` from the unpacked extension directory.

The release archive is already packaged for Firefox; users do not need to run `scripts/package.sh`. Until the extension is distributed through Mozilla Add-ons or otherwise signed for Firefox, this installation is temporary and must be loaded again after restarting Firefox.

## Usage

1. Open a supported conversation in ChatGPT, Claude, Grok, or DeepSeek.
2. Click the extension button.
3. Optionally change the export filename and display names.
4. Choose Markdown and/or HTML.
5. Choose whether the original conversation link should be included.
6. Choose whether attachments should be downloaded and whether they should be placed in a separate folder.
7. Export the whole current branch, or enable message selection and choose only the messages you need.
8. Download the resulting ZIP archive. Long-running exports can be canceled from the popup before completion.

A typical export looks like this:

```text
My export.zip
├── My export.md
├── My export.html
└── My export/
    ├── image.png
    ├── photo.jpg
    ├── recording.mp3
    └── generated-file.zip
```

Only the formats enabled in the popup are included.

## Export behavior

The extension exports the provider's **currently active linear branch** where the provider exposes branch semantics. Alternative branches are intentionally not merged into one export. If two branches are needed, export them separately.

The editable export name controls the ZIP filename, exported document filenames, and attachment directory name. The heading inside Markdown and HTML uses the conversation title reported by the provider when available.

Partial exports insert neutral omission markers at the beginning, between non-contiguous selected fragments, and at the end when appropriate.

When attachment saving is disabled, Markdown and HTML still use the resolved attachment filenames and folder paths that would be used by a normal downloaded export; only the attachment bytes are omitted from the ZIP.

### Provider-specific handling

Provider APIs and page structures differ, so acquisition and normalization remain provider-specific.

- **ChatGPT:** conversation graph traversal, citations, uploads, generated images, sandbox artifacts, and ChatGPT file delivery.
- **Claude:** active-branch traversal, local resources, image galleries, and MCP/custom visual widgets captured as self-contained SVG when rendered by Claude.
- **Grok:** conversation history reconstruction, generated/search images, generated files, user assets, and Grok-specific response cards.
- **DeepSeek:** message parent traversal, visible reasoning/THINK content, files, uploaded image previews, and external images when retrievable.

See [Multi-platform architecture](.github/MULTI_PLATFORM_ARCHITECTURE.md) and [Provider internals](docs/provider-internals.md) for implementation details.

### Large archives

ZIP files are assembled in memory and saved through Blob/Object URLs instead of whole-archive base64 data URLs. Chromium creates the Blob/Object URL in an MV3 offscreen document, while Firefox creates it directly in its background document.

Both browser paths have been live-tested with a roughly **160 MB** ZIP containing **75 attachments**. The ZIP itself is still assembled in memory, so very large exports can require substantial browser RAM.

## Firefox support

Firefox support uses the same export, selection, rendering, attachment, and ZIP code as Chromium. Only the Manifest V3 background/download environment differs:

- Chromium uses a background service worker plus an offscreen document for Blob/Object URL creation.
- Firefox uses a Manifest V3 background script and creates Blob/Object URLs directly in the background document.

Release packaging is automated. `scripts/package.sh` produces two clean archives from the same source tree: a Chromium package with `background.service_worker` and `offscreen`, and a Firefox package with `background.scripts`, no `offscreen` permission, and Firefox-specific Gecko metadata. The Firefox package targets Firefox 140 or later.

The Firefox package declares the data categories it must handle to retrieve and export active conversations. Firefox presents this declaration through its built-in installation consent experience; the developer does not receive this data.

## Known limitations

- The extension depends on provider page structures and undocumented/internal endpoints. Provider changes may temporarily break some functionality.
- Attachment and external-image support varies by provider and content type; some externally referenced images may remain remote links instead of being downloaded.
- Shift-click range selection is limited to messages currently represented by the provider page DOM; full-branch selection is handled separately where possible.
- Very large exports are still assembled in memory and can require substantial RAM.
- Firefox packages from GitHub Releases are currently unsigned and therefore use Firefox's temporary add-on loading flow.

## Privacy

The extension runs locally in the browser.

It communicates with the supported chat service and related file/content-delivery hosts only as needed to read the current conversation and retrieve content requested for export. Some externally referenced images may be requested directly from their source URL when the provider exposes them that way.

The extension does not send conversation contents to a developer-controlled server and contains no analytics or telemetry.

Extension preferences and temporary per-session UI/cache state are stored using browser extension storage APIs. The offscreen document used by Chromium for large downloads is part of the extension and does not contact an external service by itself.

See the full [Privacy Policy](PRIVACY.md) for data-handling, retention, and store-disclosure details.

## Project structure

```text
.github/workflows/package.yml  GitHub Actions packaging workflow
.github/MULTI_PLATFORM_ARCHITECTURE.md
                               Provider-neutral architecture notes
_locales/                      UI translations
icons/                         Extension icons
scripts/package.sh             Chromium/Firefox package builder
scripts/package-smoke.py       Release-package content and manifest smoke test
async-pool.js                  Small bounded-concurrency worker pool
attachments.js                 Shared attachment discovery/normalization helpers
background.js                  Export orchestration, selection cache and download lifecycle
build-mode.js                  Development/release feature switches
platform.js                    Provider registry and adapter selection
chatgpt-*.js                   ChatGPT API, normalization and selection
claude-*.js                    Claude API, normalization, selection and visual capture
grok-*.js                      Grok API/history/normalization/selection
deepseek-*.js                  DeepSeek API/normalization/selection
content.js                     ChatGPT page integration and selection UI
conversation.js                ChatGPT conversation graph normalization
download-url.js                Cross-browser Blob/Object URL download helper
offscreen.html/js              Chromium MV3 Blob/Object URL host
popup.html / popup.js          Extension popup
render.js                      Markdown/HTML rendering
math-render.js                 Math rendering support
mermaid-*.js                   Mermaid rendering support
ordered-selection.js           Shared ordered-provider selection logic
selection-*.js                 Shared selection helpers/cache
vendor/                        Vendored renderer runtimes and licenses
tests/                         Vitest unit and regression tests
utils.js                       Shared helpers
zip.js                         ZIP writer
manifest.json                  Manifest V3 development manifest
```

## Acknowledgements

This extension exists thanks to Morgana, my ChatGPT assistant.

Without her persona, and without her help, I probably would never have started this project at all.

And she was the first to say: “If we were writing our own exporter…”

## Development

Vibe-coded with ChatGPT.

Requirements, product decisions, and real-world testing by the author; architecture, implementation, debugging, and refactoring developed collaboratively with ChatGPT.

The project uses plain JavaScript and Manifest V3 with no build system or runtime package dependencies. Vitest is used as a development dependency; KaTeX and Mermaid are prepared into vendored runtime files for HTML export rendering.

To install development dependencies and run the suite locally:

```bash
npm install
npm test
```

For local Chromium development, edit the files in the repository and click **Reload** for the extension on `chrome://extensions`. Refresh the open provider page after changes to its content scripts.

Working-tree development builds automatically include the normalized internal JSON snapshot in every export for diagnostics. Packaged Chromium/Firefox releases do not expose or generate this JSON file. Unpacked development installs also expose an attachment-concurrency selector (1–10, default 3); normal packaged/store installs use 10 concurrent attachment downloads.

To build browser-specific archives locally on a Unix-like environment:

```bash
bash scripts/package.sh
```

The resulting archives are written to `dist/`.

For release packaging, pushing a tag such as `v0.1.38` runs the GitHub Actions packaging workflow. The workflow verifies that the tag matches the version in `manifest.json`, builds both browser archives, and creates a **draft GitHub Release** with both ZIP files attached. The draft can then be reviewed and published manually.

Pull requests also run the packaging workflow as a validation check. After both browser ZIPs are built, a smoke test verifies their file allowlist, release feature switches, and browser-specific manifest rules before the packages are exposed as a workflow artifact.

## License

Licensed under the [MIT License](LICENSE).

## Disclaimer

AI Chat Export is an independent project and is not affiliated with or endorsed by OpenAI, Anthropic, xAI, or DeepSeek.

ChatGPT, Claude, Grok, DeepSeek, and the respective company names and marks belong to their owners.
