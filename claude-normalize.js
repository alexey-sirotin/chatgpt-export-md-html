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

export function normalizeClaudeConversation(data, branch, omission = {}) {
  const messages = [];

  for (const message of branch || []) {
    const { textParts, attachments } = extractClaudeContent(message, data);
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
