function remoteImageAttachment(image) {
  const remoteUrl = typeof image?.url === "string" ? image.url.trim() : "";
  if (!remoteUrl) return null;

  let pathName = "";
  try {
    pathName = new URL(remoteUrl).pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {}

  const title = String(image?.title || image?.source || "Image")
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim() || "Image";
  let decodedPathName = pathName;
  try {
    decodedPathName = decodeURIComponent(pathName);
  } catch {}

  const originalName = decodedPathName && /\.[A-Za-z0-9]{1,10}$/.test(decodedPathName)
    ? decodedPathName
    : title;

  const ext = (pathName.match(/\.([A-Za-z0-9]{2,5})(?:$|[?#])/i)?.[1] || "").toLowerCase();
  const mimeType = ext === "png"
    ? "image/png"
    : ["jpg", "jpeg"].includes(ext)
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : "application/octet-stream";

  return {
    source: "claude-remote-image",
    id: image?.id || remoteUrl,
    remoteUrl,
    sourceUrl: typeof image?.page_url === "string" ? image.page_url.trim() || null : null,
    originalName,
    title,
    mimeType,
    isImage: true
  };
}

function extractClaudeContent(message, data) {
  const textParts = [];
  const attachments = [];

  for (const block of message?.content || []) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      textParts.push(block.text);
      continue;
    }

    if (block?.type !== "tool_result" || !Array.isArray(block.content)) continue;

    for (const item of block.content) {
      if (item?.type === "local_resource" && item.file_path) {
        const pathName = item.file_path.split("/").filter(Boolean).at(-1) || null;
        const itemName = typeof item.name === "string" ? item.name.trim() : "";
        const originalName = itemName && /\.[A-Za-z0-9]{1,10}$/.test(itemName)
          ? itemName
          : pathName || itemName || null;

        attachments.push({
          source: "claude-local-resource",
          id: item.uuid || item.file_path,
          filePath: item.file_path,
          originalName,
          mimeType: item.mime_type || "application/octet-stream",
          conversationId: data?.uuid || null,
        });
        continue;
      }

      if (item?.type === "image_gallery" && Array.isArray(item.images)) {
        attachments.push(
          ...item.images.map(remoteImageAttachment).filter(Boolean)
        );
      }
    }
  }

  return { textParts, attachments };
}

function activeBranchIndexByMessageId(data) {
  const byId = new Map((data?.chat_messages || []).map(message => [message.uuid, message]));
  const ids = [];
  const seen = new Set();
  let id = data?.current_leaf_message_uuid || "";

  while (id && !seen.has(id)) {
    seen.add(id);
    const message = byId.get(id);
    if (!message) break;
    ids.push(id);

    const parent = message.parent_message_uuid;
    if (!parent || parent === "00000000-0000-4000-8000-000000000000") break;
    id = parent;
  }

  ids.reverse();
  return new Map(ids.map((messageId, index) => [messageId, index]));
}

function customVisualAttachments(data, messageId, activeIndexById) {
  const rowIndex = activeIndexById.get(messageId);
  if (!Number.isInteger(rowIndex)) return [];

  return (data?.__customVisuals || [])
    .filter(item => item?.rowIndex === rowIndex && typeof item.svg === "string" && item.svg)
    .map((item, index) => ({
      source: "claude-custom-visual",
      id: `claude-visual:${messageId}:${index}`,
      originalName: `claude-visual-${rowIndex + 1}-${index + 1}.svg`,
      mimeType: "image/svg+xml",
      width: item.width || null,
      height: item.height || null,
      isImage: true,
      __inlineSvg: item.svg
    }));
}

export function normalizeClaudeConversation(data, branch, omission = {}) {
  const messages = [];
  const activeIndexById = activeBranchIndexByMessageId(data);

  for (const message of branch || []) {
    const { textParts, attachments } = extractClaudeContent(message, data);
    attachments.push(...customVisualAttachments(data, message.uuid, activeIndexById));
    if (!textParts.length && !attachments.length) continue;

    const role = message.sender === "human" ? "user" : "assistant";
    messages.push({
      id: message.uuid,
      parentId: message.parent_message_uuid || null,
      role,
      sourceRole: message.sender || role,
      createdAt: message.created_at || null,
      model: role === "assistant" ? (message.model || data?.model || null) : null,
      ...(omission.beforeIds?.has?.(message.uuid) ? { omittedBefore: true } : {}),
      content: textParts.map(text => ({
        type: "text",
        text,
        format: "markdown"
      })),
      attachments
    });
  }

  if (omission.omittedAtStart && messages.length) {
    messages[0].omittedBefore = true;
  }
  if (omission.omittedAtEnd && messages.length) {
    messages[messages.length - 1].omittedAfter = true;
  }

  return {
    platform: "claude",
    conversationId: data?.uuid || null,
    conversationUrl: data?.uuid ? "https://claude.ai/chat/" + data.uuid : null,
    title: typeof data?.name === "string" ? data.name : "",
    model: data?.model || null,
    messages
  };
}
