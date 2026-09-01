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
