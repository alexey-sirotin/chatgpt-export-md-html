import {
  getConversationInPage,
  downloadAttachmentInPage,
  abortExportInPage,
  clearExportAbortInPage
} from "./chatgpt-api.js";
import { normalizeChatGPTConversation } from "./chatgpt-normalize.js";
import {
  buildChatGPTSelectionIndex,
  selectChatGPTBranch
} from "./chatgpt-selection.js";

export const chatgptPlatform = {
  id: "chatgpt",

  matchesUrl(url) {
    try {
      return new URL(url).hostname === "chatgpt.com";
    } catch {
      return false;
    }
  },

  conversationIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "chatgpt.com") return "";
      const match = parsed.pathname.match(/\/c\/([^/?#]+)/);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  },

  conversationId(data) {
    return data?.conversation_id || "";
  },

  getConversationInPage,
  buildSelectionIndex: buildChatGPTSelectionIndex,
  selectBranch: selectChatGPTBranch,
  downloadAttachmentInPage,
  abortExportInPage,
  clearExportAbortInPage,
  normalizeConversation: normalizeChatGPTConversation
};

const platforms = [chatgptPlatform];

export function platformForUrl(url) {
  return platforms.find(platform => platform.matchesUrl(url)) || null;
}

export async function platformForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return platformForUrl(tab?.url || "");
}
