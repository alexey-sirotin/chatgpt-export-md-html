import { SELECTION_INDEX_SCHEMA_VERSION } from "./selection-index.js";

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
  const selectedIds = new Set((selection.selectedMessageIds || []).map(String));
  const excludedIds = new Set((selection.excludedMessageIds || []).map(String));
  const chosenPositions = [];

  for (let index = 0; index < ordered.length; index++) {
    const ids = directIdsFor(ordered[index], index, options);
    const included = selection.selectAll
      ? !ids.some(id => excludedIds.has(id))
      : ids.some(id => selectedIds.has(id));
    if (included) chosenPositions.push(index);
  }

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
    selectionIndex: buildOrderedSelectionIndex(ordered, options)
  };
}
