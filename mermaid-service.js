import { renderMermaidSourcesLocally } from "./mermaid-runtime.js";

const OFFSCREEN_DOCUMENT_PATH = "offscreen.html";
let creatingOffscreenDocument = null;

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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
    throw new Error("Mermaid offscreen rendering is unavailable");
  }

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = (async () => {
      try {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_DOCUMENT_PATH,
          reasons: ["BLOBS", "DOM_PARSER"],
          justification: "Render Mermaid diagrams and create Blob URLs for exported archives"
        });
      } catch (error) {
        if (!await findOffscreenClient()) throw error;
      }
    })().finally(() => {
      creatingOffscreenDocument = null;
    });
  }

  await creatingOffscreenDocument;

  for (let attempt = 0; attempt < 20; attempt++) {
    const client = await findOffscreenClient();
    if (client) return client;
    await delay(25);
  }

  throw new Error("Mermaid offscreen document is unavailable");
}

async function renderViaOffscreen(sources) {
  const client = await ensureOffscreenClient();
  const channel = new MessageChannel();

  const response = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Mermaid rendering timed out"));
    }, 60000);

    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      const result = event.data || {};
      if (!result.ok || !Array.isArray(result.results)) {
        reject(new Error(result.error || "Mermaid rendering failed"));
        return;
      }
      resolve(result.results);
    };

    channel.port1.onmessageerror = () => {
      clearTimeout(timer);
      channel.port1.close();
      reject(new Error("Could not receive Mermaid rendering result"));
    };
  });

  client.postMessage(
    { type: "RENDER_MERMAID", sources: [...(sources || [])] },
    [channel.port2]
  );

  return response;
}

export async function renderMermaidSources(sources) {
  if (!sources?.length) return [];

  // Firefox MV3 runs background.js in an extension document, so Mermaid can
  // render there directly. Chromium MV3 uses a service worker and takes the
  // existing offscreen-document path instead.
  if (typeof document !== "undefined") {
    return renderMermaidSourcesLocally(sources);
  }

  return renderViaOffscreen(sources);
}
