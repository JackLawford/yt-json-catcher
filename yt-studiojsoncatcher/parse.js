export function createAccumulator() {
  return {
    byDay: new Map()
  };
}

// merges given JSON into the 'accumulator' respective to it's job
export function mergeJoinJsonIntoAccumulator(acc, jsonString, { job }) {
  let root;
  try {
    root = JSON.parse(jsonString);
  } catch (e) {
    throw new Error("Invalid JSON for job " + job + ": " + (e?.message || e));
  }

  const rt = findDayLoyaltyResultTable(root);
  if (!rt) {
    throw new Error("No DAY+LOYALTY_STATE resultTable for job " + job);
  }

  const days = getDimValues(rt, "DAY");
  const loyalty = getDimValues(rt, "LOYALTY_STATE");
  if (!days || !loyalty || days.length !== loyalty.length) {
    throw new Error("DAY/LOYALTY_STATE dimension mismatch for job " + job);
  }

  const metricType =
    job === "views" ? ("EXTERNAL_VIEWS") :
    job === "impressions" ? ("VIDEO_THUMBNAIL_IMPRESSIONS") :
    job === "ctr" ? ("VIDEO_THUMBNAIL_IMPRESSIONS_VTR") :
    job === "avd" ? ("AVERAGE_WATCH_TIME") :
    null;

  if (!metricType) throw new Error("Unknown job: " + job);

  const metric = metricValues(rt, metricType);
  if (!metric) {
    if (job === "views") {
      const fallback = metricValues(rt, "VIEWS");
      if (!fallback) throw new Error(`Metric ${metricType} not found (and no fallback)`);
      return mergeMetric(acc, days, loyalty, fallback, job);
    }
    throw new Error(`Metric ${metricType} not found for job ${job}`);
  }

  return mergeMetric(acc, days, loyalty, metric, job);
}

// merges metric data into the accumulator
function mergeMetric(acc, days, loyalty, metricObj, job) {
  for (let i = 0; i < days.length; i++) {
    const dayIso = dayIdToIso(days[i]);
    const lk = loyaltyKey(loyalty[i]);
    if (!lk) continue;

    const rec = ensureDay(acc.byDay, dayIso)[lk];
    const v = at(metricObj, i);
    if (v == null) continue;

    if (job === "views") rec.views = v;
    else if (job === "impressions") rec.imps = v;
    else if (job === "ctr") rec.ctr = v;
    else if (job === "avd") rec.avd = v;
  }
}

// converts the contents of the accumulator to a CSV
export function accumulatorToCsv(acc, { maxDays = 90 } = {}) {
  const header = [
    "Day",
    "Impressions_new", "Impressions_returning",
    "Views_new", "Views_returning",
    "CTR_new", "CTR_returning",
    "AVD_new", "AVD_returning",
  ];

  const days = Array.from(acc.byDay.keys()).sort();
  const firstDays = days.slice(0, maxDays);


  const lines = [header.join(",")];

  for (const day of firstDays) {
    const rec = acc.byDay.get(day);
    const fmt2 = (x) => (typeof x === "number" ? x.toFixed(2) : "");

    lines.push([
      day,
      csvEscape(rec.new.imps), csvEscape(rec.returning.imps),
      csvEscape(rec.new.views), csvEscape(rec.returning.views),
      csvEscape(fmt2(rec.new.ctr)), csvEscape(fmt2(rec.returning.ctr)),
      csvEscape(fmt2(rec.new.avd)), csvEscape(fmt2(rec.returning.avd)),
    ].join(","));
  }

  return lines.join("\n");
}

// Helper functions
function findDayLoyaltyResultTable(root) {
  const results = root?.results;
  if (!Array.isArray(results)) return null;

  for (const r of results) {
    const rt = r?.value?.resultTable;
    if (!rt) continue;
    const dims = (rt.dimensionColumns ?? []).map(d => d?.dimension?.type).filter(Boolean);
    if (dims.includes("DAY") && dims.includes("LOYALTY_STATE")) return rt;
  }
  return null;
}

function getDimValues(rt, dimType) {
  const col = (rt.dimensionColumns ?? []).find(d => d?.dimension?.type === dimType);
  if (!col) return null;

  if (col.dateIds?.values) return col.dateIds.values;
  if (col.enumValues?.values) return col.enumValues.values;
  return null;
}

function pickMetricColumn(rt, metricType) {
  const cols = (rt.metricColumns ?? []).filter(c => c?.metric?.type === metricType);
  if (!cols.length) return null;

  const real = cols.find(c => c?.metric?.asPercentagesOfTotal === false);
  return real ?? cols[0];
}

function metricValues(rt, metricType) {
  const col = pickMetricColumn(rt, metricType);
  if (!col) return null;

  if (col.counts?.values) return { kind: "count", values: col.counts.values };
  if (col.milliseconds?.values) return { kind: "ms", values: col.milliseconds.values };
  if (col.percentages?.values) return { kind: "pct", values: col.percentages.values };
  return null;
}

function at(metricObj, i) {
  if (!metricObj) return null;
  const v = metricObj.values?.[i];
  if (v == null) return null;
  if (metricObj.kind === "ms") return v / 1000;
  return v;
}

function dayIdToIso(dayId) {
  const s = String(dayId);
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

function loyaltyKey(v) {
  if (v === "LOYALTY_STATE_NEW" || v === "NEW") return "new";
  if (v === "LOYALTY_STATE_RETURNING" || v === "RETURNING") return "returning";
  return null;
}

function ensureDay(byDay, dayIso) {
  if (!byDay.has(dayIso)) {
    byDay.set(dayIso, {
      new: { views: "", imps: "", ctr: "", avd: "" },
      returning: { views: "", imps: "", ctr: "", avd: "" }
    });
  }
  return byDay.get(dayIso);
}

function csvEscape(x) {
  if (x == null || x === "") return "";
  const s = String(x);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
