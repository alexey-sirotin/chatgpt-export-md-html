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

function message(text) {
  return {
    id: "math-message",
    role: "assistant",
    authorName: "Assistant",
    createdAt: "2026-09-25T18:00:00.000Z",
    content: [{ type: "text", text, format: "markdown" }],
    attachments: []
  };
}

function htmlFor(text) {
  return buildHtmlExport({
    title: "Math test",
    conversationUrl: null,
    includeOriginalLink: false,
    messages: [message(text)]
  });
}

describe("KaTeX rendering", () => {
  it("renders dollar and parenthesized inline math as MathML", () => {
    const html = htmlFor("Energy is $E=mc^2$ and also \\(a^2+b^2=c^2\\).");

    expect(html.match(/class="math-inline"/g)).toHaveLength(2);
    expect(html).toContain("<math");
    expect(html).toContain("application/x-tex");
  });

  it("renders dollar and bracket display math blocks", () => {
    const html = htmlFor([
      "Before",
      "",
      "$$",
      "\\int_0^1 x^2 \\, dx = \\frac{1}{3}",
      "$$",
      "",
      "\\[\\sum_{n=1}^{10} n = 55\\]",
      "",
      "After"
    ].join("\n"));

    expect(html.match(/class="math-block"/g)).toHaveLength(2);
    expect(html).toContain('display="block"');
    expect(html).toContain("Before");
    expect(html).toContain("After");
  });

  it("does not treat inline or fenced code as math", () => {
    const html = htmlFor([
      "Literal `$x^2$` remains code.",
      "",
      "```text",
      "$$",
      "x^2",
      "$$",
      "```"
    ].join("\n"));

    expect(html).not.toContain('class="math-inline"');
    expect(html).not.toContain('class="math-block"');
    expect(html).toContain("$x^2$");
    expect(html).toContain("$$\nx^2\n$$");
  });

  it("leaves ordinary currency alone", () => {
    const html = htmlFor("It costs $5 and $10 after delivery.");
    expect(html).not.toContain('class="math-inline"');
    expect(html).toContain("It costs $5 and $10 after delivery.");
  });

  it("preserves invalid TeX instead of dropping content", () => {
    const html = htmlFor("Broken: $\\definitelynotacommand{x}$.");
    expect(html).not.toContain('class="math-inline"');
    expect(html).toContain("$\\definitelynotacommand{x}$");
  });

  it("keeps original TeX in Markdown exports", () => {
    const source = "Inline $E=mc^2$ and display:\n\n$$\\frac{1}{2}$$";
    const markdown = buildMarkdownExport({
      title: "Math test",
      conversationUrl: null,
      includeOriginalLink: false,
      messages: [message(source)]
    });

    expect(markdown).toContain(source);
    expect(markdown).not.toContain("<math");
  });
});
