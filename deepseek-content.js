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
  let title = "";
  let collecting = null;

  function conversationId() {
    const match = location.pathname.match(/\/a\/chat\/s\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  }

  function tokenValue() {
    try {
      const stored = JSON.parse(localStorage.getItem("userToken") || "null");
      return typeof stored?.value === "string" ? stored.value : "";
    } catch {
      return "";
    }
  }

  function buildBranch(messages, currentMessageId) {
    const items = Array.isArray(messages) ? messages : [];
    const byId = new Map(
      items.filter(item => item?.message_id != null).map(item => [String(item.message_id), item])
    );
    const path = [];
    const seen = new Set();
    let current = byId.get(String(currentMessageId ?? ""));
    while (current?.message_id != null) {
      const id = String(current.message_id);
      if (seen.has(id)) break;
      seen.add(id);
      path.push(current);
      if (current.parent_id == null) break;
      current = byId.get(String(current.parent_id));
    }
    return path.reverse();
  }

  async function collectOrderedIds() {
    if (collecting) return collecting;
    collecting = (async () => {
      const id = conversationId();
      const token = tokenValue();
      if (!id || !token) {
        orderedIds = [];
        return orderedIds;
      }
      const response = await fetch(
        `/api/v0/chat/history_messages?chat_session_id=${encodeURIComponent(id)}`,
        {
          credentials: "include",
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${token}`
          }
        }
      );
      if (!response.ok) throw new Error("DeepSeek history GET: " + response.status);
      const payload = await response.json();
      const biz = payload?.data?.biz_data;
      const session = biz?.chat_session;
      const branch = buildBranch(biz?.chat_messages || [], session?.current_message_id);
      orderedIds = branch
        .filter(item => /^(USER|ASSISTANT)$/i.test(String(item?.role || "")))
        .map(item => String(item.message_id));
      title = session?.title || title;
      refreshMounted();
      return orderedIds;
    })().finally(() => {
      collecting = null;
    });
    return collecting;
  }

  function domMessageId(node) {
    const candidates = [
      node?.getAttribute?.("data-message-id"),
      node?.getAttribute?.("data-msg-id"),
      String(node?.id || "").match(/(?:message|msg)[-_](\d+)$/i)?.[1]
    ];
    for (const value of candidates) {
      if (value != null && /^\d+$/.test(String(value))) return String(value);
    }
    return null;
  }

  function turnItems() {
    const nodes = document.querySelectorAll('[data-message-id], [data-msg-id], [id^="message-"], [id^="msg-"]');
    const seen = new Set();
    const out = [];
    for (const turn of nodes) {
      const id = domMessageId(turn);
      if (!id || seen.has(id) || (orderedIds.length && !orderedIds.includes(id))) continue;
      seen.add(id);
      out.push({ turn, id });
    }
    return out;
  }

  function isSelected(id) {
    return selectAllMode ? !excludedMessageIds.has(id) : selectedMessageIds.has(id);
  }

  function setSelected(id, checked) {
    if (selectAllMode) checked ? excludedMessageIds.delete(id) : excludedMessageIds.add(id);
    else checked ? selectedMessageIds.add(id) : selectedMessageIds.delete(id);
  }

  function addCheckbox(item) {
    if (item.turn.querySelector(':scope > .chatgpt-export-select')) return;
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
    if (getComputedStyle(item.turn).position === "static") item.turn.style.position = "relative";
    item.turn.style.overflow = "visible";
    box.addEventListener("click", event => {
      event.stopPropagation();
      const value = box.checked;
      if (event.shiftKey && anchorId && orderedIds.length) {
        const a = orderedIds.indexOf(anchorId);
        const b = orderedIds.indexOf(item.id);
        if (a >= 0 && b >= 0) {
          for (let i = Math.min(a, b); i <= Math.max(a, b); i++) setSelected(orderedIds[i], value);
        } else setSelected(item.id, value);
      } else setSelected(item.id, value);
      anchorId = item.id;
      refreshMounted();
    });
    item.turn.appendChild(box);
  }

  function refreshMounted() {
    for (const item of turnItems()) {
      if (enabled) addCheckbox(item);
      const box = item.turn.querySelector(':scope > .chatgpt-export-select');
      if (box) {
        box.checked = isSelected(item.id);
        box.style.display = enabled ? "block" : "none";
      }
    }
  }

  function ensureObserver() {
    if (observer || !document.body) return;
    observer = new MutationObserver(() => {
      if (refreshQueued) return;
      refreshQueued = true;
      requestAnimationFrame(() => {
        refreshQueued = false;
        refreshMounted();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
  }

  function currentState() {
    const total = orderedIds.length;
    const selected = selectAllMode
      ? Math.max(0, total - [...excludedMessageIds].filter(id => orderedIds.includes(id)).length)
      : [...selectedMessageIds].filter(id => orderedIds.includes(id)).length;
    return { total, selected, enabled };
  }

  function selectionSnapshot() {
    return {
      selectAll: selectAllMode,
      selectedTurnIds: [],
      selectedMessageIds: [...selectedMessageIds],
      excludedTurnIds: [],
      excludedMessageIds: [...excludedMessageIds],
      legacyTurnContexts: [],
      orderedIds: [...orderedIds]
    };
  }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (msg.type === "GET_INFO") {
      collectOrderedIds()
        .then(() => respond({ title: title || document.title, ...currentState() }))
        .catch(() => respond({ title: title || document.title, ...currentState() }));
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
      collectOrderedIds().then(() => respond(selectionSnapshot())).catch(() => respond(selectionSnapshot()));
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
      collectOrderedIds().then(() => respond({
        conversationId: conversationId(),
        ids: [...orderedIds],
        temporaryIds: []
      })).catch(() => respond({ conversationId: conversationId(), ids: [], temporaryIds: [] }));
      return true;
    }

    if (msg.type === "ENABLE_SELECTION_INDEX_WATCH") {
      ensureObserver();
      respond({ ok: true });
      return;
    }
  });
})();
