# Privacy Policy

**Effective date:** September 26, 2026

This privacy policy applies to the **AI Chat Export** browser extension (the "Extension").

The Extension is an independent open-source project. It is not affiliated with or endorsed by OpenAI, Anthropic, xAI, or DeepSeek.

## Summary

The Extension processes the active conversation from a supported AI chat service in the user's browser only when the user asks it to create an export or load message-selection data. It does not operate a developer-controlled server and does not send analytics, telemetry, advertising identifiers, or conversation contents to the developer.

Supported services currently include ChatGPT, Claude, Grok, and DeepSeek.

## Data handled by the Extension

To provide its export function, the Extension may handle:

- conversation text, images, audio, files, links, timestamps, reasoning/thinking blocks when exposed by the provider, and other conversation content;
- conversation titles, identifiers, page URLs, message identifiers, branch metadata, and provider-specific message metadata;
- the user's existing authenticated browser session for the supported service, used transiently to request conversation data and attachments;
- export preferences, display names entered by the user, temporary progress state, filename drafts, and temporary message-selection cache data.

Authentication information is not written to extension storage or included in exported archives.

## How data is used

Conversation data and attachments are used only to create the Markdown, HTML, SVG/image, and ZIP files requested by the user.

Preferences may be stored in the browser's extension storage so that the Extension can remember the user's choices. Temporary progress, filename draft, and selection-cache data may be stored in session storage to support the current browser session.

## Network communication

The Extension may communicate over HTTPS with the supported service currently being exported and with related provider-controlled file, media, or widget/content-delivery hosts. This includes, depending on the provider, domains used by ChatGPT, Claude, Grok, and DeepSeek to deliver conversation data, attachments, generated files, images, or rendered content.

Some provider responses can contain externally referenced images or files. When the Extension supports localizing such content, it may request the referenced HTTPS URL directly in order to include a local copy in the export. That request is made by the user's browser to the referenced host; ordinary network metadata such as the user's IP address may therefore be visible to that host.

The Extension does not transmit conversation contents to a server operated by the developer. It does not add analytics, telemetry, advertising, or tracking requests.

Use of each supported service remains subject to that service's own terms and privacy policy.

## Sharing and disclosure

The developer does not receive, sell, rent, share, or disclose the user's conversation data, authentication information, browsing activity, or exported files.

The Extension does not use user data for advertising, profiling, creditworthiness, lending, or purposes unrelated to its export function. No human is given access to user data by the Extension.

Direct requests to supported provider hosts or to externally referenced media hosts are made only as part of retrieving content requested for export; those hosts process the request under their own policies.

## Data retention and deletion

Because the developer does not receive user data, the developer retains no copies of conversations, authentication information, or exported files.

Persistent Extension preferences remain in browser extension storage until the user changes them, clears extension data, or uninstalls the Extension. Session data is temporary and is removed by the browser when the relevant session storage is cleared. Exported archives remain under the user's control and can be deleted like any other local file.

## Security

Network requests initiated by the Extension use HTTPS. Processing and archive creation take place locally in the browser.

Provider authentication is reused only through the user's existing browser session. Authentication information is not copied into exported files or developer-controlled storage.

## Chrome Web Store Limited Use disclosure

The Extension's use of information received from browser APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes to this policy

If the Extension's data practices change, this policy will be updated before a version with those changes is published.

## Contact

Questions or privacy concerns can be submitted through the project's public issue tracker:

https://github.com/alexey-sirotin/ai-chat-export/issues

---

# Политика конфиденциальности

**Дата вступления в силу:** 26 сентября 2026 года

Эта политика относится к браузерному расширению **AI Chat Export** («Расширение»).

Расширение является независимым проектом с открытым исходным кодом и не связано с OpenAI, Anthropic, xAI или DeepSeek и не одобрено ими.

## Кратко

Расширение обрабатывает активную беседу из поддерживаемого AI-сервиса в браузере пользователя только после команды на создание экспорта или загрузку данных для выбора сообщений. У Расширения нет сервера под управлением разработчика; оно не отправляет разработчику аналитику, телеметрию, рекламные идентификаторы или содержимое бесед.

Сейчас поддерживаются ChatGPT, Claude, Grok и DeepSeek.

## Какие данные обрабатываются

Для создания экспорта Расширение может обрабатывать:

- текст беседы, изображения, аудио, файлы, ссылки, временные метки, блоки reasoning/thinking, если сервис их показывает, и другое содержимое беседы;
- название и идентификатор беседы, URL страницы, идентификаторы сообщений, данные о ветках и другие метаданные сообщений, зависящие от конкретного сервиса;
- существующий авторизованный сеанс пользователя в поддерживаемом сервисе, который временно используется для запроса данных беседы и вложений;
- настройки экспорта, введённые пользователем отображаемые имена, временное состояние выполнения, черновики имени файла и временный кеш выбора сообщений.

Данные аутентификации не записываются в хранилище Расширения и не включаются в экспортируемые архивы.

## Как используются данные

Содержимое беседы и вложения используются только для создания запрошенных пользователем файлов Markdown, HTML, SVG/изображений и ZIP.

Настройки могут храниться в локальном хранилище расширений браузера, чтобы Расширение запоминало выбор пользователя. Временные данные о ходе экспорта, черновике имени файла и кеше выбора сообщений могут храниться в хранилище текущего сеанса браузера.

## Сетевое взаимодействие

Расширение может обращаться по HTTPS к поддерживаемому сервису, из которого выполняется экспорт, а также к связанным с ним адресам доставки файлов, медиа, виджетов и другого содержимого. В зависимости от сервиса это могут быть адреса, используемые ChatGPT, Claude, Grok и DeepSeek для передачи данных беседы, вложений, сгенерированных файлов, изображений или отображаемого содержимого.

Некоторые ответы сервисов могут содержать ссылки на изображения или файлы, размещённые на внешних сайтах. Если Расширение умеет сохранять такой материал локально, оно может напрямую запросить указанный HTTPS-адрес, чтобы включить локальную копию в экспорт. Такой запрос выполняется браузером пользователя к соответствующему сайту; поэтому этому сайту могут быть доступны обычные сетевые данные запроса, например IP-адрес пользователя.

Расширение не передаёт содержимое бесед на сервер разработчика и не добавляет запросы аналитики, телеметрии, рекламы или отслеживания.

Использование каждого поддерживаемого сервиса регулируется его собственными условиями и политикой конфиденциальности.

## Передача и раскрытие данных

Разработчик не получает, не продаёт, не сдаёт в аренду, не передаёт и не раскрывает содержимое бесед, данные аутентификации, историю посещений или экспортированные файлы пользователя.

Расширение не использует данные для рекламы, профилирования, оценки кредитоспособности, кредитования или любых целей, не связанных с функцией экспорта. Расширение не предоставляет людям доступ к данным пользователя.

Прямые запросы к серверам поддерживаемых сервисов или к внешним адресам медиа выполняются только для получения содержимого, которое пользователь запросил для экспорта; соответствующие сайты обрабатывают такие запросы по собственным правилам.

## Хранение и удаление

Поскольку разработчик не получает данные пользователя, он не хранит копии бесед, данных аутентификации или экспортированных файлов.

Постоянные настройки Расширения остаются в хранилище браузера, пока пользователь не изменит их, не очистит данные Расширения или не удалит его. Данные сеанса временны и удаляются браузером при очистке соответствующего хранилища. Экспортированные архивы находятся под контролем пользователя и удаляются как обычные локальные файлы.

## Безопасность

Сетевые запросы Расширения используют HTTPS. Обработка данных и создание архива происходят локально в браузере.

Авторизация в сервисах используется только через уже существующий сеанс пользователя. Данные аутентификации не копируются в экспортируемые файлы или хранилище под управлением разработчика.

## Ограниченное использование Chrome Web Store

Использование Расширением информации, полученной через API браузера, соответствует политике пользовательских данных Chrome Web Store, включая требования Limited Use.

## Изменения политики

Если способы обработки данных изменятся, эта политика будет обновлена до публикации версии с такими изменениями.

## Контакты

Вопросы и обращения по поводу конфиденциальности можно оставить в публичном трекере проекта:

https://github.com/alexey-sirotin/ai-chat-export/issues
