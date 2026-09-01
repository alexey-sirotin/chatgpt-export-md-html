import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const runtimeFiles = [
  "attachments.js", "background.js", "chatgpt-api.js", "content.js", "conversation.js",
  "dom-selection.js", "download-url.js", "offscreen.js", "popup.js", "render.js",
  "selection-cache-observer.js", "selection-index.js", "selection-matcher.js",
  "utils.js", "zip.js"
];

describe("project naming", () => {
  it("does not leak the retired chatgpt2md identifier into runtime code", () => {
    for (const path of runtimeFiles) {
      const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
      expect(source.toLowerCase(), path).not.toContain("chatgpt2md");
    }
  });
});
