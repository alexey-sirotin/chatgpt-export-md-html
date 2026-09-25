import katex from "./vendor/katex.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isEscaped(source, index) {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && source[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function katexHtml(tex, displayMode) {
  try {
    return katex.renderToString(tex, {
      displayMode,
      output: "mathml",
      throwOnError: true,
      strict: "ignore",
      trust: false
    });
  } catch {
    return null;
  }
}

function findClosing(source, start, close) {
  for (let i = start; i <= source.length - close.length; i++) {
    if (source.startsWith(close, i) && !isEscaped(source, i)) return i;
  }
  return -1;
}

export function replaceInlineMath(text, stash) {
  const source = String(text ?? "");
  let out = "";
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("\\(", index) && !isEscaped(source, index)) {
      const close = findClosing(source, index + 2, "\\)");
      if (close >= 0) {
        const tex = source.slice(index + 2, close);
        const original = source.slice(index, close + 2);
        const html = tex.trim() ? katexHtml(tex, false) : null;
        out += html ? stash(`<span class="math-inline">${html}</span>`) : original;
        index = close + 2;
        continue;
      }
    }

    if (
      source[index] === "$" &&
      !isEscaped(source, index) &&
      source[index + 1] !== "$" &&
      !/\s/.test(source[index + 1] || "")
    ) {
      let close = index + 1;
      while (close < source.length) {
        if (
          source[close] === "$" &&
          !isEscaped(source, close) &&
          source[close - 1] !== "$" &&
          source[close + 1] !== "$" &&
          !/\s/.test(source[close - 1] || "") &&
          !/\d/.test(source[close + 1] || "")
        ) break;
        close++;
      }

      if (close < source.length) {
        const tex = source.slice(index + 1, close);
        const original = source.slice(index, close + 1);
        const html = tex.trim() ? katexHtml(tex, false) : null;
        out += html ? stash(`<span class="math-inline">${html}</span>`) : original;
        index = close + 1;
        continue;
      }
    }

    out += source[index];
    index++;
  }

  return out;
}

function displayDelimiter(line) {
  const trimmed = String(line ?? "").trim();
  if (trimmed.startsWith("$$")) return { open: "$$", close: "$$", trimmed };
  if (trimmed.startsWith("\\[")) return { open: "\\[", close: "\\]", trimmed };
  return null;
}

export function renderDisplayMathBlock(lines, start) {
  const first = displayDelimiter(lines[start]);
  if (!first) return null;

  const { open, close, trimmed } = first;
  const firstRest = trimmed.slice(open.length);
  const sameLineClose = firstRest.lastIndexOf(close);
  if (
    sameLineClose >= 0 &&
    firstRest.slice(sameLineClose + close.length).trim() === ""
  ) {
    const tex = firstRest.slice(0, sameLineClose);
    if (!tex.trim()) return null;
    const original = trimmed;
    const html = katexHtml(tex, true);
    return {
      html: html
        ? `<div class="math-block">${html}</div>`
        : `<div class="math-fallback"><code>${escapeHtml(original)}</code></div>`,
      nextLine: start + 1
    };
  }

  const texLines = [];
  if (firstRest) texLines.push(firstRest);

  for (let index = start + 1; index < lines.length; index++) {
    const line = String(lines[index] ?? "");
    const closeAt = line.lastIndexOf(close);
    if (closeAt >= 0 && line.slice(closeAt + close.length).trim() === "") {
      texLines.push(line.slice(0, closeAt));
      const tex = texLines.join("\n");
      if (!tex.trim()) return null;
      const original = lines.slice(start, index + 1).join("\n");
      const html = katexHtml(tex, true);
      return {
        html: html
          ? `<div class="math-block">${html}</div>`
          : `<div class="math-fallback"><code>${escapeHtml(original).replaceAll("\n", "<br>")}</code></div>`,
        nextLine: index + 1
      };
    }
    texLines.push(line);
  }

  return null;
}
