import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtmlExport, buildMarkdownExport } from "../render.js";

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

function messageWithInlineReferences() {
  return {
    id: "grok-inline",
    role: "assistant",
    authorName: "Assistant",
    createdAt: "2026-09-24T10:00:00.000Z",
    content: [{
      type: "text",
      format: "markdown",
      text: [
        "Before image",
        "![Search image](attachment://img-card)",
        "Between image and file",
        "[hello.c](attachment://file-card)",
        "After file"
      ].join("\n\n")
    }],
    attachments: [
      {
        source: "grok-search-image",
        id: "img-card",
        remoteUrl: "https://example.com/remote.png",
        originalName: "search.png",
        localName: "search.png",
        localPath: "Export/search.png",
        mimeType: "image/png",
        isImage: true
      },
      {
        source: "grok-generated-file",
        id: "file-card",
        remoteUrl: "https://assets.grok.com/dead/hello.c",
        originalName: "hello.c",
        localName: "hello.c",
        localPath: "Export/hello.c",
        mimeType: "text/plain",
        isImage: false
      }
    ]
  };
}

describe("inline attachment references", () => {
  it("resolves references to local files in Markdown without appending duplicates", () => {
    const markdown = buildMarkdownExport({
      title: "Test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [messageWithInlineReferences()]
    });

    expect(markdown).toContain("![Search image](Export/search.png)");
    expect(markdown).toContain("[hello.c](Export/hello.c)");
    expect(markdown).not.toContain("attachment://");
    expect(markdown).not.toContain("https://example.com/remote.png");
    expect(markdown.match(/Export\/search\.png/g)).toHaveLength(1);
    expect(markdown.match(/Export\/hello\.c/g)).toHaveLength(1);
    expect(markdown.indexOf("Before image")).toBeLessThan(markdown.indexOf("Export/search.png"));
    expect(markdown.indexOf("Export/search.png")).toBeLessThan(markdown.indexOf("Between image and file"));
    expect(markdown.indexOf("Between image and file")).toBeLessThan(markdown.indexOf("Export/hello.c"));
    expect(markdown.indexOf("Export/hello.c")).toBeLessThan(markdown.indexOf("After file"));
  });

  it("resolves references to local files in HTML without appending duplicates", () => {
    const html = buildHtmlExport({
      title: "Test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [messageWithInlineReferences()]
    });

    expect(html).toContain('<img src="Export/search.png"');
    expect(html).toContain('<a href="Export/hello.c">hello.c</a>');
    expect(html).not.toContain("attachment://");
    expect(html).not.toContain("https://example.com/remote.png");
    expect(html.match(/Export\/search\.png/g)).toHaveLength(2);
    expect(html.match(/Export\/hello\.c/g)).toHaveLength(1);
  });

  it("falls back to the remote image when no local copy was archived", () => {
    const message = messageWithInlineReferences();
    message.attachments[0] = {
      ...message.attachments[0],
      localPath: "Export/search.png",
      error: "TypeError: Failed to fetch"
    };

    const markdown = buildMarkdownExport({
      title: "Test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [message]
    });

    expect(markdown).toContain("![Search image](https://example.com/remote.png)");
    expect(markdown).not.toContain("attachment://img-card");
  });
});
