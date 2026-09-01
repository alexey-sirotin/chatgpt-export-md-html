export function chosenSelectionGroupIndexes(groups, selection, options = {}) {
  const sourceGroups = Array.isArray(groups) ? groups : [];
  const chosen = new Set();
  const selectedMessageIds = new Set((selection?.selectedMessageIds || []).map(String));
  const selectedTurnIds = new Set((selection?.selectedTurnIds || []).map(String));
  const legacyTurnContexts = new Map(
    (selection?.legacyTurnContexts || [])
      .filter(context => context?.turnId)
      .map(context => [String(context.turnId), context])
  );
  const isLegacyCandidate =
    typeof options.isLegacyCandidate === "function"
      ? options.isLegacyCandidate
      : group => group?.kind === "assistant";

  const directMatches = id => {
    const target = String(id);
    const matches = [];
    for (let i = 0; i < sourceGroups.length; i++) {
      if ((sourceGroups[i]?.directIds || []).some(value => String(value) === target)) {
        matches.push(i);
      }
    }
    return matches;
  };

  const unambiguousLegacyGroupIndex = id => {
    const context = legacyTurnContexts.get(String(id));
    if (!context?.prevMessageId || !context?.nextMessageId) return null;

    const prevMatches = directMatches(context.prevMessageId);
    const nextMatches = directMatches(context.nextMessageId);
    if (prevMatches.length !== 1 || nextMatches.length !== 1) return null;

    const prevIndex = prevMatches[0];
    const nextIndex = nextMatches[0];
    if (prevIndex >= nextIndex) return null;

    const candidates = [];
    for (let i = prevIndex + 1; i < nextIndex; i++) {
      if (isLegacyCandidate(sourceGroups[i], i)) candidates.push(i);
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
    for (let i = 0; i < sourceGroups.length; i++) {
      if ((sourceGroups[i]?.exchangeIds || []).some(value => String(value) === id)) {
        exchangeMatches.push(i);
      }
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
