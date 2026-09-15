import { describe, expect, it } from "vitest";
import { normalizeClaudeConversation } from "../claude-normalize.js";
import {
  buildClaudeSelectionIndex,
  claudeActiveBranch,
  selectClaudeBranch
} from "../claude-selection.js";

function message(uuid, sender, parent, content = [{ type: "text", text: uuid }]) {
  return {
    uuid,
    sender,
    parent_message_uuid: parent,
    created_at: "2026-09-15T09:22:10.105801Z",
    content
  };
}

describe("Claude branch and selection", () => {
  const root = "00000000-0000-4000-8000-000000000000";

  it("walks the current leaf and ignores inactive branch nodes", () => {
    const data = {
      current_leaf_message_uuid: "a2b",
      chat_messages: [
        message("u1", "human", root),
        message("a1", "assistant", "u1"),
        message("u2", "human", "a1"),
        message("a2a", "assistant", "u2"),
        message("a2b", "assistant", "u2")
      ]
    };

    expect(claudeActiveBranch(data).map(item => item.uuid))
      .toEqual(["u1", "a1", "u2", "a2b"]);
  });

  it("uses current-branch positions as DOM selection ids", () => {
    const data = {
      current_leaf_message_uuid: "a2",
      chat_messages: [
        message("u1", "human", root),
        message("a1", "assistant", "u1"),
        message("u2", "human", "a1"),
        message("a2", "assistant", "u2")
      ]
    };

    const index = buildClaudeSelectionIndex(data);
    expect(index.groups[2].directIds).toEqual(["u2", "claude-index:2"]);

    const selected = selectClaudeBranch(data, {
      selectAll: false,
      selectedMessageIds: ["claude-index:1", "claude-index:3"]
    });
    expect(selected.branch.map(item => item.uuid)).toEqual(["a1", "a2"]);
    expect(selected.omission.omittedAtStart).toBe(true);
    expect(selected.omission.beforeIds.has("a2")).toBe(true);
  });
});

describe("normalizeClaudeConversation", () => {
  it("keeps text, local resources and remote image gallery links while hiding tool chatter", () => {
    const assistant = message("a1", "assistant", "u1", [
      {
        type: "thinking",
        thinking: "",
        summaries: [{ summary: "Internal status" }]
      },
      {
        type: "tool_result",
        name: "present_files",
        content: [
          {
            type: "local_resource",
            file_path: "/mnt/user-data/outputs/example.md",
            name: "example",
            mime_type: "text/markdown",
            uuid: "file-resource-1"
          },
          {
            type: "text",
            text: "Internal tool instruction"
          }
        ]
      },
      {
        type: "tool_result",
        name: "image_search",
        content: [
          {
            type: "image_gallery",
            images: [{
              id: "img_1",
              url: "https://example.com/image.jpg",
              title: "Example image",
              page_url: "https://example.com/page"
            }]
          }
        ]
      },
      { type: "text", text: "Visible reply" }
    ]);

    const normalized = normalizeClaudeConversation(
      {
        uuid: "conv-1",
        name: "Claude test",
        model: "claude-test",
        __organizationId: "org-1"
      },
      [assistant]
    );

    expect(normalized.platform).toBe("claude");
    expect(normalized.conversationUrl).toBe("https://claude.ai/chat/conv-1");
    expect(normalized.messages).toHaveLength(1);

    const out = normalized.messages[0];
    expect(out.content.map(part => part.text).join("\n"))
      .toContain("Visible reply");
    expect(out.content.map(part => part.text).join("\n"))
      .not.toContain("https://example.com/image.jpg");
    expect(out.content.map(part => part.text).join("\n"))
      .not.toContain("Internal tool instruction");

    expect(out.attachments[0]).toMatchObject({
      source: "claude-local-resource",
      id: "file-resource-1",
      filePath: "/mnt/user-data/outputs/example.md",
      originalName: "example.md",
      conversationId: "conv-1",
      mimeType: "text/markdown"
    });
    expect(out.attachments[1]).toMatchObject({
      source: "claude-remote-image",
      id: "img_1",
      remoteUrl: "https://example.com/image.jpg",
      sourceUrl: "https://example.com/page",
      originalName: "image.jpg",
      mimeType: "image/jpeg",
      isImage: true
    });
  });
});
