import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildHtmlExport, buildMarkdownExport } from "../render.js";
import { markdownHref } from "../utils.js";

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

function imageMessage(overrides = {}) {
  return {
    id: "image-message",
    role: "assistant",
    authorName: "Assistant",
    createdAt: "2026-08-30T17:00:00.000Z",
    content: [],
    attachments: [{
      originalName: "Эфирный силуэт с золотыми акцентами",
      localName: "Эфирный силуэт с золотыми акцентами.png",
      localPath: "Export/Эфирный силуэт с золотыми акцентами.png",
      mimeType: "application/octet-stream",
      isImage: true
    }],
    ...overrides
  };
}

describe("rendering metadata-only image attachments", () => {
  it("keeps a known image clickable in Markdown even without an image MIME type", () => {
    const message = imageMessage();
    const href = markdownHref(message.attachments[0].localPath);

    const markdown = buildMarkdownExport({
      title: "Test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [message]
    });

    expect(markdown).toContain(
      `[![Эфирный силуэт с золотыми акцентами](${href})](${href})`
    );
  });

  it("keeps a known image clickable in HTML", () => {
    const message = imageMessage();
    const href = markdownHref(message.attachments[0].localPath);

    const html = buildHtmlExport({
      title: "Test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [message]
    });

    expect(html).toContain(
      `<a href="${href}"><img src="${href}" alt="Эфирный силуэт с золотыми акцентами"></a>`
    );
  });
});


describe("nested list rendering", () => {
  it("preserves ordered-list nesting in HTML", () => {
    const html = buildHtmlExport({
      title: "Nested lists",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [{
        id: "nested",
        role: "assistant",
        authorName: "Assistant",
        createdAt: "2026-09-15T09:32:00.000Z",
        content: [{
          type: "text",
          text: [
            "1. Подготовка теста",
            "   1. Собрать примеры сообщений",
            "   2. Проверить разные типы разметки",
            "      1. Списки",
            "      2. Таблицы",
            "2. Прогон экспортёра"
          ].join("\n"),
          format: "markdown"
        }],
        attachments: []
      }]
    });

    expect(html).toContain(
      "<ol>\n<li>Подготовка теста<ol>\n<li>Собрать примеры сообщений</li>"
    );
    expect(html).toContain(
      "<li>Проверить разные типы разметки<ol>\n<li>Списки</li>\n<li>Таблицы</li>\n</ol></li>"
    );
    expect(html).toContain("<li>Прогон экспортёра</li>\n</ol>");
  });

  it("preserves mixed nested unordered lists", () => {
    const html = buildHtmlExport({
      title: "Nested bullets",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [{
        id: "nested-bullets",
        role: "assistant",
        authorName: "Assistant",
        createdAt: "2026-09-15T09:32:00.000Z",
        content: [{
          type: "text",
          text: "- One\n  - Two\n    - Three\n- Four",
          format: "markdown"
        }],
        attachments: []
      }]
    });

    expect(html).toContain("<ul>\n<li>One<ul>\n<li>Two<ul>");
    expect(html).toContain("<li>Four</li>\n</ul>");
  });
});


describe("Claude remote image fallback", () => {
  const remoteMessage = {
    id: "remote-image",
    role: "assistant",
    authorName: "Assistant",
    createdAt: "2026-09-15T09:29:00.000Z",
    content: [],
    attachments: [{
      source: "claude-remote-image",
      id: "img-1",
      remoteUrl: "https://example.com/image.jpg",
      sourceUrl: "https://example.com/page",
      title: "Example image",
      originalName: "image.jpg",
      mimeType: "image/jpeg",
      isImage: true,
      localAvailable: false,
      error: "TypeError: Failed to fetch"
    }]
  };

  it("renders the remote image as a clickable Markdown image when archiving fails", () => {
    const markdown = buildMarkdownExport({
      title: "Remote image",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [remoteMessage]
    });

    expect(markdown).toContain(
      "[![Example image](https://example.com/image.jpg)](https://example.com/page)"
    );
    expect(markdown).not.toContain("htmlAttachmentFailed");
  });

  it("renders the remote image as a clickable HTML image when archiving fails", () => {
    const html = buildHtmlExport({
      title: "Remote image",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [remoteMessage]
    });

    expect(html).toContain(
      '<a href="https://example.com/page"><img src="https://example.com/image.jpg" alt="Example image"></a>'
    );
    expect(html).not.toContain("htmlAttachmentFailed");
  });

  it("uses the local image when the remote image was archived", () => {
    const localMessage = {
      ...remoteMessage,
      attachments: [{
        ...remoteMessage.attachments[0],
        localAvailable: true,
        error: undefined,
        localPath: "Export/image.jpg",
        localName: "image.jpg"
      }]
    };
    const markdown = buildMarkdownExport({
      title: "Remote image",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [localMessage]
    });

    expect(markdown).toContain("Export/image.jpg");
    expect(markdown).not.toContain("https://example.com/image.jpg");
  });
});
