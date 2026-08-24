const objectUrls = new Set();

navigator.serviceWorker.onmessage = event => {
  const message = event.data || {};

  if (message.type === "CREATE_OBJECT_URL") {
    const port = event.ports?.[0];
    if (!port) return;

    try {
      const blob = new Blob([message.buffer], {
        type: message.mimeType || "application/octet-stream"
      });
      const url = URL.createObjectURL(blob);
      objectUrls.add(url);
      port.postMessage({ ok: true, url });
    } catch (e) {
      port.postMessage({ ok: false, error: e.message || String(e) });
    }
    return;
  }

  if (message.type === "REVOKE_OBJECT_URL" && message.url) {
    try {
      URL.revokeObjectURL(message.url);
    } finally {
      objectUrls.delete(message.url);
    }
  }
};

addEventListener("unload", () => {
  for (const url of objectUrls) {
    URL.revokeObjectURL(url);
  }
  objectUrls.clear();
});
