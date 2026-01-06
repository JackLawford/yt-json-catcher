import fs from "node:fs";
import { performance } from "node:perf_hooks";

function logStep(name, t0) {
  const dt = (performance.now() - t0).toFixed(1);
  console.log(`[${dt}ms] ${name}`);
}

function findDayLoyaltyResultTable(root) {
  const results = root?.results;
  if (!Array.isArray(results)) return null;

  for (let idx = 0; idx < results.length; idx++) {
    const r = results[idx];
    const rt = r?.value?.resultTable;
    if (!rt) continue;
    const dims = (rt.dimensionColumns ?? []).map(d => d?.dimension?.type).filter(Boolean);
    if (dims.includes("DAY") && dims.includes("LOYALTY_STATE")) {
      return { rt, key: r?.key ?? `(index ${idx})` };
    }
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
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s;
}

function loyaltyKey(v) {
  if (v === "LOYALTY_STATE_NEW" || v === "NEW") return "new";
  if (v === "LOYALTY_STATE_RETURNING" || v === "RETURNING") return "returning";
  return null;
}

function csvEscape(x) {
  if (x == null) return "";
  const s = String(x);
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsvFromDayLoyaltyTable(rt, { maxDays = 90 } = {}) {
  const days = getDimValues(rt, "DAY");
  const loyalty = getDimValues(rt, "LOYALTY_STATE");
  if (!days || !loyalty || days.length !== loyalty.length) {
    throw new Error("DAY / LOYALTY_STATE dimension arrays missing or mismatched lengths");
  }

  const presentMetricTypes = (rt.metricColumns ?? [])
    .map(m => m?.metric?.type)
    .filter(Boolean);
  console.log("Metrics present in DAY+LOYALTY table:", Array.from(new Set(presentMetricTypes)));

  const impressions = metricValues(rt, "VIDEO_THUMBNAIL_IMPRESSIONS");
  const ctr = metricValues(rt, "VIDEO_THUMBNAIL_IMPRESSIONS_VTR");
  const views = metricValues(rt, "VIEWS") ?? metricValues(rt, "EXTERNAL_VIEWS");
  const avd = metricValues(rt, "AVERAGE_WATCH_TIME");
  const avp = metricValues(rt, "AVERAGE_VIEW_PERCENTAGE") ?? metricValues(rt, "AVERAGE_VIEW_PERCENTAGE_VIEWED");

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

  if (days.length > 5_000_000) {
    throw new Error(`Refusing to process: DAY array length is absurd (${days.length})`);
  }

  for (let i = 0; i < days.length; i++) {
    if (i > 0 && i % 200000 === 0) console.log(`...processed ${i}/${days.length} rows`);

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
  const selectedDays = sortedDays.slice(0, maxDays);

  const header = [
    "Day",
    "Impressions_new", "Impressions_returning",
    "Views_new", "Views_returning",
    "CTR_new", "CTR_returning",
    "AVD_new", "AVD_returning",
    "AVP_new", "AVP_returning",
  ];

  const fmt2 = (v) => (typeof v === "number" ? v.toFixed(2) : v);

  const lines = [header.join(",")];
  for (const day of selectedDays) {
    const rec = byDay.get(day);
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

const input = process.argv[2];
const output = process.argv[3] || "output.csv";

if (!input) {
  console.error("Usage: node yta_csv_cli.mjs input.json output.csv");
  process.exit(1);
}

const t0 = performance.now();
logStep("Reading file...", t0);
const raw = fs.readFileSync(input, "utf8");
logStep(`Read ${raw.length.toLocaleString()} chars`, t0);

logStep("Parsing JSON...", t0);
let root;
try {
  root = JSON.parse(raw);
} catch (e) {
  console.error("JSON.parse failed:", e);
  process.exit(1);
}
logStep("Parsed JSON", t0);

logStep("Finding DAY+LOYALTY table...", t0);
const found = findDayLoyaltyResultTable(root);
if (!found) {
  console.error("No table with DAY + LOYALTY_STATE found.");
  process.exit(1);
}
console.log("Using table key:", found.key);
logStep("Found table", t0);

logStep("Building CSV...", t0);
let csv;
try {
  csv = buildCsvFromDayLoyaltyTable(found.rt, { maxDays: 90 });
} catch (e) {
  console.error("CSV build failed:", e);
  process.exit(1);
}
logStep(`Built CSV (${csv.length.toLocaleString()} chars)`, t0);

logStep("Writing CSV...", t0);
fs.writeFileSync(output, csv, "utf8");
logStep(`Wrote ${output}`, t0);

console.log("Done.");
