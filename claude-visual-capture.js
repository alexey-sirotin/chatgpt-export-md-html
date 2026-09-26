import { getClaudeConversationInPage as getClaudeConversationBaseInPage } from "./claude-api.js";

const CAPTURE_KEY = "__chatgptExportClaudeVisualCaptureV3";
const SHOW_WIDGET_TOOL = "visualize:show_widget";

function activeBranchMessages(data) {
  const byId = new Map((data?.chat_messages || []).map(message => [message.uuid, message]));
  const messages = [];
  const seen = new Set();
  let id = data?.current_leaf_message_uuid || "";

  while (id && !seen.has(id)) {
    seen.add(id);
    const message = byId.get(id);
    if (!message) break;
    messages.push(message);

    const parent = message.parent_message_uuid;
    if (!parent || parent === "00000000-0000-4000-8000-000000000000") break;
    id = parent;
  }

  return messages.reverse();
}

export function claudeCustomVisualTargets(data) {
  return activeBranchMessages(data)
    .map((message, rowIndex) => {
      const blocks = Array.isArray(message?.content) ? message.content : [];
      const toolUses = blocks.filter(block =>
        block?.type === "tool_use" &&
        block?.name === SHOW_WIDGET_TOOL &&
        block?.is_mcp_app !== false
      ).length;
      const toolResults = blocks.filter(block =>
        block?.type === "tool_result" && block?.name === SHOW_WIDGET_TOOL
      ).length;
      const count = toolUses || toolResults;
      return count > 0 ? { rowIndex, count } : null;
    })
    .filter(Boolean);
}

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

async function captureClaudeCustomVisuals(tabId, targets) {
  if (!targets.length) return [];
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
          type: "chatgpt-export-claude-visual-v3",
          token,
          svg: new XMLSerializer().serializeToString(clone),
          width: source.rect.width,
          height: source.rect.height
        }, "*");
        return true;
      }
    });
  };

  const missingRows = async () => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token],
      func: (registryKey, token) => {
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return [];

        return state.targets
          .filter(target => {
            let count = 0;
            for (const visual of state.visuals.values()) {
              if (visual.rowIndex === target.rowIndex) count++;
            }
            return count < target.count;
          })
          .map(target => target.rowIndex);
      }
    });
    return Array.isArray(result) ? result : [];
  };

  const bringRowIntoView = async (rowIndex, settleMs) => {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      args: [CAPTURE_KEY, token, rowIndex, settleMs],
      func: async (registryKey, token, rowIndex, settleMs) => {
        const state = globalThis[registryKey];
        if (!state || state.token !== token) return false;

        const selector = `[data-testid="transcript-row"][data-index="${rowIndex}"]`;
        const mountedRows = () => [...document.querySelectorAll('[data-testid="transcript-row"][data-index]')]
          .map(row => ({ row, index: Number(row.getAttribute("data-index")) }))
          .filter(item => Number.isInteger(item.index))
          .sort((a, b) => a.index - b.index);

        const scrollingAncestor = element => {
          for (let parent = element?.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (
              /(?:auto|scroll)/.test(style.overflowY) &&
              parent.scrollHeight > parent.clientHeight + 1
            ) return parent;
          }
          return document.scrollingElement;
        };

        const waitFrame = () => new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );

        for (let attempt = 0; attempt < 100; attempt++) {
          const row = document.querySelector(selector);
          if (row) {
            row.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
            await waitFrame();
            await new Promise(resolve => setTimeout(resolve, settleMs));
            return true;
          }

          const rows = mountedRows();
          if (!rows.length) return false;

          const first = rows[0];
          const last = rows[rows.length - 1];
          let direction;
          let anchor;
          if (rowIndex < first.index) {
            direction = -1;
            anchor = first;
          } else if (rowIndex > last.index) {
            direction = 1;
            anchor = last;
          } else {
            anchor = rows.reduce((best, item) =>
              Math.abs(item.index - rowIndex) < Math.abs(best.index - rowIndex) ? item : best
            , rows[0]);
            direction = rowIndex < anchor.index ? -1 : 1;
          }

          const scroller = scrollingAncestor(anchor.row);
          if (!scroller) return false;

          const viewport = scroller === document.scrollingElement
            ? window.innerHeight
            : scroller.clientHeight;
          const step = Math.max(450, Math.round(viewport * 1.6));
          const before = scroller.scrollTop;
          scroller.scrollTop = before + direction * step;

          if (scroller.scrollTop === before) {
            anchor.row.scrollIntoView({
              block: direction < 0 ? "start" : "end",
              inline: "nearest",
              behavior: "auto"
            });
          }

          await waitFrame();
          await new Promise(resolve => setTimeout(resolve, 90));
        }

        return false;
      }
    });
    return result === true;
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
        try {
          window.scrollTo(state.windowPosition.left, state.windowPosition.top);
        } catch {}

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
      args: [CAPTURE_KEY, token, targets],
      func: (registryKey, token, targets) => {
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

        const scrollPositions = [];
        const seen = new Set();
        const mounted = [...document.querySelectorAll('[data-testid="transcript-row"][data-index]')];
        for (const row of mounted) {
          for (let parent = row.parentElement; parent; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            if (
              /(?:auto|scroll)/.test(style.overflowY) &&
              parent.scrollHeight > parent.clientHeight + 1 &&
              !seen.has(parent)
            ) {
              seen.add(parent);
              scrollPositions.push({
                element: parent,
                left: parent.scrollLeft,
                top: parent.scrollTop
              });
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
          targets,
          visuals: new Map(),
          scrollPositions,
          windowPosition: { left: window.scrollX, top: window.scrollY },
          handler: null
        };

        state.handler = event => {
          const data = event?.data;
          if (
            !data ||
            data.type !== "chatgpt-export-claude-visual-v3" ||
            data.token !== token ||
            !data.svg
          ) return;

          const frames = [...document.querySelectorAll("iframe")].filter(isMcpFrame);
          const frame = frames.find(candidate => candidate.contentWindow === event.source);
          const row = frame?.closest?.('[data-testid="transcript-row"][data-index]');
          const rowIndex = Number(row?.getAttribute("data-index"));
          if (!Number.isInteger(rowIndex)) return;
          if (!state.targets.some(target => target.rowIndex === rowIndex)) return;

          const siblings = [...(row?.querySelectorAll("iframe") || [])].filter(isMcpFrame);
          const visualIndex = Math.max(0, siblings.indexOf(frame));
          state.visuals.set(`${rowIndex}:${visualIndex}`, {
            rowIndex,
            visualIndex,
            svg: data.svg,
            width: Number(data.width) || null,
            height: Number(data.height) || null
          });
        };

        globalThis[registryKey] = state;
        window.addEventListener("message", state.handler);
        return { expectedCount: targets.reduce((sum, target) => sum + target.count, 0) };
      }
    });

    if (!setup?.expectedCount) return await finish();

    await captureRound();
    await new Promise(resolve => setTimeout(resolve, 120));

    for (const rowIndex of await missingRows()) {
      for (const settleMs of [800, 1400]) {
        if (!(await bringRowIntoView(rowIndex, settleMs))) break;
        await captureRound();
        await new Promise(resolve => setTimeout(resolve, 150));
        if (!(await missingRows()).includes(rowIndex)) break;
      }
    }

    return await finish();
  } catch (error) {
    console.warn("chatgpt-export-md-html: Claude visual capture failed", error);
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
  const targets = claudeCustomVisualTargets(data);
  const captured = await captureClaudeCustomVisuals(tabId, targets);
  const merged = mergeVisuals(data?.__customVisuals || [], captured);
  return merged.length ? { ...data, __customVisuals: merged } : data;
}
