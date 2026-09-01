import { t } from "./utils.js";

export async function getConversationInPage(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [t("errorConversationId"), t("errorAccessToken")],
    func: async (errorConversationId, errorAccessToken) => {
      const m = location.pathname.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
      if (!m) throw new Error(errorConversationId);
      const conversationId = m[0];

      const sessionCacheKey = "__chatgptExportMdHtmlSessionCache";
      const cachedSession = globalThis[sessionCacheKey];
      let accessToken = cachedSession?.accessToken || null;
      if (!accessToken || Date.now() - Number(cachedSession?.updatedAt || 0) > 5 * 60 * 1000) {
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" });
        const session = await sessionRes.json();
        accessToken = session.accessToken || null;
        if (accessToken) {
          globalThis[sessionCacheKey] = { accessToken, updatedAt: Date.now() };
        }
      }
      if (!accessToken) throw new Error(errorAccessToken);

      const res = await fetch(`/backend-api/conversation/${conversationId}`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) throw new Error(`conversation GET: ${res.status}`);
      return await res.json();
    }
  });
  return result;
}

export async function downloadAttachmentInPage(tabId, attachment, metadataOnly = false) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [
      attachment,
      metadataOnly,
      t("errorAttachmentId"),
      t("errorDownloadUrl", attachment?.id || attachment?.sandboxPath || ""),
      t("errorSandboxAttachmentContext")
    ],
    func: async (
      attachment,
      metadataOnly,
      errorAttachmentId,
      errorDownloadUrl,
      errorSandboxAttachmentContext
    ) => {
      const sessionCacheKey = "__chatgptExportMdHtmlSessionCache";
      const cachedSession = globalThis[sessionCacheKey];
      let accessToken = cachedSession?.accessToken || null;
      if (!accessToken || Date.now() - Number(cachedSession?.updatedAt || 0) > 5 * 60 * 1000) {
        const sessionRes = await fetch("/api/auth/session", { credentials: "include" });
        const session = await sessionRes.json();
        accessToken = session.accessToken || null;
        if (accessToken) {
          globalThis[sessionCacheKey] = { accessToken, updatedAt: Date.now() };
        }
      }
      const headers = accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : {};

      const cleanName = value => {
        if (typeof value !== "string") return null;
        const v = value.trim();
        if (!v || v.startsWith("file_")) return null;
        return v;
      };

      const filenameFromContentDisposition = value => {
        if (typeof value !== "string" || !value) return null;

        const star = value.match(/filename\*\s*=\s*(?:UTF-8''|utf-8'')?([^;]+)/i);
        if (star) {
          let v = star[1].trim().replace(/^"|"$/g, "");
          try { v = decodeURIComponent(v); } catch {}
          const cleaned = cleanName(v);
          if (cleaned) return cleaned;
        }

        const plain = value.match(/filename\s*=\s*(?:"([^"]+)"|([^;]+))/i);
        if (plain) {
          const cleaned = cleanName((plain[1] || plain[2] || "").trim());
          if (cleaned) return cleaned;
        }
        return null;
      };

      const filenameFromUrl = value => {
        if (typeof value !== "string" || !value) return null;
        try {
          const u = new URL(value, location.href);
          for (const key of [
            "filename", "file_name", "name", "title",
            "response-content-disposition", "content-disposition"
          ]) {
            const raw = u.searchParams.get(key);
            if (!raw) continue;
            if (/disposition/i.test(key)) {
              const fromDisposition = filenameFromContentDisposition(raw);
              if (fromDisposition) return fromDisposition;
            } else {
              const cleaned = cleanName(raw);
              if (cleaned) return cleaned;
            }
          }
        } catch {}
        return null;
      };

      const filenameFromObject = value => {
        if (!value || typeof value !== "object") return null;
        const seen = new WeakSet();
        const preferred = ["title", "original_name", "originalName", "filename", "file_name"];

        const visit = obj => {
          if (!obj || typeof obj !== "object" || seen.has(obj)) return null;
          seen.add(obj);

          for (const key of preferred) {
            const cleaned = cleanName(obj[key]);
            if (cleaned) return cleaned;
          }

          const genericName = cleanName(obj.name);
          if (genericName) return genericName;

          for (const child of Object.values(obj)) {
            if (child && typeof child === "object") {
              const found = visit(child);
              if (found) return found;
            }
          }
          return null;
        };

        return visit(value);
      };

      let mediaUrl = attachment?.signedUrl || null;
      let discoveredName = cleanName(attachment?.originalName) || cleanName(attachment?.title);
      let discoveredType = attachment?.mimeType || attachment?.mime_type || null;
      let resolvedFileId = attachment?.id || null;
      let resolvedLibraryFileId = attachment?.libraryFileId || null;

      if (!mediaUrl && attachment?.source === "sandbox" && attachment?.sandboxPath) {
        const conversationId = attachment?.conversationId;
        const messageId = attachment?.messageId;
        if (!conversationId || !messageId) {
          throw new Error(errorSandboxAttachmentContext);
        }

        const qs = new URLSearchParams({
          message_id: String(messageId),
          sandbox_path: String(attachment.sandboxPath),
          download_intent: "true"
        });
        const metaRes = await fetch(
          `/backend-api/conversation/${encodeURIComponent(conversationId)}/interpreter/download?${qs}`,
          { method: "GET", headers, credentials: "include" }
        );
        if (!metaRes.ok) {
          const preview = (await metaRes.text()).slice(0, 300);
          throw new Error(`interpreter/download: ${metaRes.status} ${preview}`);
        }

        const meta = await metaRes.json();
        if (meta?.status && meta.status !== "success") {
          throw new Error(`interpreter/download: ${meta.status}`);
        }

        discoveredName =
          discoveredName ||
          cleanName(meta?.file_name) ||
          cleanName(meta?.metadata?.library_file_reference?.file_name) ||
          filenameFromObject(meta);
        discoveredType = discoveredType || meta?.mime_type || meta?.mimeType || null;
        resolvedFileId = resolvedFileId || meta?.metadata?.file_id || meta?.file_id || null;
        resolvedLibraryFileId =
          resolvedLibraryFileId || meta?.metadata?.library_file_reference?.library_file_id || null;
        mediaUrl = meta?.download_url || meta?.downloadUrl || null;

        if (!mediaUrl) throw new Error(errorDownloadUrl);
      }

      if (!mediaUrl) {
        if (!resolvedFileId) throw new Error(errorAttachmentId);

        const metaRes = await fetch(`/backend-api/files/download/${encodeURIComponent(resolvedFileId)}`, {
          method: "GET",
          headers,
          credentials: "include"
        });
        if (!metaRes.ok) {
          const preview = (await metaRes.text()).slice(0, 300);
          throw new Error(`files/download ${resolvedFileId}: ${metaRes.status} ${preview}`);
        }

        const meta = await metaRes.json();
        discoveredName = discoveredName || filenameFromObject(meta);
        discoveredType = discoveredType || meta.mime_type || meta.mimeType || meta.content_type || null;
        mediaUrl =
          meta.download_url ||
          meta.downloadUrl ||
          meta.url ||
          meta.signed_url ||
          meta.signedUrl ||
          null;

        if (!mediaUrl) throw new Error(errorDownloadUrl);
      }

      discoveredName = discoveredName || filenameFromUrl(mediaUrl);

      if (metadataOnly) {
        const applyResponseMetadata = response => {
          discoveredName = discoveredName ||
            filenameFromContentDisposition(response.headers.get("content-disposition")) ||
            filenameFromUrl(response.url);
          if (!discoveredType || discoveredType === "application/octet-stream") {
            discoveredType = response.headers.get("content-type") || discoveredType || null;
          }
        };

        try {
          const headRes = await fetch(mediaUrl, {
            method: "HEAD",
            headers,
            credentials: "include"
          });
          if (headRes.ok) applyResponseMetadata(headRes);
        } catch {}

        // Some attachment hosts omit Content-Disposition/Content-Type on HEAD.
        // Probe only the first byte so metadata-only export can still use the
        // same human-readable filename/type without downloading the attachment.
        if (!discoveredName || !discoveredType || discoveredType === "application/octet-stream") {
          let probeRes = null;
          try {
            probeRes = await fetch(mediaUrl, {
              method: "GET",
              headers: { ...headers, Range: "bytes=0-0" },
              credentials: "include"
            });
            if (probeRes.ok) applyResponseMetadata(probeRes);
          } catch {
          } finally {
            try { await probeRes?.body?.cancel(); } catch {}
          }
        }

        return {
          bytes: null,
          type: discoveredType || "application/octet-stream",
          finalUrl: mediaUrl,
          originalName: discoveredName || null,
          fileId: resolvedFileId || null,
          libraryFileId: resolvedLibraryFileId || null
        };
      }

      const fileRes = await fetch(mediaUrl, {
        method: "GET",
        headers,
        credentials: "include"
      });
      if (!fileRes.ok) {
        const preview = (await fileRes.text()).slice(0, 300);
        throw new Error(`media GET: ${fileRes.status} ${preview}`);
      }

      discoveredName = discoveredName ||
        filenameFromContentDisposition(fileRes.headers.get("content-disposition")) ||
        filenameFromUrl(fileRes.url);

      const blob = await fileRes.blob();
      const buf = await blob.arrayBuffer();
      return {
        bytes: Array.from(new Uint8Array(buf)),
        type: blob.type || fileRes.headers.get("content-type") || discoveredType || "application/octet-stream",
        finalUrl: fileRes.url || mediaUrl,
        originalName: discoveredName || null,
        fileId: resolvedFileId || null,
        libraryFileId: resolvedLibraryFileId || null
      };
    }
  });
  return result;
}

