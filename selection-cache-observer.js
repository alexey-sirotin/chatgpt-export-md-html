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

  function mountedFallbackRoot(container) {
    if (!container) return null;

    const semantic = container.querySelector?.([
      '[data-message-author-role]',
      '[data-testid^="conversation-turn-"]',
      '[data-conversation-screenshot-content]',
      '.markdown',
      'img',
      'video',
      'audio'
    ].join(','));
    if (semantic) return semantic.closest?.('[data-conversation-screenshot-content]') || semantic;

    if ((container.textContent || '').trim()) return container;
    return null;
  }

  function mountedContainerRoot(container, sourceTurnId) {
    if (!container) return null;

    for (const candidate of container.querySelectorAll?.('[data-turn-id]') || []) {
      if (candidate.getAttribute('data-turn-id') === sourceTurnId) return candidate;
    }

    if (stableMessageIdInContainer(container)) return container;
    return mountedFallbackRoot(container);
  }

  function collectIds() {
    const stableIds = new Set();
    const temporaryIds = new Set();
    const containers = document.querySelectorAll('[data-turn-id-container]');

    // For cache validation prefer the final data-message-id whenever a mounted
    // turn has one. ChatGPT's data-turn-id-container can be a UI/render identity
    // that changes independently from the server conversation mapping, even
    // while the actual message UUID remains stable. Reporting both identities
    // produced false cache misses on otherwise unchanged chats.
    for (const container of containers) {
      const sourceTurnId = container.getAttribute('data-turn-id-container');
      if (!sourceTurnId || sourceTurnId === 'client-created-root') continue;
      if (!mountedContainerRoot(container, sourceTurnId)) continue;

      const messageId = stableMessageIdInContainer(container);
      if (messageId) {
        stableIds.add(messageId);
        continue;
      }

      // No final message UUID yet. An unresolved request-* definitely means the
      // rendered conversation is changing, while a stable turn/container ID is
      // the best fallback for image-only or future DOM variants without a
      // data-message-id.
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
      if (!mountedFallbackRoot(el) && !stableMessageIdInContainer(el)) continue;

      const messageId = stableMessageIdInContainer(el);
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

  function summarizeSnapshot(snapshot) {
    return {
      conversationId: snapshot.conversationId,
      stableCount: snapshot.ids.length,
      temporaryCount: snapshot.temporaryIds.length,
      stableIds: snapshot.ids,
      temporaryIds: snapshot.temporaryIds
    };
  }

  function describeId(id) {
    const selector = [
      `[data-message-id="${CSS.escape(id)}"]`,
      `[data-turn-id="${CSS.escape(id)}"]`,
      `[data-turn-id-container="${CSS.escape(id)}"]`
    ].join(',');

    return [...document.querySelectorAll(selector)].map(el => {
      const container = el.closest?.('[data-turn-id-container]') || el;
      const matchedBy = [];
      for (const attr of ['data-message-id', 'data-turn-id', 'data-turn-id-container']) {
        if (el.getAttribute(attr) === id) matchedBy.push(attr);
      }
      return {
        tag: el.tagName,
        matchedBy,
        messageId: el.getAttribute('data-message-id'),
        turnId: el.getAttribute('data-turn-id'),
        turnContainerId: el.getAttribute('data-turn-id-container'),
        containerTurnId: container?.getAttribute?.('data-turn-id-container') || null,
        containerMessageId: stableMessageIdInContainer(container),
        role: el.getAttribute('data-message-author-role') ||
          container?.querySelector?.('[data-message-author-role]')?.getAttribute('data-message-author-role') ||
          null,
        testId: el.getAttribute('data-testid') ||
          container?.querySelector?.('[data-testid]')?.getAttribute('data-testid') ||
          null,
        text: (container?.innerText || el.innerText || '').trim().slice(0, 300)
      };
    });
  }

  async function sendSeenIds(conversationId, ids, temporaryIds) {
    return chrome.runtime.sendMessage({
      type: 'SELECTION_INDEX_SEEN_IDS',
      conversationId,
      ids,
      temporaryIds
    });
  }

  async function probeIds(conversationId, ids, temporaryIds) {
    for (const id of ids) {
      const response = await sendSeenIds(conversationId, [id], []);
      debug('probe-stable', { id, dirty: response?.dirty });
      if (response?.dirty) {
        debug('probe-first-dirty', { kind: 'stable', id, dom: describeId(id) });
        return response;
      }
    }

    for (const id of temporaryIds) {
      const response = await sendSeenIds(conversationId, [], [id]);
      debug('probe-temporary', { id, dirty: response?.dirty });
      if (response?.dirty) {
        debug('probe-first-dirty', { kind: 'temporary', id, dom: describeId(id) });
        return response;
      }
    }

    return { dirty: false };
  }

  async function reportCurrentIds() {
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

    try {
      const response = await probeIds(snapshot.conversationId, ids, temporaryIds);
      debug('observer-response', {
        dirty: response?.dirty,
        stableCount: ids.length,
        temporaryCount: temporaryIds.length
      });
    } catch (error) {
      debug('observer-error', { message: error?.message || String(error) });
    }
  }

  function scheduleReport() {
    if (!enabled || refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      void reportCurrentIds();
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
      void reportCurrentIds();
      respond({ ok: true });
      return;
    }
  });
})();
