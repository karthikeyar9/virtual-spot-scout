# Auto Rush map data

`hyd-roads.osm.json` is an OpenStreetMap extract of central Hyderabad's main roads
(Charminar up to Hussain Sagar). Road data © OpenStreetMap contributors, ODbL.

To refresh it (run from the repo root):

```
curl -f -A "auto-rush-game/1.0" -o backend/data/hyd-roads.osm.json --data-urlencode 'data=[out:json][timeout:60];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"](17.355,78.455,17.430,78.495);out geom;' https://overpass-api.de/api/interpreter
node backend/scripts/build-auto-rush-map.js
```

The script writes `backend/games/auto-rush-hyderabad.json`, which the server loads.
Set `AUTO_RUSH_MAP=grid` to play on the original grid city instead.
