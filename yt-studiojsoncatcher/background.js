import { createAccumulator, mergeJoinJsonIntoAccumulator, accumulatorToCsv } from "./parse.js";

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby3hubagpkrzUFppEIBpVY-h3kr6sGpsyPX8nLBpxRzi-AcNzMXArx4GkLl7s2npJYc/exec";

let enabled = false;

const exportTabs = new Set();
const tabToSession = new Map();

const sessions = new Map();

// ensures that the hook script is injected into the specified tab.
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

// returns the correct url for the given videoId and job.
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
  if (job === "avp") {
    return `https://studio.youtube.com/video/${encodeURIComponent(videoId)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(videoId)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=AVERAGE_WATCH_PERCENTAGE&granularity=DAY&t_metrics=AVERAGE_WATCH_PERCENTAGE&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=AVERAGE_WATCH_PERCENTAGE&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`
  }
  throw new Error("Unknown job: " + job);
}

// ensures that the bridge script is injected into the specified tab.
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

// message handler to start processing
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "OPEN_AND_PROCESS_TAB") return;

  enabled = true;

  const videoId = msg.videoId;
  if (!videoId) return;

  const jobs = ["views", "impressions", "ctr", "avd", "avp"];

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

// message handler to receive captured JSON and send to accumulator, later export as CSV
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== "DOWNLOAD_JSON") return;

  const tabId = msg.originTabId;

  const sessionId = tabToSession.get(tabId);
  const s = sessionId ? sessions.get(sessionId) : null;
  if (!s) return;

  if (s.capturedThisPage) return;
  s.capturedThisPage = true;

  const job = s.jobs[s.idx];

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
    (async () => {
      try {
        const csv = accumulatorToCsv(s.acc, { maxDays: 90 });

        const payload = JSON.stringify({
          videoId: s.videoId,
          csv
        });

        const res = await fetch(APPS_SCRIPT_URL, {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=utf-8" },
          body: payload,
          redirect: "follow"
        });

        const text = await res.text().catch(() => "");
        console.log("[SW] CSV POST response:", res.status, text);

        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text}`);
      } catch (e) {
        console.warn("[SW] CSV POST failed:", e);
      } finally {
        sessions.delete(sessionId);
      }
    })();

    return;
  }

  openJobTab(sessionId).catch(() => {});
});
