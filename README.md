# Live Flight Tracker

A polished, touch-friendly live aircraft radar that runs entirely in the browser. It combines Leaflet maps with public ADS-B data from Airplanes.live, ADSB.lol, and OpenSky, automatically falling back when a source is unavailable. Leaflet is vendored in the repository so a third-party script CDN cannot prevent the app from starting.

## What it can do

- Plot live aircraft with heading-correct, altitude-colored markers.
- Search by callsign, registration, ICAO hex, aircraft type, operator, or country.
- Filter airborne, ground, and emergency aircraft plus altitude ranges.
- Sort the in-view flight list by distance, altitude, speed, or callsign.
- Show visible, airborne, ground, and emergency counts at a glance.
- Follow a selected aircraft with smooth dead-reckoned motion between updates.
- Draw the aircraft positions observed during the current session.
- Project the selected aircraft 10 minutes ahead from its present track and groundspeed.
- Enrich selected aircraft with registration, type, and operator details when available.
- Switch between dark radar, street, and light map styles.
- Jump to East Texas, Houston, Dallas, the United States, or the device's current location.
- Share a selected flight through the system share sheet or clipboard.
- Persist map position and interface preferences locally.
- Explain rate limits, CORS failures, offline state, stale data, and wide-area coverage instead of failing silently.

## iPhone and touch support

- Controls use `touch-action: manipulation`, which prevents double-tap text zoom on buttons while preserving normal pinch zoom on the map.
- Mobile form controls use a 16 px font to prevent Safari's automatic focus zoom.
- Safari 18+ gets native haptics from checkbox controls using its `switch` attribute.
- Other supported mobile browsers use the Vibration API for light button feedback.
- A best-effort hidden native switch extends haptic feedback to regular buttons on current iOS Safari.
- Haptics can be disabled under **Tracker settings -> Map -> Haptic feedback**.

## Data behavior

The tracker tries these sources in order based on the size of the current map view:

1. [Airplanes.live](https://airplanes.live/api-guide/) for nearby point/radius searches.
2. [ADSB.lol](https://api.adsb.lol/) as the next public ADS-B source.
3. [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) for bounding-box coverage and fallback data.

Point/radius APIs cover at most 250 nautical miles. When a national-scale view must fall back to one of them, the app draws and labels the actual coverage circle rather than implying that the whole screen was scanned. Zoom or pan to scan a different area.

Public services can be delayed, incomplete, blocked by browser CORS rules, or rate-limited. This project is for education and visualization only and is not for navigation.

## Run locally

No build or package installation is required:

```bash
node server.js
```

Then open `http://localhost:5173`.

## Publish with GitHub Pages

In the repository, choose:

`Settings -> Pages -> Deploy from a branch -> main -> /root`

The site will be available at:

`https://jibarclay2006-sketch.github.io/Flight-Tracker/`

## Optional CORS proxy

If every automatic source is blocked in the browser, deploy `cloudflare-worker.js` as a Cloudflare Worker. In the tracker, open **Settings -> Advanced data settings** and paste the Worker's base URL.

The included Worker:

- proxies only the allowed OpenSky state and track endpoints;
- handles browser CORS preflight requests;
- rejects non-GET methods and unknown paths;
- returns a useful `502` response if OpenSky is unreachable.

Do not place private API credentials in this repository or in the browser settings field.

## Keyboard shortcuts

- `/` focuses aircraft search.
- `R` refreshes the current airspace.
- `Escape` closes the mobile aircraft panel or clears the selected aircraft.
