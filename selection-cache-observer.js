(() => {
  let enabled = false;
  let observer = null;
  let refreshQueued = false;
  const reported = new Set();

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function collectIds() {
    const stableIds = new Set();
    const temporaryIds = new Set();

    for (const el of document.querySelectorAll('[data-turn-id-container], [data-turn-id], [data-message-id]')) {
      for (const attr of ['data-turn-id-container', 'data-turn-id', 'data-message-id']) {
        const value = el.getAttribute(attr);
        if (!value || value === 'client-created-root') continue;
        if (value.startsWith('request-')) temporaryIds.add(value);
        else stableIds.add(value);
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
