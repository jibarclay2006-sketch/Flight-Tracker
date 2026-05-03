const DEFAULT_API = "https://opensky-network.org/api";
const LS_API_KEY = "flightTrackerApiBase";
const EARTH_RADIUS_M = 6371000;

const state = {
  map: null,
  aircraft: new Map(),
  selectedIcao: null,
  refreshTimer: null,
  animationFrame: null,
  lastFetchStarted: 0,
  lastFetchEnded: 0,
  routeLine: null,
  projectedLine: null,
  observedTrailLine: null,
  apiBase: localStorage.getItem(LS_API_KEY) || DEFAULT_API
};

const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  locateBtn: document.getElementById("locateBtn"),
  houstonBtn: document.getElementById("houstonBtn"),
  usaBtn: document.getElementById("usaBtn"),
  autoRefresh: document.getElementById("autoRefresh"),
  liveMotion: document.getElementById("liveMotion"),
  showProjected: document.getElementById("showProjected"),
  showObservedTrail: document.getElementById("showObservedTrail"),
  showRoute: document.getElementById("showRoute"),
  refreshSeconds: document.getElementById("refreshSeconds"),
  searchBox: document.getElementById("searchBox"),
  selectedInfo: document.getElementById("selectedInfo"),
  status: document.getElementById("status"),
  apiBase: document.getElementById("apiBase"),
  saveApiBtn: document.getElementById("saveApiBtn")
};

function init(){
  state.map = L.map("map", { preferCanvas: true }).setView([31.4, -96.9], 6);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; OpenStreetMap contributors | Aircraft data: OpenSky Network"
  }).addTo(state.map);

  els.apiBase.value = state.apiBase;
  wireEvents();
  fetchVisibleAircraft();
  startAutoRefresh();
  animateAircraft();
}

function wireEvents(){
  els.refreshBtn.addEventListener("click", fetchVisibleAircraft);
  els.houstonBtn.addEventListener("click", () => state.map.setView([29.7604, -95.3698], 8));
  els.usaBtn.addEventListener("click", () => state.map.fitBounds([[24.4, -125.0], [49.4, -66.9]]));
  els.locateBtn.addEventListener("click", locateUser);
  els.autoRefresh.addEventListener("change", startAutoRefresh);
  els.refreshSeconds.addEventListener("change", startAutoRefresh);
  els.searchBox.addEventListener("input", applyFilter);
  els.liveMotion.addEventListener("change", redrawSelectedOverlays);
  els.showProjected.addEventListener("change", redrawSelectedOverlays);
  els.showObservedTrail.addEventListener("change", redrawSelectedOverlays);
  els.showRoute.addEventListener("change", redrawSelectedOverlays);
  els.saveApiBtn.addEventListener("click", () => {
    const value = els.apiBase.value.trim().replace(/\/$/, "") || DEFAULT_API;
    state.apiBase = value;
    localStorage.setItem(LS_API_KEY, value);
    setStatus(`Saved API base: ${value}`);
    fetchVisibleAircraft();
  });
  state.map.on("moveend", () => {
    if (state.map.getZoom() >= 4) fetchVisibleAircraft();
  });
}

function locateUser(){
  if (!navigator.geolocation){
    setStatus("Geolocation is not supported in this browser.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    state.map.setView([pos.coords.latitude, pos.coords.longitude], 8);
  }, () => setStatus("Could not get your location.", true));
}

function startAutoRefresh(){
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (!els.autoRefresh.checked) return;
  const seconds = clamp(Number(els.refreshSeconds.value) || 20, 10, 120);
  state.refreshTimer = setInterval(fetchVisibleAircraft, seconds * 1000);
}

async function fetchVisibleAircraft(){
  const bounds = state.map.getBounds();
  const lamin = bounds.getSouth().toFixed(4);
  const lamax = bounds.getNorth().toFixed(4);
  const lomin = bounds.getWest().toFixed(4);
  const lomax = bounds.getEast().toFixed(4);
  const url = `${state.apiBase}/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`;
  state.lastFetchStarted = Date.now();
  setStatus("Loading aircraft in visible area...");
  try{
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const rows = Array.isArray(data.states) ? data.states : [];
    updateAircraft(rows, data.time ? data.time * 1000 : Date.now());
    state.lastFetchEnded = Date.now();
    setStatus(`Loaded ${rows.length} aircraft. Last update: ${new Date().toLocaleTimeString()}`);
  } catch(err){
    console.error(err);
    setStatus(`Could not load aircraft: ${err.message}. Try again later or use a proxy URL.`, true);
  }
}

function updateAircraft(rows, dataTimeMs){
  const seen = new Set();
  for (const row of rows){
    const ac = parseState(row, dataTimeMs);
    if (!ac || !Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
    seen.add(ac.icao24);
    const existing = state.aircraft.get(ac.icao24);
    if (existing){
      existing.prevLat = existing.displayLat ?? existing.lat;
      existing.prevLon = existing.displayLon ?? existing.lon;
      Object.assign(existing, ac, { displayLat: ac.lat, displayLon: ac.lon, lastSeenLocal: Date.now() });
      existing.trail.push([ac.lat, ac.lon]);
      existing.trail = simplifyTrail(existing.trail).slice(-90);
      existing.marker.setLatLng([existing.displayLat, existing.displayLon]);
      existing.marker.setIcon(makePlaneIcon(existing.track, state.selectedIcao === ac.icao24));
      existing.marker.setPopupContent(popupHtml(existing));
    } else {
      ac.displayLat = ac.lat;
      ac.displayLon = ac.lon;
      ac.lastSeenLocal = Date.now();
      ac.trail = [[ac.lat, ac.lon]];
      ac.routeTried = false;
      ac.marker = L.marker([ac.lat, ac.lon], { icon: makePlaneIcon(ac.track, false), title: ac.callsign || ac.icao24 })
        .addTo(state.map)
        .bindPopup(popupHtml(ac));
      ac.marker.on("click", () => selectAircraft(ac.icao24));
      state.aircraft.set(ac.icao24, ac);
    }
  }

  const cutoff = Date.now() - 180000;
  for (const [icao, ac] of state.aircraft.entries()){
    if (!seen.has(icao) && ac.lastSeenLocal < cutoff){
      state.map.removeLayer(ac.marker);
      state.aircraft.delete(icao);
      if (state.selectedIcao === icao) clearSelection();
    }
  }
  applyFilter();
  redrawSelectedOverlays();
}

function parseState(s, dataTimeMs){
  return {
    icao24: safeStr(s[0]),
    callsign: safeStr(s[1]),
    originCountry: safeStr(s[2]),
    timePosition: s[3],
    lastContact: s[4],
    lon: num(s[5]),
    lat: num(s[6]),
    baroAltitude: num(s[7]),
    onGround: Boolean(s[8]),
    velocity: num(s[9]),
    track: num(s[10]),
    verticalRate: num(s[11]),
    geoAltitude: num(s[13]),
    squawk: safeStr(s[14]),
    spi: Boolean(s[15]),
    positionSource: s[16],
    dataTimeMs
  };
}

function safeStr(v){ return (v ?? "").toString().trim(); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function makePlaneIcon(track = 0, active = false){
  const heading = Number.isFinite(track) ? track : 0;
  const cls = active ? "plane-icon plane-active" : "plane-icon";
  const svg = `<div class="${cls}" style="transform: rotate(${heading}deg)">
    <svg viewBox="0 0 64 64" width="28" height="28" aria-hidden="true">
      <path fill="#4cc9f0" stroke="#06101d" stroke-width="3" d="M32 3c2.2 0 4 1.8 4 4v19l19 12c1 .7 1.6 1.8 1.6 3v5.2L36 40v13l7 5v3L32 58l-11 3v-3l7-5V40L7.4 46.2V41c0-1.2.6-2.3 1.6-3l19-12V7c0-2.2 1.8-4 4-4z"/>
    </svg>
  </div>`;
  return L.divIcon({ html: svg, className: "", iconSize: [28,28], iconAnchor: [14,14], popupAnchor: [0,-14] });
}

function popupHtml(ac){
  const alt = ac.geoAltitude ?? ac.baroAltitude;
  const speedKt = ac.velocity != null ? ac.velocity * 1.94384 : null;
  const flightaware = ac.callsign ? `https://flightaware.com/live/flight/${encodeURIComponent(ac.callsign.replace(/\s+/g,""))}` : null;
  return `<strong>${ac.callsign || "Unknown callsign"}</strong> <span class="pill">${ac.icao24}</span><br>
    <div class="info-grid">
      <strong>Country</strong><span>${ac.originCountry || "—"}</span>
      <strong>Altitude</strong><span>${alt != null ? `${Math.round(alt).toLocaleString()} m` : "—"}</span>
      <strong>Speed</strong><span>${speedKt != null ? `${Math.round(speedKt)} kt` : "—"}</span>
      <strong>Heading</strong><span>${ac.track != null ? `${Math.round(ac.track)}°` : "—"}</span>
      <strong>Vertical rate</strong><span>${ac.verticalRate != null ? `${Math.round(ac.verticalRate)} m/s` : "—"}</span>
      <strong>Squawk</strong><span>${ac.squawk || "—"}</span>
    </div>
    ${flightaware ? `<p><a href="${flightaware}" target="_blank" rel="noreferrer">Look up route on FlightAware</a></p>` : ""}`;
}

function selectAircraft(icao){
  if (state.selectedIcao && state.aircraft.has(state.selectedIcao)){
    const old = state.aircraft.get(state.selectedIcao);
    old.marker.setIcon(makePlaneIcon(old.track, false));
  }
  state.selectedIcao = icao;
  const ac = state.aircraft.get(icao);
  if (!ac) return;
  ac.marker.setIcon(makePlaneIcon(ac.track, true));
  updateSelectedInfo(ac);
  redrawSelectedOverlays();
  if (els.showRoute.checked) loadRouteForSelected(ac);
}

function clearSelection(){
  state.selectedIcao = null;
  els.selectedInfo.innerHTML = "Click a plane to see details.";
  clearOverlays();
}

function updateSelectedInfo(ac){
  const alt = ac.geoAltitude ?? ac.baroAltitude;
  const speedKt = ac.velocity != null ? ac.velocity * 1.94384 : null;
  els.selectedInfo.innerHTML = `<div class="info-grid">
    <strong>Callsign</strong><span>${ac.callsign || "—"}</span>
    <strong>ICAO24</strong><span>${ac.icao24}</span>
    <strong>Country</strong><span>${ac.originCountry || "—"}</span>
    <strong>Altitude</strong><span>${alt != null ? `${Math.round(alt).toLocaleString()} m` : "—"}</span>
    <strong>Speed</strong><span>${speedKt != null ? `${Math.round(speedKt)} kt` : "—"}</span>
    <strong>Heading</strong><span>${ac.track != null ? `${Math.round(ac.track)}°` : "—"}</span>
    <strong>Coordinates</strong><span>${(ac.displayLat ?? ac.lat).toFixed(4)}, ${(ac.displayLon ?? ac.lon).toFixed(4)}</span>
  </div>
  <p class="muted">Observed trail is built from points this app has seen. Planned/established airline routing usually is not included in ADS-B state data, so the app tries OpenSky route estimation and provides a FlightAware lookup when needed.</p>`;
}

function applyFilter(){
  const q = els.searchBox.value.trim().toLowerCase();
  for (const ac of state.aircraft.values()){
    const hay = `${ac.callsign} ${ac.icao24} ${ac.originCountry}`.toLowerCase();
    const show = !q || hay.includes(q);
    if (show && !state.map.hasLayer(ac.marker)) ac.marker.addTo(state.map);
    if (!show && state.map.hasLayer(ac.marker)) state.map.removeLayer(ac.marker);
  }
}

function animateAircraft(){
  if (els.liveMotion.checked){
    const now = Date.now();
    for (const ac of state.aircraft.values()){
      if (!ac.onGround && ac.velocity && ac.track != null){
        const elapsed = clamp((now - ac.lastSeenLocal) / 1000, 0, 45);
        const predicted = destinationPoint(ac.lat, ac.lon, ac.track, ac.velocity * elapsed);
        ac.displayLat = predicted.lat;
        ac.displayLon = predicted.lon;
        ac.marker.setLatLng([ac.displayLat, ac.displayLon]);
      }
    }
    if (state.selectedIcao && state.aircraft.has(state.selectedIcao)){
      const ac = state.aircraft.get(state.selectedIcao);
      updateSelectedInfo(ac);
      redrawProjectedLine(ac);
    }
  }
  state.animationFrame = requestAnimationFrame(animateAircraft);
}

function destinationPoint(lat, lon, bearingDeg, distanceM){
  const δ = distanceM / EARTH_RADIUS_M;
  const θ = toRad(bearingDeg);
  const φ1 = toRad(lat);
  const λ1 = toRad(lon);
  const sinφ2 = Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ);
  const φ2 = Math.asin(sinφ2);
  const y = Math.sin(θ) * Math.sin(δ) * Math.cos(φ1);
  const x = Math.cos(δ) - Math.sin(φ1) * sinφ2;
  const λ2 = λ1 + Math.atan2(y, x);
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}
function toRad(d){ return d * Math.PI / 180; }
function toDeg(r){ return r * 180 / Math.PI; }

function redrawSelectedOverlays(){
  if (!state.selectedIcao || !state.aircraft.has(state.selectedIcao)){
    clearOverlays();
    return;
  }
  const ac = state.aircraft.get(state.selectedIcao);
  redrawObservedTrail(ac);
  redrawProjectedLine(ac);
  redrawRouteLine(ac);
}

function clearOverlays(){
  for (const layer of [state.routeLine, state.projectedLine, state.observedTrailLine]){
    if (layer) state.map.removeLayer(layer);
  }
  state.routeLine = state.projectedLine = state.observedTrailLine = null;
}

function redrawObservedTrail(ac){
  if (state.observedTrailLine) state.map.removeLayer(state.observedTrailLine);
  state.observedTrailLine = null;
  if (!els.showObservedTrail.checked || !ac.trail || ac.trail.length < 2) return;
  state.observedTrailLine = L.polyline(ac.trail, { color: "#80ed99", weight: 3, opacity: 0.85 }).addTo(state.map);
}

function redrawProjectedLine(ac){
  if (state.projectedLine) state.map.removeLayer(state.projectedLine);
  state.projectedLine = null;
  if (!els.showProjected.checked || ac.track == null || !ac.velocity) return;
  const start = [ac.displayLat ?? ac.lat, ac.displayLon ?? ac.lon];
  const endPt = destinationPoint(start[0], start[1], ac.track, ac.velocity * 600);
  state.projectedLine = L.polyline([start, [endPt.lat, endPt.lon]], {
    color: "#4cc9f0", weight: 2, opacity: 0.8, dashArray: "7 7"
  }).addTo(state.map);
}

function redrawRouteLine(ac){
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  state.routeLine = null;
  if (!els.showRoute.checked || !ac.routePoints || ac.routePoints.length < 2) return;
  state.routeLine = L.polyline(ac.routePoints, { color: "#ffd166", weight: 3, opacity: 0.85, dashArray: "10 8" }).addTo(state.map);
}

async function loadRouteForSelected(ac){
  if (!ac.callsign || ac.routeTried) return;
  ac.routeTried = true;
  const callsign = ac.callsign.replace(/\s+/g, "");
  const begin = Math.floor(Date.now() / 1000) - 86400;
  const end = Math.floor(Date.now() / 1000);
  const trackUrl = `${state.apiBase}/tracks/all?icao24=${encodeURIComponent(ac.icao24)}&time=0`;
  const routeUrl = `${state.apiBase}/routes?callsign=${encodeURIComponent(callsign)}&begin=${begin}&end=${end}`;
  try{
    const trackRes = await fetch(trackUrl, { cache: "no-store" });
    if (trackRes.ok){
      const track = await trackRes.json();
      if (Array.isArray(track.path) && track.path.length > 1){
        ac.routePoints = track.path.map(p => [p[1], p[2]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
        redrawRouteLine(ac);
      }
    }
  }catch(err){ console.warn("Track lookup failed", err); }

  try{
    const routeRes = await fetch(routeUrl, { cache: "no-store" });
    if (routeRes.ok){
      const route = await routeRes.json();
      if (route?.route?.length){
        els.selectedInfo.insertAdjacentHTML("beforeend", `<p class="warn">Estimated route airports: ${route.route.join(" → ")}</p>`);
      }
    }
  }catch(err){ console.warn("Route lookup failed", err); }
}

function simplifyTrail(points){
  const out = [];
  for (const p of points){
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0]-p[0]) > 0.0003 || Math.abs(last[1]-p[1]) > 0.0003) out.push(p);
  }
  return out;
}

function setStatus(msg, isError = false){
  els.status.textContent = msg;
  els.status.className = isError ? "warn" : "";
}

window.addEventListener("load", init);
