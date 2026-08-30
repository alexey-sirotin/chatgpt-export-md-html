export function sandboxAttachmentRecords(msg) {
  // Files created by ChatGPT's code/interpreter tools are rendered from Markdown
  // links such as [Download file](sandbox:/mnt/data/example.zip). The raw
  // conversation node does not expose them as ordinary metadata.attachments;
  // the sandbox path itself is the only durable handle until it is resolved via
  // /interpreter/download.
  if (!msg || msg.author?.role === "user") return [];

  const texts = [];
  const c = msg.content || {};
  if (Array.isArray(c.parts)) {
    for (const part of c.parts) {
      if (typeof part === "string") texts.push(part);
    }
  } else if (typeof c.text === "string") {
    texts.push(c.text);
  }

  const byUrl = new Map();
  const re = /\[([^\]\r\n]+)\]\((sandbox:\/mnt\/data\/[^)\r\n]+)\)/g;

  for (const text of texts) {
    re.lastIndex = 0;
    for (let match; (match = re.exec(text)); ) {
      const sandboxUrl = match[2].trim();
      let sandboxPath = sandboxUrl.slice("sandbox:".length);
      try { sandboxPath = decodeURI(sandboxPath); } catch {}

      let originalName = sandboxPath.split("/").filter(Boolean).at(-1) || null;
      if (originalName) {
        try { originalName = decodeURIComponent(originalName); } catch {}
      }

      if (!byUrl.has(sandboxUrl)) {
        byUrl.set(sandboxUrl, {
          source: "sandbox",
          sandboxUrl,
          sandboxPath,
          originalName,
          messageId: msg.id || null
        });
      }
    }
  }

  return [...byUrl.values()];
}

export function replaceSandboxLinkDestinations(text, replacements) {
  if (typeof text !== "string" || !replacements?.size) return text;
  return text.replace(/\]\((sandbox:\/mnt\/data\/[^)\r\n]+)\)/g, (full, sandboxUrl) => {
    const replacement = replacements.get(sandboxUrl);
    return replacement ? `](${replacement})` : full;
  });
}

function walkObject(value, visit, seen = new WeakSet()) {
  if (value == null) return;

  if (typeof value === "object") {
    if (seen.has(value)) return;
    seen.add(value);
    visit(value);

    if (Array.isArray(value)) {
      for (const v of value) walkObject(v, visit, seen);
    } else {
      for (const v of Object.values(value)) walkObject(v, visit, seen);
    }
  }
}

function extractFileId(value) {
  if (typeof value !== "string") return null;

  const sediment = value.match(/^sediment:\/\/(file_[A-Za-z0-9_-]+)/);
  if (sediment) return sediment[1];

  const plain = value.match(/^(file_[A-Za-z0-9_-]+)$/);
  if (plain) return plain[1];

  try {
    const u = new URL(value.replaceAll("&amp;", "&"));
    const id = u.searchParams.get("id");
    if (id?.startsWith("file_")) return id;
  } catch {}

  return null;
}

function recordLooksLikeImage(value) {
  if (!value || typeof value !== "object") return false;

  const mimeType = String(value.mime_type || value.mimeType || "").toLowerCase();
  if (mimeType.startsWith("image/")) return true;

  const structuralType = String(
    value.content_type || value.contentType || value.type || ""
  ).toLowerCase();
  if (structuralType === "image_asset_pointer" || structuralType.startsWith("image/")) {
    return true;
  }

  const source = String(value.source || "").toLowerCase();
  if (source.includes("image")) return true;

  for (const key of Object.keys(value)) {
    if (/image_(?:asset_)?pointer|image_url|image_src/i.test(key)) return true;
  }

  const name =
    value.name || value.filename || value.file_name ||
    value.original_name || value.originalName || value.title || "";
  if (/\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i.test(String(name))) {
    return true;
  }

  // ChatGPT image asset records normally retain pixel dimensions even when
  // the backing file is no longer downloadable.
  return Number.isFinite(Number(value.width)) && Number.isFinite(Number(value.height));
}

export function attachmentRecords(msg, safeUrls = []) {
  const byId = new Map();

  function merge(rec) {
    if (!rec?.id) return;
    const old = byId.get(rec.id) || {};
    byId.set(rec.id, { ...old, ...Object.fromEntries(
      Object.entries(rec).filter(([,v]) => v !== undefined && v !== null && v !== "")
    )});
  }

  // Explicit attachment metadata.
  const meta = msg.metadata?.attachments;
  if (Array.isArray(meta)) {
    for (const a of meta) {
      // Some attachment metadata IDs are not the actual estuary file id.
      // Keep them only if they look like ChatGPT file ids.
      const actualId =
        extractFileId(a.id) ||
        extractFileId(a.asset_pointer) ||
        extractFileId(a.url) ||
        extractFileId(a.download_url);

      if (actualId) {
        merge({
          id: actualId,
          originalName: a.name || a.filename || a.original_name || a.originalName || a.title,
          mimeType: a.mime_type || a.mimeType,
          size: a.size || a.size_bytes,
          width: a.width,
          height: a.height,
          source: a.source,
          libraryFileId: a.library_file_id,
          ...(recordLooksLikeImage(a) ? { isImage: true } : {})
        });
      }
    }
  }

  // Recursively inspect the whole message. This catches user uploads,
  // generated images, image_asset_pointer records and newer payload shapes.
  walkObject(msg, obj => {
    let fileId = null;

    for (const [k, v] of Object.entries(obj)) {
      if (typeof v !== "string") continue;
      if (
        /asset_pointer|file_id|fileId|download_url|content_url|image_url|url|src/i.test(k)
      ) {
        fileId = extractFileId(v) || fileId;
      }
    }

    if (!fileId) {
      for (const v of Object.values(obj)) {
        fileId = extractFileId(v) || fileId;
      }
    }

    if (fileId) {
      merge({
        id: fileId,
        originalName:
          obj.name || obj.filename || obj.file_name || obj.original_name || obj.originalName || obj.title ||
          obj.metadata?.name || obj.metadata?.filename || obj.metadata?.file_name ||
          obj.metadata?.original_name || obj.metadata?.originalName || obj.metadata?.title,
        mimeType:
          obj.mime_type ||
          obj.mimeType ||
          (typeof obj.content_type === "string" && obj.content_type.includes("/")
            ? obj.content_type
            : null),
        size: obj.size || obj.size_bytes,
        width: obj.width,
        height: obj.height,
        source: obj.source,
        ...(recordLooksLikeImage(obj) ? { isImage: true } : {})
      });
    }
  });

  // Generated image titles live at message level rather than on the file
  // record itself. Keep them as a fallback filename source so old chats still
  // retain human-readable image names after the backing file has expired.
  const imageGenTitle =
    typeof msg.metadata?.image_gen_title === "string"
      ? msg.metadata.image_gen_title.trim()
      : "";
  if (imageGenTitle) {
    for (const [id, rec] of byId) {
      if (rec.isImage && !rec.originalName) {
        byId.set(id, { ...rec, originalName: imageGenTitle });
      }
    }
  }

  // Any signed estuary URL in safe_urls is authoritative for its file id.
  for (const raw of safeUrls || []) {
    const url = String(raw).replaceAll("&amp;", "&");
    try {
      const u = new URL(url);
      if (!u.pathname.includes("/backend-api/estuary/content")) continue;
      const id = u.searchParams.get("id");
      if (!id?.startsWith("file_")) continue;

      // Only attach safe URLs that are actually referenced somewhere in this message.
      if (byId.has(id)) {
        merge({ id, signedUrl: url });
      }
    } catch {}
  }

  return [...byId.values(), ...sandboxAttachmentRecords(msg)];
}
