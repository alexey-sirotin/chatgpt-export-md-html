(() => {
  const dom = globalThis.ChatGPTExportDomSelection;
  if (!dom) throw new Error("ChatGPTExportDomSelection is not loaded");

  const {
    isTemporaryId,
    stableMessageIdInElement,
    matchingTurnRoot,
    mountedFallbackRoot
  } = dom;

  let enabled = false;
  let observer = null;
  let refreshQueued = false;
  const reported = new Set();

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function mountedContainerRoot(container, sourceTurnId) {
    if (!container) return null;

    const matchingRoot = matchingTurnRoot(container, sourceTurnId);
    if (matchingRoot) return matchingRoot;

    if (stableMessageIdInElement(container)) return container;
    return mountedFallbackRoot(container);
  }

  function collectIds() {
    const stableIds = new Set();
    const temporaryIds = new Set();
    const containers = document.querySelectorAll('[data-turn-id-container]');

    // For cache validation prefer the final data-message-id whenever a mounted
    // turn has one. ChatGPT's data-turn-id-container can be a UI/render identity
    // that changes independently from the server conversation mapping, even
    // while the actual message UUID remains stable. Empty virtualization
    // placeholders are ignored entirely.
    for (const container of containers) {
      const sourceTurnId = container.getAttribute('data-turn-id-container');
      if (!sourceTurnId || sourceTurnId === 'client-created-root') continue;
      if (!mountedContainerRoot(container, sourceTurnId)) continue;

      const messageId = stableMessageIdInElement(container);
      if (messageId) {
        stableIds.add(messageId);
        continue;
      }

      // No final message UUID yet. An unresolved request-* means the rendered
      // conversation is changing, while a stable turn/container ID is the best
      // fallback for image-only or future DOM variants without data-message-id.
      if (isTemporaryId(sourceTurnId)) temporaryIds.add(sourceTurnId);
      else stableIds.add(sourceTurnId);
    }

    // Defensive fallback for a future DOM variant where mounted turns are no
    // longer wrapped in data-turn-id-container. As above, a stable message UUID
    // wins over the surrounding turn ID.
    for (const el of document.querySelectorAll('[data-turn-id]')) {
      if (el.closest?.('[data-turn-id-container]')) continue;
      const turnId = el.getAttribute('data-turn-id');
      if (!turnId || turnId === 'client-created-root') continue;
      if (!mountedFallbackRoot(el) && !stableMessageIdInElement(el)) continue;

      const messageId = stableMessageIdInElement(el);
      if (messageId) {
        stableIds.add(messageId);
      } else if (isTemporaryId(turnId)) {
        temporaryIds.add(turnId);
      } else {
        stableIds.add(turnId);
      }
    }

    return {
      conversationId: currentConversationId(),
      ids: [...stableIds],
      temporaryIds: [...temporaryIds]
    };
  }

  function reportCurrentIds() {
    if (!enabled) return;
    const snapshot = collectIds();
    if (!snapshot.conversationId) return;

    const ids = [];
    const temporaryIds = [];

    for (const id of snapshot.ids) {
      const key = `${snapshot.conversationId}\n${id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      ids.push(id);
    }

    for (const id of snapshot.temporaryIds) {
      const key = `${snapshot.conversationId}\n${id}`;
      if (reported.has(key)) continue;
      reported.add(key);
      temporaryIds.push(id);
    }

    if (!ids.length && !temporaryIds.length) return;

    chrome.runtime.sendMessage({
      type: 'SELECTION_INDEX_SEEN_IDS',
      conversationId: snapshot.conversationId,
      ids,
      temporaryIds
    }).catch(() => {});
  }

  function scheduleReport() {
    if (!enabled || refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      reportCurrentIds();
    });
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleReport);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-turn-id-container', 'data-turn-id', 'data-message-id']
    });
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'GET_SELECTION_INDEX_IDS') {
      respond(collectIds());
      return;
    }

    if (msg.type === 'ENABLE_SELECTION_INDEX_WATCH') {
      enabled = true;
      ensureObserver();
      reportCurrentIds();
      respond({ ok: true });
      return;
    }
  });
})();
