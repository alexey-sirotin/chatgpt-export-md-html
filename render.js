import { t, markdownHref, markdownLabel, attachmentDisplayName } from "./utils.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function safeHtmlHref(value) {
  const href = String(value ?? "").trim();
  if (!href) return "#";

  // Allow ordinary web/mail links and local relative paths used by exported media.
  if (/^(https?:|mailto:|#|\.\.?\/)/i.test(href)) return href;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href;
  return "#";
}

function inlineMarkdownToHtml(text) {
  let source = String(text ?? "");
  const tokens = [];

  const stash = html => {
    const token = `@@CHATGPT2MD_INLINE_${tokens.length}@@`;
    tokens.push(html);
    return token;
  };

  // Protect inline code and links before escaping the remaining source.
  source = source.replace(/`([^`\n]+)`/g, (_, code) =>
    stash(`<code>${escapeHtml(code)}</code>`)
  );
  source = source.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) =>
    stash(`<a href="${escapeHtml(safeHtmlHref(href))}">${escapeHtml(label)}</a>`)
  );

  let out = escapeHtml(source);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  out = out.replace(/~~([^~]+)~~/g, "<del>$1</del>");
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");

  tokens.forEach((html, i) => {
    out = out.replaceAll(`@@CHATGPT2MD_INLINE_${i}@@`, html);
  });
  return out;
}

function markdownToHtml(markdown) {
  const lines = String(markdown ?? "").replaceAll("\r\n", "\n").split("\n");
  const out = [];
  let paragraph = [];
  let quote = [];
  let listType = null;
  let inFence = false;
  let fenceLang = "";
  let codeLines = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    out.push(`<p>${paragraph.map(inlineMarkdownToHtml).join("<br>")}</p>`);
    paragraph = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    out.push(`<blockquote>${quote.map(inlineMarkdownToHtml).join("<br>")}</blockquote>`);
    quote = [];
  };
  const closeList = () => {
    if (!listType) return;
    out.push(`</${listType}>`);
    listType = null;
  };
  const openList = type => {
    if (listType === type) return;
    closeList();
    listType = type;
    out.push(`<${type}>`);
  };

  for (const line of lines) {
    const fence = line.match(/^```\s*([^\s`]*)?.*$/);
    if (fence) {
      if (!inFence) {
        flushParagraph();
        flushQuote();
        closeList();
        inFence = true;
        fenceLang = fence[1] || "";
        codeLines = [];
      } else {
        const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
        out.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
        inFence = false;
        fenceLang = "";
        codeLines = [];
      }
      continue;
    }

    if (inFence) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      flushQuote();
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMarkdownToHtml(heading[2])}</h${level}>`);
      continue;
    }

    const blockquote = line.match(/^>\s?(.*)$/);
    if (blockquote) {
      flushParagraph();
      closeList();
      quote.push(blockquote[1]);
      continue;
    }
    flushQuote();

    const unordered = line.match(/^\s*[-+*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      openList("ul");
      out.push(`<li>${inlineMarkdownToHtml(unordered[1])}</li>`);
      continue;
    }

    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      openList("ol");
      out.push(`<li>${inlineMarkdownToHtml(ordered[1])}</li>`);
      continue;
    }

    closeList();
    paragraph.push(line);
  }

  if (inFence) {
    const cls = fenceLang ? ` class="language-${escapeHtml(fenceLang)}"` : "";
    out.push(`<pre><code${cls}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  }
  flushParagraph();
  flushQuote();
  closeList();
  return out.join("\n");
}

function localTimeIso(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


export function buildMarkdownExport({ title, conversationUrl, messages }) {
  const md = [
    `# ${title}`,
    "",
    `Оригинал: ${conversationUrl}`,
    ""
  ];

  for (const message of messages) {
    const texts = (message.content || [])
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text);
    const attachments = message.attachments || [];
    if (!texts.length && !attachments.length) continue;

    md.push(`### \[${localTimeIso(message.createdAt)}\] ${message.authorName || message.role || ""}`, "");
    if (texts.length) md.push(texts.join("\n\n"), "");

    for (const a of attachments) {
      if (a.error) {
        md.push(`*[Не удалось скачать вложение ${a.originalName || a.id || a.sandboxPath || a.localName || ""}]*`, "");
        continue;
      }
      if (a.source === "sandbox" || !a.localPath) continue;

      const href = markdownHref(a.localPath);
      if ((a.mimeType || "").startsWith("image/")) {
        const imageAlt = attachmentDisplayName(a, "Изображение");
        md.push(`[![${markdownLabel(imageAlt)}](${href})](${href})`, "");
      } else {
        md.push(`[${markdownLabel(a.originalName || a.localName)}](${href})`, "");
      }
    }
  }

  return md.join("\n");
}

export function buildHtmlExport({ title, conversationUrl, messages }) {
  const visibleMessages = messages.filter(message => {
    const hasText = (message.content || []).some(
      part => part?.type === "text" && typeof part.text === "string" && part.text.trim() !== ""
    );
    const hasAttachment = (message.attachments || []).length > 0;
    return hasText || hasAttachment;
  });

  const htmlMessages = visibleMessages.map(message => {
    const author = escapeHtml(message.authorName || message.role || "");
    const createdAt = escapeHtml(message.createdAt || "");
    const displayTime = escapeHtml(localTimeIso(message.createdAt));
    const body = (message.content || [])
      .filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => markdownToHtml(part.text))
      .join("\n");

    const attachments = (message.attachments || []).map(a => {
      if (a.error) {
        return `<p class="attachment-error"><em>${escapeHtml(t("htmlAttachmentFailed", a.originalName || a.id || ""))}</em></p>`;
      }
      if (!a.localPath) return "";
      // sandbox:/mnt/data links already occupy their original position in the
      // message text after being rewritten to a local path. Do not append a
      // duplicate attachment link at the end of the HTML message.
      if (a.source === "sandbox") return "";
      const href = escapeHtml(markdownHref(a.localPath));
      const originalLabel = a.originalName || a.title || null;
      const label = escapeHtml(attachmentDisplayName(a, a.localName || t("htmlAttachment")));
      if ((a.mimeType || "").startsWith("image/")) {
        return `<figure><a href="${href}"><img src="${href}" alt="${label}"></a>${originalLabel ? `<figcaption>${label}</figcaption>` : ""}</figure>`;
      }
      return `<p class="attachment"><a href="${href}">${label}</a></p>`;
    }).join("\n");

    return `<article class="message ${message.role === "user" ? "user" : "assistant"}">
  <header><strong>${author}</strong><time datetime="${createdAt}">${displayTime}</time></header>
  <div class="content">${body}${attachments}</div>
</article>`;
  }).join("\n");

  const lang = (chrome.i18n.getUILanguage() || "en").toLowerCase().startsWith("ru") ? "ru" : "en";
  const escapedTitle = escapeHtml(title);
  const escapedUrl = escapeHtml(conversationUrl);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapedTitle}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 16px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: Canvas; color: CanvasText; }
  main { max-width: 920px; margin: 0 auto; padding: 32px 20px 64px; }
  .document-header { margin-bottom: 28px; }
  .document-header h1 { margin: 0 0 8px; line-height: 1.2; }
  .document-header p { margin: 0; overflow-wrap: anywhere; }
  .message { margin: 0 0 18px; padding: 16px 18px; border: 1px solid color-mix(in srgb, CanvasText 16%, transparent); border-radius: 12px; }
  .message.user { background: color-mix(in srgb, Canvas 94%, #4a90e2 6%); }
  .message.assistant { background: color-mix(in srgb, Canvas 96%, #7a7a7a 4%); }
  .message header { display: flex; gap: 12px; align-items: baseline; margin-bottom: 10px; }
  .message time { font-size: 0.82em; opacity: 0.65; }
  .content > :first-child { margin-top: 0; }
  .content > :last-child { margin-bottom: 0; }
  p { margin: 0 0 0.85em; }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.2em 0 0.5em; }
  blockquote { margin: 0.8em 0; padding: 0.1em 0 0.1em 1em; border-left: 3px solid color-mix(in srgb, CanvasText 28%, transparent); opacity: 0.9; }
  pre { overflow-x: auto; padding: 12px 14px; border-radius: 8px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
  code { font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace; font-size: 0.92em; }
  :not(pre) > code { padding: 0.08em 0.3em; border-radius: 4px; background: color-mix(in srgb, CanvasText 8%, Canvas); }
  a { color: LinkText; }
  figure { margin: 14px 0 4px; }
  figure img { display: block; max-width: 100%; height: auto; border-radius: 8px; }
  figcaption { margin-top: 5px; font-size: 0.8em; opacity: 0.65; }
  .attachment-error { opacity: 0.7; }
  @media print {
    :root { color-scheme: light; }
    body { background: white; color: black; }
    main { max-width: none; padding: 0; }
    .message { break-inside: auto; border-color: #bbb; background: white !important; }
    figure, pre { break-inside: avoid; }
    a { color: inherit; text-decoration: underline; }
  }
</style>
</head>
<body>
<main>
  <header class="document-header">
    <h1>${escapedTitle}</h1>
    <p>${escapeHtml(t("htmlOriginalLabel"))}: <a href="${escapedUrl}">${escapedUrl}</a></p>
  </header>
${htmlMessages}
</main>
</body>
</html>`;
}

