// Optional proxy for GitHub Pages if direct OpenSky browser requests are blocked.
// Deploy this as a Cloudflare Worker, then paste the Worker URL into Advanced API settings.

const OPEN_SKY_BASE = "https://opensky-network.org/api";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = new URL(OPEN_SKY_BASE + url.pathname + url.search);

    if (!["/states/all", "/tracks/all", "/routes"].includes(url.pathname)) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const response = await fetch(target.toString(), {
      method: "GET",
      headers: { "Accept": "application/json" }
    });

    const body = await response.text();
    return new Response(body, {
      status: response.status,
      headers: {
        ...corsHeaders(),
        "Content-Type": response.headers.get("Content-Type") || "application/json",
        "Cache-Control": "no-store"
      }
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization"
  };
}
