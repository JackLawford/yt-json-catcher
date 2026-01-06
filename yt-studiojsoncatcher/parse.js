export function ytaJsonStringToCsv(jsonString, { maxDays = 90 } = {}) {
  let root;
  try {
    root = JSON.parse(jsonString);
  } catch (e) {
    throw new Error("msg.body was not valid JSON: " + (e?.message || e));
  }

  const rt = findDayLoyaltyResultTable(root);
  if (!rt) {
    throw new Error("Could not find a resultTable with DAY + LOYALTY_STATE dimensions in results[]");
  }

  return buildCsvFromDayLoyaltyTable(rt, { maxDays });
}

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

function dayIdToIso(dayId) {
  const s = String(dayId);
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

function loyaltyKey(v) {
  if (v === "LOYALTY_STATE_NEW") return "new";
  if (v === "LOYALTY_STATE_RETURNING") return "returning";
  if (v === "NEW") return "new";
  if (v === "RETURNING") return "returning";
  return null;
}

function csvEscape(x) {
  if (x == null) return "";
  const s = String(x);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsvFromDayLoyaltyTable(rt, { maxDays }) {
  const days = getDimValues(rt, "DAY");
  const loyalty = getDimValues(rt, "LOYALTY_STATE");
  if (!days || !loyalty || days.length !== loyalty.length) {
    throw new Error("DAY / LOYALTY_STATE dimension arrays missing or mismatched lengths");
  }

  const impressions = metricValues(rt, "VIDEO_THUMBNAIL_IMPRESSIONS");
  const ctr = metricValues(rt, "VIDEO_THUMBNAIL_IMPRESSIONS_VTR");

  const views = metricValues(rt, "VIEWS") ?? metricValues(rt, "EXTERNAL_VIEWS");

  const avd = metricValues(rt, "AVERAGE_WATCH_TIME");

  const avp =
    metricValues(rt, "AVERAGE_VIEW_PERCENTAGE") ??
    metricValues(rt, "AVERAGE_VIEW_PERCENTAGE_VIEWED");

  const byDay = new Map();

  function ensureDay(dayIso) {
    if (!byDay.has(dayIso)) {
      byDay.set(dayIso, {
        new: { impressions: "", views: "", ctr: "", avd: "", avp: "" },
        returning: { impressions: "", views: "", ctr: "", avd: "", avp: "" },
      });
    }
    return byDay.get(dayIso);
  }

  function at(metricObj, i) {
    if (!metricObj) return null;
    const v = metricObj.values?.[i];
    if (v == null) return null;
    if (metricObj.kind === "ms") return v / 1000;
    return v;
  }

  for (let i = 0; i < days.length; i++) {
    const dayIso = dayIdToIso(days[i]);
    const lk = loyaltyKey(loyalty[i]);
    if (!lk) continue;

    const row = ensureDay(dayIso)[lk];

    const imps = at(impressions, i);
    const vws = at(views, i);
    const c = at(ctr, i);
    const d = at(avd, i);
    const p = at(avp, i);

    if (imps != null) row.impressions = imps;
    if (vws != null) row.views = vws;

    if (c != null) row.ctr = c;
    else if (imps != null && vws != null && imps !== 0) row.ctr = (vws / imps) * 100;

    if (d != null) row.avd = d;
    if (p != null) row.avp = p;
  }

  const sortedDays = Array.from(byDay.keys()).sort();
  const lastDays = sortedDays.slice(Math.max(0, sortedDays.length - maxDays));

  const header = [
    "Day",
    "Impressions_new", "Impressions_returning",
    "Views_new", "Views_returning",
    "CTR_new", "CTR_returning",
    "AVD_new", "AVD_returning",
    "AVP_new", "AVP_returning",
  ];

  const lines = [header.join(",")];

  for (const day of lastDays) {
    const rec = byDay.get(day);

    const fmt2 = (v) => (typeof v === "number" ? v.toFixed(2) : v);

    lines.push([
      day,
      csvEscape(rec.new.impressions),
      csvEscape(rec.returning.impressions),
      csvEscape(rec.new.views),
      csvEscape(rec.returning.views),
      csvEscape(fmt2(rec.new.ctr)),
      csvEscape(fmt2(rec.returning.ctr)),
      csvEscape(fmt2(rec.new.avd)),
      csvEscape(fmt2(rec.returning.avd)),
      csvEscape(fmt2(rec.new.avp)),
      csvEscape(fmt2(rec.returning.avp)),
    ].join(","));
  }

  return lines.join("\n");
}
