const ASSET_BASE = "https://assets.grok.com/";

function absoluteAssetUrl(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : ASSET_BASE + trimmed.replace(/^\/+/, "");
}

function fileNameFromUrl(value, fallback = null) {
  if (!value) return fallback;
  try {
    const name = new URL(value, ASSET_BASE).pathname.split("/").filter(Boolean).at(-1);
    return name ? decodeURIComponent(name) : fallback;
  } catch {
    return fallback;
  }
}

export function parseGrokCards(cardAttachmentsJson = []) {
  const cards = [];
  for (const raw of cardAttachmentsJson || []) {
    if (!raw) continue;
    if (typeof raw === "object") {
      cards.push(raw);
      continue;
    }
    if (typeof raw !== "string") continue;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") cards.push(parsed);
    } catch {}
  }
  return cards;
}

function attachmentFromCard(card, conversationId) {
  if (!card || typeof card !== "object") return null;

  if (card.cardType === "generated_image_card" || card?.image_chunk?.imageUrl) {
    const remoteUrl = absoluteAssetUrl(card?.image_chunk?.imageUrl);
    if (!remoteUrl) return null;
    return {
      source: "grok-generated-image",
      id: card.id || card?.image_chunk?.imageUuid || remoteUrl,
      assetId: card?.image_chunk?.imageUuid || null,
      remoteUrl,
      sourceUrl: null,
      originalName: fileNameFromUrl(remoteUrl, "image.jpg"),
      title: card.query || "Generated image",
      mimeType: card?.image_chunk?.mimeType || "image/jpeg",
      isImage: true
    };
  }

  if (card.cardType === "image_card" && card.image) {
    const remoteUrl = card.image.original || card.image.thumbnail || null;
    if (!remoteUrl) return null;
    return {
      source: "grok-search-image",
      id: card.id || remoteUrl,
      remoteUrl,
      sourceUrl: card.image.link || null,
      originalName: fileNameFromUrl(remoteUrl, card.image.title || "Image"),
      title: card.image.title || card.image.source || "Image",
      mimeType: "application/octet-stream",
      isImage: true
    };
  }

  if (card.type === "render_file" || card.cardType === "rendered_file_card") {
    const remoteUrl = absoluteAssetUrl(card.url);
    if (!remoteUrl) return null;
    const originalName = card.file_name || fileNameFromUrl(remoteUrl);
    return {
      source: "grok-generated-file",
      id: card.id || card.file_path || remoteUrl,
      remoteUrl,
      sourceUrl: null,
      conversationId: conversationId || null,
      filePath: card.file_path || (originalName ? "/" + originalName : null),
      originalName,
      title: card.file_name || null,
      mimeType: card.mime_type || "application/octet-stream",
      size: Number.isFinite(Number(card.file_size)) ? Number(card.file_size) : null,
      isImage: false
    };
  }

  return null;
}

function userAssetAttachments(fileAttachments, cardAttachments, conversationId) {
  const coveredAssetIds = new Set(
    (cardAttachments || [])
      .map(attachment => attachment?.assetId)
      .filter(Boolean)
      .map(String)
  );

  return (fileAttachments || [])
    .map(String)
    .filter(Boolean)
    .filter(assetId => !coveredAssetIds.has(assetId))
    .map(assetId => ({
      source: "grok-user-asset",
      id: assetId,
      assetId,
      conversationId: conversationId || null,
      remoteUrl: null,
      sourceUrl: null,
      originalName: null,
      title: null,
      mimeType: "application/octet-stream",
      isImage: false
    }));
}

function removeGrokCardMarkup(text) {
  return String(text || "")
    .replace(/<grok:render\b[^>]*>\s*<\/grok:render>/gi, "")
    .replace(/<grok-card\b[^>]*>\s*<\/grok-card>/gi, "");
}

function protectNestedMarkdownFences(text) {
  const lines = String(text || "").replaceAll("\r\n", "\n").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const opening = lines[i].match(/^```\s*(?:markdown|md)\s*$/i);
    if (!opening) continue;

    let nestedOpen = -1;
    let nestedClose = -1;
    let outerClose = -1;

    for (let j = i + 1; j < lines.length; j++) {
      if (nestedOpen < 0) {
        if (/^```[^`\s]+.*$/.test(lines[j])) nestedOpen = j;
        else if (/^```\s*$/.test(lines[j])) break;
        continue;
      }

      if (nestedClose < 0) {
        if (/^```\s*$/.test(lines[j])) nestedClose = j;
        continue;
      }

      if (/^```\s*$/.test(lines[j])) {
        outerClose = j;
        break;
      }
    }

    if (nestedOpen >= 0 && nestedClose >= 0 && outerClose >= 0) {
      lines[i] = lines[i].replace(/^```/, "````");
      lines[outerClose] = "````";
      i = outerClose;
    }
  }

  return lines.join("\n");
}

export function cleanGrokMarkdown(text) {
  return protectNestedMarkdownFences(removeGrokCardMarkup(text))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeGrokConversation(data, branch, omission = {}) {
  const messages = [];

  for (const turn of branch || []) {
    const text = cleanGrokMarkdown(typeof turn?.message === "string" ? turn.message : "");
    const cardAttachments = parseGrokCards(turn?.cardAttachmentsJson)
      .map(card => attachmentFromCard(card, data?.conversationId))
      .filter(Boolean);
    const attachments = [
      ...cardAttachments,
      ...userAssetAttachments(turn?.fileAttachments, cardAttachments, data?.conversationId)
    ];

    if (!text.trim() && !attachments.length) continue;

    messages.push({
      id: turn.id,
      parentId: null,
      role: turn.role === "user" ? "user" : "assistant",
      sourceRole: turn.role || null,
      createdAt: turn.createdAt || null,
      model: turn.role === "assistant" ? (turn.model || null) : null,
      ...(omission.beforeIds?.has?.(turn.id) ? { omittedBefore: true } : {}),
      content: text ? [{ type: "text", text, format: "markdown" }] : [],
      attachments
    });
  }

  if (omission.omittedAtStart && messages.length) messages[0].omittedBefore = true;
  if (omission.omittedAtEnd && messages.length) messages[messages.length - 1].omittedAfter = true;

  return {
    platform: "grok",
    conversationId: data?.conversationId || null,
    conversationUrl: data?.conversationId ? "https://grok.com/c/" + data.conversationId : null,
    title: typeof data?.title === "string" ? data.title : "",
    model: null,
    messages
  };
}
