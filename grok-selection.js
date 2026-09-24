import { SELECTION_INDEX_SCHEMA_VERSION } from "./selection-index.js";

function positionalId(index) {
  return "grok-index:" + index;
}

export function buildGrokSelectionIndex(data) {
  const turns = Array.isArray(data?.turns) ? data.turns : [];
  return {
    schemaVersion: SELECTION_INDEX_SCHEMA_VERSION,
    groups: turns.map((turn, index) => ({
      kind: turn.role === "user" ? "user" : "assistant",
      directIds: [String(turn.id), positionalId(index)],
      exchangeIds: []
    }))
  };
}

export function selectGrokBranch(data, selection = {}) {
  const turns = Array.isArray(data?.turns) ? data.turns : [];
  const selectedIds = new Set((selection.selectedMessageIds || []).map(String));
  const excludedIds = new Set((selection.excludedMessageIds || []).map(String));

  const chosenPositions = [];
  for (let index = 0; index < turns.length; index++) {
    const turn = turns[index];
    const ids = [String(turn.id), positionalId(index)];
    const included = selection.selectAll
      ? !ids.some(id => excludedIds.has(id))
      : ids.some(id => selectedIds.has(id));
    if (included) chosenPositions.push(index);
  }

  const branch = chosenPositions.map(index => turns[index]);
  const beforeIds = new Set();
  let previous = null;
  for (const index of chosenPositions) {
    if (previous != null && index > previous + 1) {
      beforeIds.add(turns[index].id);
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
        chosenPositions[chosenPositions.length - 1] < turns.length - 1
    },
    selectionIndex: buildGrokSelectionIndex(data)
  };
}
