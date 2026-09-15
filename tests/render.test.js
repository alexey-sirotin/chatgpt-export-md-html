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
