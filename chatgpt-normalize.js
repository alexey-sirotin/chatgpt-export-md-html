import { isoUtc } from "./utils.js";
import { textParts } from "./conversation.js";
import { attachmentRecords } from "./attachments.js";

function normalizeMathSegment(text) {
  const codeSpans = [];
  let source = String(text ?? "").replace(/(`+)([^`\n]*?)\1/g, match => {
    const token = `\u0000CHATGPT_EXPORT_CODE_${codeSpans.length}\u0000`;
    codeSpans.push(match);
    return token;
  });

  // ChatGPT commonly emits LaTeX delimiters as \(...\) and \[...\].
  // Normalize those to the dollar delimiters understood by common Markdown
  // math renderers (including VS Code) while keeping the TeX source itself.
  source = source.replace(/(?<!\\)\\\[((?:.|\n)*?)(?<!\\)\\\]/g, (_, tex) => `$$${tex}$$`);
  source = source.replace(/(?<!\\)\\\(([^\n]*?)(?<!\\)\\\)/g, (_, tex) => `$${tex}$`);

  codeSpans.forEach((code, index) => {
    source = source.replaceAll(`\u0000CHATGPT_EXPORT_CODE_${index}\u0000`, code);
  });

  return source;
}

export function normalizeChatGPTMarkdownMath(text) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  const chunks = [];
  let plain = [];
  let fenceLength = 0;

  const flushPlain = () => {
    if (!plain.length) return;
    chunks.push(normalizeMathSegment(plain.join("\n")));
    plain = [];
  };

  for (const line of lines) {
    const fence = line.match(/^\s*(`{3,})/);

    if (fenceLength) {
      chunks.push(line);
      const trimmed = line.trim();
      if (/^`+$/.test(trimmed) && trimmed.length >= fenceLength) fenceLength = 0;
      continue;
    }

    if (fence) {
      flushPlain();
      fenceLength = fence[1].length;
      chunks.push(line);
      continue;
    }

    plain.push(line);
  }

  flushPlain();
  return chunks.join("\n");
}

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
        text: normalizeChatGPTMarkdownMath(text),
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
