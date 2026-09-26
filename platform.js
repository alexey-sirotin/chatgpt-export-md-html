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
  downloadClaudeAttachmentInPage,
  abortClaudeExportInPage,
  clearClaudeExportAbortInPage
} from "./claude-api.js";
import { getClaudeConversationWithVisualsInPage } from "./claude-visual-capture.js";
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

function routeHandlers(hostname, pathPattern, decodeMatch = false) {
  return {
    matchesUrl(url) {
      try {
        return new URL(url).hostname === hostname;
      } catch {
        return false;
      }
    },

    conversationIdFromUrl(url) {
      try {
        const parsed = new URL(url);
        if (parsed.hostname !== hostname) return "";
        const match = parsed.pathname.match(pathPattern);
        if (!match) return "";
        return decodeMatch ? decodeURIComponent(match[1]) : match[1];
      } catch {
        return "";
      }
    }
  };
}

export const chatgptPlatform = {
  id: "chatgpt",
  ...routeHandlers("chatgpt.com", /\/c\/([^/?#]+)/, true),

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
  ...routeHandlers("claude.ai", /\/chat\/([0-9a-f-]{36})/i),

  conversationId(data) {
    return data?.uuid || "";
  },

  getConversationInPage: getClaudeConversationWithVisualsInPage,
  buildSelectionIndex: buildClaudeSelectionIndex,
  selectBranch: selectClaudeBranch,
  downloadAttachmentInPage: downloadClaudeAttachmentInPage,
  abortExportInPage: abortClaudeExportInPage,
  clearExportAbortInPage: clearClaudeExportAbortInPage,
  normalizeConversation: normalizeClaudeConversation
};

export const grokPlatform = {
  id: "grok",
  ...routeHandlers("grok.com", /\/(?:c|chat|conversation)\/([0-9a-f-]{36})(?:\/|$)/i),

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
  ...routeHandlers("chat.deepseek.com", /\/a\/chat\/s\/([^/?#]+)/i, true),

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
