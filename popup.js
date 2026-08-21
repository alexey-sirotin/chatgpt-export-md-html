const $ = (id) => document.getElementById(id);
const t = (key, substitutions) => {
  const args = Array.isArray(substitutions)
    ? substitutions.map(String)
    : substitutions == null ? undefined : String(substitutions);
  return chrome.i18n.getMessage(key, args) || key;
};

let tabId;
let totalMessages = 0;
let selectedMessages = 0;
let hasAuthoritativeSelectionState = false;
let originalConversationTitle = "";

async function send(type, payload = {}) {
  return chrome.tabs.sendMessage(tabId, { type, ...payload });
}

let exportStartedAt = null;
let exportTimer = null;
let lastProgressText = "";

function localizeStaticUi() {
  document.documentElement.lang = chrome.i18n.getUILanguage() || "ru";

  for (const el of document.querySelectorAll("[data-i18n]")) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}

function defaultNames() {
  return {
    userName: t("defaultUserName"),
    assistantName: t("defaultAssistantName")
  };
}

function setWorking(working) {
  for (const id of [
    "toggle", "all", "none", "export", "name", "userName", "assistantName",
    "exportMarkdown", "exportHtml", "exportJson", "saveAttachments", "separateAttachmentsFolder"
  ]) {
    const el = $(id);
    if (el) el.disabled = working;
  }
  if (!working) {
    syncAttachmentOptionsUi();
    syncFormatOptionsUi();
  }
}

function renderProgress(text) {
  lastProgressText = text || t("exporting");
  if (!exportStartedAt) {
    $("status").textContent = lastProgressText;
    return;
  }
  const elapsed = Math.max(0, Math.floor((Date.now() - exportStartedAt) / 1000));
  $("status").textContent = `${lastProgressText}\n${t("workingOk", elapsed)}`;
}

function startProgress(text = t("preparingExport"), startedAt = Date.now()) {
  exportStartedAt = Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now();
  setWorking(true);
  renderProgress(text);
  clearInterval(exportTimer);
  exportTimer = setInterval(() => renderProgress(lastProgressText), 1000);
}

function restoreProgress(state) {
  if (!state?.active) return false;
  if (state.exportName) $("name").value = state.exportName;
  startProgress(state.text || t("exporting"), state.startedAt || Date.now());
  return true;
}

function stopProgress() {
  clearInterval(exportTimer);
  exportTimer = null;
  exportStartedAt = null;
  lastProgressText = "";
  setWorking(false);
}

async function loadNames() {
  const defaults = defaultNames();
  const saved = await chrome.storage.local.get(["userName", "assistantName"]);

  // No migration of previously saved names: whatever the user entered stays as-is.
  $("userName").value = saved.userName || defaults.userName;
  $("assistantName").value = saved.assistantName || defaults.assistantName;
}

async function saveNames() {
  const defaults = defaultNames();
  const userName = $("userName").value.trim() || defaults.userName;
  const assistantName = $("assistantName").value.trim() || defaults.assistantName;
  $("userName").value = userName;
  $("assistantName").value = assistantName;
  await chrome.storage.local.set({ userName, assistantName });
  return { userName, assistantName };
}

function syncAttachmentOptionsUi() {
  const saveAttachments = $("saveAttachments").checked;
  $("separateAttachmentsFolder").disabled = !saveAttachments || !!exportStartedAt;
}

function syncFormatOptionsUi() {
  const anyFormat = $("exportMarkdown").checked || $("exportHtml").checked || $("exportJson").checked;
  $("export").disabled = !!exportStartedAt || !anyFormat;
}

async function loadOptions() {
  const saved = await chrome.storage.local.get({
    exportMarkdown: true,
    exportHtml: true,
    exportJson: true,
    saveAttachments: true,
    separateAttachmentsFolder: true
  });
  $("exportMarkdown").checked = saved.exportMarkdown !== false;
  $("exportHtml").checked = saved.exportHtml !== false;
  $("exportJson").checked = saved.exportJson !== false;
  $("saveAttachments").checked = saved.saveAttachments !== false;
  $("separateAttachmentsFolder").checked = saved.separateAttachmentsFolder !== false;
  syncAttachmentOptionsUi();
  syncFormatOptionsUi();
}

async function saveOptions() {
  const exportMarkdown = $("exportMarkdown").checked;
  const exportHtml = $("exportHtml").checked;
  const exportJson = $("exportJson").checked;
  const saveAttachments = $("saveAttachments").checked;
  const separateAttachmentsFolder = $("separateAttachmentsFolder").checked;
  await chrome.storage.local.set({
    exportMarkdown,
    exportHtml,
    exportJson,
    saveAttachments,
    separateAttachmentsFolder
  });
  syncAttachmentOptionsUi();
  syncFormatOptionsUi();
  return { exportMarkdown, exportHtml, exportJson, saveAttachments, separateAttachmentsFolder };
}

function selectionStatus(selected, total = totalMessages) {
  return t("selectedCount", [selected, total]);
}

function applyLocalSelectionState(state) {
  if (!state || hasAuthoritativeSelectionState) return;
  if (Number.isFinite(state.total)) totalMessages = state.total;
  if (Number.isFinite(state.selected)) selectedMessages = state.selected;
}

async function refreshAuthoritativeSelectionState() {
  try {
    const summary = await chrome.runtime.sendMessage({
      type: "GET_SELECTION_SUMMARY",
      tabId
    });
    if (!Number.isFinite(summary?.total) || !Number.isFinite(summary?.selected)) return false;
    totalMessages = summary.total;
    selectedMessages = summary.selected;
    hasAuthoritativeSelectionState = true;
    $("status").textContent = selectionStatus(selectedMessages, totalMessages);
    return true;
  } catch {
    return false;
  }
}

async function init() {
  localizeStaticUi();
  await Promise.all([loadNames(), loadOptions()]);
  [ { id: tabId } ] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const info = await send("GET_INFO");
    originalConversationTitle = info.title || "";
    $("name").value = originalConversationTitle || "ChatGPT export";
    applyLocalSelectionState(info);
    $("status").textContent = selectionStatus(selectedMessages, totalMessages);
    $("toggle").textContent = t(info.enabled ? "hideSelection" : "showSelection");

    const progressState = await chrome.runtime.sendMessage({
      type: "GET_EXPORT_STATE",
      tabId
    });
    if (restoreProgress(progressState)) return;

    // ChatGPT now virtualizes the conversation aggressively, so the content
    // script may see only a small mounted window. Ask the background worker to
    // count logical messages from the full conversation mapping instead.
    await refreshAuthoritativeSelectionState();
  } catch (e) {
    $("status").textContent = t("openChatHint");
  }
}

$("toggle").onclick = async () => {
  const r = await send("TOGGLE_SELECTION_UI");
  applyLocalSelectionState(r);
  $("toggle").textContent = t(r.enabled ? "hideSelection" : "showSelection");
  $("status").textContent = selectionStatus(selectedMessages, totalMessages);
};

$("all").onclick = async () => {
  const r = await send("SELECT_ALL");
  if (hasAuthoritativeSelectionState) {
    selectedMessages = totalMessages;
  } else {
    applyLocalSelectionState(r);
  }
  $("status").textContent = selectionStatus(selectedMessages, totalMessages);
};

$("none").onclick = async () => {
  const r = await send("SELECT_NONE");
  if (hasAuthoritativeSelectionState) {
    selectedMessages = 0;
  } else {
    applyLocalSelectionState(r);
  }
  $("status").textContent = selectionStatus(selectedMessages, totalMessages);
};

$("export").onclick = async () => {
  if (!$("exportMarkdown").checked && !$("exportHtml").checked && !$("exportJson").checked) {
    $("status").textContent = t("chooseFormat");
    return;
  }

  startProgress();
  try {
    const sel = await send("GET_SELECTION");
    if (!sel.selectAll && !sel.selectedMessageIds.length && !sel.selectedTurnIds.length) {
      stopProgress();
      $("status").textContent = t("nothingSelected");
      return;
    }

    const [names, options] = await Promise.all([saveNames(), saveOptions()]);
    const r = await chrome.runtime.sendMessage({
      type: "EXPORT_ACTIVE_TAB",
      tabId,
      exportName: $("name").value.trim(),
      originalTitle: originalConversationTitle,
      startedAt: exportStartedAt,
      userName: names.userName,
      assistantName: names.assistantName,
      exportMarkdown: options.exportMarkdown,
      exportHtml: options.exportHtml,
      exportJson: options.exportJson,
      saveAttachments: options.saveAttachments,
      separateAttachmentsFolder: options.separateAttachmentsFolder
    });
    stopProgress();
    if (r.ok) {
      // The background worker only responds with ok after Chrome reports that
      // the archive download has completed successfully. Close the transient
      // popup at that point; the content-script selection state has already
      // been reset for the next export.
      window.close();
    } else {
      $("status").textContent = t("errorPrefix", r.error);
    }
  } catch (e) {
    stopProgress();
    $("status").textContent = t("errorPrefix", e.message);
  }
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.tabId != null && msg.tabId !== tabId) return;

  if (msg?.type === "EXPORT_PROGRESS") {
    if (!exportStartedAt) {
      startProgress(msg.text || t("exporting"), msg.startedAt || Date.now());
    } else {
      renderProgress(msg.text || t("exporting"));
    }
    return;
  }

  if (msg?.type === "EXPORT_FINISHED") {
    if (!exportStartedAt) return;
    stopProgress();
    if (msg.ok) {
      window.close();
    } else {
      $("status").textContent = t("errorPrefix", msg.error || "Unknown error");
    }
  }
});

$("userName").addEventListener("change", saveNames);
$("assistantName").addEventListener("change", saveNames);
$("exportMarkdown").addEventListener("change", saveOptions);
$("exportHtml").addEventListener("change", saveOptions);
$("exportJson").addEventListener("change", saveOptions);
$("saveAttachments").addEventListener("change", saveOptions);
$("separateAttachmentsFolder").addEventListener("change", saveOptions);

init();
