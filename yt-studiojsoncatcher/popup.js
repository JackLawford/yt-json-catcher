// pulls the video ID from the current tab's URL
function extractVideoId(urlString) {
  const url = new URL(urlString);
  const requiredHost = "studio.youtube.com";
  const prefix = "/video/";

  if (url.hostname !== requiredHost) return null;
  if (!url.pathname.startsWith(prefix)) return null;

  const rest = url.pathname.slice(prefix.length);
  const id = rest.split("/")[0];
  return id || null;
}

// click handler for the export button, shoots video ID to background.js
document.getElementById("go").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const id = extractVideoId(tab.url);
  if (!id) return;

  chrome.runtime.sendMessage({ type: "OPEN_AND_PROCESS_TAB", videoId: id });
});
