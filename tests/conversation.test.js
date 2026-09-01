import { describe, expect, it } from "vitest";
import {
  branchExcludingFromRaw,
  cleanExportText,
  isInternalToolInvocationText,
  selectedBranchFromRaw
} from "../conversation.js";

function node(id, role, {
  metadata = {},
  content = null,
  text = `${id} text`,
  parent = null
} = {}) {
  return {
    id,
    __mappingId: id,
    parent,
    message: {
      id,
      author: { role },
      metadata,
      content: content || {
        content_type: "text",
        parts: [text]
      }
    }
  };
}

function imageToolNode(id, { metadata = {}, fileId = `file_${id}` } = {}) {
  return node(id, "tool", {
    metadata,
    content: {
      content_type: "multimodal_text",
      parts: [{
        content_type: "image_asset_pointer",
        asset_pointer: `sediment://${fileId}`,
        width: 1024,
        height: 1024
      }]
    }
  });
}

function messageIds(branch) {
  return branch.map(item => item.message.id);
}

describe("conversation selection", () => {
  it("uses a mounted message id to select the whole logical assistant response", () => {
    const raw = [
      node("u1", "user"),
      node("invoke1", "assistant"),
      imageToolNode("image1"),
      node("u2", "user")
    ];

    const selected = selectedBranchFromRaw(raw, {
      selectedMessageIds: ["image1"]
    });

    expect(messageIds(selected)).toEqual(["invoke1", "image1"]);
  });

  it("matches an ordinary direct turn id", () => {
    const raw = [
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user")
    ];

    expect(messageIds(selectedBranchFromRaw(raw, {
      selectedTurnIds: ["a1"]
    }))).toEqual(["a1"]);
  });

  it("matches a turn_exchange_id when no direct id matches", () => {
    const raw = [
      node("u1", "user"),
      node("a1", "assistant", {
        metadata: { turn_exchange_id: "exchange-legacy-1" }
      }),
      node("u2", "user")
    ];

    expect(messageIds(selectedBranchFromRaw(raw, {
      selectedTurnIds: ["exchange-legacy-1"]
    }))).toEqual(["a1"]);
  });

  it("matches a legacy DOM image turn through metadata.parent_id", () => {
    const raw = [
      node("u1", "user"),
      node("invoke1", "assistant", {
        metadata: { parent_id: "legacy-dom-image-turn" },
        text: '{"size":"1024x1024","n":1}'
      }),
      imageToolNode("image1"),
      node("u2", "user")
    ];

    expect(messageIds(selectedBranchFromRaw(raw, {
      selectedTurnIds: ["legacy-dom-image-turn"]
    }))).toEqual(["invoke1", "image1"]);
  });

  it("uses orphan boundaries only when they prove exactly one assistant group", () => {
    const raw = [
      node("u1", "user"),
      imageToolNode("image1"),
      node("u2", "user")
    ];

    expect(messageIds(selectedBranchFromRaw(raw, {
      selectedTurnIds: ["orphan-dom-turn"],
      legacyTurnContexts: [{
        turnId: "orphan-dom-turn",
        prevMessageId: "u1",
        nextMessageId: "u2"
      }]
    }))).toEqual(["image1"]);
  });

  it("does not guess when orphan boundaries contain multiple assistant groups", () => {
    const raw = [
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user"),
      imageToolNode("image2"),
      node("u3", "user")
    ];

    expect(selectedBranchFromRaw(raw, {
      selectedTurnIds: ["orphan-dom-turn"],
      legacyTurnContexts: [{
        turnId: "orphan-dom-turn",
        prevMessageId: "u1",
        nextMessageId: "u3"
      }]
    })).toEqual([]);
  });

  it("keeps all messages in Select All semantics when an orphan exclusion is ambiguous", () => {
    const raw = [
      node("u1", "user"),
      node("a1", "assistant"),
      node("u2", "user"),
      imageToolNode("image2"),
      node("u3", "user")
    ];

    const result = branchExcludingFromRaw(raw, {
      excludedTurnIds: ["orphan-dom-turn"],
      legacyTurnContexts: [{
        turnId: "orphan-dom-turn",
        prevMessageId: "u1",
        nextMessageId: "u3"
      }]
    });

    expect(messageIds(result)).toEqual(messageIds(raw));
  });
});

describe("legacy internal image-generation frames", () => {
  it("recognizes old {size,n} image-generation invocation JSON", () => {
    expect(isInternalToolInvocationText('{"size":"1024x1024","n":1}')).toBe(true);
    expect(isInternalToolInvocationText('{"n":1,"size":"1024x1536"}')).toBe(true);
  });

  it("does not classify similar arbitrary JSON as an internal invocation", () => {
    expect(isInternalToolInvocationText(
      '{"size":"1024x1024","n":1,"note":"user data"}'
    )).toBe(false);
  });

  it("filters the invocation from assistant text but preserves the same literal user text", () => {
    const text = '{"size":"1024x1024","n":1}';

    expect(cleanExportText(text, {
      author: { role: "assistant" },
      metadata: {}
    })).toBeNull();

    expect(cleanExportText(text, {
      author: { role: "user" },
      metadata: {}
    })).toBe(text);
  });
});
