function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function openingFence(line) {
  return String(line ?? "").match(/^(`{3,})\s*([^\s`]*)?.*$/);
}

function isClosingFence(line, minimumLength) {
  const match = String(line ?? "").match(/^(`{3,})\s*$/);
  return !!match && match[1].length >= minimumLength;
}

function replaceMermaidFences(text, blocks) {
  const lines = String(text ?? "").replaceAll("\r\n", "\n").split("\n");
  const out = [];

  for (let index = 0; index < lines.length; index++) {
    const open = openingFence(lines[index]);
    if (!open) {
      out.push(lines[index]);
      continue;
    }

    const fenceLength = open[1].length;
    const language = String(open[2] || "").toLowerCase();
    let closeIndex = -1;

    for (let candidate = index + 1; candidate < lines.length; candidate++) {
      if (isClosingFence(lines[candidate], fenceLength)) {
        closeIndex = candidate;
        break;
      }
    }

    if (closeIndex < 0) {
      out.push(...lines.slice(index));
      break;
    }

    if (language !== "mermaid") {
      out.push(...lines.slice(index, closeIndex + 1));
      index = closeIndex;
      continue;
    }

    const source = lines.slice(index + 1, closeIndex).join("\n");
    if (!source.trim()) {
      out.push(...lines.slice(index, closeIndex + 1));
      index = closeIndex;
      continue;
    }

    const blockIndex = blocks.length;
    const syntheticLanguage = `chatgpt-export-mermaid-${blockIndex}`;
    const placeholder = `CHATGPT_EXPORT_MERMAID_${blockIndex}`;
    blocks.push({
      index: blockIndex,
      source,
      syntheticLanguage,
      placeholder
    });

    out.push(
      `\`\`\`${syntheticLanguage}`,
      placeholder,
      "```"
    );
    index = closeIndex;
  }

  return out.join("\n");
}

export function prepareMessagesForMermaid(messages) {
  const blocks = [];
  const preparedMessages = (messages || []).map(message => ({
    ...message,
    content: (message.content || []).map(part => {
      if (part?.type !== "text" || typeof part.text !== "string") return part;
      return {
        ...part,
        text: replaceMermaidFences(part.text, blocks)
      };
    })
  }));

  return { messages: preparedMessages, blocks };
}

function renderedSvg(result) {
  if (typeof result === "string") return result;
  if (result && typeof result.svg === "string") return result.svg;
  return null;
}

function mermaidStyle() {
  return `
  .mermaid-block { margin: 1em 0; padding: 12px; overflow-x: auto; overflow-y: hidden; text-align: center; color-scheme: light; background: #fff; border-radius: 8px; }
  .mermaid-block svg { display: block; max-width: 100%; height: auto; margin: 0 auto; }
  @media print { .mermaid-block { break-inside: avoid; overflow: visible; } }`;
}

export function applyMermaidRenderings(html, blocks, renderings = []) {
  if (!blocks?.length) return html;

  let out = String(html ?? "");
  for (const block of blocks) {
    const needle = `<pre><code class="language-${block.syntheticLanguage}">${block.placeholder}</code></pre>`;
    const svg = renderedSvg(renderings[block.index]);
    const replacement = svg
      ? `<div class="mermaid-block">${svg}</div>`
      : `<pre><code class="language-mermaid">${escapeHtml(block.source)}</code></pre>`;
    out = out.replace(needle, replacement);
  }

  const style = mermaidStyle();
  if (out.includes("</style>")) {
    out = out.replace("</style>", `${style}\n</style>`);
  }
  return out;
}
