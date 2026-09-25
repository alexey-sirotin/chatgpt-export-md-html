import {
  buildOrderedSelectionIndex,
  selectOrderedBranch
} from "./ordered-selection.js";

export function claudeActiveBranch(data) {
  const byId = new Map((data?.chat_messages || []).map(message => [message.uuid, message]));
  const branch = [];
  const seen = new Set();
  let id = data?.current_leaf_message_uuid || "";

  while (id && !seen.has(id)) {
    seen.add(id);
    const message = byId.get(id);
    if (!message) break;
    branch.push(message);

    const parent = message.parent_message_uuid;
    if (!parent || parent === "00000000-0000-4000-8000-000000000000") break;
    id = parent;
  }

  return branch.reverse();
}

const selectionOptions = {
  prefix: "claude",
  idOf: message => message.uuid,
  kindOf: message => message.sender === "human" ? "user" : "assistant"
};

export function buildClaudeSelectionIndex(data) {
  return buildOrderedSelectionIndex(claudeActiveBranch(data), selectionOptions);
}

export function selectClaudeBranch(data, selection = {}) {
  return selectOrderedBranch(claudeActiveBranch(data), selection, selectionOptions);
}
