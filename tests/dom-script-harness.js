import { readFileSync } from "node:fs";
import { vi } from "vitest";

class PassiveMutationObserver {
  constructor(callback) {
    this.callback = callback;
  }

  observe() {}
  disconnect() {}
  takeRecords() { return []; }
}

export function loadBrowserScript(path, {
  html = "",
  title = "DOM test – ChatGPT",
  url = "/c/test-conversation"
} = {}) {
  document.head.innerHTML = "<title></title>";
  document.title = title;
  document.body.innerHTML = html;
  window.history.replaceState({}, "", url);

  const listeners = [];
  const sentMessages = [];
  const runtimeSendMessage = vi.fn(async message => {
    sentMessages.push(message);
    return {};
  });

  const chromeMock = {
    i18n: {
      getMessage: key => key
    },
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      },
      sendMessage: runtimeSendMessage
    }
  };

  globalThis.chrome = chromeMock;
  window.chrome = chromeMock;

  const requestAnimationFrame = callback => {
    callback(0);
    return 1;
  };

  globalThis.requestAnimationFrame = requestAnimationFrame;
  window.requestAnimationFrame = requestAnimationFrame;

  const source = readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const execute = new Function(
    "window",
    "document",
    "chrome",
    "Node",
    "MutationObserver",
    "requestAnimationFrame",
    "getComputedStyle",
    "location",
    source
  );

  execute(
    window,
    document,
    chromeMock,
    window.Node,
    PassiveMutationObserver,
    requestAnimationFrame,
    window.getComputedStyle.bind(window),
    window.location
  );

  const dispatch = message => {
    let response;
    let responded = false;

    for (const listener of listeners) {
      listener(message, {}, value => {
        response = value;
        responded = true;
      });
      if (responded) break;
    }

    return response;
  };

  return {
    chrome: chromeMock,
    dispatch,
    listeners,
    sentMessages
  };
}
