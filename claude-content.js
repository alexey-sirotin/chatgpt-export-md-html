(() => {
  const t = key => chrome.i18n.getMessage(key) || key;
  const selectedMessageIds = new Set();
  const excludedMessageIds = new Set();
  let enabled = false;
  let selectAllMode = true;
  let anchorIndex = null;
  let observer = null;
  let refreshQueued = false;

  const conversationId = () => {
    const match = location.pathname.match(/\/chat\/([0-9a-f-]{36})/i);
    return match ? match[1] : null;
  };

  const rowId = index => "claude-index:" + index;

  function rows() {
    return [...document.querySelectorAll('[data-testid="transcript-row"][data-index]')]
      .map(row => ({
        row,
        index: Number(row.getAttribute("data-index"))
      }))
      .filter(item => Number.isInteger(item.index) && item.index >= 0);
  }

  function totalCount() {
    for (const { row } of rows()) {
      const article = row.querySelector('[role="article"][aria-setsize]');
      const size = Number(article?.getAttribute("aria-setsize"));
      if (Number.isInteger(size) && size >= 0) return size;
    }
    return rows().reduce((max, item) => Math.max(max, item.index + 1), 0);
  }

  function isSelected(index) {
    const id = rowId(index);
    return selectAllMode ? !excludedMessageIds.has(id) : selectedMessageIds.has(id);
  }

  function setSelected(index, checked) {
    const id = rowId(index);
    if (selectAllMode) {
      checked ? excludedMessageIds.delete(id) : excludedMessageIds.add(id);
    } else {
      checked ? selectedMessageIds.add(id) : selectedMessageIds.delete(id);
    }
  }

  function checkboxHost(row) {
    return row.querySelector('[role="article"]') || row;
  }

  function addCheckbox(item) {
    if (item.row.querySelector('.chatgpt-export-select')) return;
    const host = checkboxHost(item.row);
    if (!host) return;

    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "chatgpt-export-select";
    box.checked = isSelected(item.index);
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

      if (event.shiftKey && anchorIndex != null) {
        const lo = Math.min(anchorIndex, item.index);
        const hi = Math.max(anchorIndex, item.index);
        for (let index = lo; index <= hi; index++) setSelected(index, value);
      } else {
        setSelected(item.index, value);
      }

      anchorIndex = item.index;
      refreshMounted();
    });

    host.appendChild(box);
  }

  function refreshMounted() {
    for (const item of rows()) {
      if (enabled) addCheckbox(item);
      const box = item.row.querySelector('.chatgpt-export-select');
      if (box) {
        box.checked = isSelected(item.index);
        box.style.display = enabled ? "block" : "none";
      }
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-index", "aria-setsize"]
    });
  }

  function currentState() {
    const total = totalCount();
    const selected = selectAllMode
      ? Math.max(0, total - excludedMessageIds.size)
      : [...selectedMessageIds].filter(id => {
          const index = Number(id.slice("claude-index:".length));
          return Number.isInteger(index) && index >= 0 && index < total;
        }).length;
    return { total, selected, enabled };
  }

  function selectionIndexSnapshot() {
    return {
      conversationId: conversationId(),
      ids: rows().map(item => rowId(item.index)),
      temporaryIds: []
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "GET_INFO") {
      refreshMounted();
      respond({
        title: document.title.replace(/\s*[|–-]\s*Claude.*$/i, ""),
        ...currentState()
      });
      return;
    }

    if (msg.type === "TOGGLE_SELECTION_UI") {
      enabled = !enabled;
      ensureObserver();
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "SELECT_ALL") {
      selectAllMode = true;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorIndex = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "SELECT_NONE") {
      selectAllMode = false;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorIndex = null;
      refreshMounted();
      respond(currentState());
      return;
    }

    if (msg.type === "GET_SELECTION") {
      refreshMounted();
      respond({
        selectAll: selectAllMode,
        selectedTurnIds: [],
        selectedMessageIds: [...selectedMessageIds],
        excludedTurnIds: [],
        excludedMessageIds: [...excludedMessageIds],
        legacyTurnContexts: [],
        orderedIds: Array.from({ length: totalCount() }, (_, index) => rowId(index))
      });
      return;
    }

    if (msg.type === "RESET_AFTER_EXPORT") {
      selectAllMode = true;
      selectedMessageIds.clear();
      excludedMessageIds.clear();
      anchorIndex = null;
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
