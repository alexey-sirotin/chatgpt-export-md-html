import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";

export async function getGrokConversationInPage(tabId, exportId = null) {
  const noActiveConversation = t("noActiveConversation");
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [noActiveConversation, PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: async (noActiveConversation, registryKey, exportId) => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
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

      function roleForTurn(turn) {
        if (turn.querySelector('[data-testid="user-message"]')) return "user";
        if (turn.querySelector('[data-testid="assistant-message"]')) return "assistant";
        return "unknown";
      }

      function findPayload(markdown) {
        if (!markdown) return null;
        const roots = Object.keys(markdown)
          .filter(key => key.startsWith("__reactProps$"))
          .map(key => markdown[key]);
        for (const key of Object.keys(markdown)) {
          if (key.startsWith("__reactFiber$")) roots.push(markdown[key]);
        }

        const seen = new WeakSet();
        const queue = roots.map(value => ({ value, depth: 0 }));
        let visited = 0;
        let fallback = null;

        while (queue.length && visited < 5000) {
          const { value, depth } = queue.shift();
          visited++;
          if (value == null) continue;

          if (typeof value === "string") {
            if (!fallback && value.length > 0) fallback = { message: value, cardAttachmentsJson: [] };
            continue;
          }
          if ((typeof value !== "object" && typeof value !== "function") || depth > 12) continue;
          if (typeof value === "object") {
            if (seen.has(value)) continue;
            seen.add(value);
          }

          try {
            if (typeof value.message === "string") {
              return {
                message: value.message,
                cardAttachmentsJson: Array.isArray(value.cardAttachmentsJson)
                  ? value.cardAttachmentsJson
                  : []
              };
            }
          } catch {}

          let keys = [];
          try { keys = Object.keys(value); } catch {}
          for (const key of keys) {
            if (key === "stateNode" && depth > 6) continue;
            let child;
            try { child = value[key]; } catch { continue; }
            queue.push({ value: child, depth: depth + 1 });
          }
        }

        return fallback;
      }

      function extractTurn(turn, scroller) {
        const id = String(turn.id || "").replace(/^response-/, "");
        if (!id) return null;
        const role = roleForTurn(turn);
        const markdown = turn.querySelector(".response-content-markdown");
        const payload = findPayload(markdown);
        const message = typeof payload?.message === "string"
          ? payload.message
          : (markdown?.innerText || markdown?.textContent || "").trim();
        const rect = turn.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return {
          id,
          role,
          message,
          cardAttachmentsJson: payload?.cardAttachmentsJson || [],
          __order: scroller.scrollTop + rect.top - scrollerRect.top
        };
      }

      async function collectTurns() {
        const scroller = document.querySelector('[data-testid="chat-transcript-scroller"]');
        if (!scroller) throw new Error(noActiveConversation);
        const originalTop = scroller.scrollTop;
        const seen = new Map();

        const snapshot = () => {
          for (const turn of document.querySelectorAll('[id^="response-"]')) {
            const extracted = extractTurn(turn, scroller);
            if (!extracted || extracted.role === "unknown") continue;
            const previous = seen.get(extracted.id);
            if (!previous || extracted.__order < previous.__order) seen.set(extracted.id, extracted);
          }
        };

        scroller.scrollTop = 0;
        await sleep(250);
        snapshot();

        let stable = 0;
        let previousTop = -1;
        while (stable < 2) {
          if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
          const nextTop = Math.min(
            scroller.scrollHeight - scroller.clientHeight,
            scroller.scrollTop + Math.max(200, scroller.clientHeight * 0.8)
          );
          scroller.scrollTop = Math.max(0, nextTop);
          await sleep(220);
          snapshot();
          const currentTop = scroller.scrollTop;
          if (Math.abs(currentTop - previousTop) < 2 || currentTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
            stable++;
          } else {
            stable = 0;
          }
          previousTop = currentTop;
        }

        scroller.scrollTop = originalTop;
        await sleep(50);
        return [...seen.values()]
          .sort((a, b) => a.__order - b.__order)
          .map(({ __order, ...turn }) => turn);
      }

      const conversationId = conversationIdFromPage();
      if (!conversationId) throw new Error(noActiveConversation);

      let metadata = null;
      try {
        const response = await fetch(
          "/rest/app-chat/conversations_v2/" + encodeURIComponent(conversationId) +
          "?includeWorkspaces=true&includeTaskResult=true",
          { credentials: "include", signal }
        );
        if (response.ok) metadata = (await response.json())?.conversation || null;
      } catch (error) {
        if (signal?.aborted) throw error;
      }

      const turns = await collectTurns();
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

export async function downloadGrokAttachmentInPage(
  tabId,
  attachment,
  metadataOnly = false,
  exportId = null
) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [attachment, metadataOnly, PAGE_ABORT_CONTROLLERS_KEY, exportId],
    func: async (attachment, metadataOnly, registryKey, exportId) => {
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

      const remoteUrl = attachment?.remoteUrl;
      if (!remoteUrl) throw new Error("Grok attachment URL is missing");
      const declaredType = attachment.mimeType || "application/octet-stream";
      const originalName = attachment.originalName || attachment.title || null;

      if (metadataOnly) {
        return {
          bytes: null,
          type: declaredType,
          originalName,
          fileId: attachment.id || null,
          libraryFileId: null
        };
      }

      const response = await fetch(remoteUrl, {
        credentials: "omit",
        mode: "cors",
        signal
      });
      if (!response.ok) throw new Error("Grok attachment GET: " + response.status);

      const blob = await response.blob();
      const receivedType = blob.type || response.headers.get("content-type") || "";
      const resolvedType =
        receivedType && receivedType !== "application/octet-stream"
          ? receivedType
          : declaredType;
      const buffer = await blob.arrayBuffer();
      return {
        bytes: Array.from(new Uint8Array(buffer)),
        type: resolvedType,
        originalName,
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
