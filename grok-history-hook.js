(() => {
  const CACHE_KEY = "__chatgptExportGrokHistoryItems";
  const WRAPPED_KEY = "__chatgptExportGrokWebSocketWrapped";

  if (globalThis[WRAPPED_KEY]) return;
  globalThis[WRAPPED_KEY] = true;

  const cache = globalThis[CACHE_KEY] ||= new Map();
  const NativeWebSocket = globalThis.WebSocket;
  if (typeof NativeWebSocket !== "function") return;

  const rememberHistoryItem = payload => {
    const event = payload?.event;
    if (event?.type !== "conversation.history.item") return;

    const item = event.item;
    const id = item?.id;
    if (!id) return;

    const outputChunks = item?.x_grok?.output_chunks;
    if (!Array.isArray(outputChunks) || !outputChunks.length) return;

    cache.set(String(id), {
      outputChunks,
      role: item?.role || null,
      status: item?.status || null
    });
  };

  class ExportAwareWebSocket extends NativeWebSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener("message", event => {
        if (typeof event.data !== "string") return;
        try {
          rememberHistoryItem(JSON.parse(event.data));
        } catch {}
      });
    }
  }

  globalThis.WebSocket = ExportAwareWebSocket;
})();
