import { describe, expect, it } from "vitest";
import {
  branchExcludingFromRaw,
  cleanExportText,
  isVisibleMessage,
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

describe("tool invocation visibility", () => {
  it("hides assistant messages addressed to tools", () => {
    expect(isVisibleMessage({
      author: { role: "assistant" },
      recipient: "api_tool.call_tool",
      content: {
        content_type: "code",
        text: '{"path":"/GitHub/tool","args":{}}'
      },
      metadata: {}
    })).toBe(false);
  });

  it("keeps assistant replies addressed to the conversation", () => {
    expect(isVisibleMessage({
      author: { role: "assistant" },
      recipient: "all",
      content: { content_type: "text", parts: ["Visible reply"] },
      metadata: {}
    })).toBe(true);
  });

  it("keeps legacy assistant replies without a recipient", () => {
    expect(isVisibleMessage({
      author: { role: "assistant" },
      content: { content_type: "text", parts: ["Legacy reply"] },
      metadata: {}
    })).toBe(true);
  });

  it("uses recipient structure instead of modern tool-call text shapes", () => {
    const imageCall = JSON.stringify({
      prompt: null,
      size: "1024x1024",
      n: 1,
      transparent_background: false,
      is_style_transfer: false,
      referenced_image_ids: null
    });
    const webCall = JSON.stringify({
      system1_search_query: [{ q: "example" }],
      response_length: "short"
    });

    expect(isVisibleMessage({
      author: { role: "assistant" },
      recipient: "image_gen",
      content: { content_type: "code", text: imageCall },
      metadata: {}
    })).toBe(false);
    expect(isVisibleMessage({
      author: { role: "assistant" },
      recipient: "web.run",
      content: { content_type: "code", text: webCall },
      metadata: {}
    })).toBe(false);
  });

  it("does not text-filter skipped_mainline placeholders", () => {
    const text = '{"skipped_mainline":true}';

    expect(cleanExportText(text, {
      author: { role: "assistant" },
      recipient: "image_gen",
      metadata: {}
    })).toBe(text);
    expect(isVisibleMessage({
      author: { role: "assistant" },
      recipient: "image_gen",
      content: { content_type: "code", text },
      metadata: {}
    })).toBe(false);
  });
});
