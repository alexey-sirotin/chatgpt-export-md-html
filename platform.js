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
import {
  getDeepSeekConversationInPage,
  downloadDeepSeekAttachmentInPage,
  abortDeepSeekExportInPage,
  clearDeepSeekExportAbortInPage
} from "./deepseek-api.js";
import { normalizeDeepSeekConversation } from "./deepseek-normalize.js";
import {
  buildDeepSeekSelectionIndex,
  selectDeepSeekBranch
} from "./deepseek-selection.js";

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

export const deepseekPlatform = {
  id: "deepseek",

  matchesUrl(url) {
    try {
      return new URL(url).hostname === "chat.deepseek.com";
    } catch {
      return false;
    }
  },

  conversationIdFromUrl(url) {
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== "chat.deepseek.com") return "";
      const match = parsed.pathname.match(/\/a\/chat\/s\/([^/?#]+)/i);
      return match ? decodeURIComponent(match[1]) : "";
    } catch {
      return "";
    }
  },

  conversationId(data) {
    return data?.conversationId || "";
  },

  getConversationInPage: getDeepSeekConversationInPage,
  buildSelectionIndex: buildDeepSeekSelectionIndex,
  selectBranch: selectDeepSeekBranch,
  downloadAttachmentInPage: downloadDeepSeekAttachmentInPage,
  abortExportInPage: abortDeepSeekExportInPage,
  clearExportAbortInPage: clearDeepSeekExportAbortInPage,
  normalizeConversation: normalizeDeepSeekConversation
};

const platforms = [chatgptPlatform, claudePlatform, grokPlatform, deepseekPlatform];

export function platformForUrl(url) {
  return platforms.find(platform => platform.matchesUrl(url)) || null;
}

export async function platformForTab(tabId) {
  const tab = await chrome.tabs.get(tabId);
  return platformForUrl(tab?.url || "");
}
