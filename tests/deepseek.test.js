import { describe, expect, it } from "vitest";
import { buildDeepSeekActiveBranch } from "../deepseek-api.js";
import {
  externalImageAttachments,
  fileAttachments,
  normalizeDeepSeekConversation,
  thinkingMarkdown
} from "../deepseek-normalize.js";
import {
  buildDeepSeekSelectionIndex,
  selectDeepSeekBranch
} from "../deepseek-selection.js";

describe("DeepSeek active branch", () => {
  it("walks from current_message_id through parent_id and excludes sibling branches", () => {
    const messages = [
      { message_id: 1, parent_id: null },
      { message_id: 2, parent_id: 1 },
      { message_id: 3, parent_id: 2 },
      { message_id: 4, parent_id: 3 },
      { message_id: 5, parent_id: 4 },
      { message_id: 6, parent_id: 5 },
      { message_id: 7, parent_id: 6 },
      { message_id: 8, parent_id: 7 },
      { message_id: 9, parent_id: 5 }
    ];

    expect(buildDeepSeekActiveBranch(messages, 9).map(item => item.message_id))
      .toEqual([1, 2, 3, 4, 5, 9]);
  });

  it("does not use timestamps to establish order", () => {
    const messages = [
      { message_id: 1, parent_id: null, inserted_at: 20 },
      { message_id: 2, parent_id: 1, inserted_at: 19 }
    ];
    expect(buildDeepSeekActiveBranch(messages, 2).map(item => item.message_id))
      .toEqual([1, 2]);
  });
});

describe("DeepSeek normalization", () => {
  it("exports THINK and RESPONSE as separate assistant messages", () => {
    const data = { conversationId: "abc", title: "Test" };
    const branch = [{
      id: "2",
      parentId: "1",
      role: "assistant",
      insertedAt: 1790289042.472,
      model: null,
      fragments: [
        { type: "THINK", content: "Reasoning text", elapsed_secs: 8.327 },
        { type: "RESPONSE", content: "# Final answer" }
      ]
    }];

    const normalized = normalizeDeepSeekConversation(data, branch);
    expect(normalized.platform).toBe("deepseek");
    expect(normalized.messages).toHaveLength(2);
    expect(normalized.messages[0]).toMatchObject({
      id: "2:think",
      role: "assistant",
      sourceRole: "assistant-thinking"
    });
    expect(normalized.messages[0].content.map(part => part.text)).toEqual([
      "#### Thinking (8.3 s)\n\nReasoning text"
    ]);
    expect(normalized.messages[1]).toMatchObject({
      id: "2",
      role: "assistant",
      sourceRole: "assistant"
    });
    expect(normalized.messages[1].content.map(part => part.text)).toEqual([
      "# Final answer"
    ]);
    expect(normalized.messages[0].createdAt).toBe("2026-09-24T22:30:42.472Z");
    expect(normalized.messages[1].createdAt).toBe("2026-09-24T22:30:42.472Z");
  });

  it("localizes external images found inside THINK fragments", () => {
    const normalized = normalizeDeepSeekConversation(
      { conversationId: "abc", title: "Test" },
      [{
        id: "8",
        parentId: "7",
        role: "assistant",
        insertedAt: 1790289042.472,
        fragments: [
          {
            type: "THINK",
            content: "Inspect ![Placeholder](https://placehold.co/120x80.svg)",
            elapsed_secs: 2
          },
          { type: "RESPONSE", content: "Done" }
        ]
      }]
    );

    const thinking = normalized.messages[0];
    expect(thinking.id).toBe("8:think");
    expect(thinking.attachments).toHaveLength(1);
    expect(thinking.attachments[0]).toMatchObject({
      source: "deepseek-remote-image",
      remoteUrl: "https://placehold.co/120x80.svg",
      isImage: true
    });
    expect(thinking.content[0].text).toContain("attachment://deepseek-remote-image%3A8%3Athink%3A1%3A1");
  });

  it("applies an omission marker only to the first exported part of a DeepSeek turn", () => {
    const normalized = normalizeDeepSeekConversation(
      { conversationId: "abc", title: "Test" },
      [{
        id: "8",
        parentId: "7",
        role: "assistant",
        fragments: [
          { type: "THINK", content: "Reasoning" },
          { type: "RESPONSE", content: "Final" }
        ]
      }],
      { beforeIds: new Set(["8"]) }
    );

    expect(normalized.messages[0].omittedBefore).toBe(true);
    expect(normalized.messages[1].omittedBefore).toBeUndefined();
  });

  it("normalizes uploaded files and image previews", () => {
    const fragment = {
      type: "FILE",
      files: [
        {
          id: "file-code",
          file_name: "sample.m",
          file_size: 2053,
          signed_path: "/file?file_id=code&state=x",
          is_image: false
        },
        {
          id: "file-image",
          file_name: "screen.png",
          file_size: 100028,
          signed_path: "/file?file_id=image&state=y",
          is_image: true,
          width: 873,
          height: 942
        }
      ]
    };

    const attachments = fileAttachments(fragment);
    expect(attachments[0]).toMatchObject({
      source: "deepseek-user-file",
      originalName: "sample.m",
      isImage: false
    });
    expect(attachments[1]).toMatchObject({
      source: "deepseek-user-file",
      providerOriginalName: "screen.png",
      originalName: "screen.webp",
      mimeType: "image/webp",
      isImage: true,
      width: 873,
      height: 942
    });
  });

  it("turns remote Markdown images into attachment references with fallback URLs", () => {
    const parsed = externalImageAttachments(
      "Before ![Random](https://picsum.photos/200/300) after",
      "8:1"
    );
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0]).toMatchObject({
      source: "deepseek-remote-image",
      remoteUrl: "https://picsum.photos/200/300",
      isImage: true
    });
    expect(parsed.text).toContain("attachment://deepseek-remote-image%3A8%3A1%3A1");
  });

  it("formats thinking duration only when available", () => {
    expect(thinkingMarkdown({ content: "abc", elapsed_secs: 8 })).toBe("#### Thinking (8 s)\n\nabc");
    expect(thinkingMarkdown({ content: "abc" })).toBe("#### Thinking\n\nabc");
  });
});

describe("DeepSeek selection", () => {
  const data = {
    turns: [
      { id: "1", role: "user" },
      { id: "2", role: "assistant" },
      { id: "5", role: "user" },
      { id: "9", role: "assistant" }
    ]
  };

  it("builds an index from the active branch", () => {
    const index = buildDeepSeekSelectionIndex(data);
    expect(index.groups.map(group => group.directIds[0])).toEqual(["1", "2", "5", "9"]);
  });

  it("marks omissions when selecting non-contiguous messages", () => {
    const selected = selectDeepSeekBranch(data, {
      selectAll: false,
      selectedMessageIds: ["1", "9"]
    });
    expect(selected.branch.map(turn => turn.id)).toEqual(["1", "9"]);
    expect(selected.omission.beforeIds.has("9")).toBe(true);
    expect(selected.omission.omittedAtEnd).toBe(false);
  });
});
