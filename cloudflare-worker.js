// Optional OpenSky proxy for hosts where direct browser requests are blocked by CORS.
// Deploy as a Cloudflare Worker, then paste its URL into Tracker settings -> Advanced data settings.

const OPEN_SKY_BASE = "https://opensky-network.org/api";
const ALLOWED_PATHS = new Set(["/states/all", "/tracks/all"]);

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATHS.has(url.pathname)) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const target = new URL(`${OPEN_SKY_BASE}${url.pathname}${url.search}`);
    try {
      const response = await fetch(target, {
        headers: { Accept: "application/json" }
      });
      return new Response(response.body, {
        status: response.status,
        headers: {
          ...corsHeaders(),
          "Content-Type": response.headers.get("Content-Type") || "application/json; charset=utf-8",
          "Cache-Control": "public, max-age=5",
          "X-Content-Type-Options": "nosniff"
        }
      });
    } catch {
      return new Response(JSON.stringify({ error: "OpenSky is temporarily unavailable" }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" }
      });
    }
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
