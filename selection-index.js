import {
  isVisibleMessage,
  logicalSelectionGroups,
  nodeDirectIds,
  nodeExchangeIds
} from "./conversation.js";

export const SELECTION_INDEX_SCHEMA_VERSION = 4;

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
  const groups = Array.isArray(index?.groups) ? index.groups : [];
  const chosen = new Set();
  const selectedMessageIds = new Set((selection.selectedMessageIds || []).map(String));
  const selectedTurnIds = new Set((selection.selectedTurnIds || []).map(String));
  const selectedLegacyRanges = (selection.selectedLegacyRanges || []).map(String);

  const directMatches = id => {
    const matches = [];
    for (let i = 0; i < groups.length; i++) {
      if ((groups[i].directIds || []).includes(id)) matches.push(i);
    }
    return matches;
  };

  for (const id of selectedMessageIds) {
    for (const groupIndex of directMatches(id)) chosen.add(groupIndex);
  }

  for (const range of selectedLegacyRanges) {
    const split = range.indexOf("|");
    const prevId = split >= 0 ? range.slice(0, split) : range;
    const nextId = split >= 0 ? range.slice(split + 1) : "";

    const prevMatches = prevId ? directMatches(prevId) : [];
    const nextMatches = nextId ? directMatches(nextId) : [];
    const prevIndex = prevMatches.length ? prevMatches[prevMatches.length - 1] : null;
    const nextIndex = nextMatches.length ? nextMatches[0] : null;

    if (prevIndex == null && nextIndex == null) continue;

    let lo = 0;
    let hi = groups.length - 1;

    if (prevIndex != null) {
      lo = groups[prevIndex]?.kind === "assistant" ? prevIndex : prevIndex + 1;
    }
    if (nextIndex != null) {
      hi = groups[nextIndex]?.kind === "assistant" ? nextIndex : nextIndex - 1;
    }

    for (let i = Math.max(0, lo); i <= Math.min(groups.length - 1, hi); i++) {
      if (groups[i]?.kind === "assistant") chosen.add(i);
    }
  }

  for (const id of selectedTurnIds) {
    const direct = directMatches(id);
    if (direct.length) {
      for (const groupIndex of direct) chosen.add(groupIndex);
      continue;
    }

    const exchangeMatches = [];
    for (let i = 0; i < groups.length; i++) {
      if ((groups[i].exchangeIds || []).includes(id)) exchangeMatches.push(i);
    }

    const alreadyChosen = exchangeMatches.filter(groupIndex => chosen.has(groupIndex));
    const targets = alreadyChosen.length ? alreadyChosen : exchangeMatches;
    for (const groupIndex of targets) chosen.add(groupIndex);
  }

  return chosen;
}

export function selectionSummaryFromIndex(index, selection) {
  const total = Array.isArray(index?.groups) ? index.groups.length : 0;

  if (selection.selectAll) {
    const excluded = chosenGroupIndexes(index, {
      selectedMessageIds: selection.excludedMessageIds || [],
      selectedTurnIds: selection.excludedTurnIds || [],
      selectedLegacyRanges: selection.excludedLegacyRanges || []
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
