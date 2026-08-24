import {
  t,
  safeName,
  filenameWithExtension,
  uniqueFilename,
  isoUtc,
  extFromMime,
  enc,
  markdownHref
} from "./utils.js";
import {
  isVisibleMessage,
  rawBranchFromCurrent,
  selectedBranchFromRaw,
  branchExcludingFromRaw,
  logicalSelectionGroups,
  textParts
} from "./conversation.js";
import {
  buildSelectionIndex,
  selectionSummaryFromIndex,
  selectionIndexKnownIds,
  SELECTION_INDEX_SCHEMA_VERSION
} from "./selection-index.js";
import {
  attachmentRecords,
  replaceSandboxLinkDestinations
} from "./attachments.js";
import {
  getConversationInPage,
  downloadAttachmentInPage
} from "./chatgpt-api.js";
import { buildMarkdownExport, buildHtmlExport } from "./render.js";
import { makeZip } from "./zip.js";

function waitForDownloadCompletion(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      error ? reject(error) : resolve();
    };

    const onChanged = delta => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        finish();
        return;
      }
      if (delta.error?.current || delta.state?.current === "interrupted") {
        finish(new Error(delta.error?.current || "Download interrupted"));
      }
    };

    chrome.downloads.onChanged.addListener(onChanged);

    // Close the small race where an extremely small archive completes before
    // the onChanged listener is attached.
    chrome.downloads.search({ id: downloadId }).then(items => {
      const item = items?.[0];
      if (!item || settled) return;
      if (item.state === "complete") finish();
      else if (item.state === "interrupted") finish(new Error(item.error || "Download interrupted"));
    }).catch(() => {});
  });
}

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function findOffscreenClient() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const matchedClients = await clients.matchAll({ includeUncontrolled: true });
  return matchedClients.find(client => client.url === offscreenUrl) || null;
}

async function ensureOffscreenClient() {
  const existing = await findOffscreenClient();
  if (existing) return existing;

  if (!chrome.offscreen?.createDocument) {
    throw new Error("Offscreen API is unavailable in this browser");
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = (async () => {
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ["BLOBS"],
          justification: "Create Blob URLs for large ZIP downloads without base64 expansion"
        });
      } catch (e) {
        // Another export or a restarted service worker may have created the one
        // allowed offscreen document between our check and createDocument().
        if (!await findOffscreenClient()) throw e;
      }
    })().finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;

  // createDocument() resolves after the page loads, but give the service-worker
  // client registry a short moment to expose it as well.
  for (let attempt = 0; attempt < 20; attempt++) {
    const client = await findOffscreenClient();
    if (client) return client;
    await delay(25);
  }

  throw new Error("Offscreen document was created but its client is unavailable");
}

async function createOffscreenObjectUrl(bytes, mimeType) {
  const client = await ensureOffscreenClient();
  const channel = new MessageChannel();

  // makeZip() returns a full-buffer Uint8Array. Keep the helper safe for other
  // callers too: only copy if a view covers part of a larger ArrayBuffer.
  const buffer = bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.slice().buffer;

  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Timed out while creating ZIP Blob URL"));
    }, 30000);

    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      const result = event.data || {};
      if (!result.ok || !result.url) {
        reject(new Error(result.error || "Could not create ZIP Blob URL"));
        return;
      }
      resolve(result.url);
    };

    channel.port1.onmessageerror = () => {
      clearTimeout(timer);
      channel.port1.close();
      reject(new Error("Could not receive ZIP Blob URL"));
    };
  });

  // This is Web ServiceWorker messaging, not chrome.runtime messaging. It uses
  // structured clone and lets us transfer the ArrayBuffer without the 64 MiB
  // JSON-message limit or base64 conversion. Transferring also detaches the
  // archive buffer from this worker immediately.
  client.postMessage(
    { type: "CREATE_OBJECT_URL", buffer, mimeType },
    [buffer, channel.port2]
  );

  return response;
}

async function revokeOffscreenObjectUrl(url) {
  if (!url) return;
  try {
    const client = await findOffscreenClient();
    client?.postMessage({ type: "REVOKE_OBJECT_URL", url });
  } catch {
    // Best-effort cleanup. If the offscreen document vanished, its Blob URLs
    // vanished with it as well.
  }
}

const exportProgressState = new Map();

function exportProgressKey(tabId) {
  return `exportProgress:${tabId}`;
}

async function storeExportProgress(tabId, state) {
  exportProgressState.set(tabId, state);
  try {
    await chrome.storage.session.set({ [exportProgressKey(tabId)]: state });
  } catch (e) {
    console.warn("chatgpt2md: could not persist export progress", e);
  }
}

async function loadExportProgress(tabId) {
  const memory = exportProgressState.get(tabId);
  if (memory) return memory;
  try {
    const key = exportProgressKey(tabId);
    const saved = await chrome.storage.session.get(key);
    return saved[key] || null;
  } catch {
    return null;
  }
}

async function clearExportProgress(tabId) {
  exportProgressState.delete(tabId);
  try {
    await chrome.storage.session.remove(exportProgressKey(tabId));
  } catch {}
}

async function beginExportProgress(tabId, startedAt, exportName) {
  const state = {
    active: true,
    startedAt: Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now(),
    text: t("preparingExport"),
    exportName: exportName || "",
    updatedAt: Date.now()
  };
  await storeExportProgress(tabId, state);
  return state;
}

async function reportExportProgress(tabId, text) {
  const previous = exportProgressState.get(tabId) || await loadExportProgress(tabId) || {
    active: true,
    startedAt: Date.now()
  };
  const state = {
    ...previous,
    active: true,
    text,
    updatedAt: Date.now()
  };
  await storeExportProgress(tabId, state);
  try {
    await chrome.runtime.sendMessage({
      type: "EXPORT_PROGRESS",
      tabId,
      text,
      startedAt: state.startedAt
    });
  } catch {
    // The popup may have been closed while export continues. That is fine.
  }
}

async function finishExportProgress(tabId, result) {
  await clearExportProgress(tabId);
  try {
    await chrome.runtime.sendMessage({
      type: "EXPORT_FINISHED",
      tabId,
      ...result
    });
  } catch {
    // No popup is open. Nothing else to do.
  }
}

const SELECTION_INDEX_TTL_MS = 5 * 60 * 1000;
const selectionIndexMemory = new Map();

function selectionIndexKey(conversationId) {
  return `selectionIndex:${conversationId}`;
}

async function loadSelectionIndexRecord(conversationId) {
  if (!conversationId) return null;

  const memory = selectionIndexMemory.get(conversationId);
  if (memory) return memory;

  try {
    const key = selectionIndexKey(conversationId);
    const saved = await chrome.storage.session.get(key);
    const record = saved[key] || null;
    if (record) selectionIndexMemory.set(conversationId, record);
    return record;
  } catch {
    return null;
  }
}

async function persistSelectionIndexRecord(conversationId, record) {
  selectionIndexMemory.set(conversationId, record);
  try {
    await chrome.storage.session.set({ [selectionIndexKey(conversationId)]: record });
  } catch (e) {
    console.warn("chatgpt2md: could not persist selection index", e);
  }
}

async function storeSelectionIndex(conversationId, index) {
  if (!conversationId || !index) return;
  await persistSelectionIndexRecord(conversationId, {
    schemaVersion: SELECTION_INDEX_SCHEMA_VERSION,
    conversationId,
    builtAt: Date.now(),
    dirty: false,
    index
  });
}

async function freshSelectionIndex(conversationId) {
  const record = await loadSelectionIndexRecord(conversationId);
  if (!record) return null;
  if (record.schemaVersion !== SELECTION_INDEX_SCHEMA_VERSION) return null;
  if (record.dirty) return null;
  if (!Number.isFinite(record.builtAt)) return null;
  if (Date.now() - record.builtAt > SELECTION_INDEX_TTL_MS) return null;
  if (record.index?.schemaVersion !== SELECTION_INDEX_SCHEMA_VERSION) return null;
  return record.index;
}

async function markSelectionIndexDirtyIfNeeded(conversationId, ids = [], temporaryIds = []) {
  const record = await loadSelectionIndexRecord(conversationId);
  if (!record || record.dirty) return !!record?.dirty;
  if (record.schemaVersion !== SELECTION_INDEX_SCHEMA_VERSION || !record.index) return false;

  const known = selectionIndexKnownIds(record.index);
  const hasUnknownStableId = ids.some(id => id && !known.has(String(id)));
  const hasTemporaryId = temporaryIds.some(Boolean);
  if (!hasUnknownStableId && !hasTemporaryId) return false;

  await persistSelectionIndexRecord(conversationId, {
    ...record,
    dirty: true,
    dirtiedAt: Date.now()
  });
  return true;
}

async function mountedIdsMatchSelectionIndex(tabId, conversationId, index) {
  try {
    const snapshot = await chrome.tabs.sendMessage(tabId, { type: "GET_SELECTION_INDEX_IDS" });
    if (!snapshot) return true;
    if (snapshot.conversationId && snapshot.conversationId !== conversationId) return false;
    if ((snapshot.temporaryIds || []).length) return false;

    const known = selectionIndexKnownIds(index);
    return (snapshot.ids || []).every(id => known.has(String(id)));
  } catch {
    // Older page instances may not have the cache observer injected yet. The TTL
    // still protects the cache; a page refresh after extension reload adds it.
    return true;
  }
}

async function enableSelectionIndexWatch(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "ENABLE_SELECTION_INDEX_WATCH" });
  } catch {
    // Existing tabs need one page refresh after the manifest first gains the
    // observer content script. Caching still works with TTL until then.
  }
}
function omissionBoundaries(rawBranch, selectedBranch) {
  const selectedNodes = new Set(selectedBranch);
  const groups = logicalSelectionGroups(rawBranch).filter(group =>
    group.nodes.some(node => isVisibleMessage(node.message))
  );
  const groupSelected = groups.map(group =>
    group.nodes.some(node => selectedNodes.has(node))
  );
  const firstSelected = groupSelected.indexOf(true);
  const lastSelected = groupSelected.lastIndexOf(true);
  const beforeNodes = new Set();

  if (firstSelected === -1) {
    return { beforeNodes, omittedAtStart: false, omittedAtEnd: false };
  }

  let omittedSinceSelected = false;
  for (let i = firstSelected + 1; i <= lastSelected; i++) {
    if (!groupSelected[i]) {
      omittedSinceSelected = true;
      continue;
    }

    if (omittedSinceSelected) {
      const firstSelectedVisible = groups[i].nodes.find(node =>
        selectedNodes.has(node) && isVisibleMessage(node.message)
      );
      if (firstSelectedVisible) beforeNodes.add(firstSelectedVisible);
      omittedSinceSelected = false;
    }
  }

  return {
    beforeNodes,
    omittedAtStart: firstSelected > 0,
    omittedAtEnd: lastSelected < groups.length - 1
  };
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== "GET_EXPORT_STATE") return;
  loadExportProgress(msg.tabId).then(state => respond(state || { active: false }));
  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== "SELECTION_INDEX_SEEN_IDS") return;

  markSelectionIndexDirtyIfNeeded(
    msg.conversationId,
    msg.ids || [],
    msg.temporaryIds || []
  ).then(dirty => respond({ dirty })).catch(() => respond({ dirty: false }));

  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== "GET_SELECTION_SUMMARY") return;

  (async () => {
    const selection = await chrome.tabs.sendMessage(msg.tabId, { type: "GET_SELECTION" });
    let index = msg.conversationId ? await freshSelectionIndex(msg.conversationId) : null;
    let cached = !!index;

    if (index) {
      const matches = await mountedIdsMatchSelectionIndex(msg.tabId, msg.conversationId, index);
      if (!matches) {
        await markSelectionIndexDirtyIfNeeded(msg.conversationId, ["__mounted-index-mismatch__"]);
        index = null;
        cached = false;
      }
    }

    if (!index) {
      const data = await getConversationInPage(msg.tabId);
      if (msg.conversationId && data.conversation_id !== msg.conversationId) {
        throw new Error("Conversation changed while loading message list");
      }
      const rawBranch = rawBranchFromCurrent(data);
      index = buildSelectionIndex(rawBranch);
      await storeSelectionIndex(data.conversation_id, index);
    }

    await enableSelectionIndexWatch(msg.tabId);
    return {
      ...selectionSummaryFromIndex(index, selection),
      cached
    };
  })().then(respond).catch(e => {
    respond({ error: e.message || String(e) });
  });

  return true;
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg.type !== "EXPORT_ACTIVE_TAB") return;

  (async () => {
    const tabId = msg.tabId;
    await beginExportProgress(tabId, msg.startedAt, msg.exportName);
    await reportExportProgress(tabId, t("progressReadingSelection"));
    const selection = await chrome.tabs.sendMessage(tabId, { type: "GET_SELECTION" });
    await reportExportProgress(tabId, t("progressLoadingChat"));
    const data = await getConversationInPage(tabId);
    const rawBranch = rawBranchFromCurrent(data);
    await storeSelectionIndex(data.conversation_id, buildSelectionIndex(rawBranch));
    await enableSelectionIndexWatch(tabId);
    let branch = rawBranch.filter(node => isVisibleMessage(node.message));

    if (selection.selectAll) {
      const hasExclusions =
        (selection.excludedMessageIds || []).length > 0 ||
        (selection.excludedTurnIds || []).length > 0;
      if (hasExclusions) {
        branch = branchExcludingFromRaw(rawBranch, selection);
        if (!branch.length) throw new Error(t("nothingSelected"));
      }
    } else {
      const hasSelectedMessages = (selection.selectedMessageIds || []).length > 0;
      const hasSelectedTurns = (selection.selectedTurnIds || []).length > 0;
      if (!hasSelectedMessages && !hasSelectedTurns) {
        throw new Error(t("nothingSelected"));
      }
      branch = selectedBranchFromRaw(rawBranch, selection);
      if (!branch.length) {
        throw new Error(t("nothingSelected"));
      }
    }

    const omission = omissionBoundaries(rawBranch, branch);
    await reportExportProgress(tabId, t("progressPreparingMessages", branch.length));

    const exportName = safeName(msg.exportName || data.title);
    const conversationTitle = (typeof msg.originalTitle === "string" && msg.originalTitle.trim())
      ? msg.originalTitle.trim().replace(/[\r\n]+/g, " ")
      : (typeof data.title === "string" && data.title.trim())
        ? data.title.trim().replace(/[\r\n]+/g, " ")
        : exportName;
    const defaultUserName = t("defaultUserName");
    const defaultAssistantName = t("defaultAssistantName");
    const userName = (msg.userName || defaultUserName).trim() || defaultUserName;
    const assistantName = (msg.assistantName || defaultAssistantName).trim() || defaultAssistantName;
    const exportMarkdown = msg.exportMarkdown !== false;
    const exportHtml = msg.exportHtml !== false;
    const exportJsonEnabled = msg.exportJson !== false;
    const includeOriginalLink = msg.includeOriginalLink !== false;
    if (!exportMarkdown && !exportHtml && !exportJsonEnabled) throw new Error(t("chooseFormat"));
    const saveAttachments = msg.saveAttachments !== false;
    const separateAttachmentsFolder = msg.separateAttachmentsFolder !== false;
    const folder = saveAttachments && separateAttachmentsFolder ? exportName : "";
    const mediaFiles = [];
    const usedMediaNames = new Set();
    const jsonMessages = [];

    const totalAttachments = saveAttachments
      ? branch.reduce(
          (sum, node) => sum + attachmentRecords(node.message, data.safe_urls || []).length,
          0
        )
      : 0;
    let downloadedAttachments = 0;
    let idx = 0;
    let omissionPending = omission.omittedAtStart;
    for (const node of branch) {
      if (omission.beforeNodes.has(node)) omissionPending = true;
      idx++;
      if (idx === 1 || idx === branch.length || idx % 10 === 0) {
        await reportExportProgress(tabId, t("progressProcessingMessages", [idx, branch.length]));
      }
      const msgObj = node.message;
      const sourceRole = msgObj.author?.role || "unknown";
      const role = sourceRole === "tool" ? "assistant" : sourceRole;
      const rawTexts = textParts(msgObj);
      const attachments = attachmentRecords(msgObj, data.safe_urls || []);

      if (!rawTexts.length && !attachments.length) {
        idx--;
        continue;
      }

      const jsonAtt = [];
      const sandboxHrefReplacements = new Map();

      let aidx = 0;
      for (const a of attachments) {
        aidx++;

        let resolvedOriginalName = a.originalName || a.title || null;
        let resolvedMimeType = a.mimeType || "application/octet-stream";
        let resolvedFileId = a.id || null;
        let resolvedLibraryFileId = a.libraryFileId || null;
        let media = null;
        let downloadError = null;

        const downloadRecord = a.source === "sandbox"
          ? { ...a, conversationId: data.conversation_id, messageId: msgObj.id }
          : a;

        if (saveAttachments) {
          if (!a.id && a.source !== "sandbox") {
            downloadError = "attachment.id is missing";
          } else {
            try {
              await reportExportProgress(
                tabId,
                t("progressDownloadingMedia", [downloadedAttachments + 1, totalAttachments])
              );
              media = await downloadAttachmentInPage(tabId, downloadRecord);
              resolvedOriginalName = resolvedOriginalName || media.originalName || null;
              resolvedMimeType = media.type || a.mimeType || "application/octet-stream";
              resolvedFileId = resolvedFileId || media.fileId || null;
              resolvedLibraryFileId = resolvedLibraryFileId || media.libraryFileId || null;
            } catch (e) {
              downloadError = String(e);
            }
          }
        } else if (a.id && !resolvedOriginalName) {
          try {
            const info = await downloadAttachmentInPage(tabId, downloadRecord, true);
            resolvedOriginalName = info.originalName || resolvedOriginalName;
            if (!a.mimeType && info.type) resolvedMimeType = info.type;
            resolvedFileId = resolvedFileId || info.fileId || null;
            resolvedLibraryFileId = resolvedLibraryFileId || info.libraryFileId || null;
          } catch (e) {
            console.warn("chatgpt2md: could not resolve attachment metadata", a.id, e);
          }
        }

        const ext = extFromMime(resolvedMimeType, resolvedOriginalName || "");
        const fallbackName = `${String(idx).padStart(4,"0")}-${role}-${String(aidx).padStart(2,"0")}.${ext}`;
        const preferredName = filenameWithExtension(resolvedOriginalName, ext);
        const localName = uniqueFilename(preferredName, fallbackName, usedMediaNames);
        const localPath = saveAttachments && folder ? `${folder}/${localName}` : localName;
        const href = markdownHref(localPath);

        if (a.source === "sandbox" && a.sandboxUrl) {
          sandboxHrefReplacements.set(a.sandboxUrl, href);
        }

        if (saveAttachments && media?.bytes) {
          mediaFiles.push({ name: localPath, bytes: media.bytes });
        }

        jsonAtt.push({
          ...a,
          ...(resolvedFileId ? { id: resolvedFileId } : {}),
          ...(resolvedLibraryFileId ? { libraryFileId: resolvedLibraryFileId } : {}),
          ...(resolvedOriginalName ? { originalName: resolvedOriginalName } : {}),
          localName,
          localPath,
          mimeType: resolvedMimeType || a.mimeType,
          ...(downloadError ? { error: downloadError } : {})
        });

        if (saveAttachments) downloadedAttachments++;
      }

      const texts = rawTexts.map(text => replaceSandboxLinkDestinations(text, sandboxHrefReplacements));
      jsonMessages.push({
        id: msgObj.id,
        parentId: node.parent,
        role,
        sourceRole,
        authorName: role === "user" ? userName : assistantName,
        createdAt: isoUtc(msgObj.create_time),
        model: msgObj.metadata?.model_slug || msgObj.metadata?.resolved_model_slug || null,
        ...(omissionPending ? { omittedBefore: true } : {}),
        content: texts.map(text => ({ type: "text", text, format: "markdown" })),
        attachments: jsonAtt
      });
      omissionPending = false;
    }

    if (omission.omittedAtEnd && jsonMessages.length) {
      jsonMessages[jsonMessages.length - 1].omittedAfter = true;
    }

    const conversationUrl = `https://chatgpt.com/c/${data.conversation_id}`;
    const exportJson = {
      schemaVersion: 1,
      exporter: "chatgpt2md",
      exporterVersion: "0.1.31",
      title: exportName,
      conversationId: data.conversation_id,
      ...(includeOriginalLink ? { conversationUrl } : {}),
      exportedAt: new Date().toISOString(),
      userName,
      assistantName,
      messages: jsonMessages
    };

    await reportExportProgress(tabId, t("progressBuildingFiles"));
    const files = [];
    if (exportMarkdown) {
      const markdown = buildMarkdownExport({
        title: conversationTitle,
        conversationUrl,
        messages: jsonMessages,
        includeOriginalLink
      });
      files.push({ name: `${exportName}.md`, bytes: enc(markdown) });
    }
    if (exportHtml) {
      const html = buildHtmlExport({
        title: conversationTitle,
        conversationUrl,
        messages: jsonMessages,
        includeOriginalLink
      });
      files.push({ name: `${exportName}.html`, bytes: enc(html) });
    }
    if (exportJsonEnabled) {
      files.push({ name: `${exportName}.json`, bytes: enc(JSON.stringify(exportJson, null, 2)) });
    }
    files.push(...mediaFiles);
    await reportExportProgress(tabId, t("progressPackingZip"));
    let zip = makeZip(files);
    const filename = `${exportName}.zip`;

    // makeZip() copied every file into the archive buffer, so release the
    // original attachment buffers before handing the ZIP to the offscreen page.
    // This keeps peak memory close to the unavoidable source+ZIP stage instead
    // of retaining another full archive worth of media during the download.
    files.length = 0;
    mediaFiles.length = 0;

    await reportExportProgress(tabId, t("progressPreparingDownload"));
    let url = null;
    try {
      url = await createOffscreenObjectUrl(zip, "application/zip");
      zip = null;

      await reportExportProgress(tabId, t("progressSendingBrowser"));
      const downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
      await reportExportProgress(tabId, t("progressWaitingDownload"));
      await waitForDownloadCompletion(downloadId);
    } finally {
      await revokeOffscreenObjectUrl(url);
    }

    // A successful export ends the temporary message-selection session. Do the
    // reset from the background worker so it still happens if the popup closes
    // while the browser's Save As dialog is open.
    let selectionState = null;
    try {
      selectionState = await chrome.tabs.sendMessage(tabId, { type: "RESET_AFTER_EXPORT" });
    } catch (e) {
      console.warn("chatgpt2md: could not reset selection UI after export", e);
    }

    return { ok: true, filename, selectionState };
  })().then(async result => {
    await finishExportProgress(msg.tabId, { ok: true, filename: result.filename });
    respond(result);
  }).catch(async e => {
    const error = e.message || String(e);
    await finishExportProgress(msg.tabId, { ok: false, error });
    respond({ ok: false, error });
  });

  return true;
});