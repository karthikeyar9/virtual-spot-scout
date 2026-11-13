// Builds Auto Rush's real-road map from an OpenStreetMap extract of central
// Hyderabad (Charminar up to Hussain Sagar).
//
//   node backend/scripts/build-auto-rush-map.js [osm.json] [out.json]
//
// The extract comes from the Overpass API (see backend/data/README.md). Road
// data © OpenStreetMap contributors, ODbL. The output is plain game data: a
// road graph in map pixels plus stops, landmark plots, the lake and traffic
// routes, so the server and every client share one source of truth.

const fs = require('fs');
const path = require('path');

const SRC = process.argv[2] || path.join(__dirname, '../data/hyd-roads.osm.json');
const OUT = process.argv[3] || path.join(__dirname, '../games/auto-rush-hyderabad.json');

const BOUNDS = { south: 17.355, north: 17.43, west: 78.455, east: 78.495 };
const PX_PER_M = 2; // the city is squeezed so a cross-town fare takes about a minute
const PAD = 240;
const ROAD_WIDTH = { trunk: 104, primary: 104, secondary: 96, tertiary: 84 };
const SIMPLIFY_PX = 3;
const MIN_STOP_GAP = 420;
const BLOCK_W = 288, BLOCK_H = 240;
const LAKE_CELL = 48;
const LAKE_SEED = { lat: 17.4156, lon: 78.475 }; // the Buddha statue
const LAKE_LIMIT = { south: 17.4085, west: 78.4623, east: 78.489 }; // keeps the flood between Necklace Road and Tank Bund

// [name, emoji, kind, lat, lon]. Positions are approximate; each stop snaps to the nearest road.
const LANDMARKS = [
  ['Charminar', '🕌', 'heritage', 17.3616, 78.4747],
  ['Chowmahalla Palace', '👑', 'heritage', 17.3578, 78.4716],
  ['Pathergatti', '💍', 'food', 17.3668, 78.476],
  ['High Court', '⚖️', 'heritage', 17.3692, 78.4722],
  ['Osmania Hospital', '🏥', 'homes', 17.3722, 78.4742],
  ['Salar Jung Museum', '🏛️', 'heritage', 17.3713, 78.4804],
  ['Purani Haveli', '🏯', 'heritage', 17.3668, 78.4838],
  ['Dabeerpura', '🚪', 'homes', 17.369, 78.4905],
  ['MGBS Bus Station', '🚌', 'transit', 17.3784, 78.4855],
  ['Chaderghat', '🌉', 'homes', 17.377, 78.491],
  ['Mozamjahi Market', '🍦', 'food', 17.3846, 78.4745],
  ['Koti', '📚', 'food', 17.3853, 78.4858],
  ['Abids', '🛍️', 'food', 17.3912, 78.4766],
  ['King Koti', '🏰', 'homes', 17.3925, 78.485],
  ['Nampally Station', '🚉', 'transit', 17.3924, 78.4675],
  ['Narayanguda', '🎬', 'homes', 17.3958, 78.4897],
  ['Public Gardens', '🌳', 'park', 17.3985, 78.469],
  ['Basheerbagh', '🏢', 'tech', 17.4003, 78.4775],
  ['Himayatnagar', '🏡', 'homes', 17.4022, 78.485],
  ['Lakdikapul', '🚦', 'homes', 17.404, 78.4645],
  ['Birla Mandir', '🛕', 'heritage', 17.4062, 78.4691],
  ['Secretariat', '🏛️', 'tech', 17.4068, 78.4722],
  ['Lumbini Park', '⛵', 'park', 17.41, 78.4733],
  ['NTR Gardens', '🎡', 'park', 17.4124, 78.4687],
  ['Khairatabad', '🐘', 'homes', 17.4113, 78.4612],
  ['Indira Park', '🌲', 'park', 17.4135, 78.485],
  ['Necklace Road', '🚲', 'park', 17.419, 78.464],
  ['Tank Bund', '🗿', 'park', 17.419, 78.48],
];

// ---- Projection ----

const midLat = (BOUNDS.south + BOUNDS.north) / 2 * Math.PI / 180;
const project = (lat, lon) => ({
  x: PAD + (lon - BOUNDS.west) * Math.cos(midLat) * 111320 * PX_PER_M,
  y: PAD + (BOUNDS.north - lat) * 110574 * PX_PER_M,
});
const far = project(BOUNDS.south, BOUNDS.east);
const width = Math.round(far.x + PAD), height = Math.round(far.y + PAD);

function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(1591); // the year Hyderabad was founded

// ---- Roads: OSM ways -> one connected, simplified graph ----

const osm = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const nodeIndex = new Map();
let nodes = []; // {x, y}
let ways = []; // {n: [node index], w}

for (const el of osm.elements) {
  if (el.type !== 'way' || !el.geometry || !el.nodes) continue;
  const w = ROAD_WIDTH[el.tags && el.tags.highway];
  if (!w) continue;
  let run = [];
  const flush = () => { if (run.length > 1) ways.push({ n: run, w }); run = []; };
  el.geometry.forEach((g, i) => {
    const inside = g && g.lat >= BOUNDS.south && g.lat <= BOUNDS.north && g.lon >= BOUNDS.west && g.lon <= BOUNDS.east;
    if (!inside) { flush(); return; }
    const id = el.nodes[i];
    if (!nodeIndex.has(id)) { nodeIndex.set(id, nodes.length); nodes.push(project(g.lat, g.lon)); }
    const index = nodeIndex.get(id);
    if (run[run.length - 1] !== index) run.push(index);
  });
  flush();
}

// Keep the largest connected piece so every stop is reachable from every other
{
  const parent = nodes.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  for (const way of ways) for (let i = 1; i < way.n.length; i++) parent[find(way.n[i])] = find(way.n[0]);
  const size = new Map();
  for (const way of ways) size.set(find(way.n[0]), (size.get(find(way.n[0])) || 0) + way.n.length);
  const main = [...size.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const before = ways.length;
  ways = ways.filter(way => find(way.n[0]) === main);
  console.log(`roads: kept ${ways.length} of ${before} ways (largest connected network)`);
}

// Straighten out needless detail, but never drop a junction or a way's end
{
  const uses = new Array(nodes.length).fill(0);
  for (const way of ways) way.n.forEach((n, i) => { uses[n] += (i === 0 || i === way.n.length - 1) ? 2 : 1; });
  const simplify = (chain) => {
    if (chain.length < 3) return chain;
    const a = nodes[chain[0]], b = nodes[chain[chain.length - 1]];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
    let worst = 0, at = -1;
    for (let i = 1; i < chain.length - 1; i++) {
      const p = nodes[chain[i]];
      const d = Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
      if (d > worst) { worst = d; at = i; }
    }
    if (worst <= SIMPLIFY_PX) return [chain[0], chain[chain.length - 1]];
    return [...simplify(chain.slice(0, at + 1)).slice(0, -1), ...simplify(chain.slice(at))];
  };
  for (const way of ways) {
    const out = [way.n[0]];
    let start = 0;
    for (let i = 1; i < way.n.length; i++) {
      if (uses[way.n[i]] > 1 || i === way.n.length - 1) {
        out.push(...simplify(way.n.slice(start, i + 1)).slice(1));
        start = i;
      }
    }
    way.n = out;
  }
  const remap = new Map();
  const kept = [];
  for (const way of ways) {
    way.n = way.n.map(n => {
      if (!remap.has(n)) { remap.set(n, kept.length); kept.push({ x: Math.round(nodes[n].x), y: Math.round(nodes[n].y) }); }
      return remap.get(n);
    });
    way.n = way.n.filter((n, i) => i === 0 || n !== way.n[i - 1]);
  }
  ways = ways.filter(way => way.n.length > 1);
  nodes = kept;
}

// Segments, a coarse lookup grid, and the graph
const segs = [];
for (const way of ways) for (let i = 1; i < way.n.length; i++) segs.push({ a: way.n[i - 1], b: way.n[i], hw: way.w / 2 });
const GRID = 256, REACH = 320;
const grid = new Map();
segs.forEach((s, i) => {
  const a = nodes[s.a], b = nodes[s.b], r = s.hw + REACH;
  for (let cx = Math.floor((Math.min(a.x, b.x) - r) / GRID); cx <= Math.floor((Math.max(a.x, b.x) + r) / GRID); cx++) {
    for (let cy = Math.floor((Math.min(a.y, b.y) - r) / GRID); cy <= Math.floor((Math.max(a.y, b.y) + r) / GRID); cy++) {
      const key = cx * 4096 + cy;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  }
});
function nearestOnSeg(s, x, y) {
  const a = nodes[s.a], b = nodes[s.b];
  const dx = b.x - a.x, dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  const px = a.x + dx * t, py = a.y + dy * t;
  return { x: px, y: py, d: Math.hypot(x - px, y - py), angle: Math.atan2(dy, dx) };
}
/** Distance from a point to the nearest road edge (negative on a road). Capped at REACH. */
function clearance(x, y) {
  let best = REACH;
  for (const i of grid.get(Math.floor(x / GRID) * 4096 + Math.floor(y / GRID)) || []) {
    best = Math.min(best, nearestOnSeg(segs[i], x, y).d - segs[i].hw);
  }
  return best;
}
const totalLength = segs.reduce((sum, s) => sum + Math.hypot(nodes[s.b].x - nodes[s.a].x, nodes[s.b].y - nodes[s.a].y), 0);
console.log(`roads: ${nodes.length} nodes, ${segs.length} segments, ${(totalLength / PX_PER_M / 1000).toFixed(1)} km of real road`);

// ---- Stops and landmark plots ----

const stops = [];
const blocks = [];
const overlaps = (x, y, w, h, margin) => blocks.some(b => x < b.x + b.w + margin && x + w + margin > b.x && y < b.y + b.h + margin && y + h + margin > b.y);
function plotIsFree(x, y, w, h) {
  if (x < 60 || y < 60 || x + w > width - 60 || y + h > height - 60) return false;
  if (overlaps(x, y, w, h, 40)) return false;
  for (let i = 0; i <= 4; i++) for (let j = 0; j <= 4; j++) {
    if (clearance(x + w * i / 4, y + h * j / 4) < 14) return false;
  }
  return true;
}
function findPlot(cx, cy, w, h) {
  for (let r = 60; r <= 1100; r += 20) {
    for (let k = 0; k < 28; k++) {
      const angle = k / 28 * Math.PI * 2;
      const x = Math.round(cx + Math.cos(angle) * r - w / 2), y = Math.round(cy + Math.sin(angle) * r - h / 2);
      if (plotIsFree(x, y, w, h)) return { x, y };
    }
  }
  return null;
}

for (const [name, emoji, kind, lat, lon] of LANDMARKS) {
  const p = project(lat, lon);
  let best = null;
  for (const s of segs) {
    const hit = nearestOnSeg(s, p.x, p.y);
    if (!best || hit.d < best.d) best = hit;
  }
  const x = Math.round(best.x), y = Math.round(best.y);
  const clash = stops.find(s => Math.hypot(s.x - x, s.y - y) < MIN_STOP_GAP);
  if (clash) { console.log(`stops: skipped ${name} (too close to ${clash.name})`); continue; }
  const plot = findPlot(x, y, BLOCK_W, BLOCK_H);
  if (!plot) { console.log(`stops: skipped ${name} (no room for its plot)`); continue; }
  stops.push({ id: stops.length, name, emoji, x, y, a: +best.angle.toFixed(2) });
  blocks.push({ name, emoji, kind, x: plot.x, y: plot.y, w: BLOCK_W, h: BLOCK_H });
}
console.log(`stops: ${stops.length}`);

// ---- Hussain Sagar: flood the road-free space around the Buddha statue ----

const water = []; // flat [x, y, w, h, ...] rectangles
{
  const seed = project(LAKE_SEED.lat, LAKE_SEED.lon);
  const south = project(LAKE_LIMIT.south, LAKE_LIMIT.west), east = project(LAKE_LIMIT.south, LAKE_LIMIT.east);
  const open = (cx, cy) => {
    const x = (cx + 0.5) * LAKE_CELL, y = (cy + 0.5) * LAKE_CELL;
    if (y < 48 || y > south.y || x < south.x || x > east.x) return false;
    if (clearance(x, y) < 40) return false;
    return !overlaps(x - LAKE_CELL / 2, y - LAKE_CELL / 2, LAKE_CELL, LAKE_CELL, 24);
  };
  const filled = new Set();
  const queue = [[Math.floor(seed.x / LAKE_CELL), Math.floor(seed.y / LAKE_CELL)]];
  while (queue.length) {
    const [cx, cy] = queue.pop();
    const key = cx * 4096 + cy;
    if (filled.has(key) || !open(cx, cy)) continue;
    filled.add(key);
    queue.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]);
  }
  const rows = new Map();
  for (const key of filled) {
    const cx = Math.floor(key / 4096), cy = key % 4096;
    if (!rows.has(cy)) rows.set(cy, []);
    rows.get(cy).push(cx);
  }
  for (const [cy, list] of rows) {
    list.sort((a, b) => a - b);
    let start = list[0], prev = list[0];
    for (let i = 1; i <= list.length; i++) {
      if (list[i] === prev + 1) { prev = list[i]; continue; }
      water.push(start * LAKE_CELL, cy * LAKE_CELL, (prev - start + 1) * LAKE_CELL, LAKE_CELL);
      start = prev = list[i];
    }
  }
  console.log(`lake: ${filled.size} cells, ${water.length / 4} strips`);
  if (filled.size > 20) {
    // The statue's island sits in the lake itself
    blocks.push({ name: 'Hussain Sagar', emoji: '⛵', kind: 'water', x: Math.round(seed.x) - 96, y: Math.round(seed.y) - 96, w: 192, h: 192 });
  }
}

// ---- Traffic: buses and cars shuttle along stretches of real road ----

const adjacency = nodes.map(() => []);
for (const s of segs) { adjacency[s.a].push({ to: s.b, hw: s.hw }); adjacency[s.b].push({ to: s.a, hw: s.hw }); }
function wander(start, target, minHalfWidth) {
  const route = [start];
  const seen = new Set([start]);
  let length = 0, prev = -1, cur = start;
  while (length < target) {
    const options = adjacency[cur].filter(e => e.to !== prev && !seen.has(e.to) && e.hw >= minHalfWidth);
    if (!options.length) break;
    let next = options[Math.floor(rand() * options.length)];
    if (prev >= 0 && rand() < 0.85) {
      // Mostly carry straight on, like through traffic does
      const heading = Math.atan2(nodes[cur].y - nodes[prev].y, nodes[cur].x - nodes[prev].x);
      const turn = (e) => Math.abs(Math.atan2(Math.sin(Math.atan2(nodes[e.to].y - nodes[cur].y, nodes[e.to].x - nodes[cur].x) - heading), Math.cos(Math.atan2(nodes[e.to].y - nodes[cur].y, nodes[e.to].x - nodes[cur].x) - heading)));
      next = options.reduce((a, b) => (turn(b) < turn(a) ? b : a));
    }
    length += Math.hypot(nodes[next.to].x - nodes[cur].x, nodes[next.to].y - nodes[cur].y);
    prev = cur; cur = next.to;
    seen.add(cur); route.push(cur);
  }
  return { route, length };
}
function fleet(count, target, minLength, minHalfWidth, speeds) {
  const out = [];
  const starts = [];
  for (let tries = 0; tries < 4000 && out.length < count; tries++) {
    const start = Math.floor(rand() * nodes.length);
    const p = nodes[start];
    if (starts.some(s => Math.hypot(s.x - p.x, s.y - p.y) < 900)) continue;
    const { route, length } = wander(start, target, minHalfWidth);
    if (length < minLength) continue;
    starts.push(p);
    out.push({
      path: route.flatMap(n => [nodes[n].x, nodes[n].y]),
      speed: Math.round(speeds[0] + rand() * (speeds[1] - speeds[0])),
      phase: Math.round(rand() * 4000),
      lane: 24,
    });
  }
  return out;
}
const buses = fleet(12, 5200, 2600, 48, [100, 122]);
const cars = fleet(34, 3800, 1800, 42, [145, 190]).map((car, i) => ({ ...car, style: i % 2 }));
console.log(`traffic: ${buses.length} buses, ${cars.length} cars`);

// ---- Write it out ----

const map = {
  name: 'hyderabad',
  attribution: '© OpenStreetMap contributors',
  // Grid fields stay so older clients and shared types keep working
  tile: 48, cols: Math.ceil(width / 48), rows: Math.ceil(height / 48), roadTiles: 2, roadCols: [], roadRows: [],
  width, height,
  roads: { nodes: nodes.flatMap(n => [n.x, n.y]), ways: ways.map(way => ({ n: way.n, w: way.w })) },
  water, blocks, stops, buses, cars,
};
fs.writeFileSync(OUT, JSON.stringify(map));
console.log(`wrote ${path.relative(process.cwd(), OUT)} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB), map ${width} x ${height} px`);
