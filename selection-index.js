import {
  isVisibleMessage,
  logicalSelectionGroups,
  nodeDirectIds,
  nodeExchangeIds
} from "./conversation.js";

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
  const groups = Array.isArray(index?.groups) ? index.groups : [];
  const chosen = new Set();
  const selectedMessageIds = new Set((selection.selectedMessageIds || []).map(String));
  const selectedTurnIds = new Set((selection.selectedTurnIds || []).map(String));
  const legacyTurnContexts = new Map(
    (selection.legacyTurnContexts || [])
      .filter(context => context?.turnId)
      .map(context => [String(context.turnId), context])
  );

  const directMatches = id => {
    const matches = [];
    for (let i = 0; i < groups.length; i++) {
      if ((groups[i].directIds || []).includes(id)) matches.push(i);
    }
    return matches;
  };

  const unambiguousLegacyGroupIndex = id => {
    const context = legacyTurnContexts.get(String(id));
    if (!context?.prevMessageId || !context?.nextMessageId) return null;

    const prevMatches = directMatches(String(context.prevMessageId));
    const nextMatches = directMatches(String(context.nextMessageId));
    if (prevMatches.length !== 1 || nextMatches.length !== 1) return null;

    const prevIndex = prevMatches[0];
    const nextIndex = nextMatches[0];
    if (prevIndex >= nextIndex) return null;

    const candidates = [];
    for (let i = prevIndex + 1; i < nextIndex; i++) {
      if (groups[i]?.kind === "assistant") candidates.push(i);
    }

    return candidates.length === 1 ? candidates[0] : null;
  };

  for (const id of selectedMessageIds) {
    for (const groupIndex of directMatches(id)) chosen.add(groupIndex);
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

    if (exchangeMatches.length) {
      const alreadyChosen = exchangeMatches.filter(groupIndex => chosen.has(groupIndex));
      const targets = alreadyChosen.length ? alreadyChosen : exchangeMatches;
      for (const groupIndex of targets) chosen.add(groupIndex);
      continue;
    }

    const legacyGroupIndex = unambiguousLegacyGroupIndex(id);
    if (legacyGroupIndex != null) chosen.add(legacyGroupIndex);
  }

  return chosen;
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
