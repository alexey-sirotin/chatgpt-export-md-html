const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;
const localObjectUrls = new Set();

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function canCreateObjectUrlLocally() {
  return typeof document !== "undefined" &&
    typeof Blob !== "undefined" &&
    typeof URL?.createObjectURL === "function";
}

async function findOffscreenClient() {
  if (typeof clients === "undefined") return null;

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const matchedClients = await clients.matchAll({ includeUncontrolled: true });
  return matchedClients.find(client => client.url === offscreenUrl) || null;
}

async function ensureOffscreenClient() {
  const existing = await findOffscreenClient();
  if (existing) return existing;

  if (!chrome.offscreen?.createDocument) {
    throw new Error("This browser cannot create a download object URL");
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
  try {
    const client = await findOffscreenClient();
    client?.postMessage({ type: "REVOKE_OBJECT_URL", url });
  } catch {
    // Best-effort cleanup. If the offscreen document vanished, its Blob URLs
    // vanished with it as well.
  }
}

export async function createDownloadObjectUrl(bytes, mimeType = "application/octet-stream") {
  // Firefox MV3 currently runs background scripts in an extension document,
  // where Blob and URL.createObjectURL() are available directly. Chromium MV3
  // runs background.js as a service worker, so it takes the offscreen path.
  if (canCreateObjectUrlLocally()) {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    localObjectUrls.add(url);
    return url;
  }

  return createOffscreenObjectUrl(bytes, mimeType);
}

export async function revokeDownloadObjectUrl(url) {
  if (!url) return;

  if (localObjectUrls.delete(url)) {
    URL.revokeObjectURL(url);
    return;
  }

  await revokeOffscreenObjectUrl(url);
}
