(() => {
  function isTemporaryId(value) {
    return !!value && value.startsWith("request-");
  }

  function isStableId(value) {
    return !!value &&
      value !== "client-created-root" &&
      !isTemporaryId(value);
  }

  function selfOrDescendantWithMessageId(element) {
    if (!element) return null;
    if (element.matches?.("[data-message-id]")) return element;
    return element.querySelector?.("[data-message-id]") || null;
  }

  function stableMessageIdInElement(element) {
    const messageEl = selfOrDescendantWithMessageId(element);
    const messageId = messageEl?.getAttribute("data-message-id") || null;
    return messageId && !isTemporaryId(messageId) ? messageId : null;
  }

  function matchingTurnRoot(container, sourceTurnId) {
    if (!container || !sourceTurnId) return null;

    for (const candidate of container.querySelectorAll?.("[data-turn-id]") || []) {
      if (candidate.getAttribute("data-turn-id") === sourceTurnId) return candidate;
    }

    return null;
  }

  function mountedFallbackRoot(container) {
    if (!container) return null;

    const semantic = container.querySelector?.([
      "[data-message-author-role]",
      '[data-testid^="conversation-turn-"]',
      "[data-conversation-screenshot-content]",
      ".markdown",
      "img",
      "video",
      "audio"
    ].join(","));
    if (semantic) {
      return semantic.closest?.("[data-conversation-screenshot-content]") || semantic;
    }

    if ((container.textContent || "").trim()) return container;
    return null;
  }

  globalThis.ChatGPTExportDomSelection = Object.freeze({
    isTemporaryId,
    isStableId,
    selfOrDescendantWithMessageId,
    stableMessageIdInElement,
    matchingTurnRoot,
    mountedFallbackRoot
  });
})();
