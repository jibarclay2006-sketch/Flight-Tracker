# Live Flight Tracker

A browser-based live aircraft tracker built with Leaflet, OpenStreetMap tiles, and OpenSky aircraft state-vector data.

## Features

- Interactive map of aircraft in the visible map area.
- Live marker motion between API refreshes using speed and heading dead reckoning.
- Correctly rotated aircraft SVG icons based on true track.
- Search by callsign, ICAO24, or origin country.
- Click an aircraft for altitude, speed, heading, vertical rate, squawk, and coordinates.
- Observed trail for the selected aircraft.
- Projected heading line for the selected aircraft.
- Attempts to fetch OpenSky track/route data for a selected aircraft when available.
- FlightAware lookup link for fuller route information when the data source does not include official flight-plan routing.

## GitHub Pages

This repo is ready for GitHub Pages. In GitHub, go to:

`Settings -> Pages -> Deploy from a branch -> main -> /root`

The published URL should look like:

`https://jibarclay2006-sketch.github.io/Flight-Tracker/`

## Important Data Notes

OpenSky state-vector data is not a complete commercial flight-tracking product. It may be delayed, incomplete, or rate-limited. Route and flight-plan data may not always be available. This app is for educational/visualization use only and is not for navigation.

## Local Development

You can open `index.html` directly, or run a small local server:

```bash
node server.js
```

Then open:

```text
http://localhost:5173
```

## CORS / Proxy Option

If the GitHub Pages version cannot directly call OpenSky from the browser, deploy `cloudflare-worker.js` as a Cloudflare Worker, then paste that Worker URL into the app under **Advanced API settings**.
