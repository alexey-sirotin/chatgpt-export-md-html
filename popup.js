const $ = (id) => document.getElementById(id);
const t = (key, substitutions) => {
  const args = Array.isArray(substitutions)
    ? substitutions.map(String)
    : substitutions == null ? undefined : String(substitutions);
  return chrome.i18n.getMessage(key, args) || key;
};

let tabId;
let conversationId = "";
let totalMessages = 0;
let selectedMessages = 0;
let hasAuthoritativeSelectionState = false;
let originalConversationTitle = "";

const DEFAULT_ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
const MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY = 1;
const MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;

function normalizedAttachmentDownloadConcurrency(value) {
  const requested = Math.floor(Number(value));
  if (!Number.isFinite(requested)) return DEFAULT_ATTACHMENT_DOWNLOAD_CONCURRENCY;
  return Math.min(
    MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY,
    Math.max(MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY, requested)
  );
}

async function send(type, payload = {}) {
  return chrome.tabs.sendMessage(tabId, { type, ...payload });
}

function conversationIdFromUrl(url) {
  try {
    const match = new URL(url).pathname.match(/\/c\/([^/?#]+)/);
    return match ? decodeURIComponent(match[1]) : "";
  } catch {
    return "";
  }
}

function exportNameDraftKey() {
  const scope = conversationId ? `conversation:${conversationId}` : `tab:${tabId}`;
  return `exportNameDraft:${scope}`;
}

async function loadExportNameDraft() {
  if (tabId == null) return null;
  try {
    const key = exportNameDraftKey();
    const saved = await chrome.storage.session.get(key);
    const draft = saved[key];
    if (!draft) return null;
    if (conversationId) {
      if (draft.conversationId !== conversationId) return null;
    } else if (draft.conversationTitle !== originalConversationTitle) {
      return null;
    }
    return typeof draft.exportName === "string" ? draft.exportName : null;
  } catch {
    return null;
  }
}

async function saveExportNameDraft() {
  if (tabId == null) return;
  const key = exportNameDraftKey();
  await chrome.storage.session.set({
    [key]: {
      conversationId: conversationId || null,
      conversationTitle: originalConversationTitle,
      exportName: $("name").value
    }
  });
}

async function clearExportNameDraft() {
  if (tabId == null) return;
  try {
    await chrome.storage.session.remove(exportNameDraftKey());
  } catch {}
}

let exportStartedAt = null;
let exportTimer = null;
let lastProgressText = "";
let selectionLoadStartedAt = null;
let selectionLoadTimer = null;

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
    "exportMarkdown", "exportHtml", "exportJson", "includeOriginalLink",
    "saveAttachments", "separateAttachmentsFolder", "attachmentDownloadConcurrency"
  ]) {
    const el = $(id);
    if (el) el.disabled = working;
  }
  $("cancel").hidden = !working;
  $("cancel").disabled = !working;
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
  if (state.cancelRequested) $("cancel").disabled = true;
  return true;
}

function stopProgress() {
  clearInterval(exportTimer);
  exportTimer = null;
  exportStartedAt = null;
  lastProgressText = "";
  setWorking(false);
}

function renderSelectionLoading() {
  if (!selectionLoadStartedAt) return;
  const elapsed = Math.max(0, Math.floor((Date.now() - selectionLoadStartedAt) / 1000));
  $("status").textContent = elapsed > 0
    ? `${t("loadingMessageList")}\n${t("workingOk", elapsed)}`
    : t("loadingMessageList");
}

function startSelectionLoading() {
  selectionLoadStartedAt = Date.now();
  renderSelectionLoading();
  clearInterval(selectionLoadTimer);
  selectionLoadTimer = setInterval(renderSelectionLoading, 1000);
}

function stopSelectionLoading() {
  clearInterval(selectionLoadTimer);
  selectionLoadTimer = null;
  selectionLoadStartedAt = null;
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
  $("separateAttachmentsFolder").disabled = !!exportStartedAt;
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
    includeOriginalLink: true,
    saveAttachments: true,
    separateAttachmentsFolder: true,
    attachmentDownloadConcurrency: DEFAULT_ATTACHMENT_DOWNLOAD_CONCURRENCY
  });
  $("exportMarkdown").checked = saved.exportMarkdown !== false;
  $("exportHtml").checked = saved.exportHtml !== false;
  $("exportJson").checked = saved.exportJson !== false;
  $("includeOriginalLink").checked = saved.includeOriginalLink !== false;
  $("saveAttachments").checked = saved.saveAttachments !== false;
  $("separateAttachmentsFolder").checked = saved.separateAttachmentsFolder !== false;
  $("attachmentDownloadConcurrency").value = String(
    normalizedAttachmentDownloadConcurrency(saved.attachmentDownloadConcurrency)
  );
  syncAttachmentOptionsUi();
  syncFormatOptionsUi();
}

async function saveOptions() {
  const exportMarkdown = $("exportMarkdown").checked;
  const exportHtml = $("exportHtml").checked;
  const exportJson = $("exportJson").checked;
  const includeOriginalLink = $("includeOriginalLink").checked;
  const saveAttachments = $("saveAttachments").checked;
  const separateAttachmentsFolder = $("separateAttachmentsFolder").checked;
  const attachmentDownloadConcurrency = normalizedAttachmentDownloadConcurrency(
    $("attachmentDownloadConcurrency").value
  );
  $("attachmentDownloadConcurrency").value = String(attachmentDownloadConcurrency);
  await chrome.storage.local.set({
    exportMarkdown,
    exportHtml,
    exportJson,
    includeOriginalLink,
    saveAttachments,
    separateAttachmentsFolder,
    attachmentDownloadConcurrency
  });
  syncAttachmentOptionsUi();
  syncFormatOptionsUi();
  return {
    exportMarkdown,
    exportHtml,
    exportJson,
    includeOriginalLink,
    saveAttachments,
    separateAttachmentsFolder,
    attachmentDownloadConcurrency
  };
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
      tabId,
      conversationId
    });
    if (!Number.isFinite(summary?.total) || !Number.isFinite(summary?.selected)) return false;
    totalMessages = summary.total;
    selectedMessages = summary.selected;
    hasAuthoritativeSelectionState = true;
    return true;
  } catch {
    return false;
  }
}

async function init() {
  localizeStaticUi();
  await Promise.all([loadNames(), loadOptions()]);
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = activeTab?.id;
  conversationId = conversationIdFromUrl(activeTab?.url || "");
  try {
    const info = await send("GET_INFO");
    originalConversationTitle = info.title || "";
    const defaultExportName = originalConversationTitle || t("defaultExportName");
    const draftExportName = await loadExportNameDraft();
    $("name").value = draftExportName ?? defaultExportName;
    applyLocalSelectionState(info);
    $("toggle").textContent = t(info.enabled ? "hideSelection" : "showSelection");

    const progressState = await chrome.runtime.sendMessage({
      type: "GET_EXPORT_STATE",
      tabId
    });
    if (restoreProgress(progressState)) return;

    // ChatGPT now virtualizes the conversation aggressively. On the first open
    // we build a compact logical-message index from the full conversation; later
    // popup opens can reuse it until the page observer sees a new turn or the
    // short cache TTL expires.
    startSelectionLoading();
    await refreshAuthoritativeSelectionState();
    stopSelectionLoading();
    $("status").textContent = selectionStatus(selectedMessages, totalMessages);
  } catch (e) {
    stopSelectionLoading();
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
      includeOriginalLink: options.includeOriginalLink,
      saveAttachments: options.saveAttachments,
      separateAttachmentsFolder: options.separateAttachmentsFolder,
      attachmentDownloadConcurrency: options.attachmentDownloadConcurrency
    });
    stopProgress();
    if (r.ok) {
      await clearExportNameDraft();
      // The background worker only responds with ok after Chrome reports that
      // the archive download has completed successfully. Close the transient
      // popup at that point; the content-script selection state has already
      // been reset for the next export.
      window.close();
    } else if (r.canceled) {
      $("status").textContent = t("exportCanceled");
    } else {
      $("status").textContent = t("errorPrefix", r.error);
    }
  } catch (e) {
    stopProgress();
    $("status").textContent = t("errorPrefix", e.message);
  }
};

$("cancel").onclick = async () => {
  if (!exportStartedAt || tabId == null) return;
  $("cancel").disabled = true;
  renderProgress(t("cancelingExport"));

  try {
    const result = await chrome.runtime.sendMessage({
      type: "CANCEL_EXPORT",
      tabId
    });
    if (!result?.ok) {
      $("cancel").disabled = false;
      $("status").textContent = t("errorPrefix", result?.error || t("unknownError"));
    }
  } catch (e) {
    $("cancel").disabled = false;
    $("status").textContent = t("errorPrefix", e.message || t("unknownError"));
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
    if (msg.cancelRequested) $("cancel").disabled = true;
    return;
  }

  if (msg?.type === "EXPORT_FINISHED") {
    if (!exportStartedAt) return;
    stopProgress();
    if (msg.ok) {
      void clearExportNameDraft().finally(() => window.close());
    } else if (msg.canceled) {
      $("status").textContent = t("exportCanceled");
    } else {
      $("status").textContent = t("errorPrefix", msg.error || t("unknownError"));
    }
  }
});

$("name").addEventListener("input", () => {
  saveExportNameDraft().catch(() => {});
});
$("userName").addEventListener("change", saveNames);
$("assistantName").addEventListener("change", saveNames);
$("exportMarkdown").addEventListener("change", saveOptions);
$("exportHtml").addEventListener("change", saveOptions);
$("exportJson").addEventListener("change", saveOptions);
$("includeOriginalLink").addEventListener("change", saveOptions);
$("saveAttachments").addEventListener("change", saveOptions);
$("separateAttachmentsFolder").addEventListener("change", saveOptions);
$("attachmentDownloadConcurrency").addEventListener("change", saveOptions);

init();
