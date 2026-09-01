import {
  isVisibleMessage,
  logicalSelectionGroups,
  nodeDirectIds,
  nodeExchangeIds
} from "./conversation.js";
import { chosenSelectionGroupIndexes } from "./selection-matcher.js";

export const SELECTION_INDEX_SCHEMA_VERSION = 3;

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function buildSelectionIndex(rawBranch) {
  const groups = logicalSelectionGroups(rawBranch)
    .filter(group => group.nodes.some(node => isVisibleMessage(node.message)))
    .map(group => ({
      kind: group.kind,
      directIds: uniqueStrings(group.nodes.flatMap(node => nodeDirectIds(node))),
      exchangeIds: uniqueStrings(group.nodes.flatMap(node => nodeExchangeIds(node)))
    }));

  return {
    schemaVersion: SELECTION_INDEX_SCHEMA_VERSION,
    groups
  };
}

function chosenGroupIndexes(index, selection) {
  return chosenSelectionGroupIndexes(index?.groups, selection);
}

export function selectionSummaryFromIndex(index, selection) {
  const total = Array.isArray(index?.groups) ? index.groups.length : 0;

  if (selection.selectAll) {
    const excluded = chosenGroupIndexes(index, {
      selectedMessageIds: selection.excludedMessageIds || [],
      selectedTurnIds: selection.excludedTurnIds || [],
      legacyTurnContexts: selection.legacyTurnContexts || []
    });
    return { total, selected: Math.max(0, total - excluded.size) };
  }

  return {
    total,
    selected: chosenGroupIndexes(index, selection).size
  };
}

export function selectionIndexKnownIds(index) {
  const out = new Set();
  for (const group of index?.groups || []) {
    for (const id of group.directIds || []) out.add(String(id));
    for (const id of group.exchangeIds || []) out.add(String(id));
  }
  return out;
}
