// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadBrowserScript } from "./dom-script-harness.js";

function stableContainer(turnId, messageId, {
  body = "message",
  role = "assistant"
} = {}) {
  const messageAttr = messageId ? ` data-message-id="${messageId}"` : "";
  return `
    <div data-turn-id-container="${turnId}">
      <section data-turn-id="${turnId}">
        <div data-message-author-role="${role}"${messageAttr}>${body}</div>
      </section>
    </div>
  `;
}

describe("selection-cache observer DOM identity rules", () => {
  it("prefers a stable data-message-id over a stable turn/container id", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: stableContainer("ui-render-turn", "server-message-id")
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: ["server-message-id"],
      temporaryIds: []
    });
  });

  it("uses the final message id for a request-* container after hydration", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: `
        <div data-turn-id-container="request-streaming">
          <div data-message-author-role="assistant" data-message-id="message-final">
            streamed
          </div>
        </div>
      `
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: ["message-final"],
      temporaryIds: []
    });
  });

  it("reports a rendered unresolved request-* as temporary", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: `
        <div data-turn-id-container="request-pending">
          <div data-message-author-role="assistant">streaming</div>
        </div>
      `
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: [],
      temporaryIds: ["request-pending"]
    });
  });

  it("ignores an empty request-* virtualization placeholder", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: '<div data-turn-id-container="request-empty"></div>'
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: [],
      temporaryIds: []
    });
  });

  it("falls back to a stable turn id for a mounted legacy image-only turn", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: `
        <div data-turn-id-container="legacy-image-turn">
          <section data-turn-id="legacy-image-turn">
            <img src="legacy.png" alt="">
          </section>
        </div>
      `
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: ["legacy-image-turn"],
      temporaryIds: []
    });
  });

  it("supports the standalone data-turn-id fallback and still prefers its message id", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: `
        <section data-turn-id="standalone-ui-turn">
          <div data-message-author-role="assistant" data-message-id="standalone-message">
            standalone
          </div>
        </section>
      `
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" })).toEqual({
      conversationId: "test-conversation",
      ids: ["standalone-message"],
      temporaryIds: []
    });
  });

  it("deduplicates repeated mounted representations of the same stable message", () => {
    const { dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: [
        stableContainer("ui-turn-a", "same-message"),
        stableContainer("ui-turn-b", "same-message")
      ].join("")
    });

    expect(dispatch({ type: "GET_SELECTION_INDEX_IDS" }).ids)
      .toEqual(["same-message"]);
  });

  it("reports each seen id only once while the watch is enabled", () => {
    const { chrome, dispatch } = loadBrowserScript("selection-cache-observer.js", {
      html: `
        <div data-turn-id-container="request-pending">
          <div data-message-author-role="assistant">streaming</div>
        </div>
      `
    });

    dispatch({ type: "ENABLE_SELECTION_INDEX_WATCH" });
    dispatch({ type: "ENABLE_SELECTION_INDEX_WATCH" });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: "SELECTION_INDEX_SEEN_IDS",
      conversationId: "test-conversation",
      ids: [],
      temporaryIds: ["request-pending"]
    });
  });
});
