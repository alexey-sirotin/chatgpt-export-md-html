import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const runtimeFiles = [
  "manifest.json", "popup.html", "async-pool.js", "attachments.js", "background.js", "cancellation.js", "chatgpt-api.js",
  "content.js", "conversation.js", "dom-selection.js", "download-url.js", "offscreen.js", "popup.js",
  "render.js", "selection-cache-observer.js", "selection-index.js",
  "selection-matcher.js", "utils.js", "zip.js"
];

const readProjectFile = path =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const en = JSON.parse(readProjectFile("_locales/en/messages.json"));
const ru = JSON.parse(readProjectFile("_locales/ru/messages.json"));
const sortedKeys = value => Object.keys(value || {}).sort();
const placeholderNames = message =>
  [...String(message || "").matchAll(/\$([A-Z0-9_]+)\$/g)].map(m => m[1]).sort();

function referencedKeys() {
  const keys = new Set(["hideSelection", "omittedStartMarker", "omittedMessagesMarker"]);
  const patterns = [
    /\bt\(\s*["'`]([^"'`]+)["'`]/g,
    /chrome\.i18n\.getMessage\(\s*["'`]([^"'`]+)["'`]/g,
    /__MSG_([A-Za-z0-9_]+)__/g,
    /data-i18n(?:-placeholder)?=["']([^"']+)["']/g
  ];
  for (const path of runtimeFiles) {
    const source = readProjectFile(path);
    for (const pattern of patterns) {
      for (const match of source.matchAll(pattern)) keys.add(match[1]);
    }
  }
  return [...keys].sort();
}

describe("localization catalog", () => {
  it("keeps English and Russian key sets in sync", () => {
    expect(sortedKeys(ru)).toEqual(sortedKeys(en));
  });

  it("keeps placeholder definitions and references in sync", () => {
    for (const key of sortedKeys(en)) {
      expect(sortedKeys(ru[key]?.placeholders)).toEqual(sortedKeys(en[key]?.placeholders));
      expect(placeholderNames(ru[key]?.message)).toEqual(placeholderNames(en[key]?.message));
    }
  });

  it("contains every statically referenced runtime key", () => {
    const referenced = referencedKeys();
    const enKeys = new Set(sortedKeys(en));
    const ruKeys = new Set(sortedKeys(ru));
    expect(referenced.filter(key => !enKeys.has(key))).toEqual([]);
    expect(referenced.filter(key => !ruKeys.has(key))).toEqual([]);
  });

  it("does not contain empty messages", () => {
    for (const key of sortedKeys(en)) {
      expect(String(en[key]?.message || "").trim(), `en:${key}`).not.toBe("");
      expect(String(ru[key]?.message || "").trim(), `ru:${key}`).not.toBe("");
    }
  });
});
