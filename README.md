# ChatGPT Export to Markdown & HTML

A browser extension for exporting the current ChatGPT conversation branch to local Markdown, HTML and JSON files, with attachments saved alongside the export.

Current version: **0.1.32**

## Features

- Export the current ChatGPT branch — no full conversation tree.
- Export all messages or select individual messages directly in the ChatGPT UI.
- Shift-click range selection for currently represented messages.
- Markdown, HTML and JSON can be enabled independently.
- Save user uploads, generated images, audio/files and ChatGPT-created `sandbox:/mnt/data/...` artifacts locally.
- Preserve original attachment filenames when ChatGPT provides them.
- Keep images clickable in Markdown and HTML.
- Resolve ChatGPT web citation markers to normal links.
- Preserve local message date/time in human-readable exports and UTC timestamps in JSON.
- Use the original ChatGPT page title inside Markdown/HTML while allowing a separate editable archive name.
- Keep edited export names as per-conversation session drafts while the popup is closed and reopened.
- Optionally omit the original ChatGPT conversation link from Markdown, HTML and JSON.
- Mark omitted beginning, internal gaps and omitted end in partial Markdown/HTML exports; JSON carries matching omission metadata.
- Optional separate folder for attachments.
- Long-export progress survives closing and reopening the extension popup.
- Cache the logical message-selection index for faster popup reopening while keeping export contents authoritative from a fresh conversation fetch.
- Use Blob/Object URL downloads for large ZIP archives instead of base64 data URLs.
- Shared Chromium and Firefox codebase with browser-specific release packaging.
- English and Russian UI.
- No external CSS or JavaScript is required by exported HTML.

## Installation

There is currently no browser-store release. Ready-to-use browser packages are attached to each GitHub Release.

### Chromium

1. Download `chatgpt-export-md-html-<version>-chromium.zip` from the latest GitHub Release.
2. Unpack the archive.
3. Open `chrome://extensions` in Chrome, Vivaldi or another Chromium-based browser.
4. Enable **Developer mode**.
5. Click **Load unpacked** and select the unpacked extension directory.
6. Open or refresh a conversation on `https://chatgpt.com/`.
7. Click the extension button in the browser toolbar.

### Firefox

Firefox 128 or later is supported.

1. Download `chatgpt-export-md-html-<version>-firefox.zip` from the latest GitHub Release.
2. Unpack the archive.
3. Open `about:debugging`.
4. Choose **This Firefox** → **Load Temporary Add-on…**.
5. Select `manifest.json` from the unpacked extension directory.

The release archive is already packaged for Firefox; users do not need to run `scripts/package.sh`. Until the extension is distributed through Mozilla Add-ons or otherwise signed for Firefox, this installation is temporary and must be loaded again after restarting Firefox.

## Usage

1. Open a ChatGPT conversation.
2. Click the extension button.
3. Optionally change the export filename and display names.
4. Choose Markdown, HTML and/or JSON.
5. Choose whether the original ChatGPT conversation link should be included.
6. Choose whether attachments should be downloaded and whether they should be placed in a separate folder.
7. Export the whole current branch, or enable message selection and choose only the messages you need.
8. Download the resulting ZIP archive.

A typical export looks like this:

```text
My export.zip
├── My export.md
├── My export.html
├── My export.json
└── My export/
    ├── image-gen-1.png
    ├── photo.jpg
    ├── recording.mp3
    └── generated-file.zip
```

Only the formats enabled in the popup are included.

## Export behavior

The extension exports the **currently selected linear branch** of the conversation. Alternative branches are intentionally not included. If two branches are needed, export them separately.

The editable export name controls the ZIP filename, exported document filenames and attachment directory name. The heading inside Markdown and HTML uses the original ChatGPT page title, including the project name when available.

Partial exports insert neutral omission markers at the beginning, between non-contiguous selected fragments, and at the end when appropriate. JSON records the same structure with `omittedBefore` and `omittedAfter` flags.

When attachment saving is disabled, Markdown and HTML still use the same resolved attachment filenames and folder paths as a normal downloaded export; only the attachment bytes are omitted from the ZIP.

### Large archives

ZIP files are assembled in memory and saved through Blob/Object URLs instead of whole-archive base64 data URLs. Chromium creates the Blob/Object URL in an MV3 offscreen document, while Firefox creates it directly in its background document.

This avoids the previous whole-archive binary-string/base64/data-URL conversion, which multiplied memory usage and could terminate the browser on large image-heavy exports. Both the Chromium and Firefox paths have been live-tested with a roughly **160 MB** ZIP containing **75 attachments**.

The ZIP itself is still assembled in memory, so very large exports can use several gigabytes of browser RAM while attachments are downloaded and the archive is built. Further streaming/memory optimization is possible if larger real-world exports require it.

## Firefox support

Firefox support uses the same export, selection, rendering, attachment and ZIP code as Chromium. Only the Manifest V3 background/download environment differs:

- Chromium uses a background service worker plus an offscreen document for Blob/Object URL creation.
- Firefox uses a Manifest V3 background script and creates Blob/Object URLs directly in the background document.

Release packaging is automated. `scripts/package.sh` produces two clean archives from the same source tree: a Chromium package with `background.service_worker` and `offscreen`, and a Firefox package with `background.scripts`, no `offscreen` permission and Firefox-specific Gecko metadata. The Firefox package targets Firefox 128 or later.

Both packaged variants have been live-tested without manifest warnings. Firefox testing has covered normal export, selective-message export, attachment saving and a roughly 160 MB / 75-attachment stress test.

## Known limitations

- The extension depends on ChatGPT's current DOM structure and undocumented internal endpoints. Changes to ChatGPT may temporarily break some functionality.
- External web images referenced by an assistant response can remain remote links instead of being downloaded into the archive.
- Audio transcription text shown by ChatGPT is not currently exported separately.
- Shift-click range selection is limited to messages currently represented by the ChatGPT page DOM; full-branch selection itself is handled independently of DOM virtualization.
- Very large exports are still assembled in memory and can require substantial RAM.
- Firefox packages from GitHub Releases are currently unsigned and therefore use Firefox's temporary add-on loading flow.

## Privacy

The extension runs locally in the browser.

It communicates with `chatgpt.com` only to read the current conversation and download files referenced by that conversation. It does not send conversation contents to third-party servers and contains no analytics or telemetry.

Extension preferences and temporary per-session UI/cache state are stored using browser extension storage APIs. The offscreen document used by Chromium for large downloads is part of the extension and does not contact an external service.

## Project structure

```text
.github/workflows/package.yml  GitHub Actions packaging workflow
_locales/                      UI translations
icons/                         Extension icons
scripts/package.sh             Chromium/Firefox package builder
attachments.js                 Attachment discovery and normalization
background.js                  Export orchestration, selection cache and download lifecycle
chatgpt-api.js                 ChatGPT session/API access and file resolution
content.js                     Chat-page integration and message selection UI
conversation.js                Conversation branch and message normalization
download-url.js                Cross-browser Blob/Object URL download helper
offscreen.html                 Chromium MV3 offscreen document host
offscreen.js                   Chromium Blob/Object URL creation for ZIP downloads
popup.html                     Extension popup
popup.js                       Popup behavior
render.js                      Markdown/HTML rendering
selection-cache-observer.js    Lightweight page observer for selection-cache invalidation
selection-index.js             Compact logical message-selection index
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

Requirements, product decisions and real-world testing by the author; architecture, implementation, debugging and refactoring developed collaboratively with ChatGPT.

The project uses plain JavaScript and Manifest V3 with no build system or runtime dependencies.

For local Chromium development, edit the files in the repository and click **Reload** for the extension on `chrome://extensions`. Refresh the open ChatGPT page after changes to content scripts such as `content.js` or `selection-cache-observer.js`.

To build browser-specific archives locally on a Unix-like environment:

```bash
bash scripts/package.sh
```

The resulting archives are written to `dist/`. This command is for development and release packaging; end users should download the already-built browser archive from GitHub Releases.

For release packaging, pushing a tag such as `v0.1.32` runs the GitHub Actions packaging workflow. The workflow verifies that the tag matches the version in `manifest.json`, builds both browser archives and creates a **draft GitHub Release** with both ZIP files attached. The draft can then be reviewed and published manually, which keeps release immutability compatible with the packaging flow.

Pull requests also run the packaging workflow as a validation check and expose the two ZIP files as a workflow artifact.

## License

Licensed under the [MIT License](LICENSE).

## Disclaimer

This is an independent project and is not affiliated with or endorsed by OpenAI.

ChatGPT and OpenAI are trademarks of OpenAI.
