import { describe, expect, it } from "vitest";
import {
  buildSelectionIndex,
  SELECTION_INDEX_SCHEMA_VERSION,
  selectionSummaryFromIndex
} from "../selection-index.js";

function node(id, role, { metadata = {}, parent = null } = {}) {
  return {
    id,
    __mappingId: id,
    parent,
    message: {
      id,
      author: { role },
      metadata,
      content: {
        content_type: "text",
        parts: [`${id} text`]
      }
    }
  };
}

describe("selection index", () => {
  it("indexes metadata.parent_id for legacy selection matching", () => {
    const index = buildSelectionIndex([
      node("u1", "user"),
      node("a1", "assistant", {
        metadata: { parent_id: "legacy-dom-image-turn" }
      }),
      node("u2", "user")
    ]);

    expect(SELECTION_INDEX_SCHEMA_VERSION).toBe(3);
    expect(index.groups[1].kind).toBe("assistant");
    expect(index.groups[1].exchangeIds).toContain("legacy-dom-image-turn");
  });

  it("counts an unambiguous orphan selection as one logical group", () => {
    const index = buildSelectionIndex([
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user")
    ]);

    expect(selectionSummaryFromIndex(index, {
      selectAll: false,
      selectedTurnIds: ["orphan"],
      legacyTurnContexts: [{
        turnId: "orphan",
        prevMessageId: "u1",
        nextMessageId: "u2"
      }]
    })).toEqual({ total: 3, selected: 1 });
  });

  it("does not count an ambiguous orphan in Select None mode", () => {
    const index = buildSelectionIndex([
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user"),
      node("a2", "assistant"),
      node("u3", "user")
    ]);

    expect(selectionSummaryFromIndex(index, {
      selectAll: false,
      selectedTurnIds: ["orphan"],
      legacyTurnContexts: [{
        turnId: "orphan",
        prevMessageId: "u1",
        nextMessageId: "u3"
      }]
    })).toEqual({ total: 5, selected: 0 });
  });

  it("keeps the base Select All count when an orphan exclusion is ambiguous", () => {
    const index = buildSelectionIndex([
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user"),
      node("a2", "assistant"),
      node("u3", "user")
    ]);

    expect(selectionSummaryFromIndex(index, {
      selectAll: true,
      excludedTurnIds: ["orphan"],
      legacyTurnContexts: [{
        turnId: "orphan",
        prevMessageId: "u1",
        nextMessageId: "u3"
      }]
    })).toEqual({ total: 5, selected: 5 });
  });
});
