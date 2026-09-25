import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";
const DEEPSEEK_FILE_BASE = "https://files.deepseeksvc.com/api";

export function buildDeepSeekActiveBranch(chatMessages, currentMessageId) {
  const items = Array.isArray(chatMessages) ? chatMessages : [];
  const byId = new Map(
    items
      .filter(item => item?.message_id != null)
      .map(item => [String(item.message_id), item])
  );

  const path = [];
  const seen = new Set();
  let current = byId.get(String(currentMessageId ?? ""));

  while (current?.message_id != null) {
    const id = String(current.message_id);
    if (seen.has(id)) break;
    seen.add(id);
    path.push(current);
    if (current.parent_id == null) break;
    current = byId.get(String(current.parent_id));
  }

  return path.reverse();
}

function metadataResult(attachment) {
  return {
    bytes: null,
    type: attachment?.mimeType || "application/octet-stream",
    originalName: attachment?.originalName || attachment?.title || null,
    fileId: attachment?.id || null,
    libraryFileId: null
  };
}

export async function getDeepSeekConversationInPage(tabId, exportId = null) {
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

      const match = location.pathname.match(/\/a\/chat\/s\/([^/?#]+)/i);
      const conversationId = match ? decodeURIComponent(match[1]) : "";
      if (!conversationId) throw new Error(noActiveConversation);

      let token = "";
      try {
        const stored = JSON.parse(localStorage.getItem("userToken") || "null");
        token = typeof stored?.value === "string" ? stored.value : "";
      } catch {}
      if (!token) throw new Error("DeepSeek user token is missing");

      const response = await fetch(
        "/api/v0/chat/history_messages?chat_session_id=" + encodeURIComponent(conversationId),
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: "Bearer " + token
          },
          signal
        }
      );
      if (!response.ok) throw new Error("DeepSeek history GET: " + response.status);

      const payload = await response.json();
      if (payload?.code !== 0) {
        throw new Error("DeepSeek history API: " + (payload?.msg || payload?.code || "unknown error"));
      }

      const biz = payload?.data?.biz_data;
      if (biz?.biz_code !== 0) {
        throw new Error("DeepSeek history business API: " + (biz?.biz_msg || biz?.biz_code || "unknown error"));
      }

      const session = biz?.chat_session || null;
      const messages = Array.isArray(biz?.chat_messages) ? biz.chat_messages : [];
      if (!session || session.current_message_id == null) throw new Error(noActiveConversation);

      const byId = new Map(
        messages
          .filter(item => item?.message_id != null)
          .map(item => [String(item.message_id), item])
      );
      const branch = [];
      const seen = new Set();
      let current = byId.get(String(session.current_message_id));
      while (current?.message_id != null) {
        const id = String(current.message_id);
        if (seen.has(id)) break;
        seen.add(id);
        branch.push(current);
        if (current.parent_id == null) break;
        current = byId.get(String(current.parent_id));
      }
      branch.reverse();

      const turns = branch
        .map(item => {
          const rawRole = String(item.role || "").toUpperCase();
          const role = rawRole === "USER" ? "user" : rawRole === "ASSISTANT" ? "assistant" : "unknown";
          return {
            id: String(item.message_id),
            parentId: item.parent_id == null ? null : String(item.parent_id),
            role,
            model: item.model || null,
            insertedAt: Number.isFinite(Number(item.inserted_at)) ? Number(item.inserted_at) : null,
            fragments: Array.isArray(item.fragments) ? item.fragments : []
          };
        })
        .filter(turn => turn.role !== "unknown");

      if (!turns.length) throw new Error(noActiveConversation);

      return {
        conversationId,
        title: session.title || document.title.replace(/\s*[|–-]\s*DeepSeek.*$/i, ""),
        currentMessageId: String(session.current_message_id),
        version: session.version ?? null,
        turns
      };
    }
  });

  if (!result?.conversationId || !Array.isArray(result.turns)) {
    throw new Error(noActiveConversation);
  }
  return result;
}

export async function downloadDeepSeekAttachmentInPage(tabId, attachment, metadataOnly = false, exportId = null) {
  if (metadataOnly) return metadataResult(attachment);

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    args: [attachment, PAGE_ABORT_CONTROLLERS_KEY, exportId, DEEPSEEK_FILE_BASE],
    func: async (attachment, registryKey, exportId, fileBase) => {
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

      const asResult = async response => {
        if (!response.ok) throw new Error("DeepSeek attachment GET: " + response.status);
        const blob = await response.blob();
        const type = blob.type || response.headers.get("content-type") || attachment?.mimeType || "application/octet-stream";
        const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()));
        return {
          bytes,
          type,
          originalName: attachment?.originalName || attachment?.title || null,
          fileId: attachment?.id || null,
          libraryFileId: null
        };
      };

      if (attachment?.source === "deepseek-user-file") {
        const signedPath = String(attachment.signedPath || "");
        if (!signedPath.startsWith("/file?")) throw new Error("DeepSeek signed file path is missing");
        const separator = signedPath.includes("?") ? "&" : "?";
        const mode = attachment.isImage ? "p" : "r";
        const response = await fetch(fileBase + signedPath + separator + "ty=" + mode, {
          method: "GET",
          mode: "cors",
          credentials: "omit",
          referrer: "https://chat.deepseek.com/",
          signal
        });
        return await asResult(response);
      }

      const remoteUrl = String(attachment?.remoteUrl || "");
      if (!remoteUrl) throw new Error("DeepSeek attachment URL is missing");
      const response = await fetch(remoteUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        signal
      });
      return await asResult(response);
    }
  });

  return result;
}

export async function abortDeepSeekExportInPage(tabId, exportId) {
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

export async function clearDeepSeekExportAbortInPage(tabId, exportId) {
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
