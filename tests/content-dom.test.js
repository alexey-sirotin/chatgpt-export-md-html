// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { loadBrowserScript } from "./dom-script-harness.js";

function stableTurn(turnId, messageId, {
  role = "assistant",
  body = "message"
} = {}) {
  const messageAttr = messageId ? ` data-message-id="${messageId}"` : "";
  return `
    <div data-turn-id-container="${turnId}">
      <section data-turn-id="${turnId}" data-turn="${role}">
        <div data-message-author-role="${role}"${messageAttr}>${body}</div>
      </section>
    </div>
  `;
}

describe("content-script DOM selection behavior", () => {
  it("uses the final message id for a request-* container once it is available", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: `
        <div data-turn-id-container="request-streaming">
          <div data-message-author-role="assistant" data-message-id="message-final">
            streamed answer
          </div>
        </div>
      `
    });

    expect(dispatch({ type: "GET_SELECTION" }).orderedIds)
      .toEqual(["message-final"]);
  });

  it("ignores an empty request-* virtualization placeholder", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: '<div data-turn-id-container="request-pending"></div>'
    });

    expect(dispatch({ type: "GET_SELECTION" }).orderedIds).toEqual([]);
  });

  it("keeps a stable legacy image-only turn selectable without data-message-id", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: `
        <div data-turn-id-container="legacy-image-turn">
          <section data-turn-id="legacy-image-turn">
            <img src="legacy.png" alt="">
          </section>
        </div>
      `
    });

    const state = dispatch({ type: "TOGGLE_SELECTION_UI" });

    expect(state).toMatchObject({ total: 1, selected: 1, enabled: true });
    expect(document.querySelectorAll(".chatgpt-export-select")).toHaveLength(1);
    expect(dispatch({ type: "GET_SELECTION" }).orderedIds)
      .toEqual(["legacy-image-turn"]);
  });

  it("supports the defensive mounted-turn fallback outside data-turn-id-container", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: `
        <section data-turn-id="standalone-turn">
          <div data-message-author-role="assistant" data-message-id="standalone-message">
            standalone
          </div>
        </section>
      `
    });

    dispatch({ type: "TOGGLE_SELECTION_UI" });

    expect(document.querySelectorAll(".chatgpt-export-select")).toHaveLength(1);
  });

  it("does not add duplicate checkboxes across repeated refreshes", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: stableTurn("turn-1", "message-1")
    });

    dispatch({ type: "TOGGLE_SELECTION_UI" });
    dispatch({ type: "GET_INFO" });
    dispatch({ type: "GET_SELECTION" });
    dispatch({ type: "GET_INFO" });

    expect(document.querySelectorAll(".chatgpt-export-select")).toHaveLength(1);
  });

  it("records both turn and message ids when a stable mounted turn is deselected", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: stableTurn("ui-turn-1", "message-final-1")
    });

    dispatch({ type: "TOGGLE_SELECTION_UI" });
    document.querySelector(".chatgpt-export-select").click();

    const selection = dispatch({ type: "GET_SELECTION" });

    expect(selection.excludedTurnIds).toEqual(["ui-turn-1"]);
    expect(selection.excludedMessageIds).toEqual(["message-final-1"]);
  });

  it("builds a conservative legacy context from stable mounted neighbors", () => {
    const { dispatch } = loadBrowserScript("content.js", {
      html: [
        stableTurn("turn-prev", "message-prev", { role: "user", body: "before" }),
        `
          <div data-turn-id-container="legacy-orphan-turn">
            <section data-turn-id="legacy-orphan-turn">
              <img src="orphan.png" alt="">
            </section>
          </div>
        `,
        stableTurn("turn-next", "message-next", { role: "user", body: "after" })
      ].join("")
    });

    dispatch({ type: "TOGGLE_SELECTION_UI" });

    const orphan = document.querySelector(
      '[data-turn-id-container="legacy-orphan-turn"] .chatgpt-export-select'
    );
    orphan.click();

    const selection = dispatch({ type: "GET_SELECTION" });

    expect(selection.excludedTurnIds).toContain("legacy-orphan-turn");
    expect(selection.legacyTurnContexts).toEqual([{
      turnId: "legacy-orphan-turn",
      prevMessageId: "message-prev",
      nextMessageId: "message-next"
    }]);
  });
});
