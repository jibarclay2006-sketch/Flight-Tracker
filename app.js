const DEFAULT_OPEN_SKY = "https://opensky-network.org/api";
const PREFS_KEY = "flightTrackerPreferencesV2";
const API_KEY = "flightTrackerApiBase";
const VIEW_KEY = "flightTrackerLastView";
const EARTH_RADIUS_M = 6371000;
const MAX_RADIUS_NM = 250;
const MOVE_FETCH_DELAY_MS = 650;
const FETCH_TIMEOUT_MS = 7500;
const FOLLOW_PAN_MS = 1100;
const AIRCRAFT_STALE_MS = 240000;
const LIST_LIMIT = 180;

const DEFAULT_PREFS = Object.freeze({
  autoRefresh: true,
  liveMotion: true,
  refreshSeconds: 20,
  followSelected: true,
  showObservedTrail: true,
  showProjected: true,
  showLabels: false,
  showCoverage: true,
  haptics: true,
  mapStyle: "dark",
  sidebarCollapsed: false
});

const PLACES = {
  "east-texas": { center: [31.6035, -94.6555], zoom: 8 },
  houston: { center: [29.7604, -95.3698], zoom: 8 },
  dallas: { center: [32.7767, -96.797], zoom: 8 },
  usa: { bounds: [[24.4, -125], [49.4, -66.9]] }
};

const TILE_STYLES = {
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    options: { subdomains: "abcd", maxZoom: 20, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }
  },
  street: {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    options: { maxZoom: 19, attribution: "&copy; OpenStreetMap contributors" }
  },
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    options: { subdomains: "abcd", maxZoom: 20, attribution: "&copy; OpenStreetMap contributors &copy; CARTO" }
  }
};

const state = {
  map: null,
  tileLayer: null,
  aircraft: new Map(),
  selectedIcao: null,
  prefs: loadPreferences(),
  apiBase: safeStorageGet(API_KEY) || "",
  statusFilter: "all",
  altitudeFilter: "all",
  sort: "distance",
  refreshTimer: null,
  moveTimer: null,
  clockTimer: null,
  toastTimer: null,
  animationFrame: null,
  lastAnimationAt: 0,
  lastSelectedUiAt: 0,
  fetchController: null,
  requestId: 0,
  lastFetchStarted: 0,
  lastSuccess: 0,
  lastSource: "",
  lastQueryContext: null,
  lastSourceCoverage: "",
  lastFollowPan: 0,
  suppressMoveFetchUntil: 0,
  isMobile: window.matchMedia("(max-width: 760px)").matches,
  userLocationMarker: null,
  userAccuracyCircle: null,
  layers: {
    projected: null,
    trail: null,
    trailGlow: null,
    coverage: null
  }
};

const els = {
  app: document.getElementById("app"),
  workspace: document.querySelector(".workspace"),
  sidebar: document.getElementById("sidebar"),
  sidebarToggle: document.getElementById("sidebarToggle"),
  closeSidebarBtn: document.getElementById("closeSidebarBtn"),
  mobileFlightsBtn: document.getElementById("mobileFlightsBtn"),
  mobileFlightCount: document.getElementById("mobileFlightCount"),
  refreshBtn: document.getElementById("refreshBtn"),
  retryBtn: document.getElementById("retryBtn"),
  locateBtn: document.getElementById("locateBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  settingsDialog: document.getElementById("settingsDialog"),
  searchBox: document.getElementById("searchBox"),
  clearSearchBtn: document.getElementById("clearSearchBtn"),
  altitudeFilter: document.getElementById("altitudeFilter"),
  sortFlights: document.getElementById("sortFlights"),
  flightList: document.getElementById("flightList"),
  totalCount: document.getElementById("totalCount"),
  airborneCount: document.getElementById("airborneCount"),
  groundCount: document.getElementById("groundCount"),
  alertCount: document.getElementById("alertCount"),
  visibleCount: document.getElementById("visibleCount"),
  selectedPanel: document.getElementById("selectedPanel"),
  selectedInfo: document.getElementById("selectedInfo"),
  clearSelectionBtn: document.getElementById("clearSelectionBtn"),
  status: document.getElementById("status"),
  sourceMeta: document.getElementById("sourceMeta"),
  statusCard: document.querySelector(".status-card"),
  dataHealth: document.getElementById("dataHealth"),
  dataHealthLabel: document.getElementById("dataHealthLabel"),
  coverageBadge: document.getElementById("coverageBadge"),
  mapMessage: document.getElementById("mapMessage"),
  labelsBtn: document.getElementById("labelsBtn"),
  mapStyleBtn: document.getElementById("mapStyleBtn"),
  fullscreenBtn: document.getElementById("fullscreenBtn"),
  autoRefresh: document.getElementById("autoRefresh"),
  liveMotion: document.getElementById("liveMotion"),
  refreshSeconds: document.getElementById("refreshSeconds"),
  followSelected: document.getElementById("followSelected"),
  showObservedTrail: document.getElementById("showObservedTrail"),
  showProjected: document.getElementById("showProjected"),
  showLabels: document.getElementById("showLabels"),
  showCoverage: document.getElementById("showCoverage"),
  hapticsEnabled: document.getElementById("hapticsEnabled"),
  mapStyle: document.getElementById("mapStyle"),
  apiBase: document.getElementById("apiBase"),
  saveApiBtn: document.getElementById("saveApiBtn"),
  clearApiBtn: document.getElementById("clearApiBtn"),
  resetPrefsBtn: document.getElementById("resetPrefsBtn"),
  hapticSwitch: document.getElementById("hapticSwitch"),
  toast: document.getElementById("toast")
};

function init() {
  if (typeof L === "undefined") {
    setFatalMapMessage("The map library could not load. Check your connection and refresh the page.");
    setStatus("Map library unavailable", "error", "Leaflet was blocked or did not finish loading");
    return;
  }

  const savedView = loadSavedView();
  state.map = L.map("map", {
    preferCanvas: true,
    zoomControl: false,
    worldCopyJump: true,
    minZoom: 2,
    maxZoom: 15,
    doubleClickZoom: true
  }).setView(savedView.center, savedView.zoom);

  L.control.zoom({ position: "bottomright" }).addTo(state.map);
  setMapStyle(state.prefs.mapStyle, false);
  syncControlsFromPreferences();
  applyResponsiveLayout();
  wireEvents();
  renderAll();

  window.setTimeout(() => state.map.invalidateSize(true), 80);
  window.setTimeout(() => state.map.invalidateSize(true), 500);
  fetchVisibleAircraft({ force: true });
  startAutoRefresh();
  state.clockTimer = window.setInterval(updateTimeLabels, 1000);
  state.animationFrame = window.requestAnimationFrame(animateAircraft);
}

function wireEvents() {
  els.refreshBtn.addEventListener("click", () => fetchVisibleAircraft({ force: true }));
  els.retryBtn.addEventListener("click", () => fetchVisibleAircraft({ force: true }));
  els.locateBtn.addEventListener("click", locateUser);
  els.settingsBtn.addEventListener("click", openSettings);
  els.sidebarToggle.addEventListener("click", toggleAircraftPanel);
  els.closeSidebarBtn.addEventListener("click", closeMobilePanel);
  els.mobileFlightsBtn.addEventListener("click", () => openMobilePanel());

  els.searchBox.addEventListener("input", () => {
    els.clearSearchBtn.hidden = !els.searchBox.value;
    applyFiltersAndRender();
  });
  els.searchBox.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = getFilteredFlights()[0];
    if (first) selectAircraft(first.icao24, { center: true, fromList: true });
  });
  els.clearSearchBtn.addEventListener("click", () => {
    els.searchBox.value = "";
    els.clearSearchBtn.hidden = true;
    applyFiltersAndRender();
    els.searchBox.focus();
  });

  document.querySelectorAll("[data-filter]").forEach(button => {
    button.addEventListener("click", () => {
      state.statusFilter = button.dataset.filter;
      document.querySelectorAll("[data-filter]").forEach(item => {
        const active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-pressed", String(active));
      });
      applyFiltersAndRender();
    });
  });

  els.altitudeFilter.addEventListener("change", () => {
    state.altitudeFilter = els.altitudeFilter.value;
    applyFiltersAndRender();
  });
  els.sortFlights.addEventListener("change", () => {
    state.sort = els.sortFlights.value;
    renderFlightList();
  });

  els.flightList.addEventListener("click", event => {
    const card = event.target.closest("[data-icao]");
    if (!card) return;
    selectAircraft(card.dataset.icao, { center: true, fromList: true });
  });
  els.clearSelectionBtn.addEventListener("click", clearSelection);
  els.selectedInfo.addEventListener("click", handleSelectedAction);

  document.querySelectorAll("[data-place]").forEach(button => {
    button.addEventListener("click", () => goToPlace(button.dataset.place));
  });

  els.labelsBtn.addEventListener("click", () => {
    state.prefs.showLabels = !state.prefs.showLabels;
    persistPreferences();
    syncControlsFromPreferences();
    updateAllMarkerIcons();
    showToast(state.prefs.showLabels ? "Aircraft labels on" : "Aircraft labels off");
  });
  els.mapStyleBtn.addEventListener("click", cycleMapStyle);
  els.fullscreenBtn.addEventListener("click", toggleFullscreen);

  bindPreferenceControl(els.autoRefresh, "autoRefresh", value => {
    state.prefs.autoRefresh = value;
    startAutoRefresh();
  });
  bindPreferenceControl(els.liveMotion, "liveMotion", value => {
    state.prefs.liveMotion = value;
    if (!value) resetAircraftToReportedPositions();
    redrawSelectedOverlays();
  });
  els.refreshSeconds.addEventListener("change", () => {
    state.prefs.refreshSeconds = clamp(Number(els.refreshSeconds.value) || 20, 10, 120);
    persistPreferences();
    startAutoRefresh();
  });
  bindPreferenceControl(els.followSelected, "followSelected", value => {
    state.prefs.followSelected = value;
    if (value) followSelectedPlane(true);
  });
  bindPreferenceControl(els.showObservedTrail, "showObservedTrail", () => redrawSelectedOverlays());
  bindPreferenceControl(els.showProjected, "showProjected", () => redrawSelectedOverlays());
  bindPreferenceControl(els.showLabels, "showLabels", () => {
    syncControlsFromPreferences();
    updateAllMarkerIcons();
  });
  bindPreferenceControl(els.showCoverage, "showCoverage", () => updateCoverageGuide());
  bindPreferenceControl(els.hapticsEnabled, "haptics", () => {});
  els.mapStyle.addEventListener("change", () => setMapStyle(els.mapStyle.value));
  els.saveApiBtn.addEventListener("click", saveCustomApi);
  els.clearApiBtn.addEventListener("click", clearCustomApi);
  els.resetPrefsBtn.addEventListener("click", resetPreferences);

  state.map.on("moveend", handleMapSettled);
  state.map.on("zoomend", () => {
    updateAllMarkerIcons();
    renderAll();
  });
  state.map.on("dragstart", () => {
    if (!state.prefs.followSelected) return;
    state.prefs.followSelected = false;
    persistPreferences();
    syncControlsFromPreferences();
    showToast("Following paused while you explore the map");
  });

  els.workspace.addEventListener("click", event => {
    if (state.isMobile && els.app.classList.contains("mobile-panel-open") && event.target === els.workspace) {
      closeMobilePanel();
    }
  });

  let sheetTouchY = null;
  const sheetDragZones = [els.sidebar.querySelector(".mobile-sheet-handle"), els.sidebar.querySelector(".sidebar-heading")];
  sheetDragZones.forEach(zone => {
    zone.addEventListener("touchstart", event => {
      if (!state.isMobile) return;
      sheetTouchY = event.touches[0]?.clientY ?? null;
    }, { passive: true });
    zone.addEventListener("touchend", event => {
      if (sheetTouchY == null) return;
      const endY = event.changedTouches[0]?.clientY ?? sheetTouchY;
      if (endY - sheetTouchY > 70) closeMobilePanel();
      sheetTouchY = null;
    }, { passive: true });
  });

  window.addEventListener("resize", () => {
    const wasMobile = state.isMobile;
    state.isMobile = window.matchMedia("(max-width: 760px)").matches;
    if (wasMobile !== state.isMobile) applyResponsiveLayout();
    window.setTimeout(() => state.map?.invalidateSize(true), 80);
  });
  window.addEventListener("online", () => {
    showToast("Back online — refreshing live aircraft");
    fetchVisibleAircraft({ force: true });
  });
  window.addEventListener("offline", () => {
    setStatus("You are offline", "error", "Last known aircraft remain on the map");
    setMapMessage("Offline — showing the last positions received");
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - state.lastSuccess > state.prefs.refreshSeconds * 1000) {
      fetchVisibleAircraft({ force: true });
    }
  });
  document.addEventListener("keydown", handleKeyboardShortcuts);
  document.addEventListener("fullscreenchange", () => window.setTimeout(() => state.map?.invalidateSize(true), 80));

  // Prevent double-tap zoom and accidental selection on controls without disabling map pinch zoom.
  document.addEventListener("dblclick", event => {
    if (event.target.closest("button,a,summary,label,.flight-card,[role='button']")) event.preventDefault();
  }, { capture: true, passive: false });

  // Give supported touch devices a light response for direct control presses.
  document.addEventListener("pointerup", event => {
    if (event.pointerType !== "touch") return;
    const control = event.target.closest("button,a,summary,.flight-card,select,input[type='checkbox']");
    if (!control || control.disabled) return;
    const isNativeSwitch = control.matches("input[type='checkbox'][switch]");
    if (isNativeSwitch && typeof navigator.vibrate !== "function") return;
    triggerHaptic("light");
  }, { passive: true });
}

function bindPreferenceControl(control, key, onChange) {
  control.addEventListener("change", () => {
    state.prefs[key] = control.checked;
    persistPreferences();
    onChange(control.checked);
  });
}

function syncControlsFromPreferences() {
  els.autoRefresh.checked = state.prefs.autoRefresh;
  els.liveMotion.checked = state.prefs.liveMotion;
  els.refreshSeconds.value = String(state.prefs.refreshSeconds);
  els.followSelected.checked = state.prefs.followSelected;
  els.showObservedTrail.checked = state.prefs.showObservedTrail;
  els.showProjected.checked = state.prefs.showProjected;
  els.showLabels.checked = state.prefs.showLabels;
  els.showCoverage.checked = state.prefs.showCoverage;
  els.hapticsEnabled.checked = state.prefs.haptics;
  els.mapStyle.value = state.prefs.mapStyle;
  els.apiBase.value = state.apiBase;
  els.labelsBtn.setAttribute("aria-pressed", String(state.prefs.showLabels));
}

function applyResponsiveLayout() {
  if (state.isMobile) {
    els.app.classList.remove("sidebar-collapsed");
    els.app.classList.remove("mobile-panel-open");
    els.sidebarToggle.setAttribute("aria-expanded", "false");
  } else {
    els.app.classList.remove("mobile-panel-open");
    els.app.classList.toggle("sidebar-collapsed", state.prefs.sidebarCollapsed);
    els.sidebarToggle.setAttribute("aria-expanded", String(!state.prefs.sidebarCollapsed));
  }
  window.setTimeout(() => state.map?.invalidateSize(true), 280);
}

function toggleAircraftPanel() {
  if (state.isMobile) {
    if (els.app.classList.contains("mobile-panel-open")) closeMobilePanel();
    else openMobilePanel();
    return;
  }
  state.prefs.sidebarCollapsed = !state.prefs.sidebarCollapsed;
  persistPreferences();
  applyResponsiveLayout();
}

function openMobilePanel() {
  if (!state.isMobile) return;
  els.app.classList.add("mobile-panel-open");
  els.sidebarToggle.setAttribute("aria-expanded", "true");
}

function closeMobilePanel() {
  els.app.classList.remove("mobile-panel-open");
  if (state.isMobile) els.sidebarToggle.setAttribute("aria-expanded", "false");
}

function openSettings() {
  syncControlsFromPreferences();
  if (typeof els.settingsDialog.showModal === "function") els.settingsDialog.showModal();
  else els.settingsDialog.setAttribute("open", "");
}

function startAutoRefresh() {
  if (state.refreshTimer) window.clearInterval(state.refreshTimer);
  state.refreshTimer = null;
  if (!state.prefs.autoRefresh) return;
  const seconds = clamp(Number(state.prefs.refreshSeconds) || 20, 10, 120);
  state.refreshTimer = window.setInterval(() => fetchVisibleAircraft(), seconds * 1000);
}

async function fetchVisibleAircraft({ force = false } = {}) {
  if (!state.map) return;
  if (!navigator.onLine) {
    setStatus("You are offline", "error", "Last known aircraft remain on the map");
    setMapMessage("Offline — reconnect to update aircraft");
    return;
  }

  const now = Date.now();
  if (!force && now - state.lastFetchStarted < 1200) return;
  state.lastFetchStarted = now;
  state.requestId += 1;
  const requestId = state.requestId;
  state.fetchController?.abort();
  state.fetchController = new AbortController();
  const context = getQueryContext();
  const candidates = buildSourceCandidates(context);
  const errors = [];

  els.refreshBtn.classList.add("refreshing");
  setStatus("Scanning this airspace…", "loading", "Trying available live data sources");
  clearMapMessage();

  try {
    for (const source of candidates) {
      try {
        const data = await fetchJson(source.url, state.fetchController.signal);
        if (requestId !== state.requestId) return;
        const rows = source.parse(data);
        if (!Array.isArray(rows)) throw new Error("unexpected response format");
        rows.forEach(aircraft => { aircraft.source = source.label; });
        updateAircraft(rows);
        state.lastSuccess = Date.now();
        state.lastSource = source.label;
        state.lastQueryContext = context;
        state.lastSourceCoverage = source.coverage;
        updateCoverageGuide();
        setStatus(
          `${rows.length.toLocaleString()} aircraft received`,
          "live",
          `${source.label} · updated just now`
        );
        followSelectedPlane(false);
        return;
      } catch (error) {
        if (state.fetchController.signal.aborted || requestId !== state.requestId) return;
        errors.push({ source: source.label, error });
        console.warn(`${source.label} failed`, error);
      }
    }

    if (requestId !== state.requestId) return;
    const reason = summarizeFetchErrors(errors);
    setStatus("Live flight data is temporarily unavailable", "error", reason);
    setMapMessage("Couldn’t update live traffic. Existing positions are still shown.");
    renderAll();
  } finally {
    if (requestId === state.requestId) els.refreshBtn.classList.remove("refreshing");
  }
}

function getQueryContext() {
  const bounds = state.map.getBounds();
  const center = bounds.getCenter();
  const corners = [bounds.getNorthEast(), bounds.getNorthWest(), bounds.getSouthEast(), bounds.getSouthWest()];
  const rawRadiusNm = Math.max(...corners.map(point => distanceNm(center.lat, center.lng, point.lat, point.lng)));
  const radiusNm = clamp(Math.ceil(rawRadiusNm), 25, MAX_RADIUS_NM);
  const west = bounds.getWest();
  const east = bounds.getEast();
  const south = clamp(bounds.getSouth(), -90, 90);
  const north = clamp(bounds.getNorth(), -90, 90);
  const bboxUsable = west >= -180 && east <= 180 && west < east && south < north;
  return {
    center: { lat: center.lat, lng: normalizeLongitude(center.lng) },
    bounds,
    rawRadiusNm,
    radiusNm,
    broad: rawRadiusNm > MAX_RADIUS_NM,
    huge: rawRadiusNm > 750,
    bboxUsable,
    bbox: {
      lamin: south.toFixed(4),
      lamax: north.toFixed(4),
      lomin: west.toFixed(4),
      lomax: east.toFixed(4)
    }
  };
}

function buildSourceCandidates(context) {
  const lat = context.center.lat.toFixed(4);
  const lon = context.center.lng.toFixed(4);
  const { lamin, lamax, lomin, lomax } = context.bbox;
  const openSkyPath = `/states/all?lamin=${lamin}&lomin=${lomin}&lamax=${lamax}&lomax=${lomax}&extended=1`;

  if (state.apiBase) {
    const base = state.apiBase;
    const customBounds = {
      label: "Custom OpenSky proxy",
      url: `${base}${openSkyPath}`,
      parse: parseOpenSkyResponse,
      coverage: "bounds"
    };
    const customPoint = {
      label: "Custom ADS-B proxy",
      url: `${base}/v2/point/${lat}/${lon}/${context.radiusNm}`,
      parse: parseReadsbResponse,
      coverage: "radius"
    };
    return context.bboxUsable ? [customBounds, customPoint] : [customPoint];
  }

  const pointSources = [
    {
      label: "Airplanes.live",
      url: `https://api.airplanes.live/v2/point/${lat}/${lon}/${context.radiusNm}`,
      parse: parseReadsbResponse,
      coverage: "radius"
    },
    {
      label: "ADSB.lol",
      url: `https://api.adsb.lol/v2/lat/${lat}/lon/${lon}/dist/${context.radiusNm}`,
      parse: parseReadsbResponse,
      coverage: "radius"
    }
  ];
  const openSky = {
    label: "OpenSky",
    url: `${DEFAULT_OPEN_SKY}${openSkyPath}`,
    parse: parseOpenSkyResponse,
    coverage: "bounds"
  };

  if (context.broad && !context.huge && context.bboxUsable) return [openSky, ...pointSources];
  if (context.huge || !context.bboxUsable) return pointSources;
  return [...pointSources, openSky];
}

async function fetchJson(url, parentSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromParent = () => controller.abort();
  if (parentSignal.aborted) controller.abort();
  else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" }
    });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      error.status = response.status;
      throw error;
    }
    try {
      return await response.json();
    } catch {
      throw new Error("invalid JSON response");
    }
  } catch (error) {
    if (timedOut) throw new Error("request timed out");
    throw error;
  } finally {
    window.clearTimeout(timeout);
    parentSignal.removeEventListener("abort", abortFromParent);
  }
}

function parseOpenSkyResponse(data) {
  if (!data || !(Array.isArray(data.states) || data.states === null)) throw new Error("unexpected OpenSky response");
  const rows = Array.isArray(data.states) ? data.states : [];
  return rows.map(row => ({
    icao24: safeStr(row[0]).toLowerCase(),
    callsign: safeStr(row[1]),
    originCountry: safeStr(row[2]),
    lastContact: num(row[4]) != null ? num(row[4]) * 1000 : null,
    lon: num(row[5]),
    lat: num(row[6]),
    baroAltitude: num(row[7]),
    onGround: row[8] === true,
    velocity: num(row[9]),
    track: num(row[10]),
    verticalRate: num(row[11]),
    geoAltitude: num(row[13]),
    squawk: safeStr(row[14]),
    positionSource: num(row[16]),
    category: num(row[17])
  })).filter(validAircraft);
}

function parseReadsbResponse(data) {
  if (!data || (!Array.isArray(data.ac) && !Array.isArray(data.aircraft))) throw new Error("unexpected ADS-B response");
  const rows = Array.isArray(data.ac) ? data.ac : data.aircraft;
  return rows.map(row => {
    const groundSpeedKt = num(row.gs);
    const dbFlags = num(row.dbFlags) ?? 0;
    const baroAltitude = altValue(row.alt_baro);
    return {
      icao24: safeStr(row.hex || row.icao || row.icao24).toLowerCase(),
      callsign: safeStr(row.flight || row.callsign || row.call),
      originCountry: safeStr(row.country),
      lon: num(row.lon),
      lat: num(row.lat),
      baroAltitude: feetToMeters(baroAltitude),
      geoAltitude: feetToMeters(altValue(row.alt_geom)),
      onGround: row.alt_baro === "ground" || row.gnd === true || row.gnd === 1,
      velocity: groundSpeedKt != null ? groundSpeedKt * 0.514444 : num(row.speed),
      track: num(row.track ?? row.true_heading ?? row.mag_heading),
      verticalRate: fpmToMps(num(row.baro_rate ?? row.geom_rate)),
      squawk: safeStr(row.squawk),
      registration: safeStr(row.r || row.reg),
      aircraftType: safeStr(row.t || row.type),
      description: safeStr(row.desc),
      operator: safeStr(row.ownOp),
      emergency: safeStr(row.emergency),
      category: safeStr(row.category),
      military: Boolean(dbFlags & 1),
      lastContact: num(row.seen) != null ? Date.now() - num(row.seen) * 1000 : null
    };
  }).filter(validAircraft);
}

function updateAircraft(rows) {
  const now = Date.now();
  const seen = new Set();

  for (const incoming of rows) {
    seen.add(incoming.icao24);
    const existing = state.aircraft.get(incoming.icao24);
    if (existing) {
      const previousPosition = [existing.lat, existing.lon];
      const trail = existing.trail;
      const marker = existing.marker;
      const preserved = {
        registration: existing.registration,
        aircraftType: existing.aircraftType,
        description: existing.description,
        operator: existing.operator
      };
      Object.assign(existing, incoming);
      existing.registration ||= preserved.registration;
      existing.aircraftType ||= preserved.aircraftType;
      existing.description ||= preserved.description;
      existing.operator ||= preserved.operator;
      existing.displayLat = incoming.lat;
      existing.displayLon = incoming.lon;
      existing.lastSeenLocal = now;
      existing.missedBatches = 0;
      existing.trail = trail;
      existing.marker = marker;
      if (Number.isFinite(previousPosition[0]) && distanceNm(previousPosition[0], previousPosition[1], incoming.lat, incoming.lon) < 80) {
        existing.trail.push([incoming.lat, incoming.lon]);
      }
      existing.trail = simplifyTrail(existing.trail).slice(-180);
      existing.marker.setLatLng([incoming.lat, incoming.lon]);
      existing.marker.setIcon(makePlaneIcon(existing, state.selectedIcao === incoming.icao24));
      existing.marker.setPopupContent(popupHtml(existing));
    } else {
      incoming.displayLat = incoming.lat;
      incoming.displayLon = incoming.lon;
      incoming.lastSeenLocal = now;
      incoming.missedBatches = 0;
      incoming.trail = [[incoming.lat, incoming.lon]];
      incoming.detailsTried = false;
      incoming.marker = L.marker([incoming.lat, incoming.lon], {
        icon: makePlaneIcon(incoming, false),
        title: incoming.callsign || incoming.registration || incoming.icao24.toUpperCase(),
        alt: `Aircraft ${incoming.callsign || incoming.icao24.toUpperCase()}`,
        keyboard: true,
        riseOnHover: true
      }).addTo(state.map).bindPopup(popupHtml(incoming), { closeButton: true, autoPanPadding: [30, 30] });
      incoming.marker.on("click", () => selectAircraft(incoming.icao24, { fromMarker: true }));
      state.aircraft.set(incoming.icao24, incoming);
    }
  }

  for (const [icao, aircraft] of state.aircraft.entries()) {
    if (seen.has(icao)) continue;
    aircraft.missedBatches = (aircraft.missedBatches || 0) + 1;
    if (now - aircraft.lastSeenLocal > AIRCRAFT_STALE_MS || aircraft.missedBatches >= 5) removeAircraft(icao);
  }

  applyFiltersAndRender();
  redrawSelectedOverlays();
}

function removeAircraft(icao) {
  const aircraft = state.aircraft.get(icao);
  if (!aircraft) return;
  if (state.map.hasLayer(aircraft.marker)) state.map.removeLayer(aircraft.marker);
  state.aircraft.delete(icao);
  if (state.selectedIcao === icao) clearSelection();
}

function applyFiltersAndRender() {
  const search = els.searchBox.value.trim().toLowerCase();
  for (const aircraft of state.aircraft.values()) {
    const shouldShow = aircraftMatchesFilters(aircraft, search);
    if (shouldShow && !state.map.hasLayer(aircraft.marker)) aircraft.marker.addTo(state.map);
    if (!shouldShow && state.map.hasLayer(aircraft.marker)) state.map.removeLayer(aircraft.marker);
  }
  renderAll();
}

function renderAll() {
  renderStats();
  renderFlightList();
  if (state.selectedIcao && state.aircraft.has(state.selectedIcao)) renderSelectedAircraft(state.aircraft.get(state.selectedIcao));
}

function getAircraftInView() {
  if (!state.map) return [];
  const paddedBounds = state.map.getBounds().pad(0.08);
  const cutoff = Date.now() - AIRCRAFT_STALE_MS;
  return [...state.aircraft.values()].filter(aircraft => {
    const lat = aircraft.displayLat ?? aircraft.lat;
    const lon = aircraft.displayLon ?? aircraft.lon;
    return aircraft.lastSeenLocal >= cutoff && paddedBounds.contains([lat, lon]);
  });
}

function getFilteredFlights() {
  const search = els.searchBox.value.trim().toLowerCase();
  const center = state.map.getCenter();
  const flights = getAircraftInView().filter(aircraft => aircraftMatchesFilters(aircraft, search));
  const altitude = aircraft => (aircraft.geoAltitude ?? aircraft.baroAltitude ?? -1);
  const speed = aircraft => aircraft.velocity ?? -1;
  const callsign = aircraft => (aircraft.callsign || aircraft.registration || aircraft.icao24).toLowerCase();
  const distance = aircraft => distanceNm(center.lat, center.lng, aircraft.displayLat ?? aircraft.lat, aircraft.displayLon ?? aircraft.lon);

  flights.sort((a, b) => {
    if (state.sort === "altitude") return altitude(b) - altitude(a);
    if (state.sort === "speed") return speed(b) - speed(a);
    if (state.sort === "callsign") return callsign(a).localeCompare(callsign(b));
    return distance(a) - distance(b);
  });
  return flights;
}

function aircraftMatchesFilters(aircraft, search) {
  const haystack = [
    aircraft.callsign,
    aircraft.icao24,
    aircraft.originCountry,
    aircraft.registration,
    aircraft.aircraftType,
    aircraft.description,
    aircraft.operator
  ].join(" ").toLowerCase();
  if (search && !haystack.includes(search)) return false;
  if (state.statusFilter === "airborne" && aircraft.onGround) return false;
  if (state.statusFilter === "ground" && !aircraft.onGround) return false;
  if (state.statusFilter === "alerts" && !isEmergency(aircraft)) return false;

  const altitudeFt = metersToFeet(aircraft.geoAltitude ?? aircraft.baroAltitude);
  if (state.altitudeFilter === "low" && !(altitudeFt != null && altitudeFt < 10000)) return false;
  if (state.altitudeFilter === "mid" && !(altitudeFt >= 10000 && altitudeFt < 30000)) return false;
  if (state.altitudeFilter === "high" && !(altitudeFt >= 30000)) return false;
  return true;
}

function renderStats() {
  const visible = getAircraftInView();
  const airborne = visible.filter(aircraft => !aircraft.onGround).length;
  const alerts = visible.filter(isEmergency).length;
  els.totalCount.textContent = visible.length.toLocaleString();
  els.airborneCount.textContent = airborne.toLocaleString();
  els.groundCount.textContent = (visible.length - airborne).toLocaleString();
  els.alertCount.textContent = alerts.toLocaleString();
  els.alertCount.closest(".alert-stat").classList.toggle("has-alert", alerts > 0);
  els.mobileFlightCount.textContent = visible.length.toLocaleString();
}

function renderFlightList() {
  const flights = getFilteredFlights();
  els.visibleCount.textContent = flights.length.toLocaleString();
  if (!flights.length) {
    const hasSearch = Boolean(els.searchBox.value.trim()) || state.statusFilter !== "all" || state.altitudeFilter !== "all";
    els.flightList.innerHTML = `<div class="empty-list">
      <div><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v7M12 14v.01"/><circle cx="12" cy="12" r="9"/></svg>
      <strong>${hasSearch ? "No matching aircraft" : "No aircraft in view"}</strong>
      <p>${hasSearch ? "Try clearing a filter or searching another term." : "Move the map or refresh this area."}</p></div>
    </div>`;
    return;
  }

  const center = state.map.getCenter();
  const shown = flights.slice(0, LIST_LIMIT);
  els.flightList.innerHTML = shown.map(aircraft => flightCardHtml(aircraft, center)).join("") +
    (flights.length > LIST_LIMIT ? `<div class="empty-list"><p>Showing the first ${LIST_LIMIT} aircraft. Zoom in to narrow the list.</p></div>` : "");
}

function flightCardHtml(aircraft, center) {
  const altitude = formatAltitude(aircraft);
  const speed = formatSpeed(aircraft);
  const phase = getFlightPhase(aircraft);
  const color = altitudeInfo(aircraft).color;
  const title = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const details = [aircraft.registration, aircraft.aircraftType, aircraft.military ? "Military" : ""].filter(Boolean).join(" · ") || aircraft.originCountry || "Identity unavailable";
  const distance = distanceNm(center.lat, center.lng, aircraft.displayLat ?? aircraft.lat, aircraft.displayLon ?? aircraft.lon);
  const selected = state.selectedIcao === aircraft.icao24;
  return `<button class="flight-card${selected ? " selected" : ""}" type="button" data-icao="${escapeHtml(aircraft.icao24)}" aria-label="Select ${escapeHtml(title)}">
    <div class="flight-main">
      <div class="flight-name-row">
        <svg class="mini-plane" style="--plane-color:${color};--heading:${aircraft.track ?? 0}deg" viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.8c1.2 0 2.1 1 2.1 2.1v8l8.5 5.3c.7.4 1.1 1.2 1.1 2v2.4l-9.6-2.9v5.5l3.4 2.2v1.7L16 27.7l-5.5 1.4v-1.7l3.4-2.2v-5.5l-9.6 2.9v-2.4c0-.8.4-1.6 1.1-2l8.5-5.3v-8c0-1.1.9-2.1 2.1-2.1Z"/></svg>
        <span class="flight-callsign">${escapeHtml(title)}</span>
        ${isEmergency(aircraft) ? `<span class="emergency-mark" title="Emergency squawk"></span>` : `<span class="flight-tag">${escapeHtml(phase.label)}</span>`}
      </div>
      <p class="flight-subtitle">${escapeHtml(details)}</p>
      <div class="flight-numbers"><span>${altitude}<small>alt</small></span><span>${speed}<small>spd</small></span><span>${formatVerticalRate(aircraft)}<small>v/s</small></span></div>
    </div>
    <div class="flight-distance"><strong>${distance < 10 ? distance.toFixed(1) : Math.round(distance)}</strong>nm away</div>
  </button>`;
}

function selectAircraft(icao, options = {}) {
  const aircraft = state.aircraft.get(icao);
  if (!aircraft) return;
  if (state.selectedIcao && state.aircraft.has(state.selectedIcao)) {
    const previous = state.aircraft.get(state.selectedIcao);
    previous.marker.setIcon(makePlaneIcon(previous, false));
  }
  state.selectedIcao = icao;
  aircraft.marker.setIcon(makePlaneIcon(aircraft, true));
  aircraft.marker.setZIndexOffset(1000);
  els.selectedPanel.hidden = false;
  renderSelectedAircraft(aircraft);
  renderFlightList();
  redrawSelectedOverlays();
  if (options.center) centerSelectedAircraft();
  else followSelectedPlane(true);
  loadAircraftDetails(aircraft);
  if (options.fromMarker && state.isMobile) openMobilePanel();
  if (options.fromMarker) triggerHaptic("light");
}

function clearSelection() {
  if (state.selectedIcao && state.aircraft.has(state.selectedIcao)) {
    const aircraft = state.aircraft.get(state.selectedIcao);
    aircraft.marker.setIcon(makePlaneIcon(aircraft, false));
    aircraft.marker.setZIndexOffset(0);
  }
  state.selectedIcao = null;
  els.selectedPanel.hidden = true;
  els.selectedInfo.innerHTML = "";
  clearSelectedOverlays();
  renderFlightList();
}

function renderSelectedAircraft(aircraft) {
  const color = altitudeInfo(aircraft).color;
  const phase = getFlightPhase(aircraft);
  const title = aircraft.callsign || aircraft.registration || "Unknown callsign";
  const subtitle = [aircraft.registration, aircraft.aircraftType, aircraft.description].filter(Boolean).join(" · ") || aircraft.icao24.toUpperCase();
  const flightAware = aircraft.callsign ? `https://flightaware.com/live/flight/${encodeURIComponent(aircraft.callsign.replace(/\s+/g, ""))}` : "";
  const adsbLol = `https://adsb.lol/?icao=${encodeURIComponent(aircraft.icao24)}`;
  els.selectedInfo.innerHTML = `<div class="selected-summary">
    <div class="selected-identity">
      <span class="selected-plane-icon" style="--plane-color:${color};--heading:${aircraft.track ?? 0}deg"><svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 2.8c1.2 0 2.1 1 2.1 2.1v8l8.5 5.3c.7.4 1.1 1.2 1.1 2v2.4l-9.6-2.9v5.5l3.4 2.2v1.7L16 27.7l-5.5 1.4v-1.7l3.4-2.2v-5.5l-9.6 2.9v-2.4c0-.8.4-1.6 1.1-2l8.5-5.3v-8c0-1.1.9-2.1 2.1-2.1Z"/></svg></span>
      <div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(subtitle)}</p></div>
    </div>
    <span class="phase-badge ${phase.className}">${escapeHtml(phase.label)}</span>
  </div>
  <div class="selected-metrics">
    <div><strong data-selected-altitude>${formatAltitude(aircraft)}</strong><small>Altitude</small></div>
    <div><strong data-selected-speed>${formatSpeed(aircraft)}</strong><small>Groundspeed</small></div>
    <div><strong data-selected-heading>${formatHeading(aircraft.track)}</strong><small>Heading</small></div>
  </div>
  <dl class="selected-meta">
    <dt>ICAO hex</dt><dd>${escapeHtml(aircraft.icao24.toUpperCase())}</dd>
    <dt>Country</dt><dd>${escapeHtml(aircraft.originCountry || "—")}</dd>
    <dt>Vertical rate</dt><dd data-selected-rate>${formatVerticalRateLong(aircraft)}</dd>
    <dt>Squawk</dt><dd>${escapeHtml(aircraft.squawk || "—")}${isEmergency(aircraft) ? " · ALERT" : ""}</dd>
    <dt>Position</dt><dd data-selected-position>${formatCoordinates(aircraft)}</dd>
    <dt>Data source</dt><dd>${escapeHtml(aircraft.source || state.lastSource || "—")}</dd>
  </dl>
  <div class="selected-actions">
    <button type="button" data-selected-action="center">Center</button>
    <button type="button" data-selected-action="share">Share</button>
    ${flightAware ? `<a href="${flightAware}" target="_blank" rel="noreferrer">FlightAware</a>` : `<a href="${adsbLol}" target="_blank" rel="noreferrer">ADSB.lol</a>`}
  </div>`;
}

function updateSelectedLiveFields(aircraft) {
  const values = {
    "[data-selected-altitude]": formatAltitude(aircraft),
    "[data-selected-speed]": formatSpeed(aircraft),
    "[data-selected-heading]": formatHeading(aircraft.track),
    "[data-selected-rate]": formatVerticalRateLong(aircraft),
    "[data-selected-position]": formatCoordinates(aircraft)
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = els.selectedInfo.querySelector(selector);
    if (element) element.textContent = value;
  }
}

function handleSelectedAction(event) {
  const action = event.target.closest("[data-selected-action]")?.dataset.selectedAction;
  if (!action || !state.selectedIcao || !state.aircraft.has(state.selectedIcao)) return;
  const aircraft = state.aircraft.get(state.selectedIcao);
  if (action === "center") centerSelectedAircraft();
  if (action === "share") shareAircraft(aircraft);
}

function centerSelectedAircraft() {
  if (!state.selectedIcao || !state.aircraft.has(state.selectedIcao)) return;
  const aircraft = state.aircraft.get(state.selectedIcao);
  state.suppressMoveFetchUntil = Date.now() + 1200;
  state.map.setView([aircraft.displayLat ?? aircraft.lat, aircraft.displayLon ?? aircraft.lon], Math.max(state.map.getZoom(), 9), { animate: true });
  if (state.isMobile) closeMobilePanel();
}

async function shareAircraft(aircraft) {
  const name = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const text = `${name} — ${formatAltitude(aircraft)}, ${formatSpeed(aircraft)}, heading ${formatHeading(aircraft.track)}`;
  const url = aircraft.callsign ? `https://flightaware.com/live/flight/${encodeURIComponent(aircraft.callsign.replace(/\s+/g, ""))}` : window.location.href;
  try {
    if (navigator.share) await navigator.share({ title: `Flight ${name}`, text, url });
    else {
      await navigator.clipboard.writeText(`${text}\n${url}`);
      showToast("Flight details copied to the clipboard");
    }
    triggerHaptic("success");
  } catch (error) {
    if (error.name !== "AbortError") showToast("Could not share this flight");
  }
}

async function loadAircraftDetails(aircraft) {
  if (!aircraft.icao24 || aircraft.detailsTried) return;
  aircraft.detailsTried = true;
  const sources = [
    `https://api.airplanes.live/v2/hex/${encodeURIComponent(aircraft.icao24)}`,
    `https://api.adsb.lol/v2/icao/${encodeURIComponent(aircraft.icao24)}`
  ];
  for (const url of sources) {
    try {
      const controller = new AbortController();
      const data = await fetchJson(url, controller.signal);
      const found = parseReadsbResponse(data).find(item => item.icao24 === aircraft.icao24);
      if (!found) continue;
      aircraft.registration = found.registration || aircraft.registration;
      aircraft.aircraftType = found.aircraftType || aircraft.aircraftType;
      aircraft.description = found.description || aircraft.description;
      aircraft.operator = found.operator || aircraft.operator;
      if (state.selectedIcao === aircraft.icao24) renderSelectedAircraft(aircraft);
      renderFlightList();
      return;
    } catch (error) {
      console.debug("Aircraft detail lookup failed", error);
    }
  }
}

function makePlaneIcon(aircraft, active = false) {
  const altitude = altitudeInfo(aircraft);
  const heading = Number.isFinite(aircraft.track) ? aircraft.track : 0;
  const showLabel = state.prefs.showLabels && state.map && state.map.getZoom() >= 7;
  const label = aircraft.callsign || aircraft.registration || aircraft.icao24.toUpperCase();
  const html = `<div class="plane-marker${active ? " active" : ""}" style="--plane-color:${altitude.color};--heading:${heading}deg">
    ${showLabel ? `<span class="plane-label">${escapeHtml(label)}</span>` : ""}
    <div class="plane-airframe"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 3c2.2 0 4 1.8 4 4v19l19 12c1 .7 1.6 1.8 1.6 3v5.2L36 40v13l7 5v3L32 58l-11 3v-3l7-5V40L7.4 46.2V41c0-1.2.6-2.3 1.6-3l19-12V7c0-2.2 1.8-4 4-4z"/></svg></div>
  </div>`;
  return L.divIcon({ html, className: "", iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -16] });
}

function updateAllMarkerIcons() {
  for (const aircraft of state.aircraft.values()) {
    aircraft.marker.setIcon(makePlaneIcon(aircraft, state.selectedIcao === aircraft.icao24));
  }
}

function popupHtml(aircraft) {
  const title = aircraft.callsign || aircraft.registration || "Unknown callsign";
  const phase = getFlightPhase(aircraft);
  return `<div class="popup-title"><strong>${escapeHtml(title)}</strong><span class="phase-badge ${phase.className}">${escapeHtml(phase.label)}</span></div>
    <dl class="popup-grid"><dt>ICAO</dt><dd>${escapeHtml(aircraft.icao24.toUpperCase())}</dd><dt>Aircraft</dt><dd>${escapeHtml(aircraft.aircraftType || aircraft.description || "—")}</dd><dt>Altitude</dt><dd>${formatAltitude(aircraft)}</dd><dt>Speed</dt><dd>${formatSpeed(aircraft)}</dd><dt>Heading</dt><dd>${formatHeading(aircraft.track)}</dd><dt>Squawk</dt><dd>${escapeHtml(aircraft.squawk || "—")}</dd></dl>`;
}

function animateAircraft(timestamp) {
  if (timestamp - state.lastAnimationAt >= 250) {
    state.lastAnimationAt = timestamp;
    if (state.prefs.liveMotion) {
      const now = Date.now();
      for (const aircraft of state.aircraft.values()) {
        if (aircraft.onGround || !aircraft.velocity || aircraft.track == null) continue;
        const elapsed = clamp((now - aircraft.lastSeenLocal) / 1000, 0, 45);
        const predicted = destinationPoint(aircraft.lat, aircraft.lon, aircraft.track, aircraft.velocity * elapsed);
        aircraft.displayLat = predicted.lat;
        aircraft.displayLon = predicted.lon;
        aircraft.marker.setLatLng([predicted.lat, predicted.lon]);
      }
    }
    if (state.selectedIcao && state.aircraft.has(state.selectedIcao)) {
      const aircraft = state.aircraft.get(state.selectedIcao);
      redrawProjectedLine(aircraft);
      if (timestamp - state.lastSelectedUiAt >= 1000) {
        state.lastSelectedUiAt = timestamp;
        updateSelectedLiveFields(aircraft);
        redrawObservedTrail(aircraft);
        followSelectedPlane(false);
      }
    }
  }
  state.animationFrame = window.requestAnimationFrame(animateAircraft);
}

function resetAircraftToReportedPositions() {
  for (const aircraft of state.aircraft.values()) {
    aircraft.displayLat = aircraft.lat;
    aircraft.displayLon = aircraft.lon;
    aircraft.marker.setLatLng([aircraft.lat, aircraft.lon]);
  }
}

function followSelectedPlane(force = false) {
  if (!state.prefs.followSelected || !state.selectedIcao || !state.aircraft.has(state.selectedIcao)) return;
  const aircraft = state.aircraft.get(state.selectedIcao);
  const lat = aircraft.displayLat ?? aircraft.lat;
  const lon = aircraft.displayLon ?? aircraft.lon;
  const now = Date.now();
  if (!force && now - state.lastFollowPan < FOLLOW_PAN_MS) return;
  state.lastFollowPan = now;
  state.suppressMoveFetchUntil = now + 1400;
  state.map.panTo([lat, lon], { animate: true, duration: 0.4, easeLinearity: 0.25, noMoveStart: true });
}

function redrawSelectedOverlays() {
  if (!state.selectedIcao || !state.aircraft.has(state.selectedIcao)) {
    clearSelectedOverlays();
    return;
  }
  const aircraft = state.aircraft.get(state.selectedIcao);
  redrawObservedTrail(aircraft);
  redrawProjectedLine(aircraft);
}

function redrawObservedTrail(aircraft) {
  if (!state.prefs.showObservedTrail || aircraft.trail.length < 2) {
    removeLayer("trail");
    removeLayer("trailGlow");
    return;
  }
  const points = aircraft.trail.slice();
  const livePoint = [aircraft.displayLat ?? aircraft.lat, aircraft.displayLon ?? aircraft.lon];
  const last = points.at(-1);
  if (!last || Math.abs(last[0] - livePoint[0]) > .00005 || Math.abs(last[1] - livePoint[1]) > .00005) points.push(livePoint);
  if (!state.layers.trailGlow) {
    state.layers.trailGlow = L.polyline(points, { color: "#03101b", weight: 10, opacity: .8, lineCap: "round", lineJoin: "round", interactive: false }).addTo(state.map);
  } else state.layers.trailGlow.setLatLngs(points);
  if (!state.layers.trail) {
    state.layers.trail = L.polyline(points, { color: "#4ade80", weight: 4, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false }).addTo(state.map);
  } else state.layers.trail.setLatLngs(points);
}

function redrawProjectedLine(aircraft) {
  if (!state.prefs.showProjected || aircraft.track == null || !aircraft.velocity) {
    removeLayer("projected");
    return;
  }
  const start = [aircraft.displayLat ?? aircraft.lat, aircraft.displayLon ?? aircraft.lon];
  const destination = destinationPoint(start[0], start[1], aircraft.track, aircraft.velocity * 600);
  const points = [start, [destination.lat, destination.lon]];
  if (!state.layers.projected) {
    state.layers.projected = L.polyline(points, { color: "#40c9ff", weight: 3, opacity: .9, dashArray: "8 8", interactive: false }).addTo(state.map);
  } else state.layers.projected.setLatLngs(points);
}

function clearSelectedOverlays() {
  removeLayer("projected");
  removeLayer("trail");
  removeLayer("trailGlow");
}

function removeLayer(name) {
  if (state.layers[name] && state.map.hasLayer(state.layers[name])) state.map.removeLayer(state.layers[name]);
  state.layers[name] = null;
}

function updateCoverageGuide() {
  removeLayer("coverage");
  els.coverageBadge.hidden = true;
  const context = state.lastQueryContext;
  if (!state.prefs.showCoverage || !context || state.lastSourceCoverage !== "radius" || !context.broad) return;
  state.layers.coverage = L.circle([context.center.lat, context.center.lng], {
    radius: context.radiusNm * 1852,
    color: "#40c9ff",
    weight: 2,
    opacity: .7,
    fillColor: "#40c9ff",
    fillOpacity: .025,
    dashArray: "8 8",
    interactive: false
  }).addTo(state.map);
  state.layers.coverage.bringToBack();
  els.coverageBadge.hidden = false;
}

function handleMapSettled() {
  saveCurrentView();
  renderAll();
  if (Date.now() < state.suppressMoveFetchUntil) return;
  window.clearTimeout(state.moveTimer);
  state.moveTimer = window.setTimeout(() => fetchVisibleAircraft(), MOVE_FETCH_DELAY_MS);
}

function goToPlace(placeName) {
  const place = PLACES[placeName];
  if (!place) return;
  if (place.bounds) state.map.fitBounds(place.bounds, { padding: [18, 18] });
  else state.map.setView(place.center, place.zoom, { animate: true });
  document.querySelectorAll("[data-place]").forEach(button => button.classList.toggle("active", button.dataset.place === placeName));
  if (state.isMobile) closeMobilePanel();
}

function locateUser() {
  if (!navigator.geolocation) {
    showToast("Location is not supported by this browser");
    return;
  }
  els.locateBtn.classList.add("locating");
  els.locateBtn.disabled = true;
  navigator.geolocation.getCurrentPosition(position => {
    const latlng = [position.coords.latitude, position.coords.longitude];
    if (state.userLocationMarker) state.map.removeLayer(state.userLocationMarker);
    if (state.userAccuracyCircle) state.map.removeLayer(state.userAccuracyCircle);
    state.userAccuracyCircle = L.circle(latlng, { radius: position.coords.accuracy, color: "#40c9ff", weight: 1, fillColor: "#40c9ff", fillOpacity: .08, interactive: false }).addTo(state.map);
    state.userLocationMarker = L.circleMarker(latlng, { radius: 7, color: "#e6f8ff", weight: 3, fillColor: "#0ea5e9", fillOpacity: 1 }).addTo(state.map).bindTooltip("Your location");
    state.map.setView(latlng, 9, { animate: true });
    showToast("Map centered on your location");
    els.locateBtn.classList.remove("locating");
    els.locateBtn.disabled = false;
    triggerHaptic("success");
  }, error => {
    const message = error.code === 1 ? "Location permission was denied" : "Your location could not be determined";
    showToast(message);
    els.locateBtn.classList.remove("locating");
    els.locateBtn.disabled = false;
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function setMapStyle(style, announce = true) {
  const validStyle = TILE_STYLES[style] ? style : "dark";
  state.prefs.mapStyle = validStyle;
  persistPreferences();
  if (state.tileLayer && state.map) state.map.removeLayer(state.tileLayer);
  if (state.map) {
    const tile = TILE_STYLES[validStyle];
    state.tileLayer = L.tileLayer(tile.url, tile.options).addTo(state.map);
    state.tileLayer.bringToBack();
  }
  syncControlsFromPreferences();
  if (announce) showToast(`${capitalize(validStyle)} map selected`);
}

function cycleMapStyle() {
  const styles = ["dark", "street", "light"];
  const index = styles.indexOf(state.prefs.mapStyle);
  setMapStyle(styles[(index + 1) % styles.length]);
}

async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen();
    else showToast("Fullscreen is not available in this browser");
  } catch {
    showToast("Fullscreen could not be opened");
  }
}

function saveCustomApi() {
  const value = els.apiBase.value.trim().replace(/\/$/, "");
  if (value) {
    try {
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("unsupported protocol");
    } catch {
      showToast("Enter a valid HTTP or HTTPS API URL");
      els.apiBase.focus();
      return;
    }
  }
  state.apiBase = value;
  if (value) safeStorageSet(API_KEY, value);
  else safeStorageRemove(API_KEY);
  showToast(value ? "Custom data source saved" : "Automatic data sources restored");
  fetchVisibleAircraft({ force: true });
}

function clearCustomApi() {
  state.apiBase = "";
  els.apiBase.value = "";
  safeStorageRemove(API_KEY);
  showToast("Using automatic data sources");
  fetchVisibleAircraft({ force: true });
}

function resetPreferences() {
  state.prefs = { ...DEFAULT_PREFS };
  safeStorageRemove(PREFS_KEY);
  syncControlsFromPreferences();
  applyResponsiveLayout();
  setMapStyle(state.prefs.mapStyle, false);
  startAutoRefresh();
  resetAircraftToReportedPositions();
  updateAllMarkerIcons();
  redrawSelectedOverlays();
  updateCoverageGuide();
  showToast("Tracker preferences reset");
}

function handleKeyboardShortcuts(event) {
  const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
  if (event.key === "/" && !typing) {
    event.preventDefault();
    els.searchBox.focus();
  }
  if ((event.key === "r" || event.key === "R") && !typing) fetchVisibleAircraft({ force: true });
  if (event.key === "Escape" && !els.settingsDialog.open) {
    if (state.isMobile && els.app.classList.contains("mobile-panel-open")) closeMobilePanel();
    else clearSelection();
  }
}

function setStatus(message, type = "loading", detail = "") {
  els.status.textContent = message;
  els.sourceMeta.textContent = detail;
  els.statusCard.dataset.state = type;
  els.dataHealth.dataset.state = type;
  els.dataHealthLabel.textContent = type === "live" ? "Live" : type === "error" ? "Unavailable" : "Connecting";
  els.retryBtn.hidden = type !== "error";
}

function updateTimeLabels() {
  if (!state.lastSuccess || !state.lastSource) return;
  const seconds = Math.max(0, Math.floor((Date.now() - state.lastSuccess) / 1000));
  const age = seconds < 5 ? "updated just now" : seconds < 60 ? `updated ${seconds}s ago` : `updated ${Math.floor(seconds / 60)}m ago`;
  if (els.statusCard.dataset.state === "live") els.sourceMeta.textContent = `${state.lastSource} · ${age}`;
}

function setMapMessage(message) {
  els.mapMessage.textContent = message;
  els.mapMessage.hidden = false;
}

function setFatalMapMessage(message) {
  els.mapMessage.textContent = message;
  els.mapMessage.hidden = false;
}

function clearMapMessage() {
  els.mapMessage.hidden = true;
  els.mapMessage.textContent = "";
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  state.toastTimer = window.setTimeout(() => { els.toast.hidden = true; }, 2600);
}

function triggerHaptic(kind = "light") {
  if (!state.prefs.haptics) return;
  try {
    if (typeof navigator.vibrate === "function") {
      const pattern = kind === "success" ? [10, 24, 10] : kind === "warning" ? [18, 35, 18] : 8;
      navigator.vibrate(pattern);
      return;
    }
    // Safari 18+ provides a native haptic for checkbox controls using the `switch` attribute.
    // Clicking this off-screen switch from the original user gesture gives iPhone buttons a subtle tap.
    if (els.hapticSwitch) els.hapticSwitch.click();
  } catch {
    // Haptics are an optional enhancement and should never block an action.
  }
}

function summarizeFetchErrors(errors) {
  if (errors.some(item => item.error?.status === 429)) return "Public sources are rate-limiting requests — wait a moment and retry";
  if (errors.some(item => [401, 403].includes(item.error?.status))) return "A source rejected the request; a custom proxy may be needed";
  if (errors.some(item => item.error?.message === "request timed out")) return "The public data sources timed out";
  return "Network or browser CORS restrictions blocked every available source";
}

function altitudeInfo(aircraft) {
  const altitudeFt = metersToFeet(aircraft.geoAltitude ?? aircraft.baroAltitude);
  if (aircraft.onGround) return { color: "#94a3b8", label: "Ground" };
  if (altitudeFt == null) return { color: "#cbd5e1", label: "Unknown altitude" };
  if (altitudeFt < 10000) return { color: "#4ade80", label: "Below 10,000 ft" };
  if (altitudeFt < 20000) return { color: "#38bdf8", label: "10,000–20,000 ft" };
  if (altitudeFt < 30000) return { color: "#818cf8", label: "20,000–30,000 ft" };
  if (altitudeFt < 40000) return { color: "#c084fc", label: "30,000–40,000 ft" };
  return { color: "#fb923c", label: "Above 40,000 ft" };
}

function getFlightPhase(aircraft) {
  if (isEmergency(aircraft)) return { label: `Alert ${aircraft.squawk || ""}`.trim(), className: "alert" };
  if (aircraft.onGround) return { label: "Ground", className: "ground" };
  const feetPerMinute = aircraft.verticalRate != null ? aircraft.verticalRate * 196.8504 : 0;
  if (feetPerMinute > 300) return { label: "Climbing", className: "" };
  if (feetPerMinute < -300) return { label: "Descending", className: "descending" };
  const altitudeFt = metersToFeet(aircraft.geoAltitude ?? aircraft.baroAltitude);
  if (altitudeFt != null && altitudeFt > 28000) return { label: "Cruise", className: "" };
  return { label: "Level", className: "" };
}

function isEmergency(aircraft) {
  const emergency = safeStr(aircraft.emergency).toLowerCase();
  return ["7500", "7600", "7700"].includes(aircraft.squawk) || Boolean(emergency && !["none", "no emergency"].includes(emergency));
}

function formatAltitude(aircraft) {
  if (aircraft.onGround) return "Ground";
  const feet = metersToFeet(aircraft.geoAltitude ?? aircraft.baroAltitude);
  if (feet == null) return "—";
  const rounded = Math.abs(feet) >= 1000 ? Math.round(feet / 100) * 100 : Math.round(feet);
  return `${rounded.toLocaleString()} ft`;
}

function formatSpeed(aircraft) {
  return aircraft.velocity == null ? "—" : `${Math.round(aircraft.velocity * 1.943844)} kt`;
}

function formatHeading(value) {
  return value == null ? "—" : `${String(Math.round(value)).padStart(3, "0")}°`;
}

function formatVerticalRate(aircraft) {
  if (aircraft.verticalRate == null) return "—";
  const rate = Math.round(aircraft.verticalRate * 196.8504 / 100) * 100;
  if (Math.abs(rate) < 100) return "Level";
  return `${rate > 0 ? "+" : ""}${Math.round(rate / 100) / 10}k`;
}

function formatVerticalRateLong(aircraft) {
  if (aircraft.verticalRate == null) return "—";
  const rate = Math.round(aircraft.verticalRate * 196.8504 / 100) * 100;
  return `${rate > 0 ? "+" : ""}${rate.toLocaleString()} ft/min`;
}

function formatCoordinates(aircraft) {
  const lat = aircraft.displayLat ?? aircraft.lat;
  const lon = aircraft.displayLon ?? aircraft.lon;
  return `${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

function safeStr(value) {
  return value == null ? "" : String(value).trim();
}

function num(value) {
  if (value == null || value === "" || typeof value === "boolean") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function validAircraft(aircraft) {
  return Boolean(aircraft.icao24) && Number.isFinite(aircraft.lat) && Number.isFinite(aircraft.lon) &&
    aircraft.lat >= -90 && aircraft.lat <= 90 && aircraft.lon >= -180 && aircraft.lon <= 180;
}

function altValue(value) {
  return value === "ground" ? 0 : num(value);
}

function feetToMeters(value) {
  return value == null ? null : value * .3048;
}

function metersToFeet(value) {
  return value == null ? null : value * 3.28084;
}

function fpmToMps(value) {
  return value == null ? null : value * .00508;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function normalizeLongitude(value) {
  return ((value + 540) % 360) - 180;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function simplifyTrail(points) {
  const simplified = [];
  for (const point of points) {
    const previous = simplified.at(-1);
    if (!previous || Math.abs(previous[0] - point[0]) > .00025 || Math.abs(previous[1] - point[1]) > .00025) simplified.push(point);
  }
  return simplified;
}

function destinationPoint(lat, lon, bearingDegrees, distanceMeters) {
  const angularDistance = distanceMeters / EARTH_RADIUS_M;
  const bearing = toRadians(bearingDegrees);
  const latitude = toRadians(lat);
  const longitude = toRadians(lon);
  const destinationLatitude = Math.asin(Math.sin(latitude) * Math.cos(angularDistance) + Math.cos(latitude) * Math.sin(angularDistance) * Math.cos(bearing));
  const y = Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(latitude);
  const x = Math.cos(angularDistance) - Math.sin(latitude) * Math.sin(destinationLatitude);
  const destinationLongitude = longitude + Math.atan2(y, x);
  return { lat: toDegrees(destinationLatitude), lon: normalizeLongitude(toDegrees(destinationLongitude)) };
}

function distanceNm(lat1, lon1, lat2, lon2) {
  const p1 = toRadians(lat1);
  const p2 = toRadians(lat2);
  const deltaLat = toRadians(lat2 - lat1);
  const deltaLon = toRadians(lon2 - lon1);
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(deltaLon / 2) ** 2;
  return (EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))) / 1852;
}

function toRadians(degrees) { return degrees * Math.PI / 180; }
function toDegrees(radians) { return radians * 180 / Math.PI; }

function loadPreferences() {
  try {
    const saved = JSON.parse(safeStorageGet(PREFS_KEY) || "{}");
    const preferences = { ...DEFAULT_PREFS, ...saved };
    preferences.refreshSeconds = clamp(Number(preferences.refreshSeconds) || 20, 10, 120);
    if (!TILE_STYLES[preferences.mapStyle]) preferences.mapStyle = "dark";
    return preferences;
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

function persistPreferences() {
  safeStorageSet(PREFS_KEY, JSON.stringify(state.prefs));
}

function loadSavedView() {
  try {
    const saved = JSON.parse(safeStorageGet(VIEW_KEY) || "null");
    if (saved && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) && Number.isFinite(saved.zoom)) {
      return { center: [saved.lat, saved.lng], zoom: clamp(saved.zoom, 2, 15) };
    }
  } catch {}
  return { center: PLACES["east-texas"].center, zoom: PLACES["east-texas"].zoom };
}

function saveCurrentView() {
  if (!state.map) return;
  const center = state.map.getCenter();
  safeStorageSet(VIEW_KEY, JSON.stringify({ lat: center.lat, lng: normalizeLongitude(center.lng), zoom: state.map.getZoom() }));
}

function safeStorageGet(key) {
  try { return window.localStorage.getItem(key); } catch { return null; }
}

function safeStorageSet(key, value) {
  try { window.localStorage.setItem(key, value); } catch {}
}

function safeStorageRemove(key) {
  try { window.localStorage.removeItem(key); } catch {}
}

window.addEventListener("load", init);
