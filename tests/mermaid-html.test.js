import { describe, expect, it } from "vitest";
import {
  prepareMessagesForMermaid,
  applyMermaidRenderings
} from "../mermaid-html.js";

function message(text) {
  return [{
    id: "m1",
    role: "assistant",
    content: [{ type: "text", text, format: "markdown" }],
    attachments: []
  }];
}

describe("Mermaid HTML preparation", () => {
  it("extracts Mermaid fences without mutating the original messages", () => {
    const original = message([
      "Before",
      "```mermaid",
      "flowchart LR",
      "  A --> B",
      "```",
      "After"
    ].join("\n"));

    const prepared = prepareMessagesForMermaid(original);

    expect(prepared.blocks).toHaveLength(1);
    expect(prepared.blocks[0].source).toBe("flowchart LR\n  A --> B");
    expect(prepared.messages[0].content[0].text).toContain(
      "```chatgpt-export-mermaid-0\nCHATGPT_EXPORT_MERMAID_0\n```"
    );
    expect(original[0].content[0].text).toContain("```mermaid");
  });

  it("does not treat a Mermaid example inside a longer code fence as a diagram", () => {
    const prepared = prepareMessagesForMermaid(message([
      "````markdown",
      "```mermaid",
      "flowchart LR",
      "A --> B",
      "```",
      "````"
    ].join("\n")));

    expect(prepared.blocks).toEqual([]);
    expect(prepared.messages[0].content[0].text).toContain("```mermaid");
  });

  it("replaces a rendered placeholder with static SVG and adds export styling", () => {
    const prepared = prepareMessagesForMermaid(message(
      "```mermaid\nflowchart LR\nA --> B\n```"
    ));
    const block = prepared.blocks[0];
    const coreHtml = [
      "<html><head><style>body { margin: 0; }</style></head><body>",
      `<pre><code class="language-${block.syntheticLanguage}">${block.placeholder}</code></pre>`,
      "</body></html>"
    ].join("");

    const html = applyMermaidRenderings(
      coreHtml,
      prepared.blocks,
      [{ svg: '<svg id="diagram"><text>OK</text></svg>' }]
    );

    expect(html).toContain('<div class="mermaid-block"><svg id="diagram"><text>OK</text></svg></div>');
    expect(html).toContain(".mermaid-block svg");
    expect(html).not.toContain("CHATGPT_EXPORT_MERMAID_0");
  });

  it("falls back to an escaped Mermaid code block when rendering fails", () => {
    const prepared = prepareMessagesForMermaid(message(
      "```mermaid\nflowchart LR\nA[<unsafe>] --> B\n```"
    ));
    const block = prepared.blocks[0];
    const coreHtml = `<style></style><pre><code class="language-${block.syntheticLanguage}">${block.placeholder}</code></pre>`;

    const html = applyMermaidRenderings(coreHtml, prepared.blocks, [{ svg: null }]);

    expect(html).toContain(
      '<pre><code class="language-mermaid">flowchart LR\nA[&lt;unsafe&gt;] --&gt; B</code></pre>'
    );
  });
});
