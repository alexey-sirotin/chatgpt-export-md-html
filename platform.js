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
import {
  getClaudeConversationInPage,
  downloadClaudeAttachmentInPage,
  abortClaudeExportInPage,
  clearClaudeExportAbortInPage
} from "./claude-api.js";
import { normalizeClaudeConversation } from "./claude-normalize.js";
import {
  buildClaudeSelectionIndex,
  selectClaudeBranch
} from "./claude-selection.js";
import {
  getGrokConversationInPage,
  downloadGrokAttachmentInPage,
  abortGrokExportInPage,
  clearGrokExportAbortInPage
} from "./grok-api.js";
import { normalizeGrokConversation } from "./grok-normalize.js";
import {
  buildGrokSelectionIndex,
  selectGrokBranch
} from "./grok-selection.js";

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

export const claudePlatform = {
  id: "claude",

  matchesUrl(url) {
    try {
      return new URL(url).hostname === "claude.ai";
    } catch {
      return false;
    }
  },

  conversationIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "claude.ai") return "";
      const match = parsed.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  },

  conversationId(data) {
    return data?.uuid || "";
  },

  getConversationInPage: getClaudeConversationInPage,
  buildSelectionIndex: buildClaudeSelectionIndex,
  selectBranch: selectClaudeBranch,
  downloadAttachmentInPage: downloadClaudeAttachmentInPage,
  abortExportInPage: abortClaudeExportInPage,
  clearExportAbortInPage: clearClaudeExportAbortInPage,
  normalizeConversation: normalizeClaudeConversation
};

export const grokPlatform = {
  id: "grok",

  matchesUrl(url) {
    try {
      return new URL(url).hostname === "grok.com";
    } catch {
      return false;
    }
  },

  conversationIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "grok.com") return "";
      const match = parsed.pathname.match(/\/(?:c|chat|conversation)\/([0-9a-f-]{36})(?:\/|$)/i);
      return match ? match[1] : "";
    } catch {
      return "";
    }
  },

  conversationId(data) {
    return data?.conversationId || "";
  },

  getConversationInPage: getGrokConversationInPage,
  buildSelectionIndex: buildGrokSelectionIndex,
  selectBranch: selectGrokBranch,
  downloadAttachmentInPage: downloadGrokAttachmentInPage,
  abortExportInPage: abortGrokExportInPage,
  clearExportAbortInPage: clearGrokExportAbortInPage,
  normalizeConversation: normalizeGrokConversation
};

const platforms = [chatgptPlatform, claudePlatform, grokPlatform];

export function platformForUrl(url) {
  return platforms.find(platform => platform.matchesUrl(url)) || null;
}

export async function platformForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return platformForUrl(tab?.url || "");
}
