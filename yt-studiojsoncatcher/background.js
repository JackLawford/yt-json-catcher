let enabled = true;

// inject hook
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

// inject when youtube studio is loaded
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!enabled) return;
  if (changeInfo.status !== "complete") return;
  if (!tab?.url?.startsWith("https://studio.youtube.com/")) return;
  ensureHook(tabId);
});

// toggleable via toolbar button
chrome.action.onClicked.addListener(async (tab) => {
  enabled = !enabled;
  if (enabled && tab?.id && tab.url?.startsWith("https://studio.youtube.com/")) {
    await ensureHook(tab.id);
  }
});

chrome.runtime.onInstalled.addListener(async () => {
});

// bridge listener added once per tab
async function ensureBridge(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "ISOLATED",
    func: () => {
      if (window.__YTA_JOIN_EXPORTER_BRIDGE__) return;
      window.__YTA_JOIN_EXPORTER_BRIDGE__ = true;

      window.addEventListener("message", (evt) => {
        if (evt.source !== window) return;
        const msg = evt.data;
        if (!msg || typeof msg !== "object") return;

        if (msg.type === "YTA_JOIN_CAPTURED") {
          chrome.runtime.sendMessage({
            type: "DOWNLOAD_JSON",
            url: msg.url,
            body: msg.body
          });
        }
      });
    }
  });
}

// bridge + hook must be together when studio loads
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!enabled) return;
  if (changeInfo.status !== "complete") return;
  if (!tab?.url?.startsWith("https://studio.youtube.com/")) return;
  ensureBridge(tabId);
  ensureHook(tabId);
});

// download it
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "DOWNLOAD_JSON") return;

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `yta_web_join_${ts}.json`;

  const dataUrl =
    "data:application/json;charset=utf-8," + encodeURIComponent(msg.body);

  chrome.downloads.download({
    url: dataUrl,
    filename,
    saveAs: false
  });
});
