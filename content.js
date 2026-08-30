(() => {
  const t = (key) => chrome.i18n.getMessage(key) || key;
  const selectedTurnIds = new Set();
  const selectedMessageIds = new Set();
  const selectedLegacyRangeKeys = new Set();
  const excludedTurnIds = new Set();
  const excludedMessageIds = new Set();
  const excludedLegacyRangeKeys = new Set();
  let enabled = false;
  let anchorTurnId = null;
  let observer = null;
  let refreshQueued = false;
  let selectAllMode = true;

  function validTurnId(id) {
    return !!id && id !== 'client-created-root' && !id.startsWith('request-');
  }

  function containerSelectionIdentity(container) {
    if (!container) return null;

    const sourceTurnId = container.getAttribute('data-turn-id-container');
    if (validTurnId(sourceTurnId)) {
      return { turnId: sourceTurnId, sourceTurnId };
    }

    // Fresh assistant replies in ChatGPT's live SPA use a temporary
    // data-turn-id-container/data-turn-id such as "request-...", while the
    // rendered message already has its final UUID in data-message-id. Treat that
    // real message ID as the selection identity. Empty request placeholders have
    // no data-message-id and remain ignored.
    if (sourceTurnId?.startsWith('request-')) {
      const messageId = selfOrDescendantWithMessageId(container)?.getAttribute('data-message-id') || null;
      if (validTurnId(messageId)) return { turnId: messageId, sourceTurnId };
    }

    return null;
  }

  function allTurnContainers() {
    const out = [];
    for (const el of document.querySelectorAll('[data-turn-id-container]')) {
      const identity = containerSelectionIdentity(el);
      if (identity) out.push({ el, ...identity });
    }
    return out;
  }

  function orderedTurnIds() {
    return [...new Set(allTurnContainers().map(item => item.turnId))];
  }

  function selfOrDescendantWithMessageId(el) {
    if (!el) return null;
    if (el.matches?.('[data-message-id]')) return el;
    return el.querySelector?.('[data-message-id]') || null;
  }

  function mountedFallbackRoot(container) {
    if (!container) return null;

    // Fresh assistant replies can appear in the live SPA before ChatGPT adds
    // data-turn-id/data-message-id to their inner markup. Detect rendered
    // conversational content without treating empty virtualization placeholders
    // as mounted messages.
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

    // Text-only freshly appended turns may temporarily have none of the stable
    // attributes above. Virtualized placeholders observed so far are empty, so
    // non-whitespace text is a useful final fallback.
    if ((container.textContent || '').trim()) return container;
    return null;
  }

  function populatedTurns() {
    const out = [];
    const seen = new Set();

    for (const item of allTurnContainers()) {
      const { el: container, turnId, sourceTurnId } = item;
      if (!turnId || seen.has(turnId)) continue;

      // Older/stable ChatGPT markup exposes section[data-turn-id][data-turn].
      // Fresh assistant replies can use a temporary request-* turn ID even
      // though data-message-id already contains the final UUID. Match the DOM
      // root by its source turn ID, while using the final message UUID as our
      // selection identity.
      let root = null;
      for (const candidate of container.querySelectorAll('[data-turn-id]')) {
        if (candidate.getAttribute('data-turn-id') === sourceTurnId) {
          root = candidate;
          break;
        }
      }
      root ||= mountedFallbackRoot(container);
      if (!root) continue; // genuine virtualized placeholder

      const messageEl = selfOrDescendantWithMessageId(root) || selfOrDescendantWithMessageId(container);
      const messageId = messageEl?.getAttribute('data-message-id') || null;
      out.push({ turnId, sourceTurnId, root, container, messageId });
      seen.add(turnId);
    }

    // Defensive fallback for a future DOM variant where a mounted turn is no
    // longer nested inside data-turn-id-container. Do not require
    // data-message-id here either: image-only generated replies may not have it.
    for (const section of document.querySelectorAll('[data-turn-id]')) {
      const turnId = section.getAttribute('data-turn-id');
      if (!validTurnId(turnId) || seen.has(turnId)) continue;
      const messageEl = selfOrDescendantWithMessageId(section);
      out.push({
        turnId,
        root: section,
        container: section,
        messageId: messageEl?.getAttribute('data-message-id') || null
      });
      seen.add(turnId);
    }

    // The fallback pass above can append future DOM variants out of document
    // order. Restore the real visual order before deriving legacy anchors.
    out.sort((a, b) => {
      if (a.container === b.container) return 0;
      const pos = a.container.compareDocumentPosition(b.container);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });

    // Legacy image-only turns can expose only an opaque DOM container ID that
    // never appears in the server mapping. Give such a turn a pair of stable
    // neighboring message IDs from the actual DOM order. The server can then
    // identify the logical assistant response bounded by those two messages
    // instead of guessing from one side only.
    const stableMessageIds = out.map(turn => turnMessageId(turn));
    let prevStableMessageId = null;
    const nextStableByIndex = new Array(out.length).fill(null);
    let nextStableMessageId = null;

    for (let i = out.length - 1; i >= 0; i--) {
      nextStableByIndex[i] = nextStableMessageId;
      if (stableMessageIds[i]) nextStableMessageId = stableMessageIds[i];
    }

    for (let i = 0; i < out.length; i++) {
      const turn = out[i];
      const messageId = stableMessageIds[i];

      if (messageId) {
        prevStableMessageId = messageId;
        continue;
      }

      if (prevStableMessageId || nextStableByIndex[i]) {
        turn.legacyPrevMessageId = prevStableMessageId;
        turn.legacyNextMessageId = nextStableByIndex[i];
      }
    }

    return out;
  }

  function checkboxHost(turn) {
    return turn.root.querySelector?.('[data-conversation-screenshot-content]') ||
      turn.container.querySelector?.('[data-conversation-screenshot-content]') ||
      turn.container.querySelector?.('[data-message-author-role]') ||
      turn.container.querySelector?.('[data-testid^="conversation-turn-"]') ||
      turn.root;
  }

  function turnMessageId(turn) {
    return turn.messageId ||
      selfOrDescendantWithMessageId(turn.root)?.getAttribute('data-message-id') ||
      selfOrDescendantWithMessageId(turn.container)?.getAttribute('data-message-id') ||
      null;
  }

  function legacyRangeKey(turn) {
    const prev = turn?.legacyPrevMessageId || "";
    const next = turn?.legacyNextMessageId || "";
    return prev || next ? `${prev}|${next}` : null;
  }

  function isTurnSelected(turn) {
    const mid = turnMessageId(turn);
    const legacyKey = legacyRangeKey(turn);
    if (selectAllMode) {
      return !excludedTurnIds.has(turn.turnId) &&
        !(mid && excludedMessageIds.has(mid)) &&
        !(legacyKey && excludedLegacyRangeKeys.has(legacyKey));
    }
    return selectedTurnIds.has(turn.turnId) ||
      !!(mid && selectedMessageIds.has(mid)) ||
      !!(legacyKey && selectedLegacyRangeKeys.has(legacyKey));
  }

  function setTurnIdSelected(turnId, checked) {
    if (!turnId) return;
    if (selectAllMode) {
      checked ? excludedTurnIds.delete(turnId) : excludedTurnIds.add(turnId);
    } else {
      checked ? selectedTurnIds.add(turnId) : selectedTurnIds.delete(turnId);
    }
  }

  function setTurnSelected(turn, checked) {
    setTurnIdSelected(turn.turnId, checked);
    const mid = turnMessageId(turn);
    const legacyKey = legacyRangeKey(turn);

    if (selectAllMode) {
      if (mid) checked ? excludedMessageIds.delete(mid) : excludedMessageIds.add(mid);
      if (legacyKey) {
        checked
          ? excludedLegacyRangeKeys.delete(legacyKey)
          : excludedLegacyRangeKeys.add(legacyKey);
      }
    } else {
      if (mid) checked ? selectedMessageIds.add(mid) : selectedMessageIds.delete(mid);
      if (legacyKey) {
        checked
          ? selectedLegacyRangeKeys.add(legacyKey)
          : selectedLegacyRangeKeys.delete(legacyKey);
      }
    }
  }

  function addCheckbox(turn) {
    const { turnId } = turn;
    if (!validTurnId(turnId)) return;

    const host = checkboxHost(turn);
    if (!host || turn.container.querySelector?.('.chatgpt2md-select')) return;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'chatgpt2md-select';
    box.checked = isTurnSelected(turn);
    const selectionLabel = t('selectMessageForExport');
    box.title = selectionLabel;
    box.setAttribute('aria-label', selectionLabel);

    Object.assign(box.style, {
      position: 'absolute',
      left: '-30px',
      top: '10px',
      width: '20px',
      height: '20px',
      zIndex: '2147483647',
      cursor: 'pointer',
      accentColor: '#7c3aed',
      opacity: '1',
      visibility: 'visible',
      pointerEvents: 'auto'
    });

    const cs = getComputedStyle(host);
    if (cs.position === 'static') host.style.position = 'relative';
    host.style.overflow = 'visible';

    box.addEventListener('click', (ev) => {
      ev.stopPropagation();

      // Keep "All" as an implicit default plus explicit exclusions. ChatGPT can
      // virtualize most of the conversation out of the DOM, so snapshotting only
      // currently known IDs would silently drop messages that have not mounted.
      const ids = orderedTurnIds();

      if (ev.shiftKey && anchorTurnId && ids.includes(anchorTurnId) && ids.includes(turnId)) {
        const a = ids.indexOf(anchorTurnId);
        const b = ids.indexOf(turnId);
        const lo = Math.min(a, b), hi = Math.max(a, b);
        const range = new Set(ids.slice(lo, hi + 1));
        const value = box.checked;

        for (const id of range) setTurnIdSelected(id, value);
        for (const mounted of populatedTurns()) {
          if (range.has(mounted.turnId)) setTurnSelected(mounted, value);
        }
        refreshMounted();
      } else {
        setTurnSelected(turn, box.checked);
      }

      anchorTurnId = turnId;
    });

    host.appendChild(box);
  }

  function refreshMounted() {
    const turns = populatedTurns();
    for (const turn of turns) {
      if (enabled) addCheckbox(turn);

      const host = checkboxHost(turn);
      const box = turn.container.querySelector?.('.chatgpt2md-select') ||
        host?.querySelector(':scope > .chatgpt2md-select');
      const checked = isTurnSelected(turn);
      if (box) {
        box.checked = checked;
        box.style.display = enabled ? 'block' : 'none';
      }

      // Whenever a virtualized turn mounts, mirror its current state to both the
      // turn ID and message ID. This gives the background worker the strongest
      // available identity without changing the default state of unseen turns.
      setTurnSelected(turn, checked);
    }
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshMounted();
    });
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleRefresh);

    // Observe body instead of the current #thread. ChatGPT is an SPA and can
    // replace the thread node while keeping the page alive. Attribute changes
    // are included because freshly appended turns may receive IDs during a
    // later hydration step.
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-turn-id-container', 'data-turn-id', 'data-turn', 'data-message-id']
    });
  }

  function currentState() {
    const ids = orderedTurnIds();
    const selected = ids.filter(id =>
      selectAllMode ? !excludedTurnIds.has(id) : selectedTurnIds.has(id)
    ).length;
    return {
      total: ids.length,
      selected,
      enabled
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === 'GET_INFO') {
      refreshMounted();
      const state = currentState();
      respond({
        title: document.title.replace(/\s*[-–]\s*ChatGPT.*$/i, ''),
        ...state
      });
      return;
    }

    if (msg.type === 'TOGGLE_SELECTION_UI') {
      enabled = !enabled;
      ensureObserver();
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === 'SELECT_ALL') {
      selectAllMode = true;
      selectedTurnIds.clear();
      selectedMessageIds.clear();
      selectedLegacyRangeKeys.clear();
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      excludedLegacyRangeKeys.clear();
      anchorTurnId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === 'SELECT_NONE') {
      selectAllMode = false;
      selectedTurnIds.clear();
      selectedMessageIds.clear();
      selectedLegacyRangeKeys.clear();
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      excludedLegacyRangeKeys.clear();
      anchorTurnId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === 'GET_SELECTION') {
      refreshMounted();
      respond({
        selectAll: selectAllMode,
        selectedTurnIds: [...selectedTurnIds],
        selectedMessageIds: [...selectedMessageIds],
        selectedLegacyRanges: [...selectedLegacyRangeKeys],
        excludedTurnIds: [...excludedTurnIds],
        excludedMessageIds: [...excludedMessageIds],
        excludedLegacyRanges: [...excludedLegacyRangeKeys],
        orderedIds: orderedTurnIds()
      });
      return;
    }

    if (msg.type === 'RESET_AFTER_EXPORT') {
      // A successful export completes the one-shot selection session.
      selectAllMode = true;
      selectedTurnIds.clear();
      selectedMessageIds.clear();
      selectedLegacyRangeKeys.clear();
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      excludedLegacyRangeKeys.clear();
      anchorTurnId = null;
      enabled = false;
      refreshMounted();
      respond(currentState());
      return;
    }
  });
})();
