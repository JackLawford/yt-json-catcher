import { createAccumulator, mergeJoinJsonIntoAccumulator, accumulatorToCsv } from "./parse.js";

let enabled = false;

const exportTabs = new Set();
const downloadToTab = new Map();
const tabToSession = new Map();

const sessions = new Map();

async function ensureHook(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: () => {
        if (window.__YTA_JOIN_EXPORTER_INSTALLED__) return;
        window.__YTA_JOIN_EXPORTER_INSTALLED__ = true;

        const TARGET = "/youtubei/v1/yta_web/join?alt=json";

        const origFetch = window.fetch;
        if (typeof origFetch === "function") {
          window.fetch = async (...args) => {
            const res = await origFetch(...args);
            try {
              const url =
                typeof args[0] === "string"
                  ? args[0]
                  : (args[0] && args[0].url) || "";

              if (String(url).includes(TARGET)) {
                const text = await res.clone().text();
                window.postMessage({ type: "YTA_JOIN_CAPTURED", url, body: text }, "*");
              }
            } catch (_) {}
            return res;
          };
        }

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
                  window.postMessage({ type: "YTA_JOIN_CAPTURED", url, body: xhr.responseText }, "*");
                }
              } catch (_) {}
            });

            return xhr;
          }
          window.XMLHttpRequest = PatchedXHR;
        }
      }
    });
  } catch (e) {}
}

function getUrl(videoId, job) {
  if (job === "views") {
    return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(videoId)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=EXTERNAL_VIEWS&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=EXTERNAL_VIEWS&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`;
  }
  if (job === "impressions") {
    return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(videoId)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=VIDEO_THUMBNAIL_IMPRESSIONS&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=VIDEO_THUMBNAIL_IMPRESSIONS&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`;
  }
  if (job === "ctr") {
    return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(videoId)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`;
  }
  if (job === "avd") {
    return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(videoId)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=AVERAGE_WATCH_TIME&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=AVERAGE_WATCH_TIME&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`;
  }
  throw new Error("Unknown job: " + job);
}

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

async function openJobTab(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;

  const job = s.jobs[s.idx];
  const url = getUrl(s.videoId, job);

  const tab = await chrome.tabs.create({ url, active: false });
  if (!tab?.id) return;

  s.tabId = tab.id;
  s.capturedThisPage = false;

  exportTabs.add(tab.id);
  tabToSession.set(tab.id, sessionId);

  await ensureBridge(tab.id);
  await ensureHook(tab.id);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "OPEN_AND_PROCESS_TAB") return;

  enabled = true;

  const videoId = msg.videoId;
  if (!videoId) return;

  const jobs = ["views", "impressions", "ctr", "avd"];

  const sessionId =
    (crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(16).slice(2)}`);

  sessions.set(sessionId, {
    videoId,
    jobs,
    idx: 0,
    capturedThisPage: false,
    tabId: null,
    acc: createAccumulator()
  });

  openJobTab(sessionId).catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!enabled) return;
  if (!exportTabs.has(tabId)) return;
  if (!tab?.url?.startsWith("https://studio.youtube.com/")) return;

  if (changeInfo.status === "loading" || changeInfo.status === "complete") {
    ensureBridge(tabId);
    ensureHook(tabId);

  const sessionId = tabToSession.get(tabId);
  const s = sessionId ? sessions.get(sessionId) : null;
  if (s) s.capturedThisPage = false;
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "DOWNLOAD_JSON") return;

  const tabId = msg.originTabId;

  const sessionId = tabToSession.get(tabId);
  const s = sessionId ? sessions.get(sessionId) : null;
  if (!s) return;

  if (s.capturedThisPage) return;
  s.capturedThisPage = true;

  const job = s.jobs[s.idx];

  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonFilename = `yta/${s.videoId}/${String(s.idx + 1).padStart(2, "0")}_${job}_${ts}.json`;
  const jsonUrl = "data:application/json;charset=utf-8," + encodeURIComponent(msg.body);

  chrome.downloads
    .download({ url: jsonUrl, filename: jsonFilename, saveAs: false, conflictAction: "uniquify" })
    .then((downloadId) => downloadToTab.set(downloadId, tabId))
    .catch(() => {});

  try {
    mergeJoinJsonIntoAccumulator(s.acc, msg.body, { job });
  } catch (e) {
    console.warn("[YTA] merge failed", { job, err: String(e?.message || e) });
  }

  s.idx++;

  exportTabs.delete(tabId);
  tabToSession.delete(tabId);
  chrome.tabs.remove(tabId).catch(() => {});

  if (s.idx >= s.jobs.length) {
    try {
      const csv = accumulatorToCsv(s.acc, { maxDays: 90 });

      const csvTs = new Date().toISOString().replace(/[:.]/g, "-");
      const csvFilename = `yta/${s.videoId}/00_merged_${csvTs}.csv`;
      const csvUrl = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);

      chrome.downloads
        .download({ url: csvUrl, filename: csvFilename, saveAs: false, conflictAction: "uniquify" })
        .catch(() => {});
    } catch (e) {
      console.warn("[YTA] CSV build failed", String(e?.message || e));
    }

    sessions.delete(sessionId);
    return;
  }

  openJobTab(sessionId).catch(() => {});
});


