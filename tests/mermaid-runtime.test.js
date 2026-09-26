// @vitest-environment jsdom

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { renderMermaidSourcesLocally } from "../mermaid-runtime.js";

const initialize = vi.fn();
const render = vi.fn();

beforeAll(() => {
  globalThis.chrome = {
    runtime: {
      getURL: path => `chrome-extension://test/${path}`
    }
  };
  globalThis.mermaid = { initialize, render };
});

beforeEach(() => {
  render.mockReset();
  document.body.innerHTML = "";
});

afterAll(() => {
  delete globalThis.mermaid;
  delete globalThis.chrome;
});

describe("Mermaid DOM runtime", () => {
  it("initializes Mermaid in strict static mode and sanitizes returned SVG", async () => {
    render.mockImplementation(async id => {
      const temporary = document.createElement("div");
      temporary.id = id;
      document.body.appendChild(temporary);

      const temporaryWrapper = document.createElement("div");
      temporaryWrapper.id = `d${id}`;
      document.body.appendChild(temporaryWrapper);

      return {
        svg: [
          '<svg xmlns="http://www.w3.org/2000/svg">',
          "<script>alert(1)</script>",
          '<a href="javascript:alert(1)" onclick="alert(2)"><text>OK</text></a>',
          "</svg>"
        ].join("")
      };
    });

    const [result] = await renderMermaidSourcesLocally(["flowchart LR\nA --> B"]);

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      flowchart: { htmlLabels: false }
    }));
    expect(result.svg).toContain("OK");
    expect(result.svg).not.toContain("<script");
    expect(result.svg).not.toContain("javascript:");
    expect(result.svg).not.toContain("onclick=");
    expect(document.querySelector('[id^="chatgpt-export-mermaid-"]')).toBeNull();
    expect(document.querySelector('[id^="dchatgpt-export-mermaid-"]')).toBeNull();
  });

  it("returns a per-diagram failure instead of rejecting the whole batch", async () => {
    render
      .mockResolvedValueOnce({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>first</text></svg>' })
      .mockRejectedValueOnce(new Error("Parse error"))
      .mockResolvedValueOnce({ svg: '<svg xmlns="http://www.w3.org/2000/svg"><text>third</text></svg>' });

    const results = await renderMermaidSourcesLocally([
      "flowchart LR\nA --> B",
      "this is not valid Mermaid",
      "flowchart LR\nC --> D"
    ]);

    expect(results).toHaveLength(3);
    expect(results[0].svg).toContain("first");
    expect(results[1]).toEqual({ svg: null, error: "Parse error" });
    expect(results[2].svg).toContain("third");
  });
});
