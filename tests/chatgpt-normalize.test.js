import { describe, expect, it } from "vitest";
import {
  normalizeChatGPTConversation,
  normalizeChatGPTMarkdownMath
} from "../chatgpt-normalize.js";

describe("normalizeChatGPTMarkdownMath", () => {
  it("converts ChatGPT math delimiters to portable Markdown dollar syntax", () => {
    const source = [
      "Inline: \\(E = mc^2\\)",
      "",
      "\\[",
      "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}",
      "\\]"
    ].join("\n");

    const normalized = normalizeChatGPTMarkdownMath(source);

    expect(normalized).toContain("Inline: $E = mc^2$");
    expect(normalized).toContain([
      "$$",
      "\\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi}",
      "$$"
    ].join("\n"));
  });

  it("does not rewrite math-like delimiters inside code", () => {
    const source = [
      "Literal `\\(x\\)` stays code.",
      "",
      "```text",
      "\\[",
      "x^2",
      "\\]",
      "```"
    ].join("\n");

    expect(normalizeChatGPTMarkdownMath(source)).toBe(source);
  });
});

describe("normalizeChatGPTConversation", () => {
  it("normalizes visible ChatGPT branch nodes into provider-neutral messages", () => {
    const first = {
      parent: "root",
      message: {
        id: "u1",
        author: { role: "user" },
        create_time: 1757930000,
        content: { parts: ["Hello"] },
        metadata: {}
      }
    };
    const second = {
      parent: "u1",
      message: {
        id: "a1",
        author: { role: "assistant" },
        create_time: 1757930001,
        content: { parts: ["**Hi**"] },
        metadata: { model_slug: "gpt-test" }
      }
    };

    const normalized = normalizeChatGPTConversation(
      {
        conversation_id: "conv-1",
        title: "Test conversation",
        safe_urls: []
      },
      [first, second],
      {
        beforeNodes: new Set([second]),
        omittedAtStart: true,
        omittedAtEnd: true
      }
    );

    expect(normalized.platform).toBe("chatgpt");
    expect(normalized.conversationId).toBe("conv-1");
    expect(normalized.conversationUrl).toBe("https://chatgpt.com/c/conv-1");
    expect(normalized.title).toBe("Test conversation");
    expect(normalized.messages).toHaveLength(2);

    expect(normalized.messages[0]).toMatchObject({
      id: "u1",
      parentId: "root",
      role: "user",
      sourceRole: "user",
      omittedBefore: true,
      content: [{ type: "text", text: "Hello", format: "markdown" }]
    });

    expect(normalized.messages[1]).toMatchObject({
      id: "a1",
      parentId: "u1",
      role: "assistant",
      sourceRole: "assistant",
      model: "gpt-test",
      omittedBefore: true,
      omittedAfter: true,
      content: [{ type: "text", text: "**Hi**", format: "markdown" }]
    });
  });

  it("normalizes ChatGPT math delimiters in message content", () => {
    const node = {
      parent: "u1",
      message: {
        id: "a-math",
        author: { role: "assistant" },
        create_time: 1757930002,
        content: { parts: ["Energy: \\(E=mc^2\\)\n\n\\[x^2\\]"] },
        metadata: {}
      }
    };

    const normalized = normalizeChatGPTConversation(
      { conversation_id: "conv-math", safe_urls: [] },
      [node]
    );

    expect(normalized.messages[0].content[0].text).toBe("Energy: $E=mc^2$\n\n$$x^2$$");
  });

  it("adds sandbox download context during normalization", () => {
    const node = {
      parent: "u1",
      message: {
        id: "a2",
        author: { role: "assistant" },
        create_time: 1757930002,
        content: {
          parts: ["[Download](sandbox:/mnt/data/example.txt)"]
        },
        metadata: {}
      }
    };

    const normalized = normalizeChatGPTConversation(
      { conversation_id: "conv-2", safe_urls: [] },
      [node]
    );

    expect(normalized.messages[0].attachments[0]).toMatchObject({
      source: "sandbox",
      sandboxPath: "/mnt/data/example.txt",
      conversationId: "conv-2",
      messageId: "a2"
    });
  });
});
