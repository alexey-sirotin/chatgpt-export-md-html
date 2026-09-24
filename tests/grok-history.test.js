import { describe, expect, it } from "vitest";
import { reconstructGrokHistoryMarkdown } from "../grok-normalize.js";

describe("Grok gateway history reconstruction", () => {
  it("uses render_start as the generated-image anchor and ignores the later completion chunk", () => {
    const attachments = [
      { id: "bca105", title: "Search image", isImage: true },
      { id: "TYiPy", title: "Generated Image", isImage: true }
    ];

    const chunks = [
      {
        text: {
          text: "## 8. Images\n\nSearch image:\n\n",
          channel: "CHANNEL_ASSISTANT_RESPONSE"
        }
      },
      {
        render_searched_image: {
          id: "bca105",
          image: { original: "https://example.com/search.jpg" }
        }
      },
      {
        text: {
          text: "\n\nGenerated image:\n\n",
          channel: "CHANNEL_ASSISTANT_RESPONSE"
        }
      },
      {
        render_start: {
          id: "TYiPy",
          generated_image: { prompt: "fixture" }
        }
      },
      {
        text: {
          text: "\n\n---\n\n## 9. After",
          channel: "CHANNEL_ASSISTANT_RESPONSE"
        }
      },
      {
        render_generated_image: {
          id: "TYiPy",
          image_chunk: {
            imageUuid: "asset-id",
            imageUrl: "users/u/generated/asset-id/image.jpg"
          }
        }
      }
    ];

    const markdown = reconstructGrokHistoryMarkdown(chunks, attachments);

    expect(markdown).toContain(
      "Search image:\n\n![Search image](attachment://bca105)"
    );
    expect(markdown).toContain(
      "Generated image:\n\n![Generated Image](attachment://TYiPy)\n\n---"
    );
    expect(markdown.match(/attachment:\/\/TYiPy/g)).toHaveLength(1);
  });

  it("ignores non-response thinking/header text", () => {
    const markdown = reconstructGrokHistoryMarkdown([
      {
        text: {
          text: "Thinking about your request",
          channel: "CHANNEL_ASSISTANT_NOTETAKER_HEADER"
        }
      },
      {
        text: {
          text: "Visible answer",
          channel: "CHANNEL_ASSISTANT_RESPONSE"
        }
      }
    ], []);

    expect(markdown).toBe("Visible answer");
  });
});
