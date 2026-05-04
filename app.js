const DEFAULT_OPEN_SKY = "https://opensky-network.org/api";
const LS_API_KEY = "flightTrackerApiBase";
const EARTH_RADIUS_M = 6371000;
const MAX_RADIUS_NM = 250;
const FOLLOW_PAN_MS = 900;

const state = {
  map: null,
  aircraft: new Map(),
  selectedIcao: null,
  refreshTimer: null,
  animationFrame: null,
  routeLine: null,
  projectedLine: null,
  observedTrailLine: null,
  observedTrailGlowLine: null,
  apiBase: localStorage.getItem(LS_API_KEY) || "",
  lastGoodSource: "",
  lastFollowPan: 0,
  suppressMoveFetchUntil: 0
};

const els = {
  refreshBtn: document.getElementById("refreshBtn"),
  locateBtn: document.getElementById("locateBtn"),
  houstonBtn: document.getElementById("houstonBtn"),
  usaBtn: document.getElementById("usaBtn"),
  autoRefresh: document.getElementById("autoRefresh"),
  liveMotion: document.getElementById("liveMotion"),
  followSelected: document.getElementById("followSelected"),
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
  state.map = L.map("map", { preferCanvas: true, zoomControl: true }).setView([29.7604, -95.3698], 8);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 12,
    attribution: "&copy; OpenStreetMap contributors | Aircraft data: OpenSky / ADS-B public APIs"
  }).addTo(state.map);

  els.apiBase.value = state.apiBase;
  wireEvents();
  setTimeout(() => state.map.invalidateSize(true), 100);
  setTimeout(() => state.map.invalidateSize(true), 700);
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
  els.followSelected?.addEventListener("change", () => followSelectedPlane(true));
  els.showProjected.addEventListener("change", redrawSelectedOverlays);
  els.showObservedTrail.addEventListener("change", redrawSelectedOverlays);
  els.showRoute.addEventListener("change", redrawSelectedOverlays);
  els.saveApiBtn.addEventListener("click", () => {
    const value = els.apiBase.value.trim().replace(/\/$/, "");
    state.apiBase = value;
    if (value) localStorage.setItem(LS_API_KEY, value);
    else localStorage.removeItem(LS_API_KEY);
    setStatus(value ? `Saved custom API base: ${value}` : "Cleared custom API base. Using automatic sources.");
    fetchVisibleAircraft();
  });
  state.map.on("moveend zoomend", () => {
    state.map.invalidateSize(false);
    if (Date.now() < state.suppressMoveFetchUntil) return;
    if (state.map.getZoom() >= 3) fetchVisibleAircraft();
  });
  state.map.on("dragstart", () => {
    if (els.followSelected) els.followSelected.checked = false;
  });
  window.addEventListener("resize", () => setTimeout(() => state.map.invalidateSize(true), 100));
}

function locateUser(){
  if (!navigator.geolocation){ setStatus("Geolocation is not supported in this browser.", true); return; }
  navigator.geolocation.getCurrentPosition(
    pos => state.map.setView([pos.coords.latitude, pos.coords.longitude], 8),
    () => setStatus("Could not get your location.", true)
  );
}

function startAutoRefresh(){
  if (state.refreshTimer) clearInterval(state.refreshTimer);
  if (!els.autoRefresh.checked) return;
  const seconds = clamp(Number(els.refreshSeconds.value) || 20, 10, 120);
  state.refreshTimer = setInterval(fetchVisibleAircraft, seconds * 1000);
}

async function fetchVisibleAircraft(){
  setStatus("Loading aircraft in visible area...");
  const candidates = buildSourceCandidates();
  const errors = [];
  for (const source of candidates){
    try{
      const res = await fetch(source.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const aircraft = source.parse(data);
      if (!Array.isArray(aircraft)) throw new Error("unexpected response format");
      updateAircraft(aircraft, Date.now());
      state.lastGoodSource = source.label;
      setStatus(`Loaded ${aircraft.length} aircraft from ${source.label}. Last update: ${new Date().toLocaleTimeString()}`);
      followSelectedPlane(false);
      return;
    } catch(err){
      errors.push(`${source.label}: ${err.message}`);
      console.warn(`${source.label} failed`, err);
    }
  }
  setStatus(`No flight data loaded. ${errors.join(" | ")}`, true);
}

function buildSourceCandidates(){
  const bounds = state.map.getBounds();
  const center = bounds.getCenter();
  const radiusNm = Math.max(25, Math.min(MAX_RADIUS_NM, Math.ceil(distanceNm(center.lat, center.lng, bounds.getNorthEast().lat, bounds.getNorthEast().lng))));
  const lat = center.lat.toFixed(4);
  const lon = center.lng.toFixed(4);
  const lamin = bounds.getSouth().toFixed(4);
  const lamax = bounds.getNorth().toFixed(4);
  const lomin = bounds.getWest().toFixed(4);
  const lomax = bounds.getEast().toFixed(4);

  if (state.apiBase){
    const base = state.apiBase;
    return [
      { label: "Custom API / OpenSky format", url: `${base}/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`, parse: parseOpenSkyResponse },
      { label: "Custom API / ADS-B point format", url: `${base}/v2/point/${lat}/${lon}/${radiusNm}`, parse: parseReadsbResponse },
      { label: "Custom API / ADS-B lat-lon-dist format", url: `${base}/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`, parse: parseReadsbResponse }
    ];
  }

  return [
    { label: "Airplanes.live", url: `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}`, parse: parseReadsbResponse },
    { label: "ADSB.lol", url: `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}`, parse: parseReadsbResponse },
    { label: "OpenSky", url: `${DEFAULT_OPEN_SKY}/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}`, parse: parseOpenSkyResponse }
  ];
}

function parseOpenSkyResponse(data){
  const rows = Array.isArray(data.states) ? data.states : [];
  return rows.map(s => ({
    icao24: safeStr(s[0]),
    callsign: safeStr(s[1]),
    originCountry: safeStr(s[2]),
    lon: num(s[5]),
    lat: num(s[6]),
    baroAltitude: num(s[7]),
    onGround: Boolean(s[8]),
    velocity: num(s[9]),
    track: num(s[10]),
    verticalRate: num(s[11]),
    geoAltitude: num(s[13]),
    squawk: safeStr(s[14]),
    source: "OpenSky"
  })).filter(validAircraft);
}

function parseReadsbResponse(data){
  const rows = Array.isArray(data.ac) ? data.ac : Array.isArray(data.aircraft) ? data.aircraft : [];
  return rows.map(a => {
    const gsKt = num(a.gs);
    return {
      icao24: safeStr(a.hex || a.icao || a.icao24),
      callsign: safeStr(a.flight || a.callsign || a.call),
      originCountry: safeStr(a.country || a.dbFlags || ""),
      lon: num(a.lon),
      lat: num(a.lat),
      baroAltitude: feetToMeters(altValue(a.alt_baro)),
      geoAltitude: feetToMeters(altValue(a.alt_geom)),
      onGround: a.alt_baro === "ground" || a.gnd === true,
      velocity: gsKt != null ? gsKt * 0.514444 : num(a.speed),
      track: num(a.track ?? a.true_heading ?? a.mag_heading),
      verticalRate: fpmToMps(num(a.baro_rate ?? a.geom_rate)),
      squawk: safeStr(a.squawk),
      registration: safeStr(a.r),
      aircraftType: safeStr(a.t),
      source: "readsb"
    };
  }).filter(validAircraft);
}

function altValue(v){ return v === "ground" ? 0 : num(v); }
function feetToMeters(v){ return v == null ? null : v * 0.3048; }
function fpmToMps(v){ return v == null ? null : v * 0.00508; }
function validAircraft(ac){ return ac.icao24 && Number.isFinite(ac.lat) && Number.isFinite(ac.lon); }

function updateAircraft(rows){
  const seen = new Set();
  for (const ac of rows){
    seen.add(ac.icao24);
    const existing = state.aircraft.get(ac.icao24);
    if (existing){
      existing.prevLat = existing.displayLat ?? existing.lat;
      existing.prevLon = existing.displayLon ?? existing.lon;
      Object.assign(existing, ac, { displayLat: ac.lat, displayLon: ac.lon, lastSeenLocal: Date.now() });
      existing.trail.push([ac.lat, ac.lon]);
      existing.trail = simplifyTrail(existing.trail).slice(-160);
      existing.marker.setLatLng([existing.displayLat, existing.displayLon]);
      existing.marker.setIcon(makePlaneIcon(existing, state.selectedIcao === ac.icao24));
      existing.marker.setPopupContent(popupHtml(existing));
    } else {
      ac.displayLat = ac.lat;
      ac.displayLon = ac.lon;
      ac.lastSeenLocal = Date.now();
      ac.trail = [[ac.lat, ac.lon]];
      ac.routeTried = false;
      ac.marker = L.marker([ac.lat, ac.lon], { icon: makePlaneIcon(ac, false), title: ac.callsign || ac.icao24 })
        .addTo(state.map)
        .bindPopup(popupHtml(ac));
      ac.marker.on("click", () => selectAircraft(ac.icao24));
      state.aircraft.set(ac.icao24, ac);
    }
  }

  const cutoff = Date.now() - 240000;
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

function safeStr(v){ return (v ?? "").toString().trim(); }
function num(v){ const n = Number(v); return Number.isFinite(n) ? n : null; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }

function altitudeInfo(ac){
  const altM = ac.geoAltitude ?? ac.baroAltitude;
  if (ac.onGround) return { color: "#9aa4b2", label: "Ground" };
  if (altM == null) return { color: "#c7d2fe", label: "Unknown altitude" };
  const altFt = altM * 3.28084;
  if (altFt < 10000) return { color: "#70e000", label: "Below 10,000 ft" };
  if (altFt < 20000) return { color: "#4cc9f0", label: "10,000–20,000 ft" };
  if (altFt < 30000) return { color: "#4361ee", label: "20,000–30,000 ft" };
  if (altFt < 40000) return { color: "#b517ff", label: "30,000–40,000 ft" };
  return { color: "#ff9f1c", label: "Above 40,000 ft" };
}

function colorDotHtml(info){
  return `<span class="color-dot" style="background:${info.color}"></span>${info.label}`;
}

function makePlaneIcon(acOrTrack = 0, active = false){
  const isAircraft = typeof acOrTrack === "object" && acOrTrack !== null;
  const heading = Number.isFinite(isAircraft ? acOrTrack.track : acOrTrack) ? (isAircraft ? acOrTrack.track : acOrTrack) : 0;
  const alt = isAircraft ? altitudeInfo(acOrTrack) : { color: "#4cc9f0", label: "Unknown altitude" };
  const cls = active ? "plane-icon plane-active" : "plane-icon";
  const stroke = active ? "#ffd166" : "#06101d";
  const strokeWidth = active ? 4.4 : 3;
  const size = active ? 34 : 29;
  const svg = `<div class="${cls}" style="transform: rotate(${heading}deg); --plane-color:${alt.color}">
    <svg viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
      <path fill="${alt.color}" stroke="${stroke}" stroke-width="${strokeWidth}" d="M32 3c2.2 0 4 1.8 4 4v19l19 12c1 .7 1.6 1.8 1.6 3v5.2L36 40v13l7 5v3L32 58l-11 3v-3l7-5V40L7.4 46.2V41c0-1.2.6-2.3 1.6-3l19-12V7c0-2.2 1.8-4 4-4z"/>
    </svg>
  </div>`;
  const iconSize = [size, size];
  const anchor = [size / 2, size / 2];
  return L.divIcon({ html: svg, className: "", iconSize, iconAnchor: anchor, popupAnchor: [0,-14] });
}

function popupHtml(ac){
  const alt = ac.geoAltitude ?? ac.baroAltitude;
  const altFt = alt != null ? alt * 3.28084 : null;
  const altColor = altitudeInfo(ac);
  const speedKt = ac.velocity != null ? ac.velocity * 1.94384 : null;
  const flightaware = ac.callsign ? `https://flightaware.com/live/flight/${encodeURIComponent(ac.callsign.replace(/\s+/g,""))}` : null;
  return `<strong>${ac.callsign || "Unknown callsign"}</strong> <span class="pill">${ac.icao24}</span><br>
    <div class="info-grid">
      <strong>Type</strong><span>${ac.aircraftType || "—"}</span>
      <strong>Registration</strong><span>${ac.registration || "—"}</span>
      <strong>Altitude</strong><span>${altFt != null ? `${Math.round(altFt).toLocaleString()} ft` : "—"}</span>
      <strong>Alt. color</strong><span>${colorDotHtml(altColor)}</span>
      <strong>Speed</strong><span>${speedKt != null ? `${Math.round(speedKt)} kt` : "—"}</span>
      <strong>Heading</strong><span>${ac.track != null ? `${Math.round(ac.track)}°` : "—"}</span>
      <strong>Vertical rate</strong><span>${ac.verticalRate != null ? `${Math.round(ac.verticalRate * 196.85).toLocaleString()} ft/min` : "—"}</span>
      <strong>Squawk</strong><span>${ac.squawk || "—"}</span>
    </div>
    ${flightaware ? `<p><a href="${flightaware}" target="_blank" rel="noreferrer">Look up route on FlightAware</a></p>` : ""}`;
}

function selectAircraft(icao){
  if (state.selectedIcao && state.aircraft.has(state.selectedIcao)){
    const old = state.aircraft.get(state.selectedIcao);
    old.marker.setIcon(makePlaneIcon(old, false));
  }
  state.selectedIcao = icao;
  const ac = state.aircraft.get(icao);
  if (!ac) return;
  ac.marker.setIcon(makePlaneIcon(ac, true));
  updateSelectedInfo(ac);
  redrawSelectedOverlays();
  followSelectedPlane(true);
  if (els.showRoute.checked) loadRouteForSelected(ac);
}

function clearSelection(){
  state.selectedIcao = null;
  els.selectedInfo.innerHTML = "Click a plane to see details.";
  clearOverlays();
}

function updateSelectedInfo(ac){
  const alt = ac.geoAltitude ?? ac.baroAltitude;
  const altFt = alt != null ? alt * 3.28084 : null;
  const altColor = altitudeInfo(ac);
  const speedKt = ac.velocity != null ? ac.velocity * 1.94384 : null;
  const followText = els.followSelected?.checked ? "Following selected plane" : "Not following";
  els.selectedInfo.innerHTML = `<div class="info-grid">
    <strong>Callsign</strong><span>${ac.callsign || "—"}</span>
    <strong>ICAO24</strong><span>${ac.icao24}</span>
    <strong>Type</strong><span>${ac.aircraftType || "—"}</span>
    <strong>Registration</strong><span>${ac.registration || "—"}</span>
    <strong>Altitude</strong><span>${altFt != null ? `${Math.round(altFt).toLocaleString()} ft` : "—"}</span>
    <strong>Alt. color</strong><span>${colorDotHtml(altColor)}</span>
    <strong>Speed</strong><span>${speedKt != null ? `${Math.round(speedKt)} kt` : "—"}</span>
    <strong>Heading</strong><span>${ac.track != null ? `${Math.round(ac.track)}°` : "—"}</span>
    <strong>Coordinates</strong><span>${(ac.displayLat ?? ac.lat).toFixed(4)}, ${(ac.displayLon ?? ac.lon).toFixed(4)}</span>
    <strong>Map</strong><span>${followText}</span>
  </div>
  <p class="muted">The bright green line is the selected aircraft trail this app has observed. The blue dashed line projects the next few minutes from current heading and groundspeed. Official flight-plan routing is not always available in public ADS-B data.</p>`;
}

function applyFilter(){
  const q = els.searchBox.value.trim().toLowerCase();
  for (const ac of state.aircraft.values()){
    const hay = `${ac.callsign} ${ac.icao24} ${ac.originCountry} ${ac.registration} ${ac.aircraftType}`.toLowerCase();
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
      redrawObservedTrail(ac);
      followSelectedPlane(false);
    }
  }
  state.animationFrame = requestAnimationFrame(animateAircraft);
}

function followSelectedPlane(force = false){
  if (!els.followSelected?.checked || !state.selectedIcao || !state.aircraft.has(state.selectedIcao)) return;
  const ac = state.aircraft.get(state.selectedIcao);
  const lat = ac.displayLat ?? ac.lat;
  const lon = ac.displayLon ?? ac.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const now = Date.now();
  if (!force && now - state.lastFollowPan < FOLLOW_PAN_MS) return;
  state.lastFollowPan = now;
  state.suppressMoveFetchUntil = now + 1300;
  state.map.panTo([lat, lon], { animate: true, duration: 0.45, easeLinearity: 0.25, noMoveStart: true });
}

function destinationPoint(lat, lon, bearingDeg, distanceM){
  const delta = distanceM / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lon);
  const sinPhi2 = Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(phi1);
  const x = Math.cos(delta) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);
  return { lat: toDeg(phi2), lon: ((toDeg(lambda2) + 540) % 360) - 180 };
}
function toRad(d){ return d * Math.PI / 180; }
function toDeg(r){ return r * 180 / Math.PI; }
function distanceNm(lat1, lon1, lat2, lon2){
  const p1 = toRad(lat1), p2 = toRad(lat2), dp = toRad(lat2-lat1), dl = toRad(lon2-lon1);
  const a = Math.sin(dp/2)**2 + Math.cos(p1)*Math.cos(p2)*Math.sin(dl/2)**2;
  return (EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))) / 1852;
}

function redrawSelectedOverlays(){
  if (!state.selectedIcao || !state.aircraft.has(state.selectedIcao)){ clearOverlays(); return; }
  const ac = state.aircraft.get(state.selectedIcao);
  redrawObservedTrail(ac);
  redrawProjectedLine(ac);
  redrawRouteLine(ac);
}

function clearOverlays(){
  for (const layer of [state.routeLine, state.projectedLine, state.observedTrailLine, state.observedTrailGlowLine]){
    if (layer) state.map.removeLayer(layer);
  }
  state.routeLine = state.projectedLine = state.observedTrailLine = state.observedTrailGlowLine = null;
}

function redrawObservedTrail(ac){
  if (state.observedTrailLine) state.map.removeLayer(state.observedTrailLine);
  if (state.observedTrailGlowLine) state.map.removeLayer(state.observedTrailGlowLine);
  state.observedTrailLine = null;
  state.observedTrailGlowLine = null;
  if (!els.showObservedTrail.checked || !ac.trail || ac.trail.length < 2) return;

  const points = ac.trail.slice();
  const livePoint = [ac.displayLat ?? ac.lat, ac.displayLon ?? ac.lon];
  const last = points[points.length - 1];
  if (last && (Math.abs(last[0] - livePoint[0]) > 0.00005 || Math.abs(last[1] - livePoint[1]) > 0.00005)) points.push(livePoint);

  state.observedTrailGlowLine = L.polyline(points, {
    color: "#06101d",
    weight: 11,
    opacity: 0.82,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);
  state.observedTrailLine = L.polyline(points, {
    color: "#7cff9b",
    weight: 5,
    opacity: 1,
    lineCap: "round",
    lineJoin: "round"
  }).addTo(state.map);
}

function redrawProjectedLine(ac){
  if (state.projectedLine) state.map.removeLayer(state.projectedLine);
  state.projectedLine = null;
  if (!els.showProjected.checked || ac.track == null || !ac.velocity) return;
  const start = [ac.displayLat ?? ac.lat, ac.displayLon ?? ac.lon];
  const endPt = destinationPoint(start[0], start[1], ac.track, ac.velocity * 600);
  state.projectedLine = L.polyline([start, [endPt.lat, endPt.lon]], { color: "#4cc9f0", weight: 3, opacity: 0.95, dashArray: "7 7" }).addTo(state.map);
}

function redrawRouteLine(ac){
  if (state.routeLine) state.map.removeLayer(state.routeLine);
  state.routeLine = null;
  if (!els.showRoute.checked || !ac.routePoints || ac.routePoints.length < 2) return;
  state.routeLine = L.polyline(ac.routePoints, { color: "#ffd166", weight: 4, opacity: 0.95, dashArray: "10 8" }).addTo(state.map);
}

async function loadRouteForSelected(ac){
  if (!ac.icao24 || ac.routeTried) return;
  ac.routeTried = true;
  const sources = [
    `https://api.adsb.lol/v2/icao/${encodeURIComponent(ac.icao24)}`,
    `https://api.airplanes.live/v2/hex/${encodeURIComponent(ac.icao24)}`
  ];
  for (const url of sources){
    try{
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) continue;
      const data = await res.json();
      const found = parseReadsbResponse(data)[0];
      if (found && (found.registration || found.aircraftType)){
        Object.assign(ac, { registration: found.registration || ac.registration, aircraftType: found.aircraftType || ac.aircraftType });
        updateSelectedInfo(ac);
        return;
      }
    }catch(err){ console.warn("Aircraft detail lookup failed", err); }
  }
}

function simplifyTrail(points){
  const out = [];
  for (const p of points){
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0]-p[0]) > 0.00025 || Math.abs(last[1]-p[1]) > 0.00025) out.push(p);
  }
  return out;
}

function setStatus(msg, isError = false){
  els.status.textContent = msg;
  els.status.className = isError ? "bad" : "";
}

window.addEventListener("load", init);
