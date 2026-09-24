import { describe, expect, it } from "vitest";
import { buildActiveBranch } from "../grok-api.js";
import {
  cleanGrokMarkdown,
  normalizeGrokConversation,
  parseGrokCards,
  replaceGrokCardPlaceholders
} from "../grok-normalize.js";
import { buildGrokSelectionIndex, selectGrokBranch } from "../grok-selection.js";

function turn(id, role, message, cardAttachmentsJson = [], fileAttachments = []) {
  return { id, role, message, cardAttachmentsJson, fileAttachments };
}

describe("Grok active branch", () => {
  it("chooses the newest leaf and reconstructs its parent chain", () => {
    const responses = [
      { responseId: "u1", sender: "human", parentResponseId: "root", createTime: "2026-09-24T10:00:00Z" },
      { responseId: "a1", sender: "assistant", parentResponseId: "u1", createTime: "2026-09-24T10:00:01Z" },
      { responseId: "u-old", sender: "human", parentResponseId: "a1", createTime: "2026-09-24T10:01:00Z" },
      { responseId: "a-old", sender: "assistant", parentResponseId: "u-old", createTime: "2026-09-24T10:01:01Z" },
      { responseId: "u-new", sender: "human", parentResponseId: "a1", createTime: "2026-09-24T10:02:00Z" },
      { responseId: "a-new", sender: "assistant", parentResponseId: "u-new", createTime: "2026-09-24T10:02:01Z" }
    ];

    expect(buildActiveBranch(responses).map(item => item.responseId)).toEqual([
      "u1", "a1", "u-new", "a-new"
    ]);
  });

  it("prefers the branch represented by currently mounted turns", () => {
    const responses = [
      { responseId: "u1", sender: "human", parentResponseId: "root", createTime: "2026-09-24T10:00:00Z" },
      { responseId: "a1", sender: "assistant", parentResponseId: "u1", createTime: "2026-09-24T10:00:01Z" },
      { responseId: "u-old", sender: "human", parentResponseId: "a1", createTime: "2026-09-24T10:01:00Z" },
      { responseId: "a-old", sender: "assistant", parentResponseId: "u-old", createTime: "2026-09-24T10:01:01Z" },
      { responseId: "u-new", sender: "human", parentResponseId: "a1", createTime: "2026-09-24T10:02:00Z" },
      { responseId: "a-new", sender: "assistant", parentResponseId: "u-new", createTime: "2026-09-24T10:02:01Z" }
    ];

    expect(buildActiveBranch(responses, ["u-old", "a-old"]).map(item => item.responseId)).toEqual([
      "u1", "a1", "u-old", "a-old"
    ]);
  });
});

describe("Grok selection", () => {
  const data = {
    turns: [
      turn("u1", "user", "one"),
      turn("a1", "assistant", "two"),
      turn("u2", "user", "three"),
      turn("a2", "assistant", "four")
    ]
  };

  it("builds stable message and positional ids", () => {
    const index = buildGrokSelectionIndex(data);
    expect(index.groups[2].directIds).toEqual(["u2", "grok-index:2"]);
  });

  it("keeps chosen turns in conversation order and marks omissions", () => {
    const selected = selectGrokBranch(data, {
      selectAll: false,
      selectedMessageIds: ["a1", "a2"]
    });
    expect(selected.branch.map(item => item.id)).toEqual(["a1", "a2"]);
    expect(selected.omission.omittedAtStart).toBe(true);
    expect(selected.omission.beforeIds.has("a2")).toBe(true);
  });
});

describe("Grok normalization", () => {
  it("parses generated images, searched images and rendered files", () => {
    const generated = JSON.stringify({
      id: "img-card",
      cardType: "generated_image_card",
      query: "test image",
      image_chunk: {
        imageUuid: "asset-img-1",
        imageUrl: "users/u/generated/asset-img-1/image.jpg",
        progress: 100
      }
    });
    const searched = JSON.stringify({
      id: "img2",
      cardType: "image_card",
      image: {
        original: "https://example.com/full.png",
        thumbnail: "https://example.com/thumb.png",
        title: "Example",
        source: "Example source",
        link: "https://example.com/page"
      }
    });
    const file = JSON.stringify({
      id: "file1",
      type: "render_file",
      cardType: "rendered_file_card",
      file_name: "hello.c",
      mime_type: "application/octet-stream",
      file_size: 83,
      url: "users/u/generated/file-id/hello.c"
    });

    expect(parseGrokCards([generated, searched, file])).toHaveLength(3);

    const normalized = normalizeGrokConversation({
      conversationId: "conv-1",
      title: "Grok fixture"
    }, [turn("a1", "assistant", "Visible **markdown**", [generated, searched, file], ["asset-img-1"])]);

    expect(normalized.platform).toBe("grok");
    expect(normalized.conversationUrl).toBe("https://grok.com/c/conv-1");
    expect(normalized.messages).toHaveLength(1);
    expect(normalized.messages[0].content[0]).toEqual({
      type: "text",
      text: "Visible **markdown**",
      format: "markdown"
    });
    expect(normalized.messages[0].attachments).toEqual([
      expect.objectContaining({
        source: "grok-generated-image",
        assetId: "asset-img-1",
        remoteUrl: "https://assets.grok.com/users/u/generated/asset-img-1/image.jpg",
        originalName: "image.jpg",
        isImage: true
      }),
      expect.objectContaining({
        source: "grok-search-image",
        remoteUrl: "https://example.com/full.png",
        sourceUrl: "https://example.com/page",
        originalName: "full.png",
        isImage: true
      }),
      expect.objectContaining({
        source: "grok-generated-file",
        conversationId: "conv-1",
        filePath: "/hello.c",
        remoteUrl: "https://assets.grok.com/users/u/generated/file-id/hello.c",
        originalName: "hello.c",
        size: 83,
        isImage: false
      })
    ]);
  });

  it("turns user fileAttachments into resolvable Grok assets", () => {
    const normalized = normalizeGrokConversation(
      { conversationId: "conv-1", title: "Grok fixture" },
      [turn(
        "u1",
        "user",
        "Move her from the beach to the water park",
        [],
        ["2ff43b37-bada-435b-b927-0aa79667884d"]
      )]
    );

    expect(normalized.messages[0].attachments).toEqual([
      expect.objectContaining({
        source: "grok-user-asset",
        id: "2ff43b37-bada-435b-b927-0aa79667884d",
        assetId: "2ff43b37-bada-435b-b927-0aa79667884d",
        conversationId: "conv-1",
        remoteUrl: null
      })
    ]);
  });

  it("does not duplicate generated images also listed in fileAttachments", () => {
    const generated = JSON.stringify({
      id: "card-id",
      cardType: "generated_image_card",
      image_chunk: {
        imageUuid: "asset-id",
        imageUrl: "users/u/generated/asset-id/image.jpg"
      }
    });

    const normalized = normalizeGrokConversation(
      { conversationId: "conv-1" },
      [turn("a1", "assistant", "", [generated], ["asset-id"])]
    );

    expect(normalized.messages[0].attachments).toHaveLength(1);
    expect(normalized.messages[0].attachments[0]).toEqual(
      expect.objectContaining({ source: "grok-generated-image", assetId: "asset-id" })
    );
  });

  it("replaces Grok card placeholders with normalized attachment references", () => {
    const attachments = [
      {
        id: "bca105",
        title: "Search image",
        isImage: true
      },
      {
        id: "U2R6U",
        originalName: "hello.c",
        isImage: false
      }
    ];
    const raw = [
      "Before image",
      '<grok:render card_id="bca105" card_type="image_card" type="render_searched_image"><argument name="image_id">foo</argument><argument name="size">LARGE</argument></grok:render>',
      "Between",
      '<grok:render card_id="U2R6U" card_type="rendered_file_card" type="render_file"><argument name="file_path">/home/workdir/artifacts/hello.c</argument></grok:render>',
      "After"
    ].join("\n\n");

    expect(replaceGrokCardPlaceholders(raw, attachments)).toContain(
      "![Search image](attachment://bca105)"
    );
    expect(replaceGrokCardPlaceholders(raw, attachments)).toContain(
      "[hello.c](attachment://U2R6U)"
    );

    const searched = JSON.stringify({
      id: "bca105",
      cardType: "image_card",
      image: { original: "https://example.com/image.png", title: "Search image" }
    });
    const normalized = normalizeGrokConversation(
      { conversationId: "conv-1" },
      [turn("a1", "assistant", raw, [searched])]
    );
    expect(normalized.messages[0].content[0].text).toContain(
      "![Search image](attachment://bca105)"
    );
    expect(normalized.messages[0].content[0].text).not.toContain("<grok:render");
  });

  it("ignores citation cards instead of turning source icons into images", () => {
    const citation = JSON.stringify({
      id: "c1",
      cardType: "citation_card",
      url: "https://example.com/source"
    });
    const normalized = normalizeGrokConversation(
      { conversationId: "conv-1" },
      [turn("a1", "assistant", "Answer", [citation])]
    );
    expect(normalized.messages[0].attachments).toEqual([]);
  });

  it("removes Grok-only card placeholders from visible Markdown", () => {
    expect(cleanGrokMarkdown(
      'Quote <grok:render card_id="c1" card_type="citation_card"></grok:render>\n\nDone'
    )).toBe("Quote \n\nDone");

    expect(cleanGrokMarkdown(
      'File\n\n<grok-card data-id="f1" data-type="rendered_file_card"></grok-card>'
    )).toBe("File");
  });

  it("widens an outer markdown fence when it contains a nested backtick fence", () => {
    const cleaned = cleanGrokMarkdown([
      "```markdown",
      "# heading inside fence",
      "- list",
      "```js",
      'console.log("nested fence")',
      "```",
      "```"
    ].join("\n"));

    expect(cleaned).toBe([
      "````markdown",
      "# heading inside fence",
      "- list",
      "```js",
      'console.log("nested fence")',
      "```",
      "````"
    ].join("\n"));
  });
});
