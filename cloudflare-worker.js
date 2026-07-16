// Optional multi-source proxy for static hosts such as GitHub Pages.
// Deploy as a Cloudflare Worker, then paste its URL into Tracker settings -> Advanced data settings.

const REQUEST_TIMEOUT_MS = 7000;

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const target = resolveTarget(url);
    if (!target) {
      return new Response("Not found", { status: 404, headers: corsHeaders() });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(target, {
        signal: controller.signal,
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
    } catch (error) {
      const message = error?.name === "AbortError" ? "Upstream request timed out" : "Upstream source is unavailable";
      return new Response(JSON.stringify({ error: message }), {
        status: 502,
        headers: { ...corsHeaders(), "Content-Type": "application/json; charset=utf-8" }
      });
    } finally {
      clearTimeout(timeout);
    }
  }
};

function resolveTarget(requestUrl) {
  const pathname = requestUrl.pathname;

  // Backwards-compatible OpenSky paths used by earlier versions of this project.
  if (["/states/all", "/tracks/all"].includes(pathname)) {
    return new URL(`https://opensky-network.org/api${pathname}${requestUrl.search}`);
  }

  if (pathname.startsWith("/opensky/")) {
    const upstreamPath = pathname.slice("/opensky".length);
    if (!["/states/all", "/tracks/all"].includes(upstreamPath)) return null;
    return new URL(`https://opensky-network.org/api${upstreamPath}${requestUrl.search}`);
  }

  const airplanesMatch = pathname.match(/^\/airplanes\/v2\/point\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (airplanesMatch && validPoint(airplanesMatch.slice(1))) {
    return new URL(`https://api.airplanes.live/v2/point/${airplanesMatch.slice(1).join("/")}`);
  }

  const adsbLolMatch = pathname.match(/^\/adsblol\/v2\/lat\/([^/]+)\/lon\/([^/]+)\/dist\/([^/]+)$/);
  if (adsbLolMatch && validPoint(adsbLolMatch.slice(1))) {
    const [lat, lon, radius] = adsbLolMatch.slice(1);
    return new URL(`https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radius}`);
  }

  const adsbFiMatch = pathname.match(/^\/adsbfi\/api\/v2\/lat\/([^/]+)\/lon\/([^/]+)\/dist\/([^/]+)$/);
  if (adsbFiMatch && validPoint(adsbFiMatch.slice(1))) {
    const [lat, lon, radius] = adsbFiMatch.slice(1);
    return new URL(`https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${radius}`);
  }

  return null;
}

function validPoint([latValue, lonValue, radiusValue]) {
  const lat = Number(latValue);
  const lon = Number(lonValue);
  const radius = Number(radiusValue);
  return Number.isFinite(lat) && lat >= -90 && lat <= 90 &&
    Number.isFinite(lon) && lon >= -180 && lon <= 180 &&
    Number.isFinite(radius) && radius >= 1 && radius <= 250;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
