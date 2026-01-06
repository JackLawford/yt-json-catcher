import { ytaJsonStringToCsv } from './parse.js';

let enabled = false;

const exportTabs = new Set();
const downloadToTab = new Map();


async function ensureHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        if (window.__YTA_JOIN_EXPORTER_INSTALLED__) return;
        window.__YTA_JOIN_EXPORTER_INSTALLED__ = true;

        const TARGET = "/youtubei/v1/yta_web/join?alt=json";

        // fetch hook
        const origFetch = window.fetch;
        if (typeof origFetch === "function") {
          window.fetch = async (...args) => {
            const res = await origFetch(...args);

            try {
              const url =
                typeof args[0] === "string"
                  ? args[0]
                  : (args[0] && args[0].url) || "";

              if (url.includes(TARGET)) {
                const text = await res.clone().text();
                window.postMessage(
                  { type: "YTA_JOIN_CAPTURED", url, body: text },
                  "*"
                );
              }
            } catch (_) {}

            return res;
          };
        }

        // XHR hook
        const OrigXHR = window.XMLHttpRequest;
        if (OrigXHR) {
          function PatchedXHR() {
            const xhr = new OrigXHR();
            let url = "";

            const origOpen = xhr.open;
            xhr.open = function (method, u, ...rest) {
              url = u;
              return origOpen.call(this, method, u, ...rest);
            };

            xhr.addEventListener("loadend", () => {
              try {
                if (String(url).includes(TARGET)) {
                  window.postMessage(
                    { type: "YTA_JOIN_CAPTURED", url, body: xhr.responseText },
                    "*"
                  );
                }
              } catch (_) {}
            });

            return xhr;
          }
          window.XMLHttpRequest = PatchedXHR;
        }
      }
    });
  } catch (e) {
  }
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== "OPEN_AND_PROCESS_TAB") return;

  enabled = true;

  chrome.tabs.create({ url: msg.url, active: false }).then((tab) => {
    if (!tab.id) return;

    exportTabs.add(tab.id);

    ensureBridge(tab.id);
    ensureHook(tab.id);
  });
});

// earlier injection
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!enabled) return;
  if (!tab?.url?.startsWith("https://studio.youtube.com/")) return;

  if (changeInfo.status === "loading") {
    ensureBridge(tabId);
    ensureHook(tabId);
  }

  if (changeInfo.status === "complete") {
    ensureBridge(tabId);
    ensureHook(tabId);
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.id) return;

  const tabId = downloadToTab.get(delta.id);
  if (tabId == null) return;

  if (delta.state?.current === "complete") {
    exportTabs.delete(tabId);
    chrome.tabs.remove(tabId).catch(() => {});
    downloadToTab.delete(delta.id);
  }

  if (delta.state?.current === "interrupted") {
    cleanupAndClose(tabId);
    downloadToTab.delete(delta.id);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
});

async function ensureBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    args: [tabId],
    func: (originTabId) => {
      if (window.__YTA_JOIN_EXPORTER_BRIDGE__) return;
      window.__YTA_JOIN_EXPORTER_BRIDGE__ = true;

      window.addEventListener("message", (evt) => {
        if (evt.source !== window) return;
        const msg = evt.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "YTA_JOIN_CAPTURED") {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_JSON",
            originTabId,
            url: msg.url,
            body: msg.body
          });
        }
      });
    }
  });
}

// ship it
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3hubagpkrzUFppEIBpVY-h3kr6sGpsyPX8nLBpxRzi-AcNzMXArx4GkLl7s2npJYc/exec";

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "DOWNLOAD_JSON") return;

  (async () => {
    try {
      var truncate = msg.body.slice(0, 50000);

      const payload = truncate;
      //const csv = ytaJsonStringToCsv(payload, { maxDays: 90 });

      const res = await fetch(APPS_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: payload,
        redirect: "follow"
      });

      const text = await res.text().catch(() => "");
      console.log("[SW] POST_TEST response:", res.status, text);

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
    } catch (e) {
      console.warn("[SW] POST_TEST failed:", e);
    }
  })();
});