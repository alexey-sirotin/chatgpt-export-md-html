(() => {
  const dom = globalThis.ChatGPTExportDomSelection;
  if (!dom) throw new Error("ChatGPTExportDomSelection is not loaded");

  const t = (key) => chrome.i18n.getMessage(key) || key;
  const {
    isTemporaryId,
    isStableId: validTurnId,
    selfOrDescendantWithMessageId,
    stableMessageIdInElement,
    matchingTurnRoot,
    mountedFallbackRoot
  } = dom;
  const selectedTurnIds = new Set();
  const selectedMessageIds = new Set();
  const excludedTurnIds = new Set();
  const excludedMessageIds = new Set();
  const legacyTurnContexts = new Map();
  let enabled = false;
  let anchorTurnId = null;
  let observer = null;
  let refreshQueued = false;
  let selectAllMode = true;

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
    if (isTemporaryId(sourceTurnId)) {
      const messageId = stableMessageIdInElement(container);
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
      const root = matchingTurnRoot(container, sourceTurnId) ||
        mountedFallbackRoot(container);
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

    // Keep a conservative fallback context for legacy image-only turns that
    // have no data-message-id. ChatGPT virtualizes the thread, so DOM neighbors
    // are not authoritative by themselves; the background worker will use this
    // pair only when it proves that exactly one visible assistant group exists
    // between the two stable server messages.
    const ordered = [...out].sort((a, b) => {
      if (a.container === b.container) return 0;
      const pos = a.container.compareDocumentPosition(b.container);
      if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
      if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
      return 0;
    });
    const messageIds = ordered.map(turn => turnMessageId(turn));
    const nextStable = new Array(ordered.length).fill(null);
    let nextMessageId = null;

    for (let i = ordered.length - 1; i >= 0; i--) {
      nextStable[i] = nextMessageId;
      if (messageIds[i]) nextMessageId = messageIds[i];
    }

    let previousMessageId = null;
    for (let i = 0; i < ordered.length; i++) {
      const turn = ordered[i];
      const messageId = messageIds[i];

      if (messageId) {
        legacyTurnContexts.delete(turn.turnId);
        previousMessageId = messageId;
        continue;
      }

      const followingMessageId = nextStable[i];
      if (previousMessageId && followingMessageId) {
        legacyTurnContexts.set(turn.turnId, {
          turnId: turn.turnId,
          prevMessageId: previousMessageId,
          nextMessageId: followingMessageId
        });
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

  function isTurnSelected(turn) {
    const mid = turnMessageId(turn);
    if (selectAllMode) {
      return !excludedTurnIds.has(turn.turnId) && !(mid && excludedMessageIds.has(mid));
    }
    return selectedTurnIds.has(turn.turnId) || !!(mid && selectedMessageIds.has(mid));
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
    if (!mid) return;

    if (selectAllMode) {
      checked ? excludedMessageIds.delete(mid) : excludedMessageIds.add(mid);
    } else {
      checked ? selectedMessageIds.add(mid) : selectedMessageIds.delete(mid);
    }
  }

  function addCheckbox(turn) {
    const { turnId } = turn;
    if (!validTurnId(turnId)) return;

    const host = checkboxHost(turn);
    if (!host || turn.container.querySelector?.('.chatgpt-export-select')) return;

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.className = 'chatgpt-export-select';
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
      const box = turn.container.querySelector?.('.chatgpt-export-select') ||
        host?.querySelector(':scope > .chatgpt-export-select');
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
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      anchorTurnId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === 'SELECT_NONE') {
      selectAllMode = false;
      selectedTurnIds.clear();
      selectedMessageIds.clear();
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      anchorTurnId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === 'GET_SELECTION') {
      refreshMounted();
      const relevantTurnIds = new Set([
        ...selectedTurnIds,
        ...excludedTurnIds
      ]);
      const legacyContexts = [...relevantTurnIds]
        .map(id => legacyTurnContexts.get(id))
        .filter(Boolean);

      respond({
        selectAll: selectAllMode,
        selectedTurnIds: [...selectedTurnIds],
        selectedMessageIds: [...selectedMessageIds],
        excludedTurnIds: [...excludedTurnIds],
        excludedMessageIds: [...excludedMessageIds],
        legacyTurnContexts: legacyContexts,
        orderedIds: orderedTurnIds()
      });
      return;
    }

    if (msg.type === 'RESET_AFTER_EXPORT') {
      // A successful export completes the one-shot selection session.
      selectAllMode = true;
      selectedTurnIds.clear();
      selectedMessageIds.clear();
      excludedTurnIds.clear();
      excludedMessageIds.clear();
      anchorTurnId = null;
      enabled = false;
      refreshMounted();
      respond(currentState());
      return;
    }
  });
})();
