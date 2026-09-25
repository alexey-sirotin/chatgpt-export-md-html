import { SELECTION_INDEX_SCHEMA_VERSION } from "./selection-index.js";
import { chosenSelectionGroupIndexes } from "./selection-matcher.js";

function positionalId(prefix, index) {
  return `${prefix}-index:${index}`;
}

function stableId(item, index, idOf) {
  const value = idOf(item, index);
  return value == null ? "" : String(value);
}

function directIdsFor(item, index, options) {
  const ids = [];
  const id = stableId(item, index, options.idOf);
  if (id) ids.push(id);
  ids.push(positionalId(options.prefix, index));
  return ids;
}

export function buildOrderedSelectionIndex(items, options) {
  const ordered = Array.isArray(items) ? items : [];
  return {
    schemaVersion: SELECTION_INDEX_SCHEMA_VERSION,
    groups: ordered.map((item, index) => ({
      kind: options.kindOf(item, index),
      directIds: directIdsFor(item, index, options),
      exchangeIds: []
    }))
  };
}

export function selectOrderedBranch(items, selection = {}, options) {
  const ordered = Array.isArray(items) ? items : [];
  const selectionIndex = buildOrderedSelectionIndex(ordered, options);
  let chosen;

  if (selection.selectAll) {
    const excluded = chosenSelectionGroupIndexes(selectionIndex.groups, {
      selectedMessageIds: selection.excludedMessageIds || [],
      selectedTurnIds: selection.excludedTurnIds || [],
      legacyTurnContexts: selection.legacyTurnContexts || []
    });
    chosen = new Set(
      selectionIndex.groups
        .map((_, index) => index)
        .filter(index => !excluded.has(index))
    );
  } else {
    chosen = chosenSelectionGroupIndexes(selectionIndex.groups, selection);
  }

  const chosenPositions = [...chosen].sort((a, b) => a - b);
  const branch = chosenPositions.map(index => ordered[index]);
  const beforeIds = new Set();
  let previous = null;

  for (const index of chosenPositions) {
    if (previous != null && index > previous + 1) {
      const id = stableId(ordered[index], index, options.idOf);
      if (id) beforeIds.add(id);
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
        chosenPositions[chosenPositions.length - 1] < ordered.length - 1
    },
    selectionIndex
  };
}
