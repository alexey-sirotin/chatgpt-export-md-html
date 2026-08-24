(() => {
  let enabled = false;
  let observer = null;
  let refreshQueued = false;
  const reported = new Set();

  function debug(event, details = {}) {
    console.info('[chatgpt2md-cache]', event, details);
  }

  function currentConversationId() {
    const match = location.pathname.match(/\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function isTemporaryId(value) {
    return !!value && value.startsWith('request-');
  }

  function stableMessageIdInContainer(container) {
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
    const containers = document.querySelectorAll('[data-turn-id-container]');

    // Mirror content.js selection identities instead of treating every internal
    // data-turn-id in ChatGPT's rendered subtree as a conversation identity.
    // Nested/internal turn IDs can change during hydration and were causing the
    // compact selection cache to invalidate even when the logical chat had not
    // changed.
    for (const container of containers) {
      const sourceTurnId = container.getAttribute('data-turn-id-container');
      if (!sourceTurnId || sourceTurnId === 'client-created-root') continue;

      const messageId = stableMessageIdInContainer(container);
      if (messageId) stableIds.add(messageId);

      if (isTemporaryId(sourceTurnId)) {
        // A request-* container is resolved as soon as the rendered message has
        // its stable UUID. Only an actually unresolved request should dirty the
        // cache.
        if (!messageId) temporaryIds.add(sourceTurnId);
      } else {
        stableIds.add(sourceTurnId);
      }
    }

    // Defensive fallback for a future DOM variant where mounted turns are no
    // longer wrapped in data-turn-id-container. This mirrors content.js's
    // fallback and ignores data-turn-id nodes that already belong to a known
    // container, avoiding hydration-only internal IDs.
    for (const el of document.querySelectorAll('[data-turn-id]')) {
      if (el.closest?.('[data-turn-id-container]')) continue;
      const turnId = el.getAttribute('data-turn-id');
      if (!turnId || turnId === 'client-created-root') continue;
      if (isTemporaryId(turnId)) temporaryIds.add(turnId);
      else stableIds.add(turnId);

      const messageId = stableMessageIdInContainer(el);
      if (messageId) stableIds.add(messageId);
    }

    return {
      conversationId: currentConversationId(),
      ids: [...stableIds],
      temporaryIds: [...temporaryIds]
    };
  }

  function summarizeSnapshot(snapshot) {
    return {
      conversationId: snapshot.conversationId,
      stableCount: snapshot.ids.length,
      temporaryCount: snapshot.temporaryIds.length,
      stableIds: snapshot.ids,
      temporaryIds: snapshot.temporaryIds
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

    debug('observer-report', {
      conversationId: snapshot.conversationId,
      stableCount: ids.length,
      temporaryCount: temporaryIds.length,
      stableIds: ids,
      temporaryIds
    });

    chrome.runtime.sendMessage({
      type: 'SELECTION_INDEX_SEEN_IDS',
      conversationId: snapshot.conversationId,
      ids,
      temporaryIds
    }).then(response => {
      debug('observer-response', {
        dirty: response?.dirty,
        stableCount: ids.length,
        temporaryCount: temporaryIds.length
      });
    }).catch(error => {
      debug('observer-error', { message: error?.message || String(error) });
    });
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
      const snapshot = collectIds();
      debug('snapshot-request', summarizeSnapshot(snapshot));
      respond(snapshot);
      return;
    }

    if (msg.type === 'ENABLE_SELECTION_INDEX_WATCH') {
      enabled = true;
      ensureObserver();
      const snapshot = collectIds();
      debug('watch-enabled', summarizeSnapshot(snapshot));
      reportCurrentIds();
      respond({ ok: true });
      return;
    }
  });
})();
