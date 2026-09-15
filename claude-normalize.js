function markdownImage(image) {
  const url = typeof image?.url === "string" ? image.url.trim() : "";
  if (!url) return "";

  const title = String(image?.title || image?.source || "Image")
    .replace(/[\[\]]/g, "")
    .trim() || "Image";
  const target = typeof image?.page_url === "string" && image.page_url.trim()
    ? image.page_url.trim()
    : url;

  return "[Image: " + title + "](" + url + ")" + (target !== url ? " ([source](" + target + "))" : "");
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
        const images = item.images.map(markdownImage).filter(Boolean);
        if (images.length) textParts.push(images.join("\n\n"));
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
