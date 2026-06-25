/**
 * app.js — render dashboard status dari data/status.json
 * Tidak perlu build step; fetch langsung file JSON yang sama-sama
 * di-host oleh GitHub Pages (di-update oleh GitHub Actions cron).
 */

const STATUS_URL = "data/status.json";
const REFRESH_INTERVAL_MS = 60 * 1000; // refresh tampilan tiap 1 menit

function timeAgo(isoString) {
  if (!isoString) return "belum pernah dicek";
  const diffMs = Date.now() - new Date(isoString).getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s lalu`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}j lalu`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}h lalu`;
}

function buildHeartbeat(history) {
  const wrap = document.createElement("div");
  wrap.className = "heartbeat";
  wrap.setAttribute("aria-hidden", "true");

  const slots = 24;
  const padded = Array(Math.max(0, slots - history.length)).fill(null).concat(history);
  const recent = padded.slice(-slots);

  for (const entry of recent) {
    const bar = document.createElement("span");
    bar.className = "heartbeat__bar";
    if (entry) {
      bar.dataset.up = String(entry.up);
      bar.title = `${entry.t} — ${entry.up ? "normal" : "bermasalah"}${entry.latencyMs ? " · " + entry.latencyMs + "ms" : ""}`;
    }
    wrap.appendChild(bar);
  }
  return wrap;
}

function buildRow(site) {
  const row = document.createElement("div");
  row.className = "row";

  const state = site.up === true ? "up" : site.up === false ? "down" : "unknown";

  const dotWrap = document.createElement("div");
  dotWrap.className = "row__dot-wrap";
  const dot = document.createElement("span");
  dot.className = `dot row__dot dot--${state}`;
  dotWrap.appendChild(dot);

  const info = document.createElement("div");
  info.className = "row__info";

  const nameRow = document.createElement("div");
  nameRow.className = "row__name";
  const nameText = document.createElement("span");
  nameText.textContent = site.name;
  const badge = document.createElement("span");
  badge.className = `row__badge row__badge--${state}`;
  badge.textContent = state === "up" ? "Normal" : state === "down" ? "Bermasalah" : "Belum ada data";
  nameRow.appendChild(nameText);
  nameRow.appendChild(badge);

  const urlLine = document.createElement("a");
  urlLine.className = "row__url";
  urlLine.href = site.url;
  urlLine.target = "_blank";
  urlLine.rel = "noopener";
  urlLine.textContent = site.url.replace(/^https?:\/\//, "");

  info.appendChild(nameRow);
  info.appendChild(urlLine);

  const right = document.createElement("div");
  right.className = "row__right";

  const latency = document.createElement("div");
  latency.className = "row__latency";
  latency.textContent = site.latencyMs != null ? `${site.latencyMs}ms` : "—";

  const heartbeat = buildHeartbeat(site.history || []);

  right.appendChild(heartbeat);
  right.appendChild(latency);

  row.appendChild(dotWrap);
  row.appendChild(info);
  row.appendChild(right);

  return row;
}

function render(statusData) {
  const groupsEl = document.getElementById("groups");
  const sites = Object.values(statusData.sites || {});

  if (sites.length === 0) {
    groupsEl.innerHTML = "";
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "Belum ada data status. Menunggu pengecekan pertama dari GitHub Actions...";
    groupsEl.appendChild(empty);
    updateGlobalSummary([]);
    return;
  }

  // Group by site.group
  const groups = {};
  for (const site of sites) {
    const g = site.group || "Lainnya";
    if (!groups[g]) groups[g] = [];
    groups[g].push(site);
  }

  groupsEl.innerHTML = "";
  for (const [groupName, groupSites] of Object.entries(groups)) {
    const section = document.createElement("div");
    section.className = "group";

    const label = document.createElement("p");
    label.className = "group__label";
    label.textContent = groupName;

    const rows = document.createElement("div");
    rows.className = "group__rows";
    for (const site of groupSites.sort((a, b) => a.name.localeCompare(b.name))) {
      rows.appendChild(buildRow(site));
    }

    section.appendChild(label);
    section.appendChild(rows);
    groupsEl.appendChild(section);
  }

  updateGlobalSummary(sites);

  const lastChecked = document.getElementById("lastChecked");
  lastChecked.textContent = statusData.lastCheckedAt
    ? `diperbarui ${timeAgo(statusData.lastCheckedAt)}`
    : "belum pernah dicek";
}

function updateGlobalSummary(sites) {
  const summaryEl = document.getElementById("globalSummary");
  const dotEl = document.getElementById("globalDot");

  if (sites.length === 0) {
    summaryEl.textContent = "belum ada data";
    dotEl.dataset.state = "unknown";
    return;
  }

  const downCount = sites.filter((s) => s.up === false).length;
  if (downCount === 0) {
    summaryEl.textContent = `Semua ${sites.length} layanan normal`;
    dotEl.dataset.state = "up";
  } else {
    summaryEl.textContent = `${downCount} dari ${sites.length} layanan bermasalah`;
    dotEl.dataset.state = "down";
  }
}

async function loadStatus() {
  try {
    const res = await fetch(`${STATUS_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    render(data);
  } catch (err) {
    console.error("Gagal memuat status:", err);
    const summaryEl = document.getElementById("globalSummary");
    summaryEl.textContent = "gagal memuat data status";
  }
}

loadStatus();
setInterval(loadStatus, REFRESH_INTERVAL_MS);
