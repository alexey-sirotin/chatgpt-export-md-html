import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";

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
    fileId: attachment?.id || null,
    libraryFileId: null
  };
}

export async function downloadGrokAttachmentInPage(tabId, attachment, metadataOnly = false, exportId = null) {
  if (metadataOnly) return attachmentMetadata(attachment);
  const remoteUrl = attachment?.remoteUrl;
  if (!remoteUrl) throw new Error("Grok attachment URL is missing");

  const url = new URL(remoteUrl);
  if (url.hostname === "assets.grok.com") {
    const response = await fetch(remoteUrl, { credentials: "omit" });
    if (!response.ok) throw new Error("Grok asset GET: " + response.status);
    const blob = await response.blob();
    const declaredType = attachment?.mimeType || "application/octet-stream";
    const receivedType = blob.type || response.headers.get("content-type") || "";
    const type = receivedType && receivedType !== "application/octet-stream" ? receivedType : declaredType;
    const buffer = await blob.arrayBuffer();
    return {
      bytes: Array.from(new Uint8Array(buffer)),
      type,
      originalName: attachment?.originalName || attachment?.title || null,
      fileId: attachment?.id || null,
      libraryFileId: null
    };
  }

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [attachment, PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: async (attachment, registryKey, exportId) => {
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
      const response = await fetch(attachment.remoteUrl, { credentials: "omit", mode: "cors", signal });
      if (!response.ok) throw new Error("Grok attachment GET: " + response.status);
      const blob = await response.blob();
      const declaredType = attachment.mimeType || "application/octet-stream";
      const receivedType = blob.type || response.headers.get("content-type") || "";
      const type = receivedType && receivedType !== "application/octet-stream" ? receivedType : declaredType;
      const buffer = await blob.arrayBuffer();
      return {
        bytes: Array.from(new Uint8Array(buffer)),
        type,
        originalName: attachment.originalName || attachment.title || null,
        fileId: attachment.id || null,
        libraryFileId: null
      };
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
