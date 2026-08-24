(() => {
  let enabled = false;
  let observer = null;
  let refreshQueued = false;
  const reported = new Set();

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isTemporaryId(value) {
    return !!value && value.startsWith('request-');
  }

  function stableMessageIdInContext(el) {
    const container = el?.closest?.('[data-turn-id-container]') || el;
    if (!container) return null;

    const messageEl = container.matches?.('[data-message-id]')
      ? container
      : container.querySelector?.('[data-message-id]');
    const messageId = messageEl?.getAttribute('data-message-id') || null;
    return messageId && !isTemporaryId(messageId) ? messageId : null;
  }

  function collectIds() {
    const stableIds = new Set();
    const temporaryIds = new Set();

    for (const el of document.querySelectorAll('[data-turn-id-container], [data-turn-id], [data-message-id]')) {
      for (const attr of ['data-turn-id-container', 'data-turn-id', 'data-message-id']) {
        const value = el.getAttribute(attr);
        if (!value || value === 'client-created-root') continue;

        if (!isTemporaryId(value)) {
          stableIds.add(value);
          continue;
        }

        // ChatGPT can keep request-* as the turn/container ID even after the
        // rendered message has received its final UUID in data-message-id. In
        // that state the temporary ID is not evidence that the conversation
        // changed: use the stable message ID instead. Only unresolved request-*
        // IDs should invalidate the compact selection index.
        const stableMessageId = stableMessageIdInContext(el);
        if (stableMessageId) stableIds.add(stableMessageId);
        else temporaryIds.add(value);
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
