import { describe, expect, it } from "vitest";
import {
  chatgptPlatform,
  claudePlatform,
  platformForUrl
} from "../platform.js";

describe("platform registry", () => {
  it("detects ChatGPT conversation URLs", () => {
    const url = "https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000";
    expect(platformForUrl(url)?.id).toBe("chatgpt");
    expect(chatgptPlatform.conversationIdFromUrl(url))
      .toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("detects Claude conversation URLs", () => {
    const url = "https://claude.ai/chat/123e4567-e89b-12d3-a456-426614174000";
    expect(platformForUrl(url)?.id).toBe("claude");
    expect(claudePlatform.conversationIdFromUrl(url))
      .toBe("123e4567-e89b-12d3-a456-426614174000");
  });

  it("does not claim unrelated URLs", () => {
    expect(platformForUrl("https://example.com/c/123")).toBeNull();
    expect(chatgptPlatform.conversationIdFromUrl("https://example.com/c/123")).toBe("");
  });

  it("accepts non-conversation ChatGPT pages but returns no conversation id", () => {
    expect(platformForUrl("https://chatgpt.com/")?.id).toBe("chatgpt");
    expect(chatgptPlatform.conversationIdFromUrl("https://chatgpt.com/")).toBe("");
  });
});
