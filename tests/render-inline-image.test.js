import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtmlExport } from "../render.js";

beforeAll(() => {
  globalThis.chrome = {
    i18n: {
      getMessage: key => key,
      getUILanguage: () => "en"
    }
  };
});

afterAll(() => {
  delete globalThis.chrome;
});

describe("inline Markdown image rendering", () => {
  it("renders a local image with a numbered filename as an image in HTML", () => {
    const html = buildHtmlExport({
      title: "Inline image",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [{
        id: "m1",
        role: "assistant",
        authorName: "Assistant",
        createdAt: "2026-09-24T10:00:00.000Z",
        content: [{
          type: "text",
          format: "markdown",
          text: "Before ![Generated Image](Export/image%20%282%29.jpg) after"
        }],
        attachments: []
      }]
    });

    expect(html).toContain(
      '<a href="Export/image%20%282%29.jpg"><img src="Export/image%20%282%29.jpg" alt="Generated Image"></a>'
    );
    expect(html).not.toContain("!<a");
  });
});
