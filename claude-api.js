import { t } from "./utils.js";

const PAGE_ABORT_CONTROLLERS_KEY = "__chatgptExportAbortControllers";
const CLAUDE_VISUAL_CAPTURE_KEY = "__chatgptExportClaudeVisualCapture";

async function captureClaudeCustomVisualsInPage(tabId) {
  const token = crypto.randomUUID();

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CLAUDE_VISUAL_CAPTURE_KEY, token],
      func: (registryKey, token) => {
        const old = globalThis[registryKey];
        if (old?.handler) window.removeEventListener("message", old.handler);

        const state = { token, items: [], handler: null };
        state.handler = event => {
          const data = event?.data;
          if (
            !data ||
            data.type !== "chatgpt-export-claude-visual" ||
            data.token !== token ||
            !data.svg
          ) return;
          state.items.push({ source: event.source, payload: data });
        };
        globalThis[registryKey] = state;
        window.addEventListener("message", state.handler);
      }
    });

    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [token],
      func: token => {
        if (
          !/(?:^|\.)claudemcpcontent\.com$/i.test(location.hostname) ||
          location.pathname !== "/mcp_apps"
        ) return null;

        const candidates = [...document.querySelectorAll("svg")]
          .map(svg => ({ svg, rect: svg.getBoundingClientRect() }))
          .filter(item => item.rect.width > 100 && item.rect.height > 50)
          .sort((a, b) =>
            (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
          );
        const source = candidates[0];
        if (!source) return null;

        const clone = source.svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

        const properties = [
          "color",
          "fill",
          "fill-opacity",
          "stroke",
          "stroke-opacity",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-dasharray",
          "opacity",
          "font-family",
          "font-size",
          "font-weight",
          "font-style",
          "letter-spacing",
          "text-anchor",
          "dominant-baseline",
          "visibility",
          "display",
          "paint-order",
          "vector-effect",
          "marker-start",
          "marker-mid",
          "marker-end"
        ];

        const originals = [source.svg, ...source.svg.querySelectorAll("*")];
        const clones = [clone, ...clone.querySelectorAll("*")];
        originals.forEach((element, index) => {
          const target = clones[index];
          if (!target) return;
          const style = getComputedStyle(element);
          for (const property of properties) {
            const value = style.getPropertyValue(property);
            if (value) target.style.setProperty(property, value);
          }
        });

        for (const script of clone.querySelectorAll("script")) script.remove();
        for (const foreignObject of clone.querySelectorAll("foreignObject")) foreignObject.remove();
        for (const element of [clone, ...clone.querySelectorAll("*")]) {
          for (const attr of [...element.attributes]) {
            if (/^on/i.test(attr.name)) {
              element.removeAttribute(attr.name);
              continue;
            }
            if (
              /^(?:href|xlink:href)$/i.test(attr.name) &&
              /^\s*javascript:/i.test(attr.value)
            ) {
              element.removeAttribute(attr.name);
            }
          }
        }

        const viewBox = clone.viewBox?.baseVal;
        if (viewBox?.width > 0 && viewBox?.height > 0) {
          clone.setAttribute("width", String(viewBox.width));
          clone.setAttribute("height", String(viewBox.height));
        } else {
          clone.setAttribute("width", String(Math.round(source.rect.width)));
          clone.setAttribute("height", String(Math.round(source.rect.height)));
        }

        const svg = new XMLSerializer().serializeToString(clone);
        window.parent.postMessage({
          type: "chatgpt-export-claude-visual",
          token,
          svg,
          width: source.rect.width,
          height: source.rect.height
        }, "*");
        return true;
      }
    });

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CLAUDE_VISUAL_CAPTURE_KEY, token],
      func: async (registryKey, token) => {
        await new Promise(resolve => setTimeout(resolve, 50));
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return [];

        const frames = [...document.querySelectorAll("iframe")];
        const visuals = [];
        for (const item of state.items) {
          const frame = frames.find(candidate => candidate.contentWindow === item.source);
          const row = frame?.closest?.('[data-testid="transcript-row"][data-index]');
          const rowIndex = Number(row?.getAttribute("data-index"));
          if (!Number.isInteger(rowIndex) || rowIndex < 0) continue;
          visuals.push({
            rowIndex,
            svg: item.payload.svg,
            width: Number(item.payload.width) || null,
            height: Number(item.payload.height) || null
          });
        }

        if (state.handler) window.removeEventListener("message", state.handler);
        delete globalThis[registryKey];
        return visuals;
      }
    });

    return Array.isArray(result) ? result : [];
  } catch (error) {
    console.warn("chatgpt-export-md-html: could not capture Claude custom visuals", error);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [CLAUDE_VISUAL_CAPTURE_KEY],
        func: registryKey => {
          const state = globalThis[registryKey];
          if (state?.handler) window.removeEventListener("message", state.handler);
          delete globalThis[registryKey];
        }
      });
    } catch {}
    return [];
  }
}

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

      for (const organizationId of [...new Set(candidates)]) {
        const response = await fetch(
          "/api/organizations/" + encodeURIComponent(organizationId) +
          "/chat_conversations/" + encodeURIComponent(conversationId) + query,
          { credentials: "include", signal }
        );
        if (!response.ok) continue;
        const data = await response.json();
        return { ...data, __organizationId: organizationId };
      }

      throw new Error(noActiveConversation);
    }
  });

  if (!result || !Array.isArray(result.chat_messages) || !result.current_leaf_message_uuid) {
    throw new Error(noActiveConversation);
  }

  const customVisuals = await captureClaudeCustomVisualsInPage(tabId);
  return customVisuals.length ? { ...result, __customVisuals: customVisuals } : result;
}

export async function downloadClaudeAttachmentInPage(
  tabId,
  attachment,
  metadataOnly = false,
  exportId = null
) {
  if (attachment?.source === "claude-custom-visual") {
    const originalName = attachment.originalName || "claude-visual.svg";
    const type = "image/svg+xml";
    if (metadataOnly) {
      return {
        bytes: null,
        type,
        originalName,
        fileId: attachment.id || null,
        libraryFileId: null
      };
    }

    const svg = typeof attachment.__inlineSvg === "string" ? attachment.__inlineSvg : "";
    if (!svg) throw new Error("Claude custom visual SVG is missing");
    return {
      bytes: Array.from(new TextEncoder().encode(svg)),
      type,
      originalName,
      fileId: attachment.id || null,
      libraryFileId: null
    };
  }

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

      if (attachment?.source === "claude-remote-image") {
        const remoteUrl = attachment.remoteUrl;
        if (!remoteUrl) throw new Error("Claude remote image URL is missing");

        const originalName = attachment.originalName || attachment.title || null;
        const declaredType = attachment.mimeType || "application/octet-stream";

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
        if (!response.ok) {
          throw new Error("Claude remote image GET: " + response.status);
        }

        const blob = await response.blob();
        const type = blob.type || response.headers.get("content-type") || declaredType;
        if (type && !type.startsWith("image/")) {
          throw new Error("Claude remote image returned non-image content: " + type);
        }

        const buffer = await blob.arrayBuffer();
        return {
          bytes: Array.from(new Uint8Array(buffer)),
          type: type || declaredType,
          originalName,
          fileId: attachment.id || null,
          libraryFileId: null
        };
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
      const receivedType = blob.type || response.headers.get("content-type") || "";
      const resolvedType =
        receivedType && receivedType !== "application/octet-stream"
          ? receivedType
          : type;

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
