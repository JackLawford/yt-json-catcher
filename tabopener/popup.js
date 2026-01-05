function parseIds(raw) {
  return raw
    .split(/[\s,]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function buildUrl(template, id) {
  return template.replaceAll("{id}", encodeURIComponent(id));
}

async function openTabs(urls) {
  for (const url of urls) {
    await chrome.tabs.create({ url, active: false });
  }
}

document.getElementById("open").addEventListener("click", async () => {
  const template = "https://studio.youtube.com/video/{id}/analytics/tab-overview/period-default/explore?entity_type=VIDEO&entity_id={id}&time_period=lifetime&explore_type=TABLE_AND_CHART&metrics_computation_type=DELTA&metric=EXTERNAL_VIEWS&granularity=DAY&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&t_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&t_metrics=EXTERNAL_VIEWS&t_metrics=EXTERNAL_WATCH_TIME&t_metrics=AVERAGE_WATCH_TIME&v_metrics=EXTERNAL_VIEWS&v_metrics=EXTERNAL_WATCH_TIME&v_metrics=SUBSCRIBERS_NET_CHANGE&v_metrics=TOTAL_ESTIMATED_EARNINGS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS&v_metrics=VIDEO_THUMBNAIL_IMPRESSIONS_VTR&dimension=LOYALTY_STATE&o_column=EXTERNAL_VIEWS&o_direction=ANALYTICS_ORDER_DIRECTION_DESC"
  const rawIds = document.getElementById("ids").value;
  const ids = parseIds(rawIds);

  if (ids.length === 0) {
    alert("Gotta input video IDs first");
    return;
  }

  const seen = new Set();
  const uniqueIds = ids.filter(id => (seen.has(id) ? false : (seen.add(id), true)));

  const urls = uniqueIds.map(id => buildUrl(template, id));

  await openTabs(urls);
  window.close();
});
