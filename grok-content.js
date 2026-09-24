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

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

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

  async function collectOrderedIds() {
    if (orderedIds.length && !orderDirty) return orderedIds;
    if (collecting) return collecting;

    collecting = (async () => {
      const scroller = document.querySelector('[data-testid="chat-transcript-scroller"]');
      if (!scroller) {
        orderedIds = turnItems().map(item => item.id);
        orderDirty = false;
        return orderedIds;
      }

      const originalTop = scroller.scrollTop;
      const positions = new Map();
      const snapshot = () => {
        const scrollerRect = scroller.getBoundingClientRect();
        for (const { turn, id } of turnItems()) {
          const rect = turn.getBoundingClientRect();
          const position = scroller.scrollTop + rect.top - scrollerRect.top;
          const previous = positions.get(id);
          if (previous == null || position < previous) positions.set(id, position);
        }
      };

      scroller.scrollTop = scroller.scrollHeight;
      await sleep(300);
      snapshot();

      let stable = 0;
      let previousTop = Number.POSITIVE_INFINITY;
      while (stable < 2) {
        const nextTop = Math.max(
          0,
          scroller.scrollTop - Math.max(200, scroller.clientHeight * 0.8)
        );
        scroller.scrollTop = nextTop;
        await sleep(220);
        snapshot();
        const currentTop = scroller.scrollTop;
        if (currentTop <= 2 || Math.abs(currentTop - previousTop) < 2) {
          stable++;
        } else {
          stable = 0;
        }
        previousTop = currentTop;
      }

      scroller.scrollTop = originalTop;
      await sleep(50);
      orderedIds = [...positions.entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([id]) => id);
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
      ids: turnItems().map(item => item.id),
      temporaryIds: []
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "GET_INFO") {
      refreshMounted();
      respond({
        title: document.title.replace(/\s*[|–-]\s*Grok.*$/i, ""),
        ...currentState()
      });
      return;
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
      respond({
        selectAll: selectAllMode,
        selectedTurnIds: [],
        selectedMessageIds: [...selectedMessageIds],
        excludedTurnIds: [],
        excludedMessageIds: [...excludedMessageIds],
        legacyTurnContexts: [],
        orderedIds: [...orderedIds]
      });
      return;
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
      respond(selectionIndexSnapshot());
      return;
    }

    if (msg.type === "ENABLE_SELECTION_INDEX_WATCH") {
      ensureObserver();
      respond({ ok: true });
      return;
    }
  });
})();
