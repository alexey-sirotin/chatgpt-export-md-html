import { markdownLabel } from "./utils.js";
import { attachmentRecords } from "./attachments.js";

export function isModelCaptionToolMessage(msg) {
  if (!msg || msg.author?.role !== "tool") return false;

  const c = msg.content || {};
  const texts = [];

  if (Array.isArray(c.parts)) {
    for (const part of c.parts) {
      if (typeof part === "string" && part.trim()) texts.push(part.trim());
    }
  } else if (typeof c.text === "string" && c.text.trim()) {
    texts.push(c.text.trim());
  }

  // Image generation can leave behind internal vision/caption nodes such as
  // "Model caption: ...". They may also carry duplicate/intermediate image
  // attachments, but they are not visible conversational replies.
  return texts.length > 0 && texts.every(text => /^Model caption:\s*/i.test(text));
}

export function isVisibleMessage(msg) {
  if (!msg) return false;

  if (isModelCaptionToolMessage(msg)) return false;

  const type = msg.content?.content_type;
  if ([
    "reasoning_recap",
    "thoughts",
    "system_error",
    "model_editable_context",
    "computer_initialize_state"
  ].includes(type)) return false;

  const role = msg.author?.role;
  if (role === "user" || role === "assistant") return true;

  // Image-only replies can be represented in conversation mapping as tool
  // messages containing image_asset_pointer records. Keep only tool messages
  // that actually contain downloadable media.
  if (role === "tool") return attachmentRecords(msg).length > 0;

  return false;
}

export function rawBranchFromCurrent(data) {
  const out = [];
  let id = data.current_node;
  const seen = new Set();
  while (id && id !== "client-created-root" && !seen.has(id)) {
    seen.add(id);
    const node = data.mapping?.[id];
    if (!node) break;
    if (node.message) out.push({ ...node, __mappingId: id });
    id = node.parent;
  }
  return out.reverse();
}

export function branchFromCurrent(data) {
  return rawBranchFromCurrent(data).filter(node => isVisibleMessage(node.message));
}

export function nodeDirectIds(node) {
  const ids = [];
  if (node?.__mappingId) ids.push(node.__mappingId);
  if (node?.id) ids.push(node.id);
  if (node?.message?.id) ids.push(node.message.id);
  return ids;
}

export function nodeExchangeIds(node) {
  const m = node?.message?.metadata || {};
  return [
    m.turn_exchange_id,
    m.turnExchangeId,
    m.turn_id,
    m.turnId
  ].filter(Boolean).map(String);
}

export function logicalSelectionGroups(rawBranch) {
  const groups = [];
  let assistantGroup = null;

  for (const node of rawBranch) {
    const role = node.message?.author?.role;

    if (role === "user") {
      groups.push({ kind: "user", nodes: [node] });
      assistantGroup = { kind: "assistant", nodes: [] };
      groups.push(assistantGroup);
      continue;
    }

    // Everything between two user messages belongs to one logical assistant
    // response. A visible image response can be composed of several internal
    // assistant/tool nodes, while the DOM checkbox may point at only one of them.
    if (assistantGroup) assistantGroup.nodes.push(node);
  }

  return groups.filter(group => group.nodes.length > 0);
}

export function selectedBranchFromRaw(rawBranch, selection) {
  const selectedMessageIds = new Set((selection.selectedMessageIds || []).map(String));
  const selectedTurnIds = new Set((selection.selectedTurnIds || []).map(String));
  const selectedLegacyAfterMessageIds = new Set(
    (selection.selectedLegacyAfterMessageIds || []).map(String)
  );
  const groups = logicalSelectionGroups(rawBranch);
  const chosen = new Set();

  const directGroupsFor = id => groups.filter(group =>
    group.nodes.some(node => nodeDirectIds(node).includes(id))
  );

  // Message IDs are the strongest signal because they come directly from the
  // mounted DOM message. Selecting any node inside an assistant response selects
  // the whole logical response, including its image/tool nodes.
  for (const id of selectedMessageIds) {
    for (const group of directGroupsFor(id)) chosen.add(group);
  }

  // Legacy image-only DOM turns can have an opaque render/container ID that
  // never appears in the server mapping. The content script sends the nearest
  // preceding stable message ID. Resolve that ID against the server groups:
  // - after a user group => the following assistant response;
  // - after an assistant node => that same logical assistant response.
  for (const anchorId of selectedLegacyAfterMessageIds) {
    for (let i = 0; i < groups.length; i++) {
      const group = groups[i];
      const matchesAnchor = group.nodes.some(node =>
        nodeDirectIds(node).includes(anchorId)
      );
      if (!matchesAnchor) continue;

      if (group.kind === "assistant") {
        chosen.add(group);
      } else if (group.kind === "user" && groups[i + 1]?.kind === "assistant") {
        chosen.add(groups[i + 1]);
      }
    }
  }

  // Turn IDs are needed for virtualized/unmounted range selection. Prefer an
  // exact node/message match. Only if that is unavailable, fall back to the
  // exchange ID carried by ChatGPT's internal nodes.
  for (const id of selectedTurnIds) {
    const direct = directGroupsFor(id);
    if (direct.length) {
      for (const group of direct) chosen.add(group);
      continue;
    }

    const exchangeMatches = groups.filter(group =>
      group.nodes.some(node => nodeExchangeIds(node).includes(id))
    );

    // If a DOM message ID has already identified one of several groups sharing
    // the same exchange ID, do not broaden the selection to its neighbors.
    const alreadyChosen = exchangeMatches.filter(group => chosen.has(group));
    const targets = alreadyChosen.length ? alreadyChosen : exchangeMatches;
    for (const group of targets) chosen.add(group);
  }

  const out = [];
  for (const group of groups) {
    if (!chosen.has(group)) continue;
    for (const node of group.nodes) {
      if (isVisibleMessage(node.message)) out.push(node);
    }
  }
  return out;
}

export function branchExcludingFromRaw(rawBranch, selection) {
  const excludedBranch = selectedBranchFromRaw(rawBranch, {
    selectedMessageIds: selection.excludedMessageIds || [],
    selectedTurnIds: selection.excludedTurnIds || [],
    selectedLegacyAfterMessageIds: selection.excludedLegacyAfterMessageIds || []
  });
  const excludedNodes = new Set(excludedBranch);
  return rawBranch.filter(node =>
    isVisibleMessage(node.message) && !excludedNodes.has(node)
  );
}

export function selectionSummaryFromRaw(rawBranch, selection) {
  const groups = logicalSelectionGroups(rawBranch).filter(group =>
    group.nodes.some(node => isVisibleMessage(node.message))
  );

  const selectedBranch = selection.selectAll
    ? branchExcludingFromRaw(rawBranch, selection)
    : selectedBranchFromRaw(rawBranch, selection);
  const selectedNodes = new Set(selectedBranch);
  const selected = groups.filter(group =>
    group.nodes.some(node => selectedNodes.has(node))
  ).length;

  return { total: groups.length, selected };
}

export function isInternalToolInvocationText(text) {
  if (typeof text !== "string") return false;
  const trimmed = text.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return false;

  try {
    const value = JSON.parse(trimmed);
    if (!value || Array.isArray(value) || typeof value !== "object") return false;
    const keys = Object.keys(value);

    // Older image-gen turns stored only the serialized { size, n } call as an
    // assistant message. It is internal plumbing, not conversational text.
    if (
      keys.length === 2 &&
      Object.hasOwn(value, "size") &&
      Object.hasOwn(value, "n") &&
      typeof value.size === "string" &&
      /^\d+x\d+$/i.test(value.size) &&
      Number.isInteger(value.n) &&
      value.n > 0
    ) return true;

    // Internal image_gen calls seen in newer conversation mapping. `prompt` is
    // not guaranteed to be present (for example on an image edit/regeneration).
    const imageGenAllowed = new Set([
      "prompt", "size", "n", "transparent_background",
      "is_style_transfer", "referenced_image_ids"
    ]);
    const imageGenRequired = [
      "size", "n", "transparent_background",
      "is_style_transfer", "referenced_image_ids"
    ];
    if (
      imageGenRequired.every(key => Object.hasOwn(value, key)) &&
      keys.every(key => imageGenAllowed.has(key))
    ) return true;

    // Internal web-search invocation observed between the assistant's preliminary
    // and final visible replies. Keep both conversational replies, hide only the
    // serialized call arguments.
    const webSearchAllowed = new Set(["system1_search_query", "response_length"]);
    if (
      Array.isArray(value.system1_search_query) &&
      keys.every(key => webSearchAllowed.has(key))
    ) return true;

    return false;
  } catch {
    return false;
  }
}

export function referenceFallbackMarkdown(ref) {
  const items = Array.isArray(ref?.items) ? ref.items : [];
  const links = [];
  const seen = new Set();

  for (const item of items) {
    const url = typeof item?.url === "string" ? item.url.trim() : "";
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const label = item.title || item.attribution || url;
    links.push(`[${markdownLabel(label)}](${url})`);
  }

  if (!links.length && Array.isArray(ref?.safe_urls)) {
    for (const value of ref.safe_urls) {
      const url = typeof value === "string" ? value.trim() : "";
      if (!url || seen.has(url)) continue;
      seen.add(url);
      links.push(`[${markdownLabel(url)}](${url})`);
    }
  }

  return links.length ? `(${links.join(", ")})` : "";
}

// ChatGPT stores visible web citations as private-use markers such as
//   \uE200cite\uE202turn...\uE201
// and keeps the renderer-friendly replacement in metadata.content_references.
// Resolve those references before Markdown/HTML generation instead of leaking
// ChatGPT's internal marker syntax into exported files.
export function applyContentReferences(text, msg) {
  const refs = msg?.metadata?.content_references;
  if (!Array.isArray(refs) || !refs.length) return text;

  const replacements = [];
  const fallbackRefs = [];

  for (const ref of refs) {
    const matched = typeof ref?.matched_text === "string" ? ref.matched_text : "";
    if (!matched) continue;

    // sources_footnote commonly has matched_text === " ". It is UI metadata,
    // not inline content, so never replace a generic space in the message.
    if (ref.type === "sources_footnote") continue;

    let replacement = null;
    if (ref.type === "hidden") {
      replacement = "";
    } else if (typeof ref.alt === "string" && ref.alt.trim() !== "") {
      // For grouped webpages ChatGPT already gives us useful Markdown, e.g.
      // ([OpenAI](https://openai.com/brand/)).
      replacement = ref.alt;
    } else if (ref.type === "grouped_webpages") {
      replacement = referenceFallbackMarkdown(ref);
    } else if (matched.includes("\uE200")) {
      // Unknown private ChatGPT inline marker: better omit the renderer token
      // than expose implementation detail in an archival export.
      replacement = "";
    }

    if (replacement == null) continue;

    const start = Number.isInteger(ref.start_idx) ? ref.start_idx : null;
    const end = Number.isInteger(ref.end_idx) ? ref.end_idx : null;
    if (
      start != null && end != null && start >= 0 && end >= start &&
      end <= text.length && text.slice(start, end) === matched
    ) {
      replacements.push({ start, end, replacement });
    } else {
      fallbackRefs.push({ matched, replacement });
    }
  }

  // Offsets refer to the original stored text. Replace from right to left so
  // earlier offsets remain valid even when replacement lengths differ.
  replacements.sort((a, b) => b.start - a.start);
  for (const r of replacements) {
    text = text.slice(0, r.start) + r.replacement + text.slice(r.end);
  }

  // Defensive fallback for content layouts where metadata offsets are relative
  // to a larger logical text than the individual content part we received.
  for (const r of fallbackRefs) {
    const pos = text.indexOf(r.matched);
    if (pos !== -1) {
      text = text.slice(0, pos) + r.replacement + text.slice(pos + r.matched.length);
    }
  }

  return text;
}

export function cleanExportText(text, msg = null) {
  if (typeof text !== "string") return null;

  const isUserMessage = msg?.author?.role === "user";
  if (!isUserMessage) {
    text = applyContentReferences(text, msg);

    // Backward-compatible cleanup when older/partial conversation data does not
    // include content_references metadata. Do this only for non-user messages so
    // a user can literally paste an internal marker into a bug report without
    // the exporter silently changing their text.
    text = text.replaceAll("\uE200memcite\uE201", "");
    text = text.replace(/\uE200cite(?:\uE202[^\uE201]*)*\uE201/g, "");
  }

  // Internal placeholder messages should not become visible chat messages.
  const trimmed = text.trim();
  if (/^\{\s*"skipped_mainline"\s*:\s*true\s*\}$/.test(trimmed)) return null;
  // Never interpret a user-pasted JSON snippet as internal plumbing. The
  // structural tool-call filter is only for non-user nodes.
  if (!isUserMessage && isInternalToolInvocationText(trimmed)) return null;

  return text;
}

export function textParts(msg) {
  const c = msg.content || {};
  const out = [];

  if (Array.isArray(c.parts)) {
    for (const part of c.parts) {
      if (typeof part === "string") {
        const t = cleanExportText(part, msg);
        if (t != null && t.trim() !== "") out.push(t);
      }
    }
  } else if (typeof c.text === "string") {
    const t = cleanExportText(c.text, msg);
    if (t != null && t.trim() !== "") out.push(t);
  }

  return out;
}
