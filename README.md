# Live Flight Tracker

A polished, touch-friendly live aircraft radar that runs in the browser. It combines and deduplicates public ADS-B data from Airplanes.live, ADSB.lol, ADSB.fi, and OpenSky instead of stopping after the first feed responds. Leaflet is vendored in the repository so a third-party script CDN cannot prevent the app from starting.

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
- Show per-feed health, unique merged counts, and an explicit surface-receiver coverage warning.

## iPhone and touch support

- Controls use `touch-action: manipulation`, which prevents double-tap text zoom on buttons while preserving normal pinch zoom on the map.
- Mobile form controls use a 16 px font to prevent Safari's automatic focus zoom.
- Safari 18+ gets native haptics from checkbox controls using its `switch` attribute.
- Other supported mobile browsers use the Vibration API for light button feedback.
- A best-effort hidden native switch extends haptic feedback to regular buttons on current iOS Safari.
- Haptics can be disabled under **Tracker settings -> Map -> Haptic feedback**.

## Data behavior

The tracker checks these sources together and merges aircraft by ICAO hex:

1. [Airplanes.live](https://airplanes.live/api-guide/) for nearby point/radius searches.
2. [ADSB.lol](https://api.adsb.lol/) for another community receiver network.
3. [ADSB.fi](https://opendata.adsb.fi/) for an additional community feed.
4. [OpenSky](https://openskynetwork.github.io/opensky-api/rest.html) for bounding-box state vectors.

Open **Feed details** below the aircraft list to see which providers responded, how many rows each reported, and whether surface coverage is thin.

Point/radius APIs cover at most 250 nautical miles. When a national-scale view must fall back to one of them, the app draws and labels the actual coverage circle rather than implying that the whole screen was scanned. Zoom or pan to scan a different area.

Public services can be delayed, incomplete, blocked by browser CORS rules, or rate-limited. Ground transponders are especially easy to miss because low-altitude surface signals require receivers close to the airport. A successful request does not guarantee complete airport coverage. This project is for education and visualization only and is not for navigation.

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

## Optional multi-source proxy

Some public providers do not permit direct cross-origin browser requests. To make every configured source available from GitHub Pages, deploy `cloudflare-worker.js` as a Cloudflare Worker. In the tracker, open **Settings -> Advanced data settings** and paste the Worker's base URL.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/jibarclay2006-sketch/Flight-Tracker)

The button uses the repository's `wrangler.jsonc` configuration to create the proxy in your own Cloudflare account. After deployment, copy the provided `https://...workers.dev` address, paste it into **Custom API base URL**, and save.

In the Cloudflare dashboard:

1. Open **Workers & Pages**, create a Worker, and replace its starter code with `cloudflare-worker.js`.
2. Deploy it and copy the resulting `https://...workers.dev` URL.
3. Paste that URL into the tracker's **Custom API base URL** field and save.

The included Worker:

- proxies only validated Airplanes.live, ADSB.lol, ADSB.fi, and OpenSky paths;
- handles browser CORS preflight requests;
- rejects non-GET methods and unknown paths;
- times out slow upstreams and returns a useful `502` response when a provider is unreachable.

The proxy fixes browser access and lets the app merge all configured feeds; it cannot add ground aircraft that none of those receiver networks captured. For near-complete airport surface traffic, connect a licensed commercial provider or a well-placed local receiver through a compatible private proxy.

Do not place private API credentials in this repository or in the browser settings field.

## Keyboard shortcuts

- `/` focuses aircraft search.
- `R` refreshes the current airspace.
- `Escape` closes the mobile aircraft panel or clears the selected aircraft.
