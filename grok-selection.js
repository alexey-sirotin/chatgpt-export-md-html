import {
  buildOrderedSelectionIndex,
  selectOrderedBranch
} from "./ordered-selection.js";

const selectionOptions = {
  prefix: "grok",
  idOf: turn => turn.id,
  kindOf: turn => turn.role === "user" ? "user" : "assistant"
};

export function buildGrokSelectionIndex(data) {
  const turns = Array.isArray(data?.turns) ? data.turns : [];
  return buildOrderedSelectionIndex(turns, selectionOptions);
}

export function selectGrokBranch(data, selection = {}) {
  const turns = Array.isArray(data?.turns) ? data.turns : [];
  return selectOrderedBranch(turns, selection, selectionOptions);
}
