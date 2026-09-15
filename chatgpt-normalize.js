import { isoUtc } from "./utils.js";
import { textParts } from "./conversation.js";
import { attachmentRecords } from "./attachments.js";

export function normalizeChatGPTConversation(data, branch, omission = {}) {
  const messages = [];
  let omissionPending = !!omission.omittedAtStart;
  const beforeNodes = omission.beforeNodes instanceof Set
    ? omission.beforeNodes
    : new Set();

  for (const node of branch || []) {
    if (beforeNodes.has(node)) omissionPending = true;

    const msg = node?.message;
    if (!msg) continue;

    const sourceRole = msg.author?.role || "unknown";
    const role = sourceRole === "tool" ? "assistant" : sourceRole;
    const texts = textParts(msg);
    const attachments = attachmentRecords(msg, data?.safe_urls || []).map(attachment =>
      attachment.source === "sandbox"
        ? {
            ...attachment,
            conversationId: data?.conversation_id || null,
            messageId: msg.id || null
          }
        : attachment
    );

    if (!texts.length && !attachments.length) continue;

    messages.push({
      id: msg.id,
      parentId: node.parent || null,
      role,
      sourceRole,
      createdAt: isoUtc(msg.create_time),
      model:
        msg.metadata?.model_slug ||
        msg.metadata?.resolved_model_slug ||
        null,
      ...(omissionPending ? { omittedBefore: true } : {}),
      content: texts.map(text => ({
        type: "text",
        text,
        format: "markdown"
      })),
      attachments
    });

    omissionPending = false;
  }

  if (omission.omittedAtEnd && messages.length) {
    messages[messages.length - 1].omittedAfter = true;
  }

  return {
    platform: "chatgpt",
    conversationId: data?.conversation_id || null,
    conversationUrl: data?.conversation_id
      ? `https://chatgpt.com/c/${data.conversation_id}`
      : null,
    title: typeof data?.title === "string" ? data.title : "",
    messages
  };
}
