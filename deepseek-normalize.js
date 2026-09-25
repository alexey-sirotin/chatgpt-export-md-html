function secondsToIso(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) ? new Date(seconds * 1000).toISOString() : null;
}

function previewName(name) {
  const value = String(name || "image").trim() || "image";
  return /\.[^.]+$/.test(value) ? value.replace(/\.[^.]+$/, ".webp") : value + ".webp";
}

function markdownLabel(value, fallback = "Image") {
  return String(value || fallback)
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replace(/[\r\n]+/g, " ")
    .trim();
}

function externalImageAttachments(text, seed) {
  const attachments = [];
  let index = 0;
  const transformed = String(text || "").replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
    (_full, alt, remoteUrl) => {
      index++;
      const id = `deepseek-remote-image:${seed}:${index}`;
      attachments.push({
        source: "deepseek-remote-image",
        id,
        remoteUrl,
        sourceUrl: remoteUrl,
        originalName: null,
        title: alt || "Image",
        mimeType: "application/octet-stream",
        isImage: true
      });
      return `![${markdownLabel(alt)}](attachment://${encodeURIComponent(id)})`;
    }
  );
  return { text: transformed, attachments };
}

function fileAttachments(fragment) {
  return (fragment?.files || [])
    .filter(file => file?.id && file?.signed_path)
    .map(file => ({
      source: "deepseek-user-file",
      id: String(file.id),
      signedPath: file.signed_path,
      providerOriginalName: file.file_name || null,
      originalName: file.is_image ? previewName(file.file_name) : (file.file_name || null),
      title: file.file_name || null,
      mimeType: file.is_image ? "image/webp" : "application/octet-stream",
      size: Number.isFinite(Number(file.file_size)) ? Number(file.file_size) : null,
      width: Number.isFinite(Number(file.width)) ? Number(file.width) : null,
      height: Number.isFinite(Number(file.height)) ? Number(file.height) : null,
      isImage: file.is_image === true
    }));
}

function thinkingMarkdown(fragment) {
  const text = String(fragment?.content || "").trim();
  if (!text) return "";
  const elapsed = Number(fragment?.elapsed_secs);
  const suffix = Number.isFinite(elapsed) ? ` (${elapsed.toFixed(1).replace(/\.0$/, "")} s)` : "";
  return `#### Thinking${suffix}\n\n${text}`;
}

export function normalizeDeepSeekConversation(data, branch, omission = {}) {
  const messages = [];

  for (const turn of branch || []) {
    const content = [];
    const attachments = [];
    let textSeed = 0;

    for (const fragment of turn?.fragments || []) {
      const type = String(fragment?.type || "").toUpperCase();

      if (type === "FILE") {
        attachments.push(...fileAttachments(fragment));
        continue;
      }

      if (type === "THINK") {
        const markdown = thinkingMarkdown(fragment);
        if (markdown) content.push({ type: "text", text: markdown, format: "markdown" });
        continue;
      }

      if (type !== "REQUEST" && type !== "RESPONSE") continue;
      const raw = typeof fragment?.content === "string" ? fragment.content : "";
      if (!raw.trim()) continue;
      textSeed++;
      const parsed = externalImageAttachments(raw, `${turn.id}:${textSeed}`);
      content.push({ type: "text", text: parsed.text, format: "markdown" });
      attachments.push(...parsed.attachments);
    }

    if (!content.length && !attachments.length) continue;

    messages.push({
      id: String(turn.id),
      parentId: turn.parentId == null ? null : String(turn.parentId),
      role: turn.role === "user" ? "user" : "assistant",
      sourceRole: turn.role || null,
      createdAt: secondsToIso(turn.insertedAt),
      model: turn.role === "assistant" ? (turn.model || null) : null,
      ...(omission.beforeIds?.has?.(String(turn.id)) ? { omittedBefore: true } : {}),
      content,
      attachments
    });
  }

  if (omission.omittedAtStart && messages.length) messages[0].omittedBefore = true;
  if (omission.omittedAtEnd && messages.length) messages[messages.length - 1].omittedAfter = true;

  return {
    platform: "deepseek",
    conversationId: data?.conversationId || null,
    conversationUrl: data?.conversationId
      ? "https://chat.deepseek.com/a/chat/s/" + encodeURIComponent(data.conversationId)
      : null,
    title: typeof data?.title === "string" ? data.title : "",
    model: null,
    messages
  };
}

export { externalImageAttachments, fileAttachments, thinkingMarkdown };
