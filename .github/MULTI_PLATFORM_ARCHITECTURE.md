# Multi-platform architecture

Status: implemented architecture as of 2026-09-25.

## Purpose

The extension supports multiple AI chat providers while keeping the export pipeline provider-neutral.

Currently supported providers:

- ChatGPT
- Claude
- Grok
- DeepSeek

The architecture is intentionally incremental: shared behavior is extracted only after it has been proven equivalent across multiple providers. Provider-specific API, DOM, authentication and attachment behavior remains isolated where the providers genuinely differ.

## High-level flow

```text
active browser tab
  -> platform registry
  -> provider-specific conversation fetch
  -> provider-specific active-branch reconstruction
  -> provider-specific selection mapping
  -> provider-specific normalization
  -> normalized conversation
  -> shared attachment/export pipeline
  -> Markdown / HTML / JSON
  -> ZIP
```

The shared export pipeline must not depend on provider-native message schemas.

## Platform registry

`platform.js` selects the provider from the active tab URL and exposes one adapter object per provider.

Each adapter currently provides the equivalent of:

```js
{
  id,
  matchesUrl(url),
  conversationIdFromUrl(url),
  conversationId(data),

  getConversationInPage(tabId, exportId),
  buildSelectionIndex(data),
  selectBranch(data, selection),
  normalizeConversation(data, branch, omission),

  downloadAttachmentInPage(tabId, attachment, metadataOnly, exportId),
  abortExportInPage(tabId, exportId),
  clearExportAbortInPage(tabId, exportId)
}
```

The registry centralizes provider detection and route parsing. It does not try to hide provider-specific conversation semantics.

## Normalized conversation model

All providers normalize into a common representation before rendering and packaging:

```js
{
  platform: "chatgpt" | "claude" | "grok" | "deepseek",
  conversationId: "...",
  conversationUrl: "...",
  title: "...",
  model: "...", // optional
  messages: [
    {
      id: "...",
      parentId: "...",   // optional
      role: "user" | "assistant",
      sourceRole: "...", // optional provider-specific role/type
      createdAt: "...",  // UTC ISO string when available
      model: "...",      // optional per-message model
      omittedBefore: true, // optional
      omittedAfter: true,  // optional
      content: [
        { type: "text", text: "...", format: "markdown" }
      ],
      attachments: [
        {
          source: "...",
          id: "...",
          originalName: "...",
          title: "...",
          mimeType: "...",
          isImage: true
        }
      ]
    }
  ]
}
```

Provider-specific attachment fields may be retained as opaque metadata until the adapter resolves or downloads them.

## Shared core

The following concerns are provider-neutral and remain shared:

- export orchestration in `background.js`;
- normalized message preparation;
- attachment concurrency and ZIP packaging;
- Markdown/HTML/JSON rendering;
- filename and MIME handling;
- browser download lifecycle;
- export progress and cancellation state;
- selection-index cache and summary logic;
- select-all plus explicit inclusion/exclusion semantics;
- generic ordered-message selection for providers whose logical messages are already flat.

Important shared files include:

- `render.js`
- `zip.js`
- `download-url.js`
- `cancellation.js`
- `async-pool.js`
- `runtime-mode.js`
- `selection-index.js`
- `selection-matcher.js`
- `ordered-selection.js`
- `utils.js`

## Selection architecture

Selection has two layers.

### Shared state semantics

The popup/content/background protocol uses a common shape such as:

```js
{
  selectAll: true,
  selectedMessageIds: [],
  excludedMessageIds: [],
  selectedTurnIds: [],
  excludedTurnIds: []
}
```

Selection indexes expose logical groups with stable and positional IDs.

### Provider-specific DOM mapping

DOM selection remains provider-specific because each site renders and virtualizes messages differently.

- ChatGPT uses defensive logical grouping because one visible assistant response can span several graph/tool nodes.
- Claude maps current-branch transcript positions to message UUIDs.
- Grok maps rendered response IDs to the reconstructed active branch.
- DeepSeek maps rendered message rows to DeepSeek message IDs.

`ordered-selection.js` contains the shared implementation used by Claude, Grok and DeepSeek. ChatGPT intentionally keeps its specialized graph-aware selection implementation.

## Active branch reconstruction

This is deliberately not generalized because the providers expose different branch semantics.

### ChatGPT

Uses `mapping` plus `current_node` and walks parent links. Visibility filtering and logical assistant grouping are ChatGPT-specific.

### Claude

Uses `current_leaf_message_uuid` and `parent_message_uuid` to walk the active path.

### Grok

The API provides response parent relationships but no equivalent authoritative current-leaf field in the observed endpoint. The adapter reconstructs candidate leaf paths and prefers the path matching currently mounted response IDs, with recency/order as tie-breakers.

### DeepSeek

Uses `chat_session.current_message_id` plus each message's `parent_id`. Parent relationships, not timestamps, define conversation order.

These implementations may look similar at the loop level, but their rules for choosing the starting leaf differ enough that a common abstraction would currently obscure important provider behavior.

## Provider-specific normalization

### ChatGPT

Provider-specific logic includes:

- mapping/current-node traversal;
- visibility filtering;
- tool-node handling;
- grouped logical assistant replies;
- content-reference/citation cleanup;
- ChatGPT file, sandbox and image attachment records.

### Claude

Claude normalization currently handles:

- visible `text` blocks;
- generated `local_resource` files exposed through tool results;
- remote `image_gallery` images;
- filtering ordinary tool chatter from exported conversation text.

### Grok

Grok normalization handles:

- response history chunks;
- generated/search image cards;
- generated files;
- user assets;
- Grok card placeholders embedded in Markdown;
- cleanup of Grok-specific markup and nested Markdown fence edge cases.

### DeepSeek

DeepSeek normalization handles fragment types including:

- `REQUEST`;
- `THINK`;
- `RESPONSE`;
- `FILE`.

Visible THINK/reasoning is exported as a separate assistant message before the final response. External images referenced inside THINK and RESPONSE are localized through the ordinary attachment pipeline.

## Attachments

Attachment normalization is shared, but retrieval remains provider-specific.

Reasons include:

- ChatGPT may require metadata endpoints, signed URLs or sandbox interpreter downloads;
- Claude uses organization/conversation resource endpoints;
- Grok uses asset metadata, generated-file metadata and `assets.grok.com`;
- DeepSeek uses signed file paths whose valid mode differs between ordinary files and uploaded image previews.

The shared export pipeline asks the active platform adapter for either metadata or bytes, then applies common filename/MIME logic and stores local attachment paths.

Remote images from provider responses are represented as attachments where possible so Markdown and HTML can reference local copies after export.

## Page-context execution and cancellation

Authenticated provider fetches often have to run in the page's MAIN world. Each provider therefore owns its page-context fetch implementation.

The providers currently repeat a small AbortController registry pattern. This duplication is intentional for now because the functions passed to `chrome.scripting.executeScript` are serialized into page context; extracting the pattern would add indirection without materially simplifying provider behavior.

## Content scripts

The selection content scripts for Claude, Grok and DeepSeek share broad concepts:

- maintain select-all/include/exclude state;
- insert checkboxes into mounted rows;
- support Shift-range selection;
- observe virtualized DOM changes;
- report selection state and mounted IDs.

They are not currently unified because the provider-specific parts are substantial:

- DOM selectors and checkbox hosts;
- stable ID extraction;
- active-order discovery;
- when network/API access is required from the content script.

A common content-script framework can be reconsidered if a future provider demonstrates another truly equivalent implementation.

## Export renderer boundary

`render.js` consumes only normalized export messages. Provider code should preserve source Markdown rather than pre-render provider HTML.

Current renderer-level follow-ups include:

- KaTeX/math rendering in exported HTML;
- Mermaid diagram rendering in exported HTML;
- optional common collapsing of reasoning/thinking blocks.

These are intentionally provider-neutral features.

## Rules for adding another provider

A new provider should normally add:

1. platform registration and URL parsing;
2. authenticated conversation fetch;
3. active-branch reconstruction;
4. selection index and DOM binding;
5. normalization into the common conversation model;
6. attachment metadata/download handling;
7. manifest host/content-script entries;
8. unit tests and package-smoke coverage.

Before creating a new shared abstraction, compare the new implementation with the existing providers. Extract only behavior whose semantics are actually the same.

## Current architectural conclusion

The project does not need a large framework rewrite. The useful abstraction boundary has emerged incrementally:

- platform registry at the top;
- provider-specific acquisition/selection/normalization at the edges;
- normalized messages and a shared export pipeline in the middle.

The post-DeepSeek refactor deliberately extracted ordered selection shared by Claude, Grok and DeepSeek while leaving ChatGPT's graph-aware selection specialized. Similar restraint should be used for future refactoring: remove demonstrated duplication, but do not force unlike provider models into a single abstraction.
