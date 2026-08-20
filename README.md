# ChatGPT Export to Markdown & HTML

A browser extension for exporting the current ChatGPT conversation branch to local Markdown, HTML and JSON files, with attachments saved alongside the export.

Current version: **0.1.30**

## Features

- Export the current ChatGPT branch — no full conversation tree.
- Export all messages or select individual messages directly in the ChatGPT UI.
- Shift-click range selection.
- Markdown, HTML and JSON can be enabled independently.
- Save user uploads, generated images, audio/files and ChatGPT-created `sandbox:/mnt/data/...` artifacts locally.
- Preserve original attachment filenames when ChatGPT provides them.
- Keep images clickable in Markdown and HTML.
- Resolve ChatGPT web citation markers to normal links.
- Preserve local message date/time in human-readable exports and UTC timestamps in JSON.
- Use the original ChatGPT page title inside Markdown/HTML while allowing a separate editable archive name.
- Optional separate folder for attachments.
- Long-export progress survives closing and reopening the extension popup.
- English and Russian UI.
- No external CSS or JavaScript is required by exported HTML.

## Installation

There is currently no packaged store release. Install the extension in developer mode:

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome, Vivaldi or another Chromium-based browser.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository root — the directory containing `manifest.json`.
6. Open or refresh a conversation on `https://chatgpt.com/`.
7. Click the extension button in the browser toolbar.

No build step is required.

## Usage

1. Open a ChatGPT conversation.
2. Click the extension button.
3. Optionally change the export filename and display names.
4. Choose Markdown, HTML and/or JSON.
5. Choose whether attachments should be downloaded and whether they should be placed in a separate folder.
6. Export the whole current branch, or enable message selection and choose only the messages you need.
7. Download the resulting ZIP archive.

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

When attachment saving is disabled, Markdown and HTML still retain expected local links so previously downloaded files can be placed beside the export later.

## Known limitations

- The extension depends on ChatGPT's current DOM structure and undocumented internal endpoints. Changes to ChatGPT may temporarily break some functionality.
- External web images referenced by an assistant response can remain remote links instead of being downloaded into the archive.
- Audio transcription text shown by ChatGPT is not currently exported separately.
- Partial exports do not yet insert explicit markers for skipped messages.
- Firefox is not currently supported.

## Privacy

The extension runs locally in the browser.

It communicates with `chatgpt.com` only to read the current conversation and download files referenced by that conversation. It does not send conversation contents to third-party servers and contains no analytics or telemetry.

Extension preferences are stored using the browser extension storage APIs.

## Project structure

```text
_locales/         UI translations
icons/            Extension icons
attachments.js    Attachment discovery and normalization
background.js     Export orchestration and download lifecycle
chatgpt-api.js    ChatGPT session/API access and file resolution
content.js        Chat-page integration and message selection UI
conversation.js   Conversation branch and message normalization
popup.html        Extension popup
popup.js          Popup behavior
render.js         Markdown/HTML rendering
utils.js          Shared helpers
zip.js            ZIP writer
manifest.json     Manifest V3 extension manifest
```
## Acknowledgements

This extension exists thanks to Morgana, my ChatGPT assistant.

Without her persona, and without her help, I probably would never have started this project at all.

And she was the first to say: “If we were writing our own exporter…”

## Development

Vibe-coded with ChatGPT.

Requirements, product decisions and real-world testing by the author; architecture, implementation, debugging and refactoring developed collaboratively with ChatGPT.

The project uses plain JavaScript and Manifest V3 with no build system or runtime dependencies.

For local development, edit the files in the repository and click **Reload** for the extension on `chrome://extensions`. Refresh the open ChatGPT page after changes to `content.js`.

## License

Licensed under the [MIT License](LICENSE).

## Disclaimer

This is an independent project and is not affiliated with or endorsed by OpenAI.

ChatGPT and OpenAI are trademarks of OpenAI.
