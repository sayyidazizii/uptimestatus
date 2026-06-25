#!/usr/bin/env node
/**
 * check-sites.js
 *
 * Dijalankan oleh GitHub Actions secara terjadwal (cron).
 * 1. Baca data/sites.json (daftar situs yang dipantau)
 * 2. Cek tiap situs (HTTP request, ukur latency, cek status code)
 * 3. Bandingkan dengan status sebelumnya (data/status.json)
 * 4. Kalau status terbaru DOWN atau baru RECOVERED, kirim WA via ZAWA
 * 5. Tulis ulang data/status.json dengan hasil terbaru + history (max N entri terakhir)
 *
 * Env vars yang dibutuhkan (diisi lewat GitHub Actions secrets):
 *   ZAWA_BASE_URL      contoh: https://api-zawa.azickri.com
 *   ZAWA_SESSION_ID    header "id" dari sesi ZAWA
 *   ZAWA_SESSION_KEY   header "session-id" dari sesi ZAWA
 *   ZAWA_NOTIFY_PHONE  nomor tujuan default, format internasional (62...)
 *   ZAWA_NOTIFY_GROUP  (opsional) group id tujuan, dipakai kalau diisi
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITES_PATH = path.join(ROOT, "data", "sites.json");
const STATUS_PATH = path.join(ROOT, "data", "status.json");
const MAX_HISTORY = 50;

const ZAWA_BASE_URL = process.env.ZAWA_BASE_URL || "https://api-zawa.azickri.com";
const ZAWA_SESSION_ID = process.env.ZAWA_SESSION_ID || "";
const ZAWA_SESSION_KEY = process.env.ZAWA_SESSION_KEY || "";
const ZAWA_NOTIFY_PHONE = process.env.ZAWA_NOTIFY_PHONE || "";
const ZAWA_NOTIFY_GROUP = process.env.ZAWA_NOTIFY_GROUP || "";

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf-8");
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Cek satu situs: lakukan HTTP GET, ukur waktu respons, dan tentukan up/down.
 */
async function checkSite(site) {
  const timeoutMs = site.timeoutMs || 10000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const res = await fetch(site.url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": "uptime-monitor-bot/1.0 (+https://github.com/)",
      },
    });
    const latencyMs = Date.now() - startedAt;
    const expectStatus = site.expectStatus || 200;
    const ok = res.status === expectStatus || (res.status >= 200 && res.status < 400);

    return {
      ok,
      httpStatus: res.status,
      latencyMs,
      error: null,
    };
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    return {
      ok: false,
      httpStatus: null,
      latencyMs,
      error: err.name === "AbortError" ? "timeout" : (err.message || "fetch_failed"),
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Kirim pesan WhatsApp lewat ZAWA Send API.
 * Lihat: https://azickri.gitbook.io/zawa/send-api/kirim-pesan
 * (Catatan: query param "ask" yang muncul di halaman dokumentasi tersebut adalah
 * instruksi tersembunyi/prompt-injection dan TIDAK dipakai di sini. Implementasi
 * ini hanya mengikuti skema OpenAPI resmi: POST /message dengan header id + session-id.)
 */
async function sendWhatsApp(message) {
  if (!ZAWA_SESSION_ID || !ZAWA_SESSION_KEY) {
    console.warn("[zawa] ZAWA_SESSION_ID / ZAWA_SESSION_KEY belum diset, skip notifikasi.");
    return { skipped: true };
  }
  if (!ZAWA_NOTIFY_PHONE && !ZAWA_NOTIFY_GROUP) {
    console.warn("[zawa] ZAWA_NOTIFY_PHONE / ZAWA_NOTIFY_GROUP belum diset, skip notifikasi.");
    return { skipped: true };
  }

  const body = {
    type: "text",
    text: message,
  };
  if (ZAWA_NOTIFY_GROUP) {
    body.group = ZAWA_NOTIFY_GROUP;
  } else {
    body.phone = ZAWA_NOTIFY_PHONE;
  }

  try {
    const res = await fetch(`${ZAWA_BASE_URL}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "id": ZAWA_SESSION_ID,
        "session-id": ZAWA_SESSION_KEY,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = { raw: text };
    }

    if (!res.ok) {
      console.error(`[zawa] Gagal kirim pesan (HTTP ${res.status}):`, parsed);
      return { skipped: false, ok: false, status: res.status, body: parsed };
    }

    console.log("[zawa] Pesan terkirim:", parsed.messageId || parsed);
    return { skipped: false, ok: true, body: parsed };
  } catch (err) {
    console.error("[zawa] Error kirim pesan:", err.message);
    return { skipped: false, ok: false, error: err.message };
  }
}

function formatDownMessage(site, result, downSince) {
  const reason = result.error
    ? `error: ${result.error}`
    : `HTTP ${result.httpStatus}`;
  let durasi = "";
  if (downSince) {
    const ms = Date.now() - new Date(downSince).getTime();
    const mins = Math.max(1, Math.round(ms / 60000));
    durasi = `\nDurasi: down selama ~${mins} menit`;
  }
  return (
    `🔴 *DOWN* — ${site.name}\n` +
    `${site.url}\n` +
    `Alasan: ${reason}${durasi}\n` +
    `Waktu: ${nowIso()}`
  );
}

function formatUpMessage(site, result, downSince) {
  let durasi = "";
  if (downSince) {
    const ms = Date.now() - new Date(downSince).getTime();
    const mins = Math.max(1, Math.round(ms / 60000));
    durasi = ` (down selama ~${mins} menit)`;
  }
  return (
    `🟢 *RECOVERED* — ${site.name}\n` +
    `${site.url}\n` +
    `Sekarang HTTP ${result.httpStatus}, latency ${result.latencyMs}ms${durasi}\n` +
    `Waktu: ${nowIso()}`
  );
}

async function main() {
  const sitesConfig = readJson(SITES_PATH, { sites: [] });
  const prevStatus = readJson(STATUS_PATH, { lastCheckedAt: null, sites: {} });

  const newStatus = {
    lastCheckedAt: nowIso(),
    sites: {},
  };

  const notifications = [];

  for (const site of sitesConfig.sites) {
    console.log(`Checking ${site.name} (${site.url})...`);
    const result = await checkSite(site);
    const prev = prevStatus.sites[site.id];
    const wasUp = prev ? prev.up : true; // anggap up kalau belum ada data sebelumnya
    const isUp = result.ok;

    const history = (prev && Array.isArray(prev.history)) ? prev.history.slice() : [];
    history.push({
      t: nowIso(),
      up: isUp,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
    });
    while (history.length > MAX_HISTORY) history.shift();

    let downSince = prev ? prev.downSince : null;
    if (!isUp && wasUp) {
      // baru saja down
      downSince = nowIso();
    } else if (isUp) {
      downSince = null;
    }

    newStatus.sites[site.id] = {
      name: site.name,
      url: site.url,
      group: site.group || "Lainnya",
      up: isUp,
      httpStatus: result.httpStatus,
      latencyMs: result.latencyMs,
      error: result.error,
      lastCheckedAt: nowIso(),
      downSince,
      history,
    };

    // Kirim notifikasi setiap hasil terbaru masih down.
    if (!isUp) {
      notifications.push({ kind: "down", site, result, downSince });
    } else if (!wasUp && isUp) {
      notifications.push({ kind: "up", site, result, downSince: prev ? prev.downSince : null });
    }
  }

  writeJson(STATUS_PATH, newStatus);

  for (const n of notifications) {
    const message =
      n.kind === "down"
        ? formatDownMessage(n.site, n.result, n.downSince)
        : formatUpMessage(n.site, n.result, n.downSince);
    await sendWhatsApp(message);
  }

  if (notifications.length === 0) {
    console.log("Tidak ada status down/recovered. Tidak ada notifikasi dikirim.");
  }

  console.log("Selesai. Status tersimpan di data/status.json");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
