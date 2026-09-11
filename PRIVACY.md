# Privacy Policy

**Effective date:** September 11, 2026

This privacy policy applies to the **ChatGPT Export to Markdown & HTML** browser extension (the "Extension").

The Extension is an independent open-source project. It is not affiliated with or endorsed by OpenAI.

## Summary

The Extension processes the current ChatGPT conversation in the user's browser only when the user asks it to create an export. It does not operate a developer-controlled server and does not send analytics, telemetry, advertising identifiers, or conversation contents to the developer or to unrelated third parties.

## Data handled by the Extension

To provide its export function, the Extension may handle:

- the text, images, audio, files, links, timestamps, and other content of the current ChatGPT conversation;
- the conversation title, conversation identifier, current ChatGPT page URL, and message metadata;
- the user's existing ChatGPT authentication information, used transiently to request the selected conversation and its attachments from ChatGPT;
- export preferences, display names entered by the user, temporary progress state, and temporary message-selection cache data.

ChatGPT authentication information is not written to extension storage or included in exported archives.

## How data is used

Conversation data and attachments are used only to create the Markdown, HTML, JSON, and ZIP files requested by the user. The resulting archive is downloaded to a location selected through the browser.

Preferences may be stored in the browser's extension storage so that the Extension can remember the user's choices. Temporary progress, filename draft, and selection-cache data may be stored in session storage to support the current browser session.

## Network communication

The Extension communicates with ChatGPT over HTTPS, using the user's existing signed-in session, to retrieve the current conversation and files referenced by that conversation. Attachment downloads may use HTTPS file-delivery URLs returned by ChatGPT.

The Extension does not transmit user data to a server operated by the developer. It does not add analytics, telemetry, advertising, or tracking requests.

Use of ChatGPT remains subject to OpenAI's own terms and privacy policy.

## Sharing and disclosure

The developer does not receive, sell, rent, share, or disclose the user's conversation data, authentication information, browsing activity, or exported files.

The Extension does not use user data for advertising, profiling, creditworthiness, lending, or purposes unrelated to its single export function. No human is given access to user data by the Extension.

## Data retention and deletion

Because the developer does not receive user data, the developer retains no copies of conversations, authentication information, or exported files.

Persistent Extension preferences remain in browser extension storage until the user changes them, clears extension data, or uninstalls the Extension. Session data is temporary and is removed by the browser when the relevant session storage is cleared. Exported archives remain under the user's control and can be deleted like any other local file.

## Security

Network requests initiated by the Extension use HTTPS. Processing and archive creation take place locally in the browser.

## Chrome Web Store Limited Use disclosure

The Extension's use of information received from browser APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes to this policy

If the Extension's data practices change, this policy will be updated before a version with those changes is published.

## Contact

Questions or privacy concerns can be submitted through the project's public issue tracker:

https://github.com/alexey-sirotin/chatgpt-export-md-html/issues

---

# Политика конфиденциальности

**Дата вступления в силу:** 11 сентября 2026 года

Эта политика относится к браузерному расширению **ChatGPT Export to Markdown & HTML** («Расширение»).

Расширение является независимым проектом с открытым исходным кодом и не связано с OpenAI и не одобрено ею.

## Кратко

Расширение обрабатывает текущую беседу ChatGPT в браузере пользователя только после команды на создание экспорта. У Расширения нет сервера под управлением разработчика; оно не отправляет разработчику или посторонним третьим сторонам аналитику, телеметрию, рекламные идентификаторы или содержимое бесед.

## Какие данные обрабатываются

Для создания экспорта Расширение может обрабатывать:

- текст, изображения, аудио, файлы, ссылки, временные метки и другое содержимое текущей беседы ChatGPT;
- название и идентификатор беседы, URL текущей страницы ChatGPT и метаданные сообщений;
- данные существующего сеанса ChatGPT, которые временно используются для запроса выбранной беседы и её вложений;
- настройки экспорта, введённые пользователем отображаемые имена, временное состояние выполнения и временный кеш выбора сообщений.

Данные аутентификации ChatGPT не записываются в хранилище Расширения и не включаются в экспортируемые архивы.

## Как используются данные

Содержимое беседы и вложения используются только для создания запрошенных пользователем файлов Markdown, HTML, JSON и ZIP. Готовый архив сохраняется через стандартный механизм загрузок браузера.

Настройки могут храниться в локальном хранилище расширений браузера, чтобы Расширение запоминало выбор пользователя. Временные данные о ходе экспорта, черновике имени файла и кеше выбора сообщений могут храниться в хранилище текущего сеанса браузера.

## Сетевое взаимодействие

Расширение обращается к ChatGPT по HTTPS, используя уже существующий сеанс пользователя, чтобы получить текущую беседу и связанные с ней файлы. Для загрузки вложений могут использоваться HTTPS-адреса файлов, полученные от ChatGPT.

Расширение не передаёт данные пользователя на сервер разработчика и не добавляет запросы аналитики, телеметрии, рекламы или отслеживания.

Использование ChatGPT регулируется собственными условиями и политикой конфиденциальности OpenAI.

## Передача и раскрытие данных

Разработчик не получает, не продаёт, не сдаёт в аренду, не передаёт и не раскрывает содержимое бесед, данные аутентификации, историю посещений или экспортированные файлы пользователя.

Расширение не использует данные для рекламы, профилирования, оценки кредитоспособности, кредитования или любых целей, не связанных с его единственной функцией экспорта. Расширение не предоставляет людям доступ к данным пользователя.

## Хранение и удаление

Поскольку разработчик не получает данные пользователя, он не хранит копии бесед, данных аутентификации или экспортированных файлов.

Постоянные настройки Расширения остаются в хранилище браузера, пока пользователь не изменит их, не очистит данные Расширения или не удалит его. Данные сеанса временны и удаляются браузером при очистке соответствующего хранилища. Экспортированные архивы находятся под контролем пользователя и удаляются как обычные локальные файлы.

## Безопасность

Сетевые запросы Расширения используют HTTPS. Обработка данных и создание архива происходят локально в браузере.

## Ограниченное использование Chrome Web Store

Использование Расширением информации, полученной через API браузера, соответствует политике пользовательских данных Chrome Web Store, включая требования Limited Use.

## Изменения политики

Если способы обработки данных изменятся, эта политика будет обновлена до публикации версии с такими изменениями.

## Контакты

Вопросы и обращения по поводу конфиденциальности можно оставить в публичном трекере проекта:

https://github.com/alexey-sirotin/chatgpt-export-md-html/issues
