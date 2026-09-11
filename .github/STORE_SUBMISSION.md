# Store submission worksheet

This worksheet contains the text and declarations for the first Chrome Web Store and Mozilla Add-ons submissions. Keep it aligned with the packaged extension and [PRIVACY.md](../PRIVACY.md).

## Common listing information

**Name**

ChatGPT Export to Markdown & HTML

**Category**

Productivity

**Homepage**

https://github.com/alexey-sirotin/chatgpt-export-md-html

**Support**

https://github.com/alexey-sirotin/chatgpt-export-md-html/issues

**Privacy policy**

https://github.com/alexey-sirotin/chatgpt-export-md-html/blob/main/PRIVACY.md

**License**

MIT

**Affiliation disclosure**

This is an independent open-source project and is not affiliated with or endorsed by OpenAI. ChatGPT and OpenAI are trademarks of OpenAI.

## English listing

### Short description

Export the current ChatGPT conversation branch to Markdown, HTML, and JSON, with optional local copies of attachments.

### Detailed description

Export the conversation you are viewing on ChatGPT into a portable local archive.

The extension can create Markdown, HTML, and JSON files independently or together. It can also save user uploads, generated images, audio, and other files referenced by the conversation.

Features include:

- export the complete current conversation branch or select individual messages;
- preserve message dates, links, code blocks, tables, and attachment filenames when available;
- add neutral omission markers when only part of a conversation is exported;
- keep images clickable in Markdown and HTML;
- optionally omit the original conversation link;
- cancel a long-running export;
- use a self-contained HTML format with no external scripts or styles.

The export is assembled locally in the browser and downloaded as a ZIP file. The extension has no analytics, telemetry, advertising, or developer-controlled server.

The extension uses the user's existing ChatGPT session only after the user requests an export. It accesses the current conversation and its files directly from ChatGPT and its file-delivery services. Authentication information is not stored or included in the export.

This is an independent open-source project and is not affiliated with or endorsed by OpenAI. ChatGPT and OpenAI are trademarks of OpenAI.

The extension depends on ChatGPT's current page structure and internal endpoints. Changes to ChatGPT may temporarily affect its operation.

## Russian listing

### Short description

Экспорт текущей ветки беседы ChatGPT в Markdown, HTML и JSON с возможностью локально сохранить вложения.

### Detailed description

Сохраняйте открытую беседу ChatGPT в переносимый локальный архив.

Расширение может независимо или одновременно создавать файлы Markdown, HTML и JSON, а также сохранять загруженные пользователем файлы, сгенерированные изображения, аудио и другие вложения беседы.

Основные возможности:

- экспорт всей текущей ветки беседы или только выбранных сообщений;
- сохранение дат сообщений, ссылок, блоков кода, таблиц и исходных имён вложений, когда они доступны;
- нейтральные отметки пропусков при экспорте части беседы;
- кликабельные изображения в Markdown и HTML;
- возможность не добавлять ссылку на исходную беседу;
- отмена длительного экспорта;
- самодостаточный HTML без внешних скриптов и стилей.

Архив собирается локально в браузере и загружается как ZIP-файл. В расширении нет аналитики, телеметрии, рекламы или сервера под управлением разработчика.

Расширение использует существующий сеанс ChatGPT только после команды пользователя на экспорт. Оно получает текущую беседу и связанные файлы непосредственно от ChatGPT и его служб доставки файлов. Данные аутентификации не сохраняются и не включаются в экспорт.

Это независимый проект с открытым исходным кодом, не связанный с OpenAI и не одобренный ею. ChatGPT и OpenAI являются товарными знаками OpenAI.

Расширение зависит от текущей структуры страницы и внутренних интерфейсов ChatGPT. Изменения ChatGPT могут временно нарушить его работу.

## Chrome Web Store privacy fields

### Single purpose

Export user-selected content from the active ChatGPT conversation into a portable local archive.

### Permission justifications

**scripting**

Runs the extension's packaged code in the active ChatGPT tab after a user action. This is required to request the current conversation and its attachments using the user's existing ChatGPT session. No remote code is executed.

**downloads**

Saves the locally assembled ZIP archive through the browser's standard download system and monitors or cancels that download when requested by the user.

**storage**

Stores user preferences and display labels locally, and keeps temporary export progress, filename drafts, and message-selection cache data in browser session storage.

**offscreen**

Chromium Manifest V3 service workers cannot create Blob/Object URLs. A packaged offscreen document is used only to create and revoke the local Blob URL for a completed ZIP archive.

**Host permission: https://chatgpt.com/***

Limits page access to ChatGPT. It is required to identify the current conversation, add message-selection controls, retrieve conversation data using the user's signed-in session, and download files referenced by that conversation.

### Remote code

Select **No, I am not using remote code**.

All executable code is included in the extension package. Network responses from ChatGPT are treated as conversation data and files, not as executable code.

### User data categories

Disclose the following categories because Chrome defines local processing as handling user data:

- Personally identifiable information — only optional display labels entered by the user and stored locally.
- Authentication information — the existing ChatGPT session is used transiently to make authenticated requests.
- Web history — the extension reads the active ChatGPT conversation URL.
- Personal communications — ChatGPT conversation content may contain personal communications.
- Website content — conversation text, images, audio, links, files, and metadata are processed for export.

Do not select financial information, health information, location, or user activity unless the implementation changes to handle them explicitly.

### Data-use certifications

Certify that data is:

- used only for the extension's single user-facing export purpose;
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

- Requires payment or non-free companion service: **No**. A user's own ChatGPT access is required, but the extension charges nothing and has no paid companion service.
- Experimental: **No**.

### Data collection manifest declaration

The Firefox package declares these required data types:

- `authenticationInfo`;
- `browsingActivity`;
- `personalCommunications`;
- `websiteContent`.

The data is handled only to retrieve and export the active ChatGPT conversation. It is not sent to the developer. Firefox 140 or later provides the built-in disclosure and consent experience.

### Source code question

Select **No source code upload required**.

The submitted extension contains the original readable JavaScript, HTML, CSS, JSON, and locale files. Runtime code is not minified, transpiled, obfuscated, concatenated, or generated by a bundler. The packaging script only copies tracked files, adjusts browser-specific manifest fields, and creates the ZIP archive.

### Notes for reviewers

The extension has no separate account system or developer-controlled service. Full functional testing requires the reviewer to be signed in to ChatGPT with an account they are authorized to use.

Test procedure:

1. Sign in at https://chatgpt.com/ and open a conversation containing at least one user message and one assistant response.
2. Open the extension popup.
3. Keep Markdown, HTML, and JSON enabled and click Export.
4. Confirm that a ZIP archive is downloaded and contains the selected formats.
5. Reopen the popup, choose Select messages, clear the selection, select individual messages in the ChatGPT page, and export again.
6. If the conversation includes attachments, enable Save attachments and confirm that the files are included in the ZIP.

The extension retrieves the current conversation and referenced files from ChatGPT only after an explicit export or message-list action. It uses the existing ChatGPT session transiently. No authentication information is stored or included in the archive.

The extension contains no remote executable code, analytics, telemetry, advertising, or tracking. Source code and issue tracking are public at:

https://github.com/alexey-sirotin/chatgpt-export-md-html

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

## Suggested screenshots

Use a non-personal demonstration conversation created specifically for the listing.

1. Popup over an open ChatGPT conversation, showing the three export formats and attachment options.
2. Message-selection mode with several selected and unselected messages.
3. The downloaded archive opened to show Markdown, HTML, JSON, and an attachment folder.
4. A rendered HTML export containing headings, code, a table, and an image.
5. Long-export progress with the Cancel button visible.

Avoid personal chats, account identifiers, browser profile names, bookmarks, notification contents, and unrelated tabs.
