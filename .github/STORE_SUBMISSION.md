# Store submission worksheet

This worksheet contains the text and declarations for the first Chrome Web Store and Mozilla Add-ons submissions. Keep it aligned with the packaged extension and [PRIVACY.md](../PRIVACY.md).

## Common listing information

**Name**

AI Chat Export

**Category**

Productivity

**Homepage**

https://github.com/alexey-sirotin/ai-chat-export

**Support**

https://github.com/alexey-sirotin/ai-chat-export/issues

**Privacy policy**

https://github.com/alexey-sirotin/ai-chat-export/blob/main/PRIVACY.md

**License**

MIT

**Supported services**

- ChatGPT
- Claude
- Grok
- DeepSeek

**Affiliation disclosure**

AI Chat Export is an independent open-source project and is not affiliated with or endorsed by OpenAI, Anthropic, xAI, or DeepSeek. Product and company names and marks belong to their respective owners.

## English listing

### Short description

Export chats from ChatGPT, Claude, Grok, and DeepSeek to Markdown and HTML, with optional local attachments.

### Detailed description

Export the AI conversation you are viewing into a portable local archive.

AI Chat Export supports ChatGPT, Claude, Grok, and DeepSeek. It can create Markdown and HTML files independently or together and can save supported uploads, generated images, files, audio, and other attachments referenced by the conversation.

Features include:

- export the complete active conversation branch or select individual messages;
- preserve message dates, links, code blocks, tables, and attachment filenames when available;
- add neutral omission markers when only part of a conversation is exported;
- keep images clickable in Markdown and HTML;
- render supported math and Mermaid diagrams in HTML exports;
- preserve supported Claude custom visual widgets as standalone SVG attachments;
- optionally omit the original conversation link;
- cancel a long-running export;
- use a self-contained HTML format with no external scripts or styles.

The export is assembled locally in the browser and downloaded as a ZIP file. The extension has no analytics, telemetry, advertising, or developer-controlled server.

The extension uses the user's existing signed-in browser session only when needed to read the current conversation, selection data, or referenced attachments. Authentication information is not stored or included in the export.

Some provider responses can reference externally hosted images or files. When supported, the extension may request those HTTPS URLs directly so the content can be included locally in the export.

AI Chat Export is an independent open-source project and is not affiliated with or endorsed by OpenAI, Anthropic, xAI, or DeepSeek.

The extension depends on provider page structures and internal/undocumented endpoints. Provider changes may temporarily affect operation.

## Russian listing

### Short description

Экспорт чатов ChatGPT, Claude, Grok и DeepSeek в Markdown и HTML с возможностью локально сохранить вложения.

### Detailed description

Сохраняйте открытую AI-беседу в переносимый локальный архив.

AI Chat Export поддерживает ChatGPT, Claude, Grok и DeepSeek. Расширение может независимо или одновременно создавать файлы Markdown и HTML, а также сохранять поддерживаемые загрузки пользователя, сгенерированные изображения, файлы, аудио и другие вложения беседы.

Основные возможности:

- экспорт всей активной ветки беседы или только выбранных сообщений;
- сохранение дат сообщений, ссылок, блоков кода, таблиц и исходных имён вложений, когда они доступны;
- нейтральные отметки пропусков при экспорте части беседы;
- кликабельные изображения в Markdown и HTML;
- отображение поддерживаемых формул и Mermaid-диаграмм в HTML;
- сохранение поддерживаемых визуальных виджетов Claude как отдельных SVG-вложений;
- возможность не добавлять ссылку на исходную беседу;
- отмена длительного экспорта;
- самодостаточный HTML без внешних скриптов и стилей.

Архив собирается локально в браузере и загружается как ZIP-файл. В расширении нет аналитики, телеметрии, рекламы или сервера под управлением разработчика.

Расширение использует существующий авторизованный сеанс пользователя только когда это нужно для чтения текущей беседы, данных выбора сообщений или связанных вложений. Данные аутентификации не сохраняются и не включаются в экспорт.

Некоторые сервисы могут возвращать ссылки на изображения или файлы на внешних сайтах. Если такой материал поддерживается, расширение может напрямую запросить соответствующий HTTPS-адрес, чтобы включить локальную копию в экспорт.

AI Chat Export — независимый проект с открытым исходным кодом, не связанный с OpenAI, Anthropic, xAI или DeepSeek и не одобренный ими.

Расширение зависит от структуры страниц и внутренних/недокументированных интерфейсов сервисов. Изменения сервисов могут временно нарушить работу отдельных функций.

## Chrome Web Store privacy fields

### Single purpose

Export user-selected content from the active supported AI chat conversation into a portable local archive.

### Permission justifications

**scripting**

Runs the extension's packaged code in supported chat tabs after a user action. This is required to read provider page state, request conversation data and attachments using the user's existing browser session, and capture supported provider-rendered content. No remote executable code is injected.

**downloads**

Saves the locally assembled ZIP archive through the browser's standard download system and monitors or cancels that download when requested by the user.

**storage**

Stores user preferences and display labels locally, and keeps temporary export progress, filename drafts, and message-selection cache data in browser session storage.

**offscreen**

Chromium Manifest V3 service workers cannot create Blob/Object URLs. A packaged offscreen document is used only to create and revoke the local Blob URL for a completed ZIP archive.

**Host permission: https://chatgpt.com/***

Required for ChatGPT conversation discovery, selection UI, conversation retrieval, and ChatGPT-hosted attachment/file access.

**Host permission: https://claude.ai/***

Required for Claude conversation discovery, selection UI, authenticated conversation retrieval, and Claude-hosted resources.

**Host permission: https://*.claudemcpcontent.com/***

Required only to capture supported Claude MCP/custom visual widgets as static SVG content for export.

**Host permission: https://grok.com/***

Required for Grok conversation discovery, selection UI, conversation history retrieval, and Grok-specific content metadata.

**Host permission: https://assets.grok.com/***

Required to retrieve Grok-hosted generated/search images and files referenced by exported conversations.

**Host permission: https://chat.deepseek.com/***

Required for DeepSeek conversation discovery, selection UI, conversation retrieval, and DeepSeek-specific content metadata.

**Host permission: https://files.deepseeksvc.com/***

Required to retrieve DeepSeek-hosted files and image previews referenced by exported conversations.

### Remote code

Select **No, I am not using remote code**.

All extension logic is packaged with the extension. Network responses from supported chat services and referenced content hosts are treated as data/files, not as executable extension code. Provider-rendered Claude SVG content is sanitized before being saved as an attachment.

### User data categories

Disclose the following categories because store policy can treat local processing as handling user data:

- Personally identifiable information — only optional display labels entered by the user and stored locally.
- Authentication information — the user's existing signed-in provider session is used transiently for authenticated requests.
- Web history / browsing activity — the extension reads the active supported conversation URL.
- Personal communications — exported AI conversations may contain personal communications.
- Website content — conversation text, images, audio, links, files, rendered visuals, and metadata are processed for export.

Do not select financial information, health information, location, or other sensitive categories unless the implementation changes to handle them explicitly as a product feature.

### Data-use certifications

Certify that data is:

- used only for the extension's user-facing export purpose;
- not sold or transferred for advertising, profiling, creditworthiness, or lending;
- not used for purposes unrelated to export;
- not made available for human review by the developer;
- handled according to the Chrome Web Store Limited Use requirements.

## Mozilla Add-ons fields

### Firefox compatibility

Firefox for desktop 140 or later.

### Categories

Productivity, Other

### Payment and experimental flags

- Requires payment or non-free companion service: **No**. Users may need their own account/access for the supported provider, but the extension charges nothing and has no paid companion service.
- Experimental: **No**.

### Data collection manifest declaration

The Firefox package declares these required data types:

- `authenticationInfo`;
- `browsingActivity`;
- `personalCommunications`;
- `websiteContent`.

The data is handled only to retrieve and export the active conversation. It is not sent to the developer. Firefox 140 or later provides the built-in disclosure and consent experience.

### Source code question

Review this field carefully at submission time.

The project's own JavaScript is shipped as readable source, but the package also contains vendored renderer runtimes prepared from pinned KaTeX and Mermaid npm packages, including `vendor/mermaid.min.js`. If AMO treats those vendored/minified third-party files as requiring a source-code upload, select the source-code option and provide the tagged repository source together with the preparation scripts and dependency metadata needed to reproduce the packaged runtimes.

Do not claim that the submitted package contains no minified code.

### Notes for reviewers

The extension has no separate account system or developer-controlled service. Full functional testing requires the reviewer to be signed in to at least one supported provider with an account they are authorized to use.

Basic test procedure:

1. Sign in to ChatGPT, Claude, Grok, or DeepSeek and open a conversation containing at least one user message and one assistant response.
2. Open the extension popup.
3. Keep Markdown and HTML enabled and click Export.
4. Confirm that a ZIP archive is downloaded and contains the selected formats.
5. Reopen the popup, choose Select messages, clear the selection, select individual messages in the provider page, and export again.
6. If the conversation includes supported attachments, enable Save attachments and confirm that the files are included in the ZIP.

The extension retrieves the current conversation and referenced files only after an explicit user action that needs them. It uses the existing provider session transiently. No authentication information is stored or included in the archive.

The extension contains no analytics, telemetry, advertising, or tracking. Source code and issue tracking are public at:

https://github.com/alexey-sirotin/ai-chat-export

## Assets checklist

### Chrome Web Store

Required:

- [ ] 128×128 PNG extension icon in the package — existing `icons/icon-128.png`, review on light and dark backgrounds.
- [ ] At least one 1280×800 screenshot with square corners and no padding.
- [ ] 440×280 PNG or JPEG small promotional image.

Recommended:

- [ ] Up to five 1280×800 screenshots.
- [ ] Localized English and Russian screenshots.
- [ ] 1400×560 marquee promotional image.

### Mozilla Add-ons

- [ ] At least one clean screenshot demonstrating the popup and export selection.
- [ ] English and Russian listing text.
- [ ] Public support contact email entered in the AMO form.
- [ ] Privacy policy enabled and linked.
- [ ] Reviewer notes copied from this worksheet.
- [ ] Resolve the source-code-upload question for the vendored KaTeX/Mermaid runtime files.

## Suggested screenshots

Use non-personal demonstration conversations created specifically for the listing.

1. Popup over a supported AI conversation, showing the Markdown/HTML choices and attachment options.
2. Message-selection mode with several selected and unselected messages.
3. The downloaded archive opened to show Markdown, HTML, and an attachment folder.
4. A rendered HTML export containing headings, code, a table, math/Mermaid, and an image.
5. A Claude export containing a captured custom visual SVG, or long-export progress with the Cancel button visible.

Avoid personal chats, account identifiers, browser profile names, bookmarks, notification contents, and unrelated tabs.
