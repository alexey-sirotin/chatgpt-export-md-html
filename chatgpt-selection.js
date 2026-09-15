import {
  isVisibleMessage,
  rawBranchFromCurrent,
  selectedBranchFromRaw,
  branchExcludingFromRaw,
  logicalSelectionGroups,
  nodeDirectIds,
  nodeExchangeIds
} from "./conversation.js";
import { SELECTION_INDEX_SCHEMA_VERSION } from "./selection-index.js";

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean).map(String))];
}

export function buildChatGPTSelectionIndexFromRaw(rawBranch) {
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

export function buildChatGPTSelectionIndex(data) {
  return buildChatGPTSelectionIndexFromRaw(rawBranchFromCurrent(data));
}

function omissionBoundaries(rawBranch, selectedBranch) {
  const selectedNodes = new Set(selectedBranch);
  const groups = logicalSelectionGroups(rawBranch).filter(group =>
    group.nodes.some(node => isVisibleMessage(node.message))
  );
  const groupSelected = groups.map(group =>
    group.nodes.some(node => selectedNodes.has(node))
  );
  const firstSelected = groupSelected.indexOf(true);
  const lastSelected = groupSelected.lastIndexOf(true);
  const beforeNodes = new Set();

  if (firstSelected === -1) {
    return { beforeNodes, omittedAtStart: false, omittedAtEnd: false };
  }

  let omittedSinceSelected = false;
  for (let i = firstSelected + 1; i <= lastSelected; i++) {
    if (!groupSelected[i]) {
      omittedSinceSelected = true;
      continue;
    }

    if (omittedSinceSelected) {
      const firstSelectedVisible = groups[i].nodes.find(node =>
        selectedNodes.has(node) && isVisibleMessage(node.message)
      );
      if (firstSelectedVisible) beforeNodes.add(firstSelectedVisible);
      omittedSinceSelected = false;
    }
  }

  return {
    beforeNodes,
    omittedAtStart: firstSelected > 0,
    omittedAtEnd: lastSelected < groups.length - 1
  };
}

export function selectChatGPTBranch(data, selection) {
  const rawBranch = rawBranchFromCurrent(data);
  let branch = rawBranch.filter(node => isVisibleMessage(node.message));

  if (selection?.selectAll) {
    branch = branchExcludingFromRaw(rawBranch, selection);
  } else {
    branch = selectedBranchFromRaw(rawBranch, selection || {});
  }

  return {
    branch,
    omission: omissionBoundaries(rawBranch, branch),
    selectionIndex: buildChatGPTSelectionIndexFromRaw(rawBranch)
  };
}
