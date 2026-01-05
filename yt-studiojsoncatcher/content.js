// inject hook into the page the fetch
const s = document.createElement("script");
s.src = chrome.runtime.getURL("hook.js");
s.onload = () => s.remove();
(document.head || document.documentElement).appendChild(s);

// receive captured payloads from the page
window.addEventListener("message", (evt) => {
  if (evt.source !== window) return;
  const msg = evt.data;
  if (!msg || msg.type !== "YTA_JOIN_CAPTURED") return;

  // forward to background for download
  chrome.runtime.sendMessage({
    type: "DOWNLOAD_JSON",
    url: msg.url,
    body: msg.body
  });
});
