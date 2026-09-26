const MERMAID_SCRIPT_PATH = "vendor/mermaid.min.js";
let scriptPromise = null;
let initialized = false;
let renderCounter = 0;

function loadMermaidScript() {
  if (globalThis.mermaid?.render) return Promise.resolve(globalThis.mermaid);
  if (scriptPromise) return scriptPromise;
  if (typeof document === "undefined") {
    return Promise.reject(new Error("Mermaid rendering requires a DOM document"));
  }

  scriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL(MERMAID_SCRIPT_PATH);
    script.async = true;
    script.onload = () => {
      if (globalThis.mermaid?.render) resolve(globalThis.mermaid);
      else reject(new Error("Vendored Mermaid runtime did not initialize"));
    };
    script.onerror = () => reject(new Error("Could not load vendored Mermaid runtime"));
    (document.head || document.documentElement).appendChild(script);
  }).catch(error => {
    scriptPromise = null;
    throw error;
  });

  return scriptPromise;
}

async function ensureMermaid() {
  const mermaid = await loadMermaidScript();
  if (!initialized) {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: "neutral",
      flowchart: {
        htmlLabels: false
      }
    });
    initialized = true;
  }
  return mermaid;
}

function sanitizeSvg(svg) {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
    return String(svg || "");
  }

  const doc = new DOMParser().parseFromString(String(svg || ""), "image/svg+xml");
  if (doc.querySelector("parsererror")) return String(svg || "");

  for (const script of doc.querySelectorAll("script")) script.remove();
  for (const element of doc.querySelectorAll("*")) {
    for (const attr of [...element.attributes]) {
      if (/^on/i.test(attr.name)) {
        element.removeAttribute(attr.name);
        continue;
      }
      if (/^(?:href|xlink:href)$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value)) {
        element.removeAttribute(attr.name);
      }
    }
  }

  return new XMLSerializer().serializeToString(doc.documentElement);
}

function cleanupTemporaryRenderNodes(id) {
  document.getElementById(id)?.remove();
  document.getElementById(`d${id}`)?.remove();
}

export async function renderMermaidSourcesLocally(sources) {
  const mermaid = await ensureMermaid();
  const results = [];

  for (const rawSource of sources || []) {
    const source = String(rawSource ?? "");
    const id = `chatgpt-export-mermaid-${Date.now()}-${renderCounter++}`;

    try {
      const rendered = await mermaid.render(id, source);
      results.push({ svg: sanitizeSvg(rendered?.svg || "") });
    } catch (error) {
      results.push({
        svg: null,
        error: error?.message || String(error)
      });
    } finally {
      cleanupTemporaryRenderNodes(id);
    }
  }

  return results;
}
