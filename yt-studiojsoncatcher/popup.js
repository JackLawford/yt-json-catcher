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

document.getElementById("go").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url) return;

  const id = extractVideoId(tab.url);
  if (!id) return;

  const targetUrl = `https://studio.youtube.com/video/${encodeURIComponent(id)}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id=${encodeURIComponent(id)}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=EXTERNAL_VIEWS&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=EXTERNAL_VIEWS&o_direction=ANALYTICS_ORDER_DIRECTION_DESC`

  chrome.runtime.sendMessage({ type: "OPEN_AND_PROCESS_TAB", url: targetUrl });
});
