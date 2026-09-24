# Provider internals

Internal engineering notes for `ChatGPT Export to Markdown & HTML`.

This document records the provider-specific behavior we have observed while implementing and testing the exporter. It is intentionally more detailed and less user-facing than `README.md`.

> Important
>
> - These are observations of web applications and undocumented/internal endpoints, not public provider APIs.
> - Endpoint shapes, field names, authentication requirements, DOM structures, and download flows may change without notice.
> - Treat this document as a working reverse-engineering reference. When behavior changes, update both the adapter and these notes.

Last substantially updated: 2026-09-24.

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

## Source of truth

Grok was initially implemented from the rendered transcript plus React state because the obvious conversation endpoint only returned metadata. That approach exposed a major problem: **the transcript DOM is virtualized**.

A long conversation can have only a small subset of turns mounted at any one time. The original implementation had to scroll the transcript to harvest all turns, which caused visible page movement when opening the popup, entering selection mode, and exporting.

Further reverse engineering found the proper internal conversation APIs, so current extraction no longer needs transcript scrolling.

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

The important discovery is that Grok exposes the response graph directly.

### Full responses

```text
GET /rest/app-chat/conversations/{conversationId}/responses?includeThreads=false
```

Observed response shape contains fields such as:

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

In the test conversation this endpoint returned every node in the conversation graph, including alternative branches.

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

The generated API client confirms that the request body is effectively just `responseIds` and the response contains `responses`.

The web UI uses response-node data plus `load-responses` in chunks (observed around 30 responses), which explains why the visible transcript can stay virtualized even for long conversations.

For our exporter, `/responses` is currently the simplest complete source.

## Active branch reconstruction

`/responses` returns the graph, not "the 18 currently visible turns" as a preselected flat list.

The adapter builds parent chains from leaf nodes using:

```text
responseId
parentResponseId
```

Grok does not currently expose an obvious equivalent of Claude's `current_leaf_message_uuid` in the metadata endpoint we inspected.

Current branch choice therefore uses the mounted DOM response IDs as a **hint**, not as the data source:

1. collect currently mounted `[id^="response-"]` IDs;
2. build a candidate root-to-leaf path for every leaf;
3. prefer the path with greatest overlap with the mounted IDs;
4. break ties by newest leaf `createTime`;
5. finally break ties by response-array position.

This removed all transcript scrolling while still following the branch currently shown by Grok in tested cases.

## DOM / React observations

Useful selectors observed during reconnaissance:

```text
[id^="response-"]
[data-testid="user-message"]
[data-testid="assistant-message"]
.response-content-markdown
[data-testid="chat-transcript-scroller"]
.message-bubble
```

Assistant `.response-content-markdown` is cleaner than outer turn text because service/status text such as elapsed-time labels can exist outside it.

React props on response content exposed raw assistant Markdown and `cardAttachmentsJson`, which was useful before the API route was found.

The DOM remains useful for selection/active-branch hints, but must not be walked/scroll-harvested for complete export.

## `cardAttachmentsJson`

This is one of the most important Grok fields.

Despite the name, the API currently returns it as an **array of JSON strings**, not as an array of already-parsed objects. Each entry must be parsed separately.

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

Raw assistant Markdown can contain Grok placeholder markup such as `<grok:render ...>` / `<grok-card ...>`. The exporter currently strips these placeholders so they do not leak into Markdown.

A remaining improvement is to preserve the human-visible citation/source label/link semantically rather than merely removing the placeholder.

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

Preferred resource order for export is generally:

1. `image.original`
2. `image.thumbnail`
3. remote link fallback if the bytes cannot be fetched

These are third-party resources and may fail because of CORS or origin policy.

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

`image_chunk.imageUrl` may be relative, e.g.:

```text
users/{userId}/generated/{uuid}/image.jpg
```

which resolves to:

```text
https://assets.grok.com/users/{userId}/generated/{uuid}/image.jpg
```

Some generated-image cards (notably moderated/older variants) can contain the UUID but no `imageUrl`; those need separate treatment/fallback and should not be assumed downloadable solely from the card.

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

Example tested artifact: `hello.c`.

## Grok asset metadata

Generated image UUIDs can also be used as asset IDs:

```text
GET /rest/assets/{assetId}
```

Observed image metadata includes:

```text
assetId
mimeType
name
sizeBytes
createTime
lastUseTime
summary
previewImageKey
key
auxKeys
isDeleted
fileSource
sourceConversationId
isModelGenerated
updateTime
isLatest
inlineStatus
isRootAssetCreatedByModel
rootAssetSourceConversationId
sharedWithTeam
sharedWithUserIds
isPublic
width
height
rRated
thumbhash
ownerUserId
```

For a generated image, `key` can look like:

```text
users/{userId}/generated/{uuid}/image.jpg
```

and `fileSource` has been observed as:

```text
IMAGINE_GENERATED_FILE_SOURCE
```

This metadata endpoint is useful for validation and future fallback logic, but it does not itself return a signed download URL in the tested generated-image case.

## Downloading Grok generated images

A subtle CDN behavior was observed with `assets.grok.com`.

A naive extension/background fetch such as:

```js
fetch(url, { credentials: "omit" })
```

returned `403`.

A normal page `fetch()` with credentials but generic request headers could also fail / encounter CORS behavior.

The same image that Grok successfully renders can be fetched from page context when the request looks like an image request. This exact experiment succeeded:

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

Observed result for a tested JPEG:

```text
status: 200
type: cors
content-type: image/jpeg
bytes: 407712
```

This is the preferred direction for generated-image downloads.

Do not rely on manually setting browser-controlled `Sec-Fetch-*` headers. The important tested difference was that a page-context request with credentials, Grok referrer, and an image-like `Accept` succeeded.

## Downloading Grok rendered/generated files

Rendered files such as `hello.c` behave differently from generated images.

Direct access to the card's `assets.grok.com/.../hello.c` URL returned `403` in testing.

Grok exposes a conversation filesystem endpoint:

```text
GET /rest/conversations/files/content
    ?conversationId={conversationId}
    &path={path}
```

For `/hello.c`, the response included:

```text
dataUrl
mimeType
size
isTruncated
signedUrl
downloadSignedUrl
```

The returned `signedUrl` / `downloadSignedUrl` pointed to a time-limited Google Cloud Storage URL and is the correct download mechanism for this class of generated file.

Therefore rendered-file handling should be:

1. identify the conversation file path/name from the card;
2. call `/rest/conversations/files/content`;
3. prefer `downloadSignedUrl` (or `signedUrl` where appropriate);
4. fetch the signed URL;
5. store bytes in ZIP under the normalized attachment name.

## `fileAttachments` observations

Grok responses also contain `fileAttachments`, usually as asset/file UUID strings.

Examples observed:

- generated images often also appeared in `fileAttachments` using the image UUID;
- a user-uploaded image had a `fileAttachments` UUID even though `cardAttachmentsJson` was empty on the user turn;
- rendered `hello.c` had its rich card in `cardAttachmentsJson` but an empty `fileAttachments` array.

Conclusion: **do not use `fileAttachments` as the only attachment source**. It is useful supplementary metadata, while `cardAttachmentsJson` is currently essential for assistant-rendered cards/files/images.

User-uploaded Grok attachments deserve additional dedicated fixtures because they can be represented differently from assistant-generated cards.

## Markdown cleanup specific to Grok

Raw Grok assistant Markdown can contain provider placeholders. The adapter currently removes Grok card/render markup before rendering.

Another discovered edge case is nested Markdown fences. Grok can return an outer fenced block such as ```` ```markdown ```` containing inner triple-backtick fences. A normal Markdown renderer may prematurely close the outer fence.

The exporter protects this by widening the outer Markdown fence when needed, and the generic HTML renderer supports fences longer than three backticks.

## Current Grok strategy

Conversation extraction:

- metadata from `conversations_v2`;
- complete graph from `/responses?includeThreads=false`;
- active branch reconstructed from parent links, using mounted DOM IDs only as branch hints;
- no transcript scrolling.

Attachments:

- parse every `cardAttachmentsJson` string;
- generated images: fetch from `assets.grok.com` in page context with the tested image-like request;
- rendered files: resolve through `/rest/conversations/files/content` and then use the signed URL;
- third-party/search images: best-effort direct fetch, otherwise preserve remote fallback;
- continue improving user-uploaded attachment coverage.

## Grok-specific known issues / follow-ups

- Preserve citation labels/links semantically instead of merely stripping Grok placeholder markup.
- Add the newly discovered generated-image request behavior to the production downloader (the current PR code still used the older direct background fetch when these notes were written).
- Add `/rest/conversations/files/content` resolution for rendered/generated files instead of direct `assets.grok.com` fetching.
- Expand coverage for user-uploaded files/images whose response `fileAttachments` UUIDs are not mirrored by card metadata.
- Keep active-branch heuristics under test because Grok metadata did not expose an explicit current-leaf field in the inspected response.
- Remove any fallback that treats an arbitrary React string as a valid payload if legacy React-state extraction code is retained anywhere.

---

# Quick comparison

| Concern | ChatGPT | Claude | Grok |
| --- | --- | --- | --- |
| Primary history source | `/backend-api/conversation/{id}` | organization `chat_conversations/{id}` | `/rest/app-chat/conversations/{id}/responses` |
| Graph relation | `mapping` node parent/children | `parent_message_uuid` | `parentResponseId` |
| Explicit active leaf | `current_node` | `current_leaf_message_uuid` | Not found in inspected metadata; inferred with DOM hint + leaf recency |
| DOM required for full history | No | No | No (after API discovery) |
| DOM useful for selection/branch hint | Yes | Yes | Yes |
| Main structured attachment source | message metadata/content + `safe_urls` | message `attachments` / `files` / content structures | `cardAttachmentsJson` + `fileAttachments` |
| Generated/tool file special path | interpreter sandbox download | `wiggle/download-file` | conversation filesystem `files/content` -> signed URL |
| Generated image path | Estuary/file references, provider metadata | local resource or remote image | `assets.grok.com` with page image-like fetch |
| Third-party remote image fallback | Yes | Yes | Yes |

---

# Maintenance checklist

When a provider changes and compatibility breaks, check in this order:

1. Can the active conversation ID still be found from the route?
2. Does the primary conversation/history endpoint still respond under the logged-in session?
3. Have graph fields or current-leaf fields changed?
4. Are role/message/content fields still in the same shape?
5. Did attachment metadata move or change representation?
6. Are generated images still downloadable by the same mechanism?
7. Are generated/tool files still resolved by the same endpoint?
8. Are CORS/referrer/credential requirements different?
9. Did the provider change transcript virtualization or selection-related DOM attributes?
10. Does branch reconstruction still match the branch visibly selected in the UI?
11. Do full and selected exports still preserve omissions, order, images, files, and fallback links?

Keep provider-specific discoveries here even if the production adapter later hides the complexity behind a small normalized interface.