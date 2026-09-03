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
  downloadAttachmentInPage,
  abortExportInPage,
  clearExportAbortInPage
} from "./chatgpt-api.js";
import {
  createAbortError,
  isAbortError,
  throwIfAborted
} from "./cancellation.js";
import {
  mapWithConcurrency,
  normalizeConcurrency
} from "./async-pool.js";
import { buildMarkdownExport, buildHtmlExport } from "./render.js";
import { makeZip } from "./zip.js";
import {
  createDownloadObjectUrl,
  revokeDownloadObjectUrl
} from "./download-url.js";

const DEFAULT_ATTACHMENT_DOWNLOAD_CONCURRENCY = 3;
const MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY = 1;
const MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY = 10;

function waitForDownloadCompletion(downloadId, signal) {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      signal?.removeEventListener("abort", onAbort);
      error ? reject(error) : resolve();
    };

    const onChanged = delta => {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === "complete") {
        finish();
        return;
      }
      if (delta.error?.current || delta.state?.current === "interrupted") {
        finish(new Error(delta.error?.current || t("errorDownloadInterrupted")));
      }
    };

    const onAbort = () => {
      chrome.downloads.cancel(downloadId).catch(() => {});
      finish(createAbortError(t("exportCanceled")));
    };

    chrome.downloads.onChanged.addListener(onChanged);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    // Close the small race where an extremely small archive completes before
    // the onChanged listener is attached.
    chrome.downloads.search({ id: downloadId }).then(items => {
      const item = items?.[0];
      if (!item || settled) return;
      if (item.state === "complete") finish();
      else if (item.state === "interrupted") finish(new Error(item.error || t("errorDownloadInterrupted")));
    }).catch(() => {});
  });
}

const exportProgressState = new Map();
const activeExports = new Map();

function makeExportId(tabId) {
  const suffix = globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${tabId}:${suffix}`;
}

function currentExportOperation(tabId, exportId = null) {
  const operation = activeExports.get(tabId) || null;
  if (!operation) return null;
  if (exportId && operation.exportId !== exportId) return null;
  return operation;
}

async function requestExportCancellation(tabId) {
  const progress = await loadExportProgress(tabId);
  const operation = currentExportOperation(tabId, progress?.exportId || null);
  const exportId = operation?.exportId || progress?.exportId || null;
  const downloadId = operation?.downloadId ?? progress?.downloadId ?? null;

  if (!progress?.active && !operation) {
    return { ok: true, canceled: false };
  }

  if (progress?.active) {
    const state = {
      ...progress,
      active: true,
      cancelRequested: true,
      text: t("cancelingExport"),
      updatedAt: Date.now()
    };
    await storeExportProgress(tabId, state);
    try {
      await chrome.runtime.sendMessage({
        type: "EXPORT_PROGRESS",
        tabId,
        text: state.text,
        startedAt: state.startedAt,
        cancelRequested: true
      });
    } catch {}
  }

  // Persist the user's intent before aborting anything. Some abortable stages
  // reject immediately, so writing state first avoids racing a completed
  // cancellation against a late "cancel requested" progress update.
  operation?.controller.abort();

  const tasks = [];
  if (exportId) tasks.push(abortExportInPage(tabId, exportId));
  if (downloadId != null) tasks.push(chrome.downloads.cancel(downloadId));
  await Promise.allSettled(tasks);

  return { ok: true, canceled: true };
}

function exportProgressKey(tabId) {
  return `exportProgress:${tabId}`;
}

async function storeExportProgress(tabId, state) {
  exportProgressState.set(tabId, state);
  try {
    await chrome.storage.session.set({ [exportProgressKey(tabId)]: state });
  } catch (e) {
    console.warn("chatgpt-export-md-html: could not persist export progress", e);
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

async function beginExportProgress(tabId, startedAt, exportName, exportId) {
  const state = {
    active: true,
    exportId,
    startedAt: Number.isFinite(Number(startedAt)) ? Number(startedAt) : Date.now(),
    text: t("preparingExport"),
    exportName: exportName || "",
    cancelRequested: false,
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
    text: previous.cancelRequested
      ? previous.text || t("cancelingExport")
      : text,
    updatedAt: Date.now()
  };
  await storeExportProgress(tabId, state);
  try {
    await chrome.runtime.sendMessage({
      type: "EXPORT_PROGRESS",
      tabId,
      text: state.text,
      startedAt: state.startedAt,
      cancelRequested: !!state.cancelRequested
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
    console.warn("chatgpt-export-md-html: could not persist selection index", e);
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
  if (msg.type !== "CANCEL_EXPORT") return;
  requestExportCancellation(msg.tabId)
    .then(respond)
    .catch(error => respond({ ok: false, error: error.message || String(error) }));
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
        throw new Error(t("errorConversationChanged"));
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

  const tabId = msg.tabId;
  const exportId = makeExportId(tabId);
  const controller = new AbortController();
  const signal = controller.signal;
  activeExports.set(tabId, { exportId, controller, downloadId: null });

  (async () => {
    await beginExportProgress(tabId, msg.startedAt, msg.exportName, exportId);
    throwIfAborted(signal, t("exportCanceled"));
    await reportExportProgress(tabId, t("progressReadingSelection"));
    const selection = await chrome.tabs.sendMessage(tabId, { type: "GET_SELECTION" });
    throwIfAborted(signal, t("exportCanceled"));
    await reportExportProgress(tabId, t("progressLoadingChat"));
    const data = await getConversationInPage(tabId, exportId);
    throwIfAborted(signal, t("exportCanceled"));
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
    const attachmentDownloadConcurrency = normalizeConcurrency(
      msg.attachmentDownloadConcurrency,
      {
        defaultValue: DEFAULT_ATTACHMENT_DOWNLOAD_CONCURRENCY,
        min: MIN_ATTACHMENT_DOWNLOAD_CONCURRENCY,
        max: MAX_ATTACHMENT_DOWNLOAD_CONCURRENCY
      }
    );
    const folder = separateAttachmentsFolder ? exportName : "";
    const mediaFiles = [];
    const usedMediaNames = new Set();
    const jsonMessages = [];

    const preparedMessages = [];
    const attachmentJobs = [];
    let outputMessageIndex = 0;
    let branchIndex = 0;
    let omissionPending = omission.omittedAtStart;

    for (const node of branch) {
      throwIfAborted(signal, t("exportCanceled"));
      branchIndex++;

      if (
        branchIndex === 1 ||
        branchIndex === branch.length ||
        branchIndex % 10 === 0
      ) {
        await reportExportProgress(
          tabId,
          t("progressProcessingMessages", [branchIndex, branch.length])
        );
      }

      if (omission.beforeNodes.has(node)) omissionPending = true;

      const msgObj = node.message;
      const sourceRole = msgObj.author?.role || "unknown";
      const role = sourceRole === "tool" ? "assistant" : sourceRole;
      const rawTexts = textParts(msgObj);
      const attachments = attachmentRecords(msgObj, data.safe_urls || []);

      if (!rawTexts.length && !attachments.length) continue;

      outputMessageIndex++;
      const prepared = {
        node,
        msgObj,
        sourceRole,
        role,
        rawTexts,
        omittedBefore: omissionPending,
        outputMessageIndex,
        attachments: []
      };
      omissionPending = false;

      let attachmentIndex = 0;
      for (const attachment of attachments) {
        attachmentIndex++;
        const job = {
          prepared,
          attachment,
          attachmentIndex,
          resolvedOriginalName: attachment.originalName || attachment.title || null,
          resolvedMimeType: attachment.mimeType || "application/octet-stream",
          resolvedFileId: attachment.id || null,
          resolvedLibraryFileId: attachment.libraryFileId || null,
          media: null,
          downloadError: null
        };
        prepared.attachments.push(job);
        attachmentJobs.push(job);
      }

      preparedMessages.push(prepared);
    }

    const totalAttachments = saveAttachments ? attachmentJobs.length : 0;
    let completedAttachments = 0;
    let progressReports = Promise.resolve();

    const reportAttachmentCompleted = () => {
      if (!saveAttachments) return Promise.resolve();
      const completed = ++completedAttachments;
      progressReports = progressReports.then(() =>
        reportExportProgress(
          tabId,
          t("progressDownloadingMedia", [completed, totalAttachments])
        )
      );
      return progressReports;
    };

    if (saveAttachments && totalAttachments) {
      await reportExportProgress(
        tabId,
        t("progressDownloadingMedia", [0, totalAttachments])
      );
    }

    await mapWithConcurrency(
      attachmentJobs,
      attachmentDownloadConcurrency,
      async job => {
        throwIfAborted(signal, t("exportCanceled"));

        const { attachment: a, prepared } = job;
        const downloadRecord = a.source === "sandbox"
          ? {
              ...a,
              conversationId: data.conversation_id,
              messageId: prepared.msgObj.id
            }
          : a;

        if (saveAttachments) {
          if (!a.id && a.source !== "sandbox") {
            job.downloadError = t("errorAttachmentId");
          } else {
            try {
              job.media = await downloadAttachmentInPage(
                tabId,
                downloadRecord,
                false,
                exportId
              );
              throwIfAborted(signal, t("exportCanceled"));

              job.resolvedOriginalName =
                job.resolvedOriginalName || job.media.originalName || null;
              job.resolvedMimeType =
                job.media.type || a.mimeType || "application/octet-stream";
              job.resolvedFileId =
                job.resolvedFileId || job.media.fileId || null;
              job.resolvedLibraryFileId =
                job.resolvedLibraryFileId || job.media.libraryFileId || null;
            } catch (error) {
              if (signal.aborted || isAbortError(error)) {
                throw createAbortError(t("exportCanceled"));
              }
              job.downloadError = String(error);
            }
          }

          reportAttachmentCompleted();
          return job;
        }

        if (
          (a.id || a.source === "sandbox") &&
          (!job.resolvedOriginalName ||
            !a.mimeType ||
            a.mimeType === "application/octet-stream")
        ) {
          try {
            const info = await downloadAttachmentInPage(
              tabId,
              downloadRecord,
              true,
              exportId
            );
            throwIfAborted(signal, t("exportCanceled"));

            job.resolvedOriginalName =
              info.originalName || job.resolvedOriginalName;
            job.resolvedMimeType = info.type || job.resolvedMimeType;
            job.resolvedFileId =
              job.resolvedFileId || info.fileId || null;
            job.resolvedLibraryFileId =
              job.resolvedLibraryFileId || info.libraryFileId || null;
          } catch (error) {
            if (signal.aborted || isAbortError(error)) {
              throw createAbortError(t("exportCanceled"));
            }
            console.warn(
              "chatgpt-export-md-html: could not resolve attachment metadata",
              a.id || a.sandboxPath || "",
              error
            );
          }
        }

        return job;
      }
    );
    await progressReports;
    throwIfAborted(signal, t("exportCanceled"));

    for (const prepared of preparedMessages) {
      const {
        node,
        msgObj,
        sourceRole,
        role,
        rawTexts,
        outputMessageIndex
      } = prepared;
      const jsonAtt = [];
      const sandboxHrefReplacements = new Map();

      for (const job of prepared.attachments) {
        const {
          attachment: a,
          attachmentIndex,
          media,
          downloadError
        } = job;

        let resolvedOriginalName = job.resolvedOriginalName;
        let resolvedMimeType = job.resolvedMimeType;
        const resolvedFileId = job.resolvedFileId;
        const resolvedLibraryFileId = job.resolvedLibraryFileId;

        const hasKnownImageExtension =
          /\.(?:avif|bmp|gif|heic|heif|ico|jpe?g|png|svg|tiff?|webp)$/i
            .test(resolvedOriginalName || "");
        if (
          a.isImage &&
          (!resolvedMimeType || resolvedMimeType === "application/octet-stream") &&
          !hasKnownImageExtension
        ) {
          resolvedMimeType = "image/png";
        }

        const ext = extFromMime(resolvedMimeType, resolvedOriginalName || "");
        const fallbackName =
          `${String(outputMessageIndex).padStart(4, "0")}-${role}-${String(attachmentIndex).padStart(2, "0")}.${ext}`;
        const preferredName = filenameWithExtension(resolvedOriginalName, ext);
        const localName = uniqueFilename(
          preferredName,
          fallbackName,
          usedMediaNames
        );
        const localPath = folder ? `${folder}/${localName}` : localName;
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
      }

      const texts = rawTexts.map(text =>
        replaceSandboxLinkDestinations(text, sandboxHrefReplacements)
      );
      jsonMessages.push({
        id: msgObj.id,
        parentId: node.parent,
        role,
        sourceRole,
        authorName: role === "user" ? userName : assistantName,
        createdAt: isoUtc(msgObj.create_time),
        model:
          msgObj.metadata?.model_slug ||
          msgObj.metadata?.resolved_model_slug ||
          null,
        ...(prepared.omittedBefore ? { omittedBefore: true } : {}),
        content: texts.map(text => ({ type: "text", text, format: "markdown" })),
        attachments: jsonAtt
      });
    }

    if (omission.omittedAtEnd && jsonMessages.length) {
      jsonMessages[jsonMessages.length - 1].omittedAfter = true;
    }

    const conversationUrl = `https://chatgpt.com/c/${data.conversation_id}`;
    const exportJson = {
      schemaVersion: 1,
      exporter: "chatgpt-export-md-html",
      exporterVersion: chrome.runtime.getManifest().version,
      title: exportName,
      conversationId: data.conversation_id,
      ...(includeOriginalLink ? { conversationUrl } : {}),
      exportedAt: new Date().toISOString(),
      userName,
      assistantName,
      messages: jsonMessages
    };

    throwIfAborted(signal, t("exportCanceled"));
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
    throwIfAborted(signal, t("exportCanceled"));
    await reportExportProgress(tabId, t("progressPackingZip"));
    let zip = makeZip(files);
    throwIfAborted(signal, t("exportCanceled"));
    const filename = `${exportName}.zip`;

    // makeZip() copied every file into the archive buffer, so release the
    // original attachment buffers before handing the ZIP to the download URL
    // layer. This keeps peak memory close to the unavoidable source+ZIP stage.
    files.length = 0;
    mediaFiles.length = 0;

    await reportExportProgress(tabId, t("progressPreparingDownload"));
    throwIfAborted(signal, t("exportCanceled"));
    let url = null;
    try {
      url = await createDownloadObjectUrl(zip, "application/zip");
      zip = null;
      throwIfAborted(signal, t("exportCanceled"));

      await reportExportProgress(tabId, t("progressSendingBrowser"));
      const downloadId = await chrome.downloads.download({ url, filename, saveAs: true });
      const operation = currentExportOperation(tabId, exportId);
      if (operation) operation.downloadId = downloadId;
      const progress = await loadExportProgress(tabId);
      if (progress?.active && progress.exportId === exportId) {
        await storeExportProgress(tabId, { ...progress, downloadId, updatedAt: Date.now() });
      }
      throwIfAborted(signal, t("exportCanceled"));
      await reportExportProgress(tabId, t("progressWaitingDownload"));
      await waitForDownloadCompletion(downloadId, signal);
    } finally {
      await revokeDownloadObjectUrl(url);
    }

    // A successful export ends the temporary message-selection session. Do the
    // reset from the background worker so it still happens if the popup closes
    // while the browser's Save As dialog is open.
    let selectionState = null;
    try {
      selectionState = await chrome.tabs.sendMessage(tabId, { type: "RESET_AFTER_EXPORT" });
    } catch (e) {
      console.warn("chatgpt-export-md-html: could not reset selection UI after export", e);
    }

    return { ok: true, filename, selectionState };
  })().then(async result => {
    await finishExportProgress(tabId, { ok: true, filename: result.filename });
    respond(result);
  }).catch(async e => {
    const canceled = signal.aborted || isAbortError(e);
    const error = canceled ? t("exportCanceled") : (e.message || String(e));
    await finishExportProgress(tabId, {
      ok: false,
      canceled,
      ...(canceled ? {} : { error })
    });
    respond({
      ok: false,
      canceled,
      ...(canceled ? {} : { error })
    });
  }).finally(async () => {
    const operation = currentExportOperation(tabId, exportId);
    if (operation) activeExports.delete(tabId);
    try {
      await clearExportAbortInPage(tabId, exportId);
    } catch {}
  });

  return true;
});
