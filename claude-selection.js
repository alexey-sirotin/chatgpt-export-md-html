import { SELECTION_INDEX_SCHEMA_VERSION } from "./selection-index.js";

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

function positionalId(index) {
  return "claude-index:" + index;
}

export function buildClaudeSelectionIndex(data) {
  const branch = claudeActiveBranch(data);
  return {
    schemaVersion: SELECTION_INDEX_SCHEMA_VERSION,
    groups: branch.map((message, index) => ({
      kind: message.sender === "human" ? "user" : "assistant",
      directIds: [String(message.uuid), positionalId(index)],
      exchangeIds: []
    }))
  };
}

export function selectClaudeBranch(data, selection = {}) {
  const activeBranch = claudeActiveBranch(data);
  const selectedIds = new Set((selection.selectedMessageIds || []).map(String));
  const excludedIds = new Set((selection.excludedMessageIds || []).map(String));

  const chosenPositions = [];
  for (let index = 0; index < activeBranch.length; index++) {
    const message = activeBranch[index];
    const ids = [String(message.uuid), positionalId(index)];
    const included = selection.selectAll
      ? !ids.some(id => excludedIds.has(id))
      : ids.some(id => selectedIds.has(id));
    if (included) chosenPositions.push(index);
  }

  const branch = chosenPositions.map(index => activeBranch[index]);
  const beforeIds = new Set();
  let previous = null;

  for (const index of chosenPositions) {
    if (previous != null && index > previous + 1) {
      beforeIds.add(activeBranch[index].uuid);
    }
    previous = index;
  }

  return {
    branch,
    omission: {
      beforeIds,
      omittedAtStart: chosenPositions.length > 0 && chosenPositions[0] > 0,
      omittedAtEnd:
        chosenPositions.length > 0 &&
        chosenPositions[chosenPositions.length - 1] < activeBranch.length - 1
    },
    selectionIndex: buildClaudeSelectionIndex(data)
  };
}
