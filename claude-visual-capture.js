import { getClaudeConversationInPage as getClaudeConversationBaseInPage } from "./claude-api.js";

const CAPTURE_KEY = "__chatgptExportClaudeVisualCaptureV2";

function mergeVisuals(existing = [], captured = []) {
  if (!captured.length) return existing;

  const byKey = new Map();
  for (const visual of existing || []) {
    if (!Number.isInteger(visual?.rowIndex) || typeof visual?.svg !== "string") continue;
    const visualIndex = Number.isInteger(visual.visualIndex) ? visual.visualIndex : 0;
    byKey.set(`${visual.rowIndex}:${visualIndex}`, { ...visual, visualIndex });
  }
  for (const visual of captured) {
    if (!Number.isInteger(visual?.rowIndex) || typeof visual?.svg !== "string") continue;
    const visualIndex = Number.isInteger(visual.visualIndex) ? visual.visualIndex : 0;
    byKey.set(`${visual.rowIndex}:${visualIndex}`, { ...visual, visualIndex });
  }

  return [...byKey.values()]
    .sort((a, b) => a.rowIndex - b.rowIndex || a.visualIndex - b.visualIndex)
    .map(({ visualIndex, ...visual }) => visual);
}

async function captureClaudeCustomVisuals(tabId) {
  const token = crypto.randomUUID();

  const captureRound = async () => {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      args: [token],
      func: token => {
        if (
          !/(?:^|\.)claudemcpcontent\.com$/i.test(location.hostname) ||
          location.pathname !== "/mcp_apps"
        ) return null;

        const candidates = [...document.querySelectorAll("svg")]
          .map(svg => ({ svg, rect: svg.getBoundingClientRect() }))
          .filter(item => item.rect.width > 100 && item.rect.height > 50)
          .sort((a, b) =>
            (b.rect.width * b.rect.height) - (a.rect.width * a.rect.height)
          );
        const source = candidates[0];
        if (!source) return null;

        const clone = source.svg.cloneNode(true);
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

        const properties = [
          "color",
          "fill",
          "fill-opacity",
          "stroke",
          "stroke-opacity",
          "stroke-width",
          "stroke-linecap",
          "stroke-linejoin",
          "stroke-dasharray",
          "opacity",
          "font-family",
          "font-size",
          "font-weight",
          "font-style",
          "letter-spacing",
          "text-anchor",
          "dominant-baseline",
          "visibility",
          "display",
          "paint-order",
          "vector-effect",
          "marker-start",
          "marker-mid",
          "marker-end"
        ];

        const originals = [source.svg, ...source.svg.querySelectorAll("*")];
        const clones = [clone, ...clone.querySelectorAll("*")];
        originals.forEach((element, index) => {
          const target = clones[index];
          if (!target) return;
          const style = getComputedStyle(element);
          for (const property of properties) {
            const value = style.getPropertyValue(property);
            if (value) target.style.setProperty(property, value);
          }
        });

        for (const script of clone.querySelectorAll("script")) script.remove();
        for (const foreignObject of clone.querySelectorAll("foreignObject")) foreignObject.remove();
        for (const element of [clone, ...clone.querySelectorAll("*")]) {
          for (const attr of [...element.attributes]) {
            if (/^on/i.test(attr.name)) {
              element.removeAttribute(attr.name);
              continue;
            }
            if (
              /^(?:href|xlink:href)$/i.test(attr.name) &&
              /^\s*javascript:/i.test(attr.value)
            ) {
              element.removeAttribute(attr.name);
            }
          }
        }

        const viewBox = clone.viewBox?.baseVal;
        if (viewBox?.width > 0 && viewBox?.height > 0) {
          clone.setAttribute("width", String(viewBox.width));
          clone.setAttribute("height", String(viewBox.height));
        } else {
          clone.setAttribute("width", String(Math.round(source.rect.width)));
          clone.setAttribute("height", String(Math.round(source.rect.height)));
        }

        window.parent.postMessage({
          type: "chatgpt-export-claude-visual-v2",
          token,
          svg: new XMLSerializer().serializeToString(clone),
          width: source.rect.width,
          height: source.rect.height
        }, "*");
        return true;
      }
    });
  };

  const scrollRow = async (rowIndex, delayMs) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token, rowIndex, delayMs],
      func: async (registryKey, token, rowIndex, delayMs) => {
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return false;

        // Re-query the live row every time. Claude can replace an offscreen
        // transcript row/iframe while keeping the same data-index, so retaining
        // element references across awaits can silently scroll a detached node.
        const row = document.querySelector(
          `[data-testid="transcript-row"][data-index="${rowIndex}"]`
        );
        if (!row) return false;

        row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await new Promise(resolve => setTimeout(resolve, delayMs));
        return true;
      }
    });
    return result === true;
  };

  const missingRows = async () => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token],
      func: (registryKey, token) => {
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return [];
        return state.rows.filter(rowIndex => !state.capturedRows.has(rowIndex));
      }
    });
    return Array.isArray(result) ? result : [];
  };

  const finish = async () => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token],
      func: (registryKey, token) => {
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return [];

        for (const item of [...state.scrollPositions].reverse()) {
          try {
            item.element.scrollLeft = item.left;
            item.element.scrollTop = item.top;
          } catch {}
        }

        const out = [...state.visuals.values()]
          .sort((a, b) => a.rowIndex - b.rowIndex || a.visualIndex - b.visualIndex);
        window.removeEventListener("message", state.handler);
        delete globalThis[registryKey];
        return out;
      }
    });
    return Array.isArray(result) ? result : [];
  };

  try {
    const [{ result: setup }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token],
      func: (registryKey, token) => {
        const old = globalThis[registryKey];
        if (old?.handler) window.removeEventListener("message", old.handler);

        const isMcpFrame = frame => {
          try {
            const url = new URL(frame.src, location.href);
            return (
              /(?:^|\.)claudemcpcontent\.com$/i.test(url.hostname) &&
              url.pathname === "/mcp_apps"
            );
          } catch {
            return false;
          }
        };

        const rows = [...new Set(
          [...document.querySelectorAll("iframe")]
            .filter(isMcpFrame)
            .map(frame => Number(frame.closest('[data-testid="transcript-row"][data-index]')?.dataset.index))
            .filter(Number.isInteger)
        )].sort((a, b) => a - b);

        const scrollPositions = [];
        const seen = new Set();
        for (const rowIndex of rows) {
          const row = document.querySelector(
            `[data-testid="transcript-row"][data-index="${rowIndex}"]`
          );
          for (let parent = row?.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (
              /(?:auto|scroll)/.test(style.overflowY) &&
              parent.scrollHeight > parent.clientHeight + 1 &&
              !seen.has(parent)
            ) {
              seen.add(parent);
              scrollPositions.push({ element: parent, left: parent.scrollLeft, top: parent.scrollTop });
            }
          }
        }
        const scrollingElement = document.scrollingElement;
        if (scrollingElement && !seen.has(scrollingElement)) {
          scrollPositions.push({
            element: scrollingElement,
            left: scrollingElement.scrollLeft,
            top: scrollingElement.scrollTop
          });
        }

        const state = {
          token,
          rows,
          visuals: new Map(),
          capturedRows: new Set(),
          scrollPositions,
          handler: null
        };

        state.handler = event => {
          const data = event?.data;
          if (
            !data ||
            data.type !== "chatgpt-export-claude-visual-v2" ||
            data.token !== token ||
            !data.svg
          ) return;

          // Resolve the current iframe and row at message time instead of using
          // setup-time element references. Claude may replace either one when a
          // dormant MCP widget rehydrates after scrolling into view.
          const frames = [...document.querySelectorAll("iframe")].filter(isMcpFrame);
          const frame = frames.find(candidate => candidate.contentWindow === event.source);
          const row = frame?.closest?.('[data-testid="transcript-row"][data-index]');
          const rowIndex = Number(row?.getAttribute("data-index"));
          if (!Number.isInteger(rowIndex)) return;

          const siblings = [...(row?.querySelectorAll("iframe") || [])].filter(isMcpFrame);
          const visualIndex = Math.max(0, siblings.indexOf(frame));
          const key = `${rowIndex}:${visualIndex}`;
          state.visuals.set(key, {
            rowIndex,
            visualIndex,
            svg: data.svg,
            width: Number(data.width) || null,
            height: Number(data.height) || null
          });
          state.capturedRows.add(rowIndex);
        };

        globalThis[registryKey] = state;
        window.addEventListener("message", state.handler);
        return { rows, expectedCount: rows.length };
      }
    });

    if (!setup?.expectedCount) return await finish();

    await captureRound();
    await new Promise(resolve => setTimeout(resolve, 100));

    // Walk missing widget rows in transcript order. Claude only activates some
    // MCP apps after the row actually enters the viewport; jumping over a row
    // (for example with Home) is not enough to initialize its SVG.
    for (const rowIndex of await missingRows()) {
      for (const delayMs of [700, 1200]) {
        if (!(await scrollRow(rowIndex, delayMs))) break;
        await captureRound();
        await new Promise(resolve => setTimeout(resolve, 120));
        if (!(await missingRows()).includes(rowIndex)) break;
      }
    }

    return await finish();
  } catch (error) {
    console.warn("chatgpt-export-md-html: robust Claude visual capture failed", error);
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        args: [CAPTURE_KEY],
        func: registryKey => {
          const state = globalThis[registryKey];
          for (const item of [...(state?.scrollPositions || [])].reverse()) {
            try {
              item.element.scrollLeft = item.left;
              item.element.scrollTop = item.top;
            } catch {}
          }
          if (state?.handler) window.removeEventListener("message", state.handler);
          delete globalThis[registryKey];
        }
      });
    } catch {}
    return [];
  }
}

export async function getClaudeConversationWithVisualsInPage(tabId, exportId = null) {
  const data = await getClaudeConversationBaseInPage(tabId, exportId);
  const captured = await captureClaudeCustomVisuals(tabId);
  const merged = mergeVisuals(data?.__customVisuals || [], captured);
  return merged.length ? { ...data, __customVisuals: merged } : data;
}
