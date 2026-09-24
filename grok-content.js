(() => {
  const t = key => chrome.i18n.getMessage(key) || key;
  const selectedMessageIds = new Set();
  const excludedMessageIds = new Set();
  let enabled = false;
  let selectAllMode = true;
  let anchorId = null;
  let observer = null;
  let refreshQueued = false;
  let orderedIds = [];
  let collecting = null;
  let orderDirty = true;

  function conversationId() {
    const pathMatch = location.pathname.match(/\/(?:c|chat|conversation)\/([0-9a-f-]{36})(?:\/|$)/i);
    if (pathMatch) return pathMatch[1];
    const resources = performance.getEntriesByType("resource").map(entry => entry.name);
    for (let i = resources.length - 1; i >= 0; i--) {
      const match = resources[i].match(/\/rest\/app-chat\/conversations_v2\/([0-9a-f-]{36})/i);
      if (match) return match[1];
    }
    return null;
  }

  function turnItems() {
    return [...document.querySelectorAll('[id^="response-"]')]
      .map(turn => ({
        turn,
        id: String(turn.id || "").replace(/^response-/, "")
      }))
      .filter(item => item.id);
  }

  function isSelected(id) {
    return selectAllMode ? !excludedMessageIds.has(id) : selectedMessageIds.has(id);
  }

  function setSelected(id, checked) {
    if (selectAllMode) {
      checked ? excludedMessageIds.delete(id) : excludedMessageIds.add(id);
    } else {
      checked ? selectedMessageIds.add(id) : selectedMessageIds.delete(id);
    }
  }

  function checkboxHost(turn) {
    return turn.querySelector('[data-testid="user-message"], [data-testid="assistant-message"]') || turn;
  }

  function addCheckbox(item) {
    if (item.turn.querySelector('.chatgpt-export-select')) return;
    const host = checkboxHost(item.turn);
    if (!host) return;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "chatgpt-export-select";
    box.checked = isSelected(item.id);
    box.title = t("selectMessageForExport");
    box.setAttribute("aria-label", box.title);

    Object.assign(box.style, {
      position: "absolute",
      left: "-30px",
      top: "10px",
      width: "20px",
      height: "20px",
      zIndex: "2147483647",
      cursor: "pointer",
      accentColor: "#7c3aed",
      opacity: "1",
      visibility: "visible",
      pointerEvents: "auto"
    });

    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.style.overflow = "visible";

    box.addEventListener("click", event => {
      event.stopPropagation();
      const value = box.checked;
      if (event.shiftKey && anchorId && orderedIds.length) {
        const a = orderedIds.indexOf(anchorId);
        const b = orderedIds.indexOf(item.id);
        if (a >= 0 && b >= 0) {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          for (let index = lo; index <= hi; index++) setSelected(orderedIds[index], value);
        } else {
          setSelected(item.id, value);
        }
      } else {
        setSelected(item.id, value);
      }
      anchorId = item.id;
      refreshMounted();
    });

    host.appendChild(box);
  }

  function refreshMounted() {
    for (const item of turnItems()) {
      if (enabled) addCheckbox(item);
      const box = item.turn.querySelector('.chatgpt-export-select');
      if (box) {
        box.checked = isSelected(item.id);
        box.style.display = enabled ? "block" : "none";
      }
    }
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      const mounted = turnItems().map(item => item.id);
      if (orderedIds.length && mounted.some(id => !orderedIds.includes(id))) orderDirty = true;
      refreshMounted();
    });
  }

  function ensureObserver() {
    if (observer) return;
    observer = new MutationObserver(scheduleRefresh);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["id", "data-testid"]
    });
  }

  function activeIds(responses, mountedIds) {
    const items = Array.isArray(responses) ? responses : [];
    const byId = new Map();
    const parentIds = new Set();
    for (const item of items) {
      if (!item?.responseId) continue;
      byId.set(String(item.responseId), item);
      if (item.parentResponseId) parentIds.add(String(item.parentResponseId));
    }
    const mounted = new Set((mountedIds || []).map(String));
    const leaves = items.filter(item => item?.responseId && !parentIds.has(String(item.responseId)));
    const candidates = leaves.length ? leaves : items.filter(item => item?.responseId);
    let best = [];
    let bestOverlap = -1;
    let bestTime = -Infinity;
    let bestIndex = -1;
    for (const leaf of candidates) {
      const path = [];
      const seen = new Set();
      let current = leaf;
      while (current?.responseId && !seen.has(String(current.responseId))) {
        const id = String(current.responseId);
        seen.add(id);
        path.push(current);
        current = current.parentResponseId ? byId.get(String(current.parentResponseId)) : null;
      }
      path.reverse();
      const overlap = path.reduce((count, item) => count + (mounted.has(String(item.responseId)) ? 1 : 0), 0);
      const parsed = Date.parse(leaf.createTime || "");
      const time = Number.isFinite(parsed) ? parsed : -Infinity;
      const index = items.indexOf(leaf);
      if (overlap > bestOverlap || (overlap === bestOverlap && time > bestTime) || (overlap === bestOverlap && time === bestTime && index > bestIndex)) {
        best = path;
        bestOverlap = overlap;
        bestTime = time;
        bestIndex = index;
      }
    }
    return best
      .filter(item => item && item.isControl !== true)
      .filter(item => /human|user|assistant|model/i.test(String(item.sender || "")))
      .map(item => String(item.responseId));
  }

  async function collectOrderedIds() {
    if (orderedIds.length && !orderDirty) return orderedIds;
    if (collecting) return collecting;

    collecting = (async () => {
      const id = conversationId();
      if (!id) {
        orderedIds = turnItems().map(item => item.id);
        orderDirty = false;
        return orderedIds;
      }

      const response = await fetch(
        `/rest/app-chat/conversations/${encodeURIComponent(id)}/responses?includeThreads=false`,
        { credentials: "include", headers: { Accept: "application/json" } }
      );
      if (!response.ok) throw new Error("Grok responses GET: " + response.status);
      const data = await response.json();
      const mountedIds = turnItems().map(item => item.id);
      orderedIds = activeIds(data.responses || [], mountedIds);
      orderDirty = false;
      refreshMounted();
      return orderedIds;
    })().finally(() => {
      collecting = null;
    });
    return collecting;
  }

  function currentState() {
    const total = orderedIds.length || turnItems().length;
    const selected = selectAllMode
      ? Math.max(0, total - [...excludedMessageIds].filter(id => !orderedIds.length || orderedIds.includes(id)).length)
      : [...selectedMessageIds].filter(id => !orderedIds.length || orderedIds.includes(id)).length;
    return { total, selected, enabled };
  }

  function selectionIndexSnapshot() {
    return {
      conversationId: conversationId(),
      ids: orderedIds.length ? [...orderedIds] : turnItems().map(item => item.id),
      temporaryIds: []
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "GET_INFO") {
      collectOrderedIds().then(() => {
        refreshMounted();
        respond({
          title: document.title.replace(/\s*[|–-]\s*Grok.*$/i, ""),
          ...currentState()
        });
      }).catch(() => respond({
        title: document.title.replace(/\s*[|–-]\s*Grok.*$/i, ""),
        ...currentState()
      }));
      return true;
    }

    if (msg.type === "TOGGLE_SELECTION_UI") {
      enabled = !enabled;
      ensureObserver();
      collectOrderedIds().finally(() => {
        refreshMounted();
        respond(currentState());
      });
      return true;
    }

    if (msg.type === "SELECT_ALL") {
      selectAllMode = true;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "SELECT_NONE") {
      selectAllMode = false;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorId = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "GET_SELECTION") {
      collectOrderedIds().then(() => respond({
        selectAll: selectAllMode,
        selectedTurnIds: [],
        selectedMessageIds: [...selectedMessageIds],
        excludedTurnIds: [],
        excludedMessageIds: [...excludedMessageIds],
        legacyTurnContexts: [],
        orderedIds: [...orderedIds]
      })).catch(() => respond({
        selectAll: selectAllMode,
        selectedTurnIds: [],
        selectedMessageIds: [...selectedMessageIds],
        excludedTurnIds: [],
        excludedMessageIds: [...excludedMessageIds],
        legacyTurnContexts: [],
        orderedIds: [...orderedIds]
      }));
      return true;
    }

    if (msg.type === "RESET_AFTER_EXPORT") {
      selectAllMode = true;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorId = null;
      enabled = false;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "GET_SELECTION_INDEX_IDS") {
      collectOrderedIds().then(() => respond(selectionIndexSnapshot())).catch(() => respond(selectionIndexSnapshot()));
      return true;
    }

    if (msg.type === "ENABLE_SELECTION_INDEX_WATCH") {
      ensureObserver();
      respond({ ok: true });
      return;
    }
  });
})();
