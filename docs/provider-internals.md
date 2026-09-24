# Provider internals

Internal engineering notes for `ChatGPT Export to Markdown & HTML`.

This document records the provider-specific behavior we have observed while implementing and testing the exporter. It is intentionally more detailed and less user-facing than `README.md`.

> Important
>
> - These are observations of web applications and undocumented/internal endpoints, not public provider APIs.
> - Endpoint shapes, field names, authentication requirements, DOM structures, and download flows may change without notice.
> - Treat this document as a working reverse-engineering reference. When behavior changes, update both the adapter and these notes.

Last substantially updated: 2026-09-25.

---

## Common design conclusions

Across all providers tested so far, the same architectural lessons keep recurring:

1. **The DOM is a UI, not the source of truth.** Virtualization, branch switching, lazy rendering, and hidden service/tool nodes make DOM-only export fragile.
2. **Prefer the provider's own authenticated web-app data source when available.** The exporter runs in the page's authenticated context and can often use the same internal endpoints as the provider UI.
3. **Messages form a graph/tree, not necessarily a flat transcript.** Active-branch reconstruction is provider-specific.
4. **Attachments are separate from message text.** Image cards, generated files, user files, sandbox artifacts, search images, and remote references often use different metadata and different download mechanisms.
5. **The final renderer should stay provider-agnostic.** Provider adapters should return normalized messages and attachments; Markdown/HTML/JSON/ZIP logic should not need scattered provider checks.
6. **Selection UI and extraction should be separate concerns.** DOM can still be useful to identify what the user is currently looking at, even when the complete conversation comes from an API.
7. **Remote-image fallback is valid behavior.** Some third-party images cannot be fetched because of CORS or provider restrictions. In that case the exporter should preserve a usable remote link rather than fail the export.
8. **A persisted REST response is not always the whole semantic representation.** A provider may expose the complete message graph through REST while a separate streamed/history representation preserves richer ordering information for inline cards.

The normalized shape used by the multi-provider architecture is conceptually:

```js
{
  platform,
  conversationId,
  conversationUrl,
  title,
  messages: [
    {
      id,
      parentId,
      role,
      createdAt,
      model,
      content,
      attachments
    }
  ]
}
```

Exact provider-side fields differ considerably.

---

# ChatGPT

## Source of truth

The exporter retrieves the raw conversation in page context rather than reconstructing it from rendered transcript DOM.

Conversation ID is taken from the page URL. Authentication is obtained from:

```text
GET /api/auth/session
```

The response contains an `accessToken`, which the exporter caches briefly in page context.

The conversation is then fetched from:

```text
GET /backend-api/conversation/{conversationId}
Authorization: Bearer {accessToken}
```

The conversation is considered usable when it contains at least:

```text
current_node
mapping
```

`mapping` contains the conversation graph; `current_node` identifies the active leaf.

## Conversation graph and active branch

ChatGPT conversations are represented as nodes in `mapping` rather than as one authoritative flat array.

Relevant concepts:

- node id
- node `parent`
- node `children`
- node `message`
- top-level `current_node`

The exporter reconstructs the current branch from the conversation graph and exports only that branch unless message selection narrows it further.

This matters for regenerated answers / alternative branches: all historical alternatives may exist in `mapping`, while the user-facing transcript corresponds to the chain ending at `current_node`.

## Message shape used by the exporter

Useful fields include:

```text
message.id
message.author.role
message.create_time
message.content
message.metadata
```

Model information is normally taken from:

```text
message.metadata.model_slug
message.metadata.resolved_model_slug
```

Tool-role messages that are intentionally retained by the exporter are normalized to assistant output, while service/tool noise is filtered structurally by the content layer.

The implementation intentionally preserves meaningful intermediate assistant text while suppressing internal/status/tool-call material that is not part of the visible conversational answer.

## Attachments

ChatGPT attachment discovery is deliberately defensive because the representation has changed over time.

### Ordinary files and uploaded/generated images

Possible attachment information can appear in:

```text
message.metadata.attachments
message.content (nested asset/file records)
safe_urls
```

File references may use forms such as:

```text
file_...
sediment://file_...
/backend-api/estuary/content?...id=file_...
```

The exporter recursively inspects `message.content` for structural file references, but does **not** recursively scan the entire message object because unrelated citation/tool metadata may contain file IDs and create false attachments.

Useful metadata may include:

```text
name / filename / original_name / title
mime_type
size / size_bytes
width
height
library_file_id
```

`safe_urls` may contain signed Estuary URLs. These are only attached to a message when the referenced file ID is already known to belong to that message.

### Generated image titles

For some historical image-generation messages, the human-readable title is stored at message level:

```text
message.metadata.image_gen_title
```

The exporter uses it as a fallback name for image attachments when the file record itself has no useful filename.

### Sandbox / interpreter files

Files created by ChatGPT code/interpreter tools can appear only as Markdown links, for example:

```md
[Download file](sandbox:/mnt/data/example.zip)
```

The raw node may not expose these as ordinary `metadata.attachments`, so the exporter parses sandbox links from assistant message text and keeps:

```text
sandboxPath
messageId
conversationId
```

The file is resolved through:

```text
GET /backend-api/conversation/{conversationId}/interpreter/download
    ?message_id={messageId}
    &sandbox_path={sandboxPath}
    &download_intent=true
```

The returned metadata is then used to obtain the actual downloadable resource.

### External web/image-search images

Assistant responses can also contain externally referenced images that are not normal ChatGPT-owned files. We have observed URLs such as:

```text
https://images.openai.com/static-rsc-...?...purpose=fullsize
```

These may not be downloadable under the same attachment flow. Current policy is best-effort download; if that fails, preserve a clickable remote reference.

## Known ChatGPT-specific pitfalls

- `mapping` is the authoritative graph; flattened DOM order is not enough for branching.
- Old chats and newer chats can encode attachments differently.
- `metadata.attachments` IDs are not always the final Estuary file ID; pointer/URL parsing may be required.
- Sandbox artifacts require the conversation/message context and a separate interpreter download endpoint.
- Deleted/expired generated assets may retain useful metadata even when bytes are no longer available.
- External search/reference images must not be treated as ordinary uploaded files.
- `Model caption:` is intentionally filtered by the content pipeline and should remain so unless provider behavior changes.

---

# Claude

## Source of truth

For a logged-in Claude conversation, the complete conversation is fetched from Claude's internal web API rather than reconstructed from DOM.

Conversation ID is taken from:

```text
/chat/{conversationId}
```

The exporter needs an organization ID. It finds candidate organization IDs from recently loaded `chat_conversations` resource URLs and/or:

```text
GET /api/organizations
```

The primary conversation request is:

```text
GET /api/organizations/{organizationId}/chat_conversations/{conversationId}
    ?tree=True
    &rendering_mode=messages
    &render_all_tools=true
    &include_inline_comparison=true
    &consistency=strong
```

Requests are made with the logged-in Claude session:

```js
credentials: "include"
```

## Top-level conversation fields observed

Observed fields include:

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

Not every field is required by the exporter, but this is useful when debugging server-side shape changes.

## Message fields observed

Observed message fields include:

```text
uuid
text
content
sender
index
created_at
updated_at
truncated
stop_reason
attachments
files
sync_sources
parent_message_uuid
```

`stop_reason` is primarily relevant to assistant messages.

## Content array

Claude assistant messages are not reliably represented by one plain text field. `content[]` has contained multiple element types, including:

```text
text
thinking
tool_use
tool_result
```

Important observed details:

- `text` elements can contain citations.
- `thinking` elements can include summary/cutoff/truncation/hidden-related fields.
- `tool_use` elements include an id, tool name, input, message, integration name and origin-related information.
- `tool_result` elements reference the originating tool-use id and include result content/error/meta information.

The exporter should preserve meaningful assistant text while not leaking service/tool plumbing into normal rendered chat output.

## Branching

Claude exposes the active leaf explicitly:

```text
current_leaf_message_uuid
```

Messages reference their parent with:

```text
parent_message_uuid
```

Therefore the current branch can be reconstructed deterministically by starting at `current_leaf_message_uuid` and following parent links back to the root, then reversing the result.

This is much more reliable than DOM order, especially after retrying or switching response branches.

## DOM notes

Claude's DOM has useful attributes for selection/UI integration (for example virtualized transcript row indexes), but it should not be considered the authoritative complete history.

Observed transcript-related attributes have included variants such as:

```text
data-testid="transcript-row"
data-index
data-rs-index
data-perf-row
```

Exact DOM details are expected to be less stable than the data model.

## Attachments and files

Claude currently uses more than one download path.

### Claude-hosted/local conversation resources

The adapter supports a local resource shape carrying at least:

```text
organizationId
conversationId
filePath
originalName
mimeType
```

The download path currently used is:

```text
GET /api/organizations/{organizationId}/conversations/{conversationId}/wiggle/download-file
    ?path={filePath}
```

with logged-in credentials.

If the organization ID is not already present on the attachment, the exporter repeats the same organization-discovery strategy used for conversation loading.

### Remote images

Some Claude content contains directly referenced remote images rather than Claude-local files. These are treated as `claude-remote-image` attachments and fetched best-effort with CORS.

The exporter validates that a successful remote fetch actually returns an image MIME type. If a remote image cannot be downloaded, rendering can fall back to the original remote URL.

### Share-link caveat

During testing, a Claude share-link view lost at least one attachment that was present in the authenticated conversation. Do not assume a share link is a lossless source for attachments.

## Current Claude strategy

- Fetch full conversation tree from the authenticated conversation endpoint.
- Reconstruct the active branch using `current_leaf_message_uuid` + `parent_message_uuid`.
- Parse structured `content[]` instead of relying on a single text field.
- Download Claude-local files through `wiggle/download-file`.
- Treat remote images as best-effort downloadable resources with remote fallback.
- Keep DOM responsibilities mostly limited to selection/UI integration.

## Known Claude-specific debt / open questions

- Provider-internal attachment fields are not yet exhaustively modeled.
- Artifacts, shared links, citations, and every possible Claude file/content variant still need broader fixture coverage.
- Share-link export should not be treated as equivalent to export from the authenticated owner view.

---

# Grok

## History sources: graph versus semantic composition

Grok's transcript DOM is virtualized, so it is not a reliable source of complete conversation history. Long chats may have only a subset of turns mounted at any moment. The exporter therefore does not scroll the transcript to harvest messages.

Grok currently requires two complementary internal data sources:

1. **REST `/responses`** provides the complete persisted response graph and basic message/attachment metadata.
2. **Gateway history events** preserve richer semantic composition for assistant output, including the exact position of some inline cards.

Neither replaces the other in the current implementation.

## Conversation ID and metadata

Conversation ID normally comes from routes such as:

```text
/c/{conversationId}
/chat/{conversationId}
/conversation/{conversationId}
```

A fallback can recover it from recently loaded resources containing:

```text
/rest/app-chat/conversations_v2/{conversationId}
```

Conversation metadata endpoint:

```text
GET /rest/app-chat/conversations_v2/{conversationId}
    ?includeWorkspaces=true
    &includeTaskResult=true
```

Observed `conversation` fields include:

```text
conversationId
title
starred
createTime
modifyTime
systemPromptName
temporary
mediaTypes
workspaces
taskResult
latestAssetMetadata
viewerIsOwner
kind
```

This endpoint does **not** contain the complete turn list.

## Response graph APIs

### Full responses

The main persisted graph source is:

```text
GET /rest/app-chat/conversations/{conversationId}/responses?includeThreads=false
```

Observed response fields include:

```text
responseId
sender
parentResponseId
message
createTime
model
cardAttachmentsJson
generatedImageUrls
imageAttachments
fileAttachments
```

The tested branched conversation returned every graph node, including alternative branches.

### Response nodes

A lighter graph endpoint also exists:

```text
GET /rest/app-chat/conversations/{conversationId}/response-node?includeThreads=false
```

Observed node fields include:

```text
responseId
sender
parentResponseId
threadParentId
```

### Batch body loading

Grok's own front-end also uses:

```text
POST /rest/app-chat/conversations/{conversationId}/load-responses
Content-Type: application/json

{
  "responseIds": ["..."]
}
```

The generated API client indicates that the request body is effectively `responseIds` and the response contains `responses`. The web UI has been observed loading response bodies in chunks while keeping the transcript virtualized.

For the exporter, `/responses` is currently the simplest complete persisted graph source.

## Active branch reconstruction

`/responses` returns the graph rather than one preselected flat transcript.

The adapter builds parent chains using:

```text
responseId
parentResponseId
```

Grok did not expose an obvious equivalent of Claude's `current_leaf_message_uuid` in the metadata inspected during implementation.

Current branch selection therefore uses mounted DOM response IDs only as a **hint**:

1. collect currently mounted `[id^="response-"]` IDs;
2. build a candidate root-to-leaf path for every leaf;
3. prefer the path with the greatest overlap with mounted IDs;
4. break ties by newest leaf `createTime`;
5. finally break ties by response-array position.

This allows complete export without transcript scrolling while following the visibly selected branch in tested cases.

## Gateway history and `output_chunks`

REST `/responses` is sufficient for the complete graph, but it is not sufficient to reconstruct the exact inline placement of every generated/search card.

During initial history load, Grok emits gateway/WebSocket events including:

```text
conversation.history.item
conversation.history.done
```

For assistant history items, the useful richer representation is:

```text
item.x_grok.output_chunks
```

`output_chunks` preserves the order in which assistant text and rendered cards belong in the message. The exporter captures this history early through `grok-history-hook.js`, installed at `document_start` in the page's `MAIN` world, and stores chunks keyed by response ID. `grok-api.js` then merges those chunks into the corresponding REST response before normalization.

Because this hook must observe the initial history load, reloading the extension alone is not enough during manual development tests: the Grok tab must also be reloaded so the hook is present before history arrives.

## Inline card composition

`grok-normalize.js` can reconstruct assistant content from `output_chunks` when available. Relevant chunk/card behavior includes:

- assistant response text chunks;
- `render_searched_image`;
- `render_start` for generated images;
- later `render_generated_image` metadata;
- citation/service chunks that should not leak provider-internal markup;
- notetaker/thinking headers that are filtered from normal conversational output.

If gateway history chunks are unavailable, normalization falls back to the ordinary REST `message` representation.

### Generated image lifecycle

Generated images are important because their history representation is two-phase.

An early chunk can contain:

```json
{
  "render_start": {
    "id": "TYiPy",
    "generated_image": {}
  }
}
```

`render_start` establishes the inline anchor/placeholder at the correct position relative to surrounding text.

Later history can contain:

```json
{
  "render_generated_image": {
    "id": "TYiPy",
    "image_chunk": {
      "imageUuid": "...",
      "imageUrl": "...",
      "mime_type": "image/jpeg"
    }
  }
}
```

The later `render_generated_image` enriches the already-positioned placeholder with final card/asset metadata. It must **not** be treated as a second placement event.

This distinction fixed the bug where a generated image downloaded correctly but appeared at the end of the assistant message instead of at its actual inline position.

## DOM / React observations

Useful selectors observed during reconnaissance include:

```text
[id^="response-"]
[data-testid="user-message"]
[data-testid="assistant-message"]
.response-content-markdown
[data-testid="chat-transcript-scroller"]
.message-bubble
```

The DOM remains useful for selection and active-branch hints, but must not be used as the complete history source.

React props were useful during reconnaissance because they exposed raw assistant Markdown and attachment information, but production extraction now relies on the REST graph plus captured gateway history rather than scroll-harvesting React state.

## `cardAttachmentsJson`

The REST response field `cardAttachmentsJson` remains important for persisted attachment metadata.

Despite its name, it has been observed as an **array of JSON strings**, not already-parsed objects. Each entry must be parsed separately.

Observed card types include the following.

### Citation card

Example logical shape:

```js
{
  id,
  type: "render_inline_citation",
  cardType: "citation_card",
  url,
  kind
}
```

Raw assistant Markdown can contain Grok placeholder markup such as `<grok:render ...>` / `<grok-card ...>`. The exporter strips provider-internal placeholders rather than leaking them into exported Markdown.

Preserving richer human-visible citation labels/links remains a possible future improvement.

### External/search image

Observed logical shape:

```js
{
  id,
  type: "render_searched_image",
  cardType: "image_card",
  image: {
    thumbnail,
    source,
    title,
    link,
    original,
    original_width,
    original_height
  },
  size
}
```

Preferred resource order is generally:

1. `image.original`;
2. `image.thumbnail`;
3. remote fallback when bytes cannot be downloaded.

Third-party resources may fail because of CORS or origin policy; that failure should not abort the export.

### Generated / edited image

Observed card types include:

```text
render_generated_image
render_edited_image
generated_image_card
```

Useful fields include:

```text
image_chunk.imageUuid
image_chunk.imageUrl
image_chunk.mediaId
image_chunk.imageTitle
image_chunk.imageModel
image_chunk.mimeType
image_chunk.resolution
image_chunk.moderated
image_chunk.rRated
```

`image_chunk.imageUrl` may be relative, for example:

```text
users/{userId}/generated/{uuid}/image.jpg
```

which resolves under:

```text
https://assets.grok.com/
```

Some generated-image variants can contain an asset UUID without a directly usable image URL, so asset metadata lookup remains useful.

### Rendered/generated file

Observed logical shape:

```js
{
  id,
  type: "render_file",
  cardType: "rendered_file_card",
  file_name,
  content_type,
  mime_type,
  file_size,
  url,
  file_path,
  thumbnail_url,
  thumbnail_dark_url
}
```

Example manually tested artifact: `hello.c`.

## Asset metadata and user-uploaded files

Grok asset IDs can be resolved through:

```text
GET /rest/assets/{assetId}
```

Useful returned fields include:

```text
assetId
mimeType
name
sizeBytes
key
createTime
sourceConversationId
isModelGenerated
width
height
```

For generated images and user-uploaded files, `key` can identify the actual object path under `assets.grok.com`.

A user-uploaded attachment may appear only as a UUID in `fileAttachments`, with no corresponding rich card in `cardAttachmentsJson`. The production adapter therefore resolves such UUIDs through `/rest/assets/{assetId}` and constructs a normalized attachment from the returned metadata.

Manual testing confirmed a user-uploaded PNG can be resolved, downloaded, archived locally and rendered correctly.

## Downloading Grok-hosted images and uploaded assets

A naive extension/background fetch from `assets.grok.com` with omitted credentials returned `403` during testing.

Successful page-context image download used the authenticated Grok session and image-like request headers, for example:

```js
const response = await fetch(url, {
  method: "GET",
  credentials: "include",
  mode: "cors",
  referrer: "https://grok.com/",
  headers: {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
  }
});
```

The same authenticated page-context approach is used for Grok-owned uploaded assets resolved through their asset `key`.

Do not rely on manually setting browser-controlled `Sec-Fetch-*` headers. The tested requirements were page context, credentials, Grok referrer and an image-like `Accept` header.

## Downloading rendered/generated files

Rendered/generated files such as `hello.c` use a different path from ordinary Grok-hosted images.

Direct access to the card's `assets.grok.com` URL returned `403` in testing. The exporter instead calls:

```text
GET /rest/conversations/files/content
    ?conversationId={conversationId}
    &path={path}
```

Observed response fields include:

```text
dataUrl
mimeType
size
isTruncated
signedUrl
downloadSignedUrl
```

The exporter prefers a fresh `downloadSignedUrl` and falls back to `signedUrl` where appropriate, then downloads the actual bytes and stores them under the normalized attachment name.

Signed URLs are temporary credentials and must not be persisted in engineering docs, fixtures or logs.

Manual testing confirmed `hello.c` is downloaded and included in the ZIP.

## `fileAttachments` observations

`fileAttachments` contains asset/file UUIDs and is supplementary rather than authoritative for all attachment classes.

Observed cases include:

- generated images also represented by their image UUID;
- user-uploaded images represented by UUID even when `cardAttachmentsJson` is empty;
- generated `hello.c` represented by a rich rendered-file card while `fileAttachments` is empty.

Therefore attachment discovery combines `cardAttachmentsJson`, `fileAttachments`, gateway inline composition and provider-specific asset/file resolution rather than treating any one field as universal.

## Inline references and local rendering

After downloads finish, internal attachment references are resolved to local archive paths.

If an attachment has already been inserted inline through a placeholder, the renderer must not append it again at the end of the turn. Attachments with no inline-position marker, such as ordinary user uploads, may still be rendered after the message text.

For successfully downloaded generated/search/user images, the local copy is preferred over the remote URL in both Markdown and HTML. Remote URLs remain fallback only when local acquisition failed.

The generic HTML renderer understands Markdown image syntax:

```md
![alt](path)
```

and image paths are URL-encoded so filenames such as:

```text
image (2).jpg
```

remain usable in both Markdown and HTML.

Inline images are constrained by generic content CSS:

```css
.content img {
  display: block;
  max-width: 100%;
  height: auto;
  border-radius: 8px;
}
```

so provider-specific images do not overflow message cards.

## Markdown cleanup specific to Grok

Raw Grok assistant Markdown can contain provider placeholders and service-only chunks. The adapter removes Grok-specific render/card markup and filters observed notetaker/thinking headers from normal exported conversation text.

Another edge case is nested Markdown fences. Grok can return an outer fenced block such as ` ```markdown ` containing inner triple-backtick fences. The exporter protects this by widening the outer fence where needed, while the generic HTML renderer accepts fences longer than three backticks.

## Current Grok strategy

Conversation/history:

- metadata from `conversations_v2`;
- complete persisted graph from `/responses?includeThreads=false`;
- active branch reconstructed from parent links, using mounted DOM IDs only as branch hints;
- gateway `conversation.history.item` capture for `item.x_grok.output_chunks`;
- `render_start` as generated-image inline anchor and `render_generated_image` as later metadata enrichment;
- no transcript scrolling.

Attachments/downloads:

- parse `cardAttachmentsJson` entries;
- use `fileAttachments` as supplementary UUID references;
- resolve asset UUIDs through `/rest/assets/{assetId}`;
- download Grok-hosted images/user assets in authenticated page context;
- resolve rendered/generated files through `/rest/conversations/files/content` and fresh signed URLs;
- third-party/search images use best-effort download with remote fallback;
- resolve inline references to local paths after successful download and suppress duplicate end-of-turn rendering.

## Grok-specific known issues / follow-ups

- Preserve citation labels/links semantically instead of merely stripping provider placeholders.
- Keep active-branch heuristics under test because no explicit current-leaf field was found in the inspected metadata.
- Keep gateway history capture under regression coverage because exact inline composition depends on observing initial history events.
- Broaden fixtures for Grok attachment/card variants as new response shapes are encountered.

---

# Quick comparison

| Concern | ChatGPT | Claude | Grok |
| --- | --- | --- | --- |
| Primary graph/history source | `/backend-api/conversation/{id}` | organization `chat_conversations/{id}` | `/rest/app-chat/conversations/{id}/responses` |
| Supplemental semantic composition source | n/a | structured `content[]` in same response | gateway `conversation.history.item -> item.x_grok.output_chunks` |
| Graph relation | `mapping` node parent/children | `parent_message_uuid` | `parentResponseId` |
| Explicit active leaf | `current_node` | `current_leaf_message_uuid` | Not found in inspected metadata; inferred with DOM hint + leaf recency |
| DOM required for full history | No | No | No |
| DOM useful for selection/branch hint | Yes | Yes | Yes |
| Main structured attachment source | message metadata/content + `safe_urls` | message `attachments` / `files` / content structures | `cardAttachmentsJson` + `fileAttachments` + `output_chunks` |
| Generated/tool file special path | interpreter sandbox download | `wiggle/download-file` | conversation filesystem `files/content` -> signed URL |
| Generated image path | Estuary/file references, provider metadata | local resource or remote image | `assets.grok.com` with authenticated page-context image fetch |
| Third-party remote image fallback | Yes | Yes | Yes |

---

# Maintenance checklist

When a provider changes and compatibility breaks, check in this order:

1. Can the active conversation ID still be found from the route?
2. Does the primary conversation/history endpoint still respond under the logged-in session?
3. Have graph fields or current-leaf fields changed?
4. Are role/message/content fields still in the same shape?
5. Did attachment metadata move or change representation?
6. Is there a separate streamed/history representation that affects inline ordering?
7. Are generated images still downloadable by the same mechanism?
8. Are generated/tool files still resolved by the same endpoint?
9. Are CORS/referrer/credential requirements different?
10. Did the provider change transcript virtualization or selection-related DOM attributes?
11. Does branch reconstruction still match the branch visibly selected in the UI?
12. Do full and selected exports still preserve omissions, order, images, files, inline placement and fallback links?

Keep provider-specific discoveries here even if the production adapter later hides the complexity behind a small normalized interface.
