import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getConversationInPage,
  isActiveConversationData
} from "../chatgpt-api.js";

const originalChrome = globalThis.chrome;
const originalLocation = globalThis.location;

afterEach(() => {
  if (originalChrome === undefined) delete globalThis.chrome;
  else globalThis.chrome = originalChrome;

  if (originalLocation === undefined) delete globalThis.location;
  else globalThis.location = originalLocation;
});

function installChrome(executeScript) {
  globalThis.chrome = {
    i18n: {
      getMessage: vi.fn(key => {
        if (key === "noActiveConversation") return "No active conversation to export.";
        if (key === "errorAccessToken") return "accessToken was not found";
        return key;
      })
    },
    scripting: { executeScript }
  };
}

describe("active conversation detection", () => {
  it.each([
    null,
    undefined,
    {},
    { current_node: "node-1" },
    { current_node: "node-1", mapping: null }
  ])("rejects missing or incomplete conversation data", value => {
    expect(isActiveConversationData(value)).toBe(false);
  });

  it("accepts conversation data with a current node and mapping", () => {
    expect(isActiveConversationData({
      current_node: "node-1",
      mapping: { "node-1": { id: "node-1" } }
    })).toBe(true);
  });
});

describe("getConversationInPage", () => {
  it("turns a null page result into the localized no-active-conversation error", async () => {
    installChrome(vi.fn().mockResolvedValue([{ result: null }]));

    await expect(getConversationInPage(42)).rejects.toThrow(
      "No active conversation to export."
    );
  });

  it("uses the same localized error when the page URL has no conversation id", async () => {
    globalThis.location = { pathname: "/" };
    installChrome(vi.fn(async ({ func, args }) => [{ result: await func(...args) }]));

    await expect(getConversationInPage(42)).rejects.toThrow(
      "No active conversation to export."
    );
  });
});
