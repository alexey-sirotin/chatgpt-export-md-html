export const t = (key, substitutions) => {
  const args = Array.isArray(substitutions)
    ? substitutions.map(String)
    : substitutions == null ? undefined : String(substitutions);
  return chrome.i18n.getMessage(key, args) || key;
};

export function safeName(name) {
  return (name || "ChatGPT export")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180) || "ChatGPT export";
}

export function safeAttachmentName(name) {
  if (typeof name !== "string") return null;
  let value = name.trim();
  if (!value) return null;

  // Keep the original human-readable filename, but make it safe as a single
  // ZIP/filesystem path component on Windows and other common platforms.
  value = value
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/[. ]+$/g, "")
    .slice(0, 180);

  return value || null;
}

export function filenameWithExtension(name, ext) {
  const safe = safeAttachmentName(name);
  if (!safe) return null;
  if (/\.[A-Za-z0-9]{1,8}$/.test(safe)) return safe;
  return ext ? `${safe}.${ext}` : safe;
}

export function uniqueFilename(preferredName, fallbackName, usedNames) {
  const preferred = safeAttachmentName(preferredName) || safeAttachmentName(fallbackName) || "attachment.bin";
  const dot = preferred.lastIndexOf(".");
  const stem = dot > 0 ? preferred.slice(0, dot) : preferred;
  const suffix = dot > 0 ? preferred.slice(dot) : "";

  let candidate = preferred;
  let n = 2;
  while (usedNames.has(candidate.toLocaleLowerCase())) {
    candidate = `${stem} (${n})${suffix}`;
    n++;
  }
  usedNames.add(candidate.toLocaleLowerCase());
  return candidate;
}

export function isoUtc(seconds) {
  return typeof seconds === "number" ? new Date(seconds * 1000).toISOString() : null;
}

export function localTime(seconds) {
  if (typeof seconds !== "number") return "";
  const d = new Date(seconds * 1000);
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


export function extFromMime(mime, fallbackName="") {
  const byName = fallbackName.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1];
  if (byName) return byName.toLowerCase();
  const map = {
    "image/png":"png","image/jpeg":"jpg","image/webp":"webp","image/gif":"gif",
    "application/pdf":"pdf","text/plain":"txt"
  };
  return map[mime] || "bin";
}

// Minimal ZIP writer (store/no compression), enough for MVP.

export function enc(s){ return [...new TextEncoder().encode(s)]; }

// Markdown link destinations are URLs, not raw filesystem paths.
// Encode each path segment so spaces, Cyrillic and URL-significant
// characters work consistently across Markdown renderers.
export function markdownHref(localPath) {
  return localPath.split("/").map(encodeURIComponent).join("/");
}

export function markdownLabel(value) {
  return String(value ?? "")
    .replaceAll("\\", "\\\\")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}

export function attachmentDisplayName(attachment, fallback) {
  return attachment?.originalName || attachment?.title || fallback;
}
