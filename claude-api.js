import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";

export async function getClaudeConversationInPage(tabId, exportId = null) {
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

      const match = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
      if (!match) throw new Error(noActiveConversation);
      const conversationId = match[1];

      const candidates = [];
      const marker = "/chat_conversations/" + conversationId;
      const resources = performance.getEntriesByType("resource").map(entry => entry.name);
      for (let i = resources.length - 1; i >= 0; i--) {
        try {
          const url = new URL(resources[i], location.href);
          if (!url.pathname.includes(marker)) continue;
          const parts = url.pathname.split("/");
          const orgIndex = parts.indexOf("organizations");
          if (orgIndex >= 0 && parts[orgIndex + 1]) {
            candidates.push(decodeURIComponent(parts[orgIndex + 1]));
            break;
          }
        } catch {}
      }

      try {
        const orgResponse = await fetch("/api/organizations", {
          credentials: "include",
          signal
        });
        if (orgResponse.ok) {
          const orgData = await orgResponse.json();
          const organizations = Array.isArray(orgData)
            ? orgData
            : Array.isArray(orgData?.organizations)
              ? orgData.organizations
              : [];
          for (const item of organizations) {
            const id = item?.uuid || item?.id || item?.organization_id;
            if (id) candidates.push(String(id));
          }
        }
      } catch (error) {
        if (signal?.aborted) throw error;
      }

      const query =
        "?tree=True&rendering_mode=messages&render_all_tools=true" +
        "&include_inline_comparison=true&consistency=strong";

      const attempts = [];
      for (const organizationId of [...new Set(candidates)]) {
        const response = await fetch(
          "/api/organizations/" + encodeURIComponent(organizationId) +
          "/chat_conversations/" + encodeURIComponent(conversationId) + query,
          { credentials: "include", signal }
        );
        attempts.push(organizationId + ":" + response.status);
        if (!response.ok) continue;
        const data = await response.json();
        return { ...data, __organizationId: organizationId };
      }

      throw new Error(
        "Claude conversation fetch failed; candidates=" +
        candidates.length + "; attempts=" + attempts.join(",")
      );
    }
  });

  if (!result || !Array.isArray(result.chat_messages) || !result.current_leaf_message_uuid) {
    throw new Error(
      "Claude conversation response shape mismatch: " +
      JSON.stringify({
        hasResult: !!result,
        chatMessages: Array.isArray(result?.chat_messages)
          ? result.chat_messages.length
          : typeof result?.chat_messages,
        currentLeaf: result?.current_leaf_message_uuid || null,
        keys: result && typeof result === "object" ? Object.keys(result) : []
      })
    );
  }
  return result;
}

export async function downloadClaudeAttachmentInPage(
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

      if (attachment?.source !== "claude-local-resource") {
        throw new Error("Unsupported Claude attachment source");
      }

      let organizationId = attachment.organizationId || "";
      const conversationId = attachment.conversationId;
      const filePath = attachment.filePath;
      if (!conversationId || !filePath) {
        throw new Error("Claude attachment context is incomplete");
      }

      if (!organizationId) {
        const marker = "/chat_conversations/" + conversationId;
        const resources = performance.getEntriesByType("resource").map(entry => entry.name);
        for (let i = resources.length - 1; i >= 0; i--) {
          try {
            const url = new URL(resources[i], location.href);
            if (!url.pathname.includes(marker)) continue;
            const parts = url.pathname.split("/");
            const orgIndex = parts.indexOf("organizations");
            if (orgIndex >= 0 && parts[orgIndex + 1]) {
              organizationId = decodeURIComponent(parts[orgIndex + 1]);
              break;
            }
          } catch {}
        }
      }

      if (!organizationId) {
        const orgResponse = await fetch("/api/organizations", {
          credentials: "include",
          signal
        });
        if (orgResponse.ok) {
          const orgData = await orgResponse.json();
          const organizations = Array.isArray(orgData)
            ? orgData
            : Array.isArray(orgData?.organizations)
              ? orgData.organizations
              : [];
          const first = organizations[0];
          organizationId = String(first?.uuid || first?.id || first?.organization_id || "");
        }
      }

      if (!organizationId) {
        throw new Error("Claude organization id was not found");
      }

      const originalName = attachment.originalName || null;
      const type = attachment.mimeType || "application/octet-stream";

      if (metadataOnly) {
        return {
          bytes: null,
          type,
          originalName,
          fileId: attachment.id || null,
          libraryFileId: null
        };
      }

      const params = new URLSearchParams({ path: filePath });
      const response = await fetch(
        "/api/organizations/" + encodeURIComponent(organizationId) +
        "/conversations/" + encodeURIComponent(conversationId) +
        "/wiggle/download-file?" + params,
        { credentials: "include", signal }
      );
      if (!response.ok) {
        throw new Error("Claude file GET: " + response.status);
      }

      const blob = await response.blob();
      const buffer = await blob.arrayBuffer();
      return {
        bytes: Array.from(new Uint8Array(buffer)),
        type: blob.type || response.headers.get("content-type") || type,
        originalName,
        fileId: attachment.id || null,
        libraryFileId: null
      };
    }
  });
  return result;
}

export async function abortClaudeExportInPage(tabId, exportId) {
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

export async function clearClaudeExportAbortInPage(tabId, exportId) {
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
