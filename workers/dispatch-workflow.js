const GITHUB_API_URL =
  "https://api.github.com/repos/sayyidazizii/uptimestatus/actions/workflows/check-status.yml/dispatches";

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "POST") {
      return json({ ok: false, error: "method_not_allowed" }, 405);
    }

    const url = new URL(request.url);
    const secret = url.searchParams.get("secret") || request.headers.get("x-cron-secret");

    if (env.CRON_SECRET && secret !== env.CRON_SECRET) {
      return json({ ok: false, error: "unauthorized" }, 401);
    }

    if (!env.GITHUB_TOKEN) {
      return json({ ok: false, error: "missing_github_token" }, 500);
    }

    const githubRes = await fetch(GITHUB_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "uptimestatus-cron-worker",
      },
      body: JSON.stringify({ ref: "main" }),
    });

    if (githubRes.status === 204) {
      return json({ ok: true, dispatched: true });
    }

    const body = await githubRes.text();
    return json(
      {
        ok: false,
        error: "github_dispatch_failed",
        status: githubRes.status,
        body,
      },
      502
    );
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
