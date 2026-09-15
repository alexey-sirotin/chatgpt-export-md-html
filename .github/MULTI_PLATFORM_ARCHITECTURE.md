# Multi-platform architecture

Status: design proposal based on the current ChatGPT implementation and a live Claude investigation on 2026-09-15.

## Goal

Keep the existing export pipeline reusable while moving all site-specific conversation access, normalization, attachment resolution, and DOM selection behavior behind platform adapters.

The first two concrete platforms are:

- ChatGPT (existing implementation)
- Claude (investigated against the current claude.ai web app)

## Key finding

The current code is already split enough that the renderer/ZIP/download/cancellation layers are mostly reusable, but the platform boundary is wider than just the conversation API.

Platform-specific behavior includes:

- identifying the active conversation;
- fetching the full conversation;
- reconstructing the active branch;
- filtering internal/tool-only records;
- turning provider records into visible logical messages;
- resolving/download attachments;
- mapping virtualized DOM rows to logical messages;
- selection UI DOM integration;
- selection-cache invalidation.

## Proposed normalized model

The export core should consume a provider-neutral conversation:

```js
{
  platform: "chatgpt" | "claude",
  conversationId: "...",
  conversationUrl: "...",
  title: "...",
  model: "...",          // optional conversation-level model
  messages: [
    {
      id: "...",
      parentId: "...",   // optional
      role: "user" | "assistant",
      sourceRole: "...", // optional provider role, e.g. tool
      createdAt: "...",  // UTC ISO string
      model: "...",      // optional per-message model
      content: [
        { type: "text", text: "...", format: "markdown" }
      ],
      attachments: [
        {
          source: "...",
          id: "...",          // optional
          originalName: "...",// optional
          mimeType: "...",    // optional
          isImage: true,      // optional
          downloadRef: {...}  // provider-specific opaque handle
        }
      ]
    }
  ]
}
```

The core must not know about ChatGPT `mapping`, Claude `chat_messages`, DOM attributes, provider endpoint paths, or tool-result schemas.

## Proposed adapter responsibilities

A platform adapter should expose behavior roughly equivalent to:

```js
{
  id,
  matchesUrl(url),
  conversationIdFromUrl(url),

  getConversationInPage(tabId, exportId),
  normalizeConversation(rawConversation),

  getSelectionSummary(...),
  selectMessages(...),

  downloadAttachmentInPage(tabId, attachment, metadataOnly, exportId),

  abortExportInPage(tabId, exportId),
  clearExportAbortInPage(tabId, exportId)
}
```

This is an architectural boundary, not a required final API. Selection DOM code is expected to remain platform-specific even if selection state semantics are shared.

## Shared core candidates

These files/areas are already largely provider-neutral and should remain shared:

- `render.js`
- `zip.js`
- `download-url.js`
- `cancellation.js`
- `async-pool.js`
- `runtime-mode.js`
- most of `utils.js`
- browser download lifecycle and export progress in `background.js`
- common selection state semantics: select-all plus explicit exclusions

## ChatGPT-specific code today

### Fully platform-specific

- `chatgpt-api.js`
- `content.js`
- `dom-selection.js`
- `selection-cache-observer.js`

### Mixed: reusable concept, ChatGPT-specific implementation

- `conversation.js`
  - ChatGPT mapping/current_node traversal
  - tool visibility rules
  - recipient filtering
  - content references
  - logical assistant grouping
- `attachments.js`
  - estuary/sediment/file IDs
  - image_asset_pointer
  - sandbox:/mnt/data
- `selection-index.js`
  - currently built from ChatGPT logical groups/IDs
- `selection-matcher.js`
  - generic matching machinery, but currently shaped around ChatGPT turn/message/exchange IDs
- `background.js`
  - export orchestration is shared
  - conversation parsing, branch selection, attachment preparation and provider download calls are ChatGPT-specific
- `popup.js`
  - most UI is shared
  - ChatGPT URL parsing and assumptions about conversation identity are platform-specific

## Claude investigation

Test conversation: 20 messages before branching, then an alternative assistant response was created with Retry.

### Conversation endpoint

Claude loads the conversation from:

```text
/api/organizations/{organizationId}/chat_conversations/{conversationId}
  ?tree=True
  &rendering_mode=messages
  &render_all_tools=true
  &include_inline_comparison=true
  &consistency=strong
```

Original chat URL:

```text
https://claude.ai/chat/{conversationId}
```

Top-level fields observed:

```text
uuid
name
summary
model
created_at
updated_at
settings
is_starred
is_temporary
platform
is_wiggle_enabled
effective_thinking_mode
current_leaf_message_uuid
chat_messages
```

### Active branch

Each message has:

```text
uuid
sender
index
created_at
updated_at
parent_message_uuid
content
attachments
files
sync_sources
```

The active branch is reconstructed by following:

```text
current_leaf_message_uuid
  -> parent_message_uuid
  -> parent_message_uuid
  -> ...
```

This was verified before and after creating an alternative response.

Important: Claude's API `message.index` is a global creation index in the tree, not the position in the current active branch.

### Message content

`message.text` was empty in the tested conversation.

Visible text is stored in `message.content[]`.

Observed block types:

- `text`
- `thinking`
- `tool_use`
- `tool_result`

Normal assistant/user text is already Markdown in:

```js
{ type: "text", text: "..." }
```

This includes headings, nested lists, tables, blockquotes, fenced code blocks, links, emphasis, strikeout and task lists.

`thinking` blocks include UI summaries such as "Building a richly formatted sample message..." and should not be exported as ordinary visible reply text.

### Claude files

A generated file was represented as:

```text
tool_use create_file
tool_result create_file
tool_use present_files
tool_result present_files
```

The meaningful downloadable resource appears inside the `present_files` tool result:

```js
{
  type: "local_resource",
  file_path: "/mnt/user-data/outputs/synthetic-test-message.md",
  name: "synthetic-test-message",
  mime_type: "text/markdown",
  artifact_publishable: true,
  uuid: "..."
}
```

Clicking the file used:

```text
/api/organizations/{organizationId}/conversations/{conversationId}/wiggle/download-file
  ?path={encoded file_path}
```

### Claude image search

Image search produced a `tool_result` containing:

```js
{
  type: "image_gallery",
  images: [
    {
      id,
      url,
      thumbnail_url,
      title,
      source,
      page_url,
      width,
      height
    }
  ]
}
```

These are remote web images, not local Claude file resources.

### Claude DOM and virtualization

Visible rows use:

```text
[data-testid="transcript-row"]
```

Observed attributes:

```text
data-index
data-rs-index
data-perf-row="human" | "assistant"
aria-posinset
aria-setsize
```

The transcript is virtualized. At one point the DOM contained branch positions:

```text
0-7 and 15-17
```

while positions 8-14 were absent.

Crucially, DOM `data-index` is the zero-based position in the **current active branch**, not Claude API `message.index`.

Therefore the mapping is simple and stable:

```js
const message = activeBranch[Number(row.dataset.index)];
const messageId = message.uuid;
```

This continued to work after Retry changed the active branch.

This makes Claude selection simpler than ChatGPT selection: DOM virtualization can be handled by storing selection state by message UUID and remounting checkboxes as rows appear.

## Recommended selection design

Keep provider-specific DOM bindings, but share selection semantics.

Shared state:

```js
{
  selectAll: true,
  selectedMessageIds: [],
  excludedMessageIds: []
}
```

Platform DOM adapters translate a mounted row into a stable logical message ID.

ChatGPT needs its existing more defensive turn/message/exchange matching.

Claude can map:

```text
DOM row data-index -> activeBranch[position] -> message.uuid
```

The core/export layer should receive selected normalized messages and should not care how the platform obtained the selection.

## Migration plan

### Phase 1 — introduce the normalized conversation boundary

Do not add Claude yet.

Refactor ChatGPT so that its raw API data is normalized before the export/package loop.

Target result:

```text
ChatGPT raw API
  -> ChatGPT normalizer
  -> normalized conversation
  -> shared export pipeline
```

The existing behavior and tests must remain unchanged.

Likely files touched:

- `background.js`
- `conversation.js`
- `attachments.js`
- new provider-neutral normalization/export helpers
- tests

### Phase 2 — isolate platform lookup/API calls

Introduce a small platform registry selected from the active tab URL.

Move ChatGPT URL/API/abort/download operations behind the ChatGPT adapter.

Likely files touched:

- `popup.js`
- `background.js`
- `chatgpt-api.js`
- `manifest.json` only when a second platform is actually enabled

### Phase 3 — isolate selection DOM

Keep the current ChatGPT selection implementation intact behind a platform-specific binding.

Do not try to force ChatGPT and Claude to use identical DOM logic.

Share only the selection state protocol and popup/background message semantics.

### Phase 4 — add Claude adapter

Add:

- conversation fetch;
- active-branch reconstruction;
- normalization of `text` blocks;
- filtering of `thinking`, ordinary `tool_use` and ordinary `tool_result`;
- extraction of `local_resource` attachments;
- Claude attachment download endpoint;
- external image_gallery representation;
- Claude transcript-row selection binding;
- Claude host permissions/content script matches;
- tests.

## Estimated scope

### Refactor only, preserving ChatGPT behavior

Medium-sized change.

The most sensitive file is `background.js`, because it currently mixes browser orchestration with ChatGPT branch/message/attachment preparation.

The safest approach is incremental extraction rather than file moves and renames.

### Claude after refactor

Medium-sized feature, likely smaller than the original ChatGPT implementation.

The Claude API/message model is explicit and the selection mapping is unusually clean.

Expected difficult areas:

- obtaining organization ID robustly;
- confirming authenticated fetch behavior across account/workspace types;
- downloading user-uploaded files (not yet investigated; only Claude-created local_resource was tested);
- other Claude block/resource types such as artifacts;
- shared-link behavior (known to differ from the authenticated conversation and to omit file availability).

## Naming implication

The technical investigation supports a genuinely multi-platform product architecture rather than a speculative rename.

If product naming changes before store publication, store copy should still state supported providers explicitly, e.g.:

> Export AI conversations to Markdown, HTML and JSON. Currently supports ChatGPT.

Claude should only be added to that sentence after its adapter is shipped and tested.
