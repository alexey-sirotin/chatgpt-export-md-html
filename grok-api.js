import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";
const GROK_IMAGE_ACCEPT = "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";

function roleFromSender(sender) {
  const value = String(sender || "").toLowerCase();
  if (/human|user/.test(value)) return "user";
  if (/assistant|model/.test(value)) return "assistant";
  return "unknown";
}

function buildActiveBranch(responses, mountedIds = []) {
  const items = Array.isArray(responses) ? responses : [];
  if (!items.length) return [];

  const byId = new Map();
  const parentIds = new Set();
  for (const item of items) {
    if (!item?.responseId) continue;
    byId.set(String(item.responseId), item);
    if (item.parentResponseId) parentIds.add(String(item.parentResponseId));
  }

  const mounted = new Set((mountedIds || []).map(String));
  const leaves = items.filter(item => item?.responseId && !parentIds.has(String(item.responseId)));
  const candidates = leaves.length ? leaves : items.filter(item => item?.responseId);

  const pathFor = leaf => {
    const path = [];
    const seen = new Set();
    let current = leaf;
    while (current?.responseId && !seen.has(String(current.responseId))) {
      const id = String(current.responseId);
      seen.add(id);
      path.push(current);
      current = current.parentResponseId ? byId.get(String(current.parentResponseId)) : null;
    }
    return path.reverse();
  };

  let bestPath = [];
  let bestOverlap = -1;
  let bestTime = -Infinity;
  let bestIndex = -1;

  for (const leaf of candidates) {
    const path = pathFor(leaf);
    const overlap = path.reduce((count, item) => count + (mounted.has(String(item.responseId)) ? 1 : 0), 0);
    const time = Number.isFinite(Date.parse(leaf.createTime || "")) ? Date.parse(leaf.createTime) : -Infinity;
    const index = items.indexOf(leaf);
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && time > bestTime) ||
      (overlap === bestOverlap && time === bestTime && index > bestIndex)
    ) {
      bestPath = path;
      bestOverlap = overlap;
      bestTime = time;
      bestIndex = index;
    }
  }

  return bestPath;
}

export async function getGrokConversationInPage(tabId, exportId = null) {
  const noActiveConversation = t("noActiveConversation");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [noActiveConversation, PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: async (noActiveConversation, registryKey, exportId) => {
      let signal;
      if (exportId) {
        const registry = globalThis[registryKey] ||= new Map();
        let controller = registry.get(exportId);
        if (!controller) {
          controller = new AbortController();
          registry.set(exportId, controller);
        }
        signal = controller.signal;
      }

      function conversationIdFromPage() {
        const pathMatch = location.pathname.match(/\/(?:c|chat|conversation)\/([0-9a-f-]{36})(?:\/|$)/i);
        if (pathMatch) return pathMatch[1];
        const resources = performance.getEntriesByType("resource").map(entry => entry.name);
        for (let i = resources.length - 1; i >= 0; i--) {
          const match = resources[i].match(/\/rest\/app-chat\/conversations_v2\/([0-9a-f-]{36})/i);
          if (match) return match[1];
        }
        return "";
      }

      function activeBranch(responses, mountedIds) {
        const items = Array.isArray(responses) ? responses : [];
        const byId = new Map();
        const parentIds = new Set();
        for (const item of items) {
          if (!item?.responseId) continue;
          byId.set(String(item.responseId), item);
          if (item.parentResponseId) parentIds.add(String(item.parentResponseId));
        }
        const mounted = new Set((mountedIds || []).map(String));
        const leaves = items.filter(item => item?.responseId && !parentIds.has(String(item.responseId)));
        const candidates = leaves.length ? leaves : items.filter(item => item?.responseId);
        let bestPath = [];
        let bestOverlap = -1;
        let bestTime = -Infinity;
        let bestIndex = -1;
        for (const leaf of candidates) {
          const path = [];
          const seen = new Set();
          let current = leaf;
          while (current?.responseId && !seen.has(String(current.responseId))) {
            const id = String(current.responseId);
            seen.add(id);
            path.push(current);
            current = current.parentResponseId ? byId.get(String(current.parentResponseId)) : null;
          }
          path.reverse();
          const overlap = path.reduce((count, item) => count + (mounted.has(String(item.responseId)) ? 1 : 0), 0);
          const parsed = Date.parse(leaf.createTime || "");
          const time = Number.isFinite(parsed) ? parsed : -Infinity;
          const index = items.indexOf(leaf);
          if (overlap > bestOverlap || (overlap === bestOverlap && time > bestTime) || (overlap === bestOverlap && time === bestTime && index > bestIndex)) {
            bestPath = path;
            bestOverlap = overlap;
            bestTime = time;
            bestIndex = index;
          }
        }
        return bestPath;
      }

      const conversationId = conversationIdFromPage();
      if (!conversationId) throw new Error(noActiveConversation);

      const mountedIds = [...document.querySelectorAll('[id^="response-"]')]
        .map(node => String(node.id || "").replace(/^response-/, ""))
        .filter(Boolean);

      const [metadataResponse, responsesResponse] = await Promise.all([
        fetch(
          "/rest/app-chat/conversations_v2/" + encodeURIComponent(conversationId) +
          "?includeWorkspaces=true&includeTaskResult=true",
          { credentials: "include", signal }
        ),
        fetch(
          "/rest/app-chat/conversations/" + encodeURIComponent(conversationId) +
          "/responses?includeThreads=false",
          { credentials: "include", signal }
        )
      ]);

      let metadata = null;
      if (metadataResponse.ok) metadata = (await metadataResponse.json())?.conversation || null;
      if (!responsesResponse.ok) throw new Error("Grok responses GET: " + responsesResponse.status);

      const allResponses = (await responsesResponse.json())?.responses || [];
      const branch = activeBranch(allResponses, mountedIds);
      const turns = branch
        .filter(item => item && item.isControl !== true)
        .map(item => {
          const sender = String(item.sender || "").toLowerCase();
          const role = /human|user/.test(sender) ? "user" : /assistant|model/.test(sender) ? "assistant" : "unknown";
          return {
            id: String(item.responseId || ""),
            role,
            message: typeof item.message === "string" ? item.message : "",
            cardAttachmentsJson: Array.isArray(item.cardAttachmentsJson) ? item.cardAttachmentsJson : [],
            fileAttachments: Array.isArray(item.fileAttachments) ? item.fileAttachments.map(String) : [],
            createdAt: item.createTime || null,
            model: item.model || item.requestMetadata?.model || null,
            parentResponseId: item.parentResponseId || null
          };
        })
        .filter(turn => turn.id && turn.role !== "unknown");

      if (!turns.length) throw new Error(noActiveConversation);

      return {
        conversationId,
        title: metadata?.title || document.title.replace(/\s*[|–-]\s*Grok.*$/i, ""),
        createTime: metadata?.createTime || null,
        modifyTime: metadata?.modifyTime || null,
        turns
      };
    }
  });

  if (!result || !result.conversationId || !Array.isArray(result.turns)) {
    throw new Error(noActiveConversation);
  }
  return result;
}

function attachmentMetadata(attachment) {
  return {
    bytes: null,
    type: attachment?.mimeType || "application/octet-stream",
    originalName: attachment?.originalName || attachment?.title || null,
    fileId: attachment?.assetId || attachment?.id || null,
    libraryFileId: null
  };
}

export async function downloadGrokAttachmentInPage(tabId, attachment, metadataOnly = false, exportId = null) {
  if (
    metadataOnly &&
    attachment?.source !== "grok-user-asset" &&
    attachment?.source !== "grok-generated-file"
  ) {
    return attachmentMetadata(attachment);
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [attachment, metadataOnly, PAGE_ABORT_CONTROLLERS_KEY, exportId, GROK_IMAGE_ACCEPT],
    func: async (attachment, metadataOnly, registryKey, exportId, imageAccept) => {
      let signal;
      if (exportId) {
        const registry = globalThis[registryKey] ||= new Map();
        let controller = registry.get(exportId);
        if (!controller) {
          controller = new AbortController();
          registry.set(exportId, controller);
        }
        signal = controller.signal;
      }

      const asResult = async (response, fallbackType, originalName, fileId) => {
        if (!response.ok) throw new Error("Grok attachment GET: " + response.status);
        const blob = await response.blob();
        const receivedType = blob.type || response.headers.get("content-type") || "";
        const type = receivedType && receivedType !== "application/octet-stream"
          ? receivedType
          : (fallbackType || "application/octet-stream");
        const buffer = await blob.arrayBuffer();
        return {
          bytes: Array.from(new Uint8Array(buffer)),
          type,
          originalName: originalName || null,
          fileId: fileId || null,
          libraryFileId: null
        };
      };

      if (attachment?.source === "grok-generated-file") {
        const conversationId = attachment.conversationId;
        const filePath = attachment.filePath || (attachment.originalName ? "/" + attachment.originalName : "");
        if (!conversationId || !filePath) {
          throw new Error("Grok generated file context is incomplete");
        }

        const params = new URLSearchParams({
          conversationId: String(conversationId),
          path: String(filePath)
        });
        const metaResponse = await fetch(
          "/rest/conversations/files/content?" + params,
          { credentials: "include", signal }
        );
        if (!metaResponse.ok) {
          throw new Error("Grok file metadata GET: " + metaResponse.status);
        }
        const meta = await metaResponse.json();
        const originalName = attachment.originalName || filePath.split("/").filter(Boolean).at(-1) || null;
        const type = meta?.mimeType || attachment.mimeType || "application/octet-stream";

        if (metadataOnly) {
          return {
            bytes: null,
            type,
            originalName,
            fileId: attachment.id || null,
            libraryFileId: null
          };
        }

        const signedUrl = meta?.downloadSignedUrl || meta?.signedUrl;
        if (!signedUrl) throw new Error("Grok generated file signed URL is missing");
        const response = await fetch(signedUrl, { credentials: "omit", mode: "cors", signal });
        return await asResult(response, type, originalName, attachment.id || null);
      }

      if (attachment?.source === "grok-user-asset") {
        const assetId = attachment.assetId || attachment.id;
        if (!assetId) throw new Error("Grok asset id is missing");

        const metaResponse = await fetch(
          "/rest/assets/" + encodeURIComponent(String(assetId)),
          { credentials: "include", signal }
        );
        if (!metaResponse.ok) throw new Error("Grok asset metadata GET: " + metaResponse.status);
        const meta = await metaResponse.json();
        const originalName = meta?.name || attachment.originalName || attachment.title || null;
        const type = meta?.mimeType || attachment.mimeType || "application/octet-stream";

        if (metadataOnly) {
          return {
            bytes: null,
            type,
            originalName,
            fileId: assetId,
            libraryFileId: null
          };
        }

        const key = typeof meta?.key === "string" ? meta.key.trim() : "";
        if (!key) throw new Error("Grok asset key is missing");
        const remoteUrl = /^https?:\/\//i.test(key)
          ? key
          : "https://assets.grok.com/" + key.replace(/^\/+/, "");
        const response = await fetch(remoteUrl, {
          credentials: "include",
          mode: "cors",
          referrer: "https://grok.com/",
          headers: type.startsWith("image/") ? { Accept: imageAccept } : { Accept: "*/*" },
          signal
        });
        return await asResult(response, type, originalName, assetId);
      }

      const remoteUrl = attachment?.remoteUrl;
      if (!remoteUrl) throw new Error("Grok attachment URL is missing");

      const url = new URL(remoteUrl, location.href);
      const isGrokAsset = url.hostname === "assets.grok.com";
      const isImage = attachment?.isImage === true || String(attachment?.mimeType || "").startsWith("image/");
      const response = await fetch(remoteUrl, {
        credentials: isGrokAsset ? "include" : "omit",
        mode: "cors",
        ...(isGrokAsset ? { referrer: "https://grok.com/" } : {}),
        ...(isImage ? { headers: { Accept: imageAccept } } : {}),
        signal
      });
      return await asResult(
        response,
        attachment?.mimeType || "application/octet-stream",
        attachment?.originalName || attachment?.title || null,
        attachment?.assetId || attachment?.id || null
      );
    }
  });
  return result;
}

export async function abortGrokExportInPage(tabId, exportId) {
  if (!exportId) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: (registryKey, exportId) => {
      const registry = globalThis[registryKey] ||= new Map();
      let controller = registry.get(exportId);
      if (!controller) {
        controller = new AbortController();
        registry.set(exportId, controller);
      }
      controller.abort();
    }
  });
}

export async function clearGrokExportAbortInPage(tabId, exportId) {
  if (!exportId) return;
  await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: (registryKey, exportId) => {
      globalThis[registryKey]?.delete?.(exportId);
    }
  });
}

export { buildActiveBranch, roleFromSender };
