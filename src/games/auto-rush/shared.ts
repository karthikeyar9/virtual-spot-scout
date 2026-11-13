// Wire types (mirror backend/games/auto-rush.js) and the driving rules shared
// by the simulation, the 3D scene and the minimap.

/** `a` is the heading of the road at the stop (real-road maps only). */
export interface Stop { id: number; name: string; emoji: string; x: number; y: number; a?: number }
export interface Block { name: string; emoji: string; kind: string; x: number; y: number; w: number; h: number }
/**
 * A bus or car shuttling back and forth. On the grid map it runs along one
 * straight road (`axis`, `fixed`, `min`, `max`); on a real-road map it follows
 * `path`, a flat [x, y, x, y, ...] polyline. `lane` is its offset from the
 * road's centre line.
 */
export interface Bus {
  axis?: 'h' | 'v'; fixed?: number; min?: number; max?: number; path?: number[];
  speed: number; phase: number; lane?: number; style?: number;
}
/** A real road network: flat [x, y, ...] node positions, and ways that string nodes together. `w` is the full road width. */
export interface Roads { nodes: number[]; ways: { n: number[]; w: number }[] }
export interface GameMap {
  tile: number; roadTiles: number; roadCols: number[]; roadRows: number[];
  width: number; height: number; blocks: Block[]; stops: Stop[]; buses: Bus[]; cars?: Bus[];
  /** Present on real-road maps; the grid fields above are then unused. */
  roads?: Roads;
  /** Lake surface as flat [x, y, w, h, ...] rectangles. */
  water?: number[];
  attribution?: string;
}
export interface Passenger { id: number; from: number; to: number; fare: number; carrier: string | null }
export interface Chai { id: number; x: number; y: number }
export interface CarSnapshot { x: number; y: number; a: number; s: number; c: number | null; b: number; d: number }
export interface Snapshot {
  now: number; endsAt: number; status: 'active' | 'finished';
  cars: Record<string, CarSnapshot>; passengers: Passenger[]; chais: Chai[];
}
export interface InitPayload extends Snapshot { map: GameMap; rushHourMs: number; scores: Record<string, number> }
export type GameEvent =
  | { type: 'deliver'; by: string; fare: number; stop: string; score: number }
  | { type: 'pickup'; by: string; stop: string }
  | { type: 'steal'; by: string; from: string }
  | { type: 'chai'; by: string };

export interface LocalCar {
  x: number; y: number; a: number; s: number;
  steer: number; // smoothed -1..1, drives the body lean
  stunnedUntil: number; busGraceUntil: number; carGraceUntil: number;
}

export const CAR_RADIUS = 14;
export const MAX_SPEED = 250;
export const BOOST_SPEED = 400;
export const REVERSE_SPEED = 110;
export const ACCEL = 300;
export const TURN_RATE = 2.5;
export const BUS_LENGTH = 76;
export const BUS_WIDTH = 34;
export const CAR_LENGTH = 46;
export const CAR_WIDTH = 22;
export const STUN_MS = 900;
export const BUS_GRACE_MS = 2500;
/** Game units (px) per second → km/h shown on the speedometer. */
export const KMH_PER_UNIT = 0.3;

export const CAR_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#e2e8f0"];

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function colorFor(cars: Record<string, unknown>, id: string) {
  const ids = Object.keys(cars).sort();
  return CAR_COLORS[Math.max(0, ids.indexOf(id)) % CAR_COLORS.length];
}

const pathLengths = new WeakMap<number[], Float32Array>();

export function busPosition(bus: Bus, serverNow: number) {
  if (bus.path) return pathPosition(bus, bus.path, serverNow);
  const span = bus.max - bus.min;
  const travelled = ((serverNow / 1000) * bus.speed + bus.phase) % (2 * span);
  const forward = travelled < span;
  const along = bus.min + (forward ? travelled : 2 * span - travelled);
  // Left-hand traffic: each direction keeps to its own side of the centre line
  const lane = (bus.lane ?? 0) * (forward ? 1 : -1);
  return bus.axis === 'h'
    ? { x: along, y: bus.fixed - lane, angle: forward ? 0 : Math.PI }
    : { x: bus.fixed + lane, y: along, angle: forward ? Math.PI / 2 : -Math.PI / 2 };
}

function pathPosition(bus: Bus, path: number[], serverNow: number) {
  let lengths = pathLengths.get(path);
  if (!lengths) {
    lengths = new Float32Array(path.length / 2);
    for (let i = 1; i < lengths.length; i++) {
      lengths[i] = lengths[i - 1] + Math.hypot(path[i * 2] - path[i * 2 - 2], path[i * 2 + 1] - path[i * 2 - 1]);
    }
    pathLengths.set(path, lengths);
  }
  const last = lengths.length - 1;
  const span = lengths[last] || 1;
  const travelled = ((serverNow / 1000) * bus.speed + bus.phase) % (2 * span);
  const forward = travelled < span;
  const along = forward ? travelled : 2 * span - travelled;
  let lo = 0, hi = last;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (lengths[mid] <= along) lo = mid; else hi = mid;
  }
  const t = (along - lengths[lo]) / (lengths[hi] - lengths[lo] || 1);
  const ax = path[lo * 2], ay = path[lo * 2 + 1], bx = path[hi * 2], by = path[hi * 2 + 1];
  const angle = Math.atan2(by - ay, bx - ax) + (forward ? 0 : Math.PI);
  // Left-hand traffic: keep to the left of the direction of travel
  const lane = bus.lane ?? 0;
  return { x: ax + (bx - ax) * t + Math.sin(angle) * lane, y: ay + (by - ay) * t - Math.cos(angle) * lane, angle: wrapAngle(angle) };
}

// ---- Real roads ----
//
// A real-road map is a set of polylines with widths. Everything that asks
// "where is the road?" goes through this index: segments in flat arrays, a
// coarse grid to find the ones near a point, and node links for routing.

export interface RoadIndex {
  count: number;
  ax: Float32Array; ay: Float32Array; bx: Float32Array; by: Float32Array;
  hw: Float32Array; len: Float32Array; na: Int32Array; nb: Int32Array;
  nodeX: Float32Array; nodeY: Float32Array;
  links: number[][]; // node -> segments that touch it
  grid: Map<number, number[]>;
  trees: Map<string, { seg: number; dist: Float64Array; via: Int32Array }>;
}
export interface RoadHit { seg: number; x: number; y: number; d: number; hw: number }

const ROAD_CELL = 256;
/** How far from a road's edge the lookup grid still finds that road. */
export const ROAD_REACH = 240;
const roadIndexes = new WeakMap<GameMap, RoadIndex>();
const cellKey = (x: number, y: number) => Math.floor(x / ROAD_CELL) * 4096 + Math.floor(y / ROAD_CELL);

export function roadIndex(map: GameMap): RoadIndex | null {
  if (!map.roads) return null;
  let index = roadIndexes.get(map);
  if (index) return index;

  const { nodes, ways } = map.roads;
  const count = ways.reduce((sum, way) => sum + way.n.length - 1, 0);
  const nodeCount = nodes.length / 2;
  index = {
    count,
    ax: new Float32Array(count), ay: new Float32Array(count), bx: new Float32Array(count), by: new Float32Array(count),
    hw: new Float32Array(count), len: new Float32Array(count), na: new Int32Array(count), nb: new Int32Array(count),
    nodeX: new Float32Array(nodeCount), nodeY: new Float32Array(nodeCount),
    links: Array.from({ length: nodeCount }, () => [] as number[]),
    grid: new Map(), trees: new Map(),
  };
  for (let n = 0; n < nodeCount; n++) { index.nodeX[n] = nodes[n * 2]; index.nodeY[n] = nodes[n * 2 + 1]; }
  let i = 0;
  for (const way of ways) {
    for (let k = 1; k < way.n.length; k++, i++) {
      const a = way.n[k - 1], b = way.n[k];
      const ax = index.nodeX[a], ay = index.nodeY[a], bx = index.nodeX[b], by = index.nodeY[b];
      index.ax[i] = ax; index.ay[i] = ay; index.bx[i] = bx; index.by[i] = by;
      index.hw[i] = way.w / 2; index.len[i] = Math.hypot(bx - ax, by - ay);
      index.na[i] = a; index.nb[i] = b;
      index.links[a].push(i); index.links[b].push(i);
      const r = way.w / 2 + ROAD_REACH;
      for (let cx = Math.floor((Math.min(ax, bx) - r) / ROAD_CELL); cx <= Math.floor((Math.max(ax, bx) + r) / ROAD_CELL); cx++) {
        for (let cy = Math.floor((Math.min(ay, by) - r) / ROAD_CELL); cy <= Math.floor((Math.max(ay, by) + r) / ROAD_CELL); cy++) {
          const key = cx * 4096 + cy;
          const cell = index.grid.get(key);
          if (cell) cell.push(i); else index.grid.set(key, [i]);
        }
      }
    }
  }
  roadIndexes.set(map, index);
  return index;
}

/**
 * The road whose edge is closest to a point (a point on a road is "closest"
 * to the road it is deepest inside). With `exhaustive`, a point far from every
 * road still gets an answer; otherwise it gets null.
 */
export function nearestRoad(index: RoadIndex, x: number, y: number, exhaustive = true): RoadHit | null {
  const near = index.grid.get(cellKey(x, y));
  if (!near && !exhaustive) return null;
  const n = near ? near.length : index.count;
  let seg = -1, edge = Infinity, hx = 0, hy = 0, hd = 0;
  for (let k = 0; k < n; k++) {
    const i = near ? near[k] : k;
    const ax = index.ax[i], ay = index.ay[i];
    const dx = index.bx[i] - ax, dy = index.by[i] - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1) : 0;
    const px = ax + dx * t, py = ay + dy * t;
    const d = Math.hypot(x - px, y - py);
    if (d - index.hw[i] < edge) { edge = d - index.hw[i]; seg = i; hx = px; hy = py; hd = d; }
  }
  return seg < 0 ? null : { seg, x: hx, y: hy, d: hd, hw: index.hw[seg] };
}

/** Distance from a point to the nearest road edge; negative on a road, capped at ROAD_REACH. */
export function roadClearance(index: RoadIndex, x: number, y: number) {
  const hit = nearestRoad(index, x, y, false);
  return hit ? Math.min(ROAD_REACH, hit.d - hit.hw) : ROAD_REACH;
}

/** Moves the auto to (nx, ny), holding it inside the nearest road if that would leave the tarmac. */
function moveOnRoads(me: LocalCar, index: RoadIndex, nx: number, ny: number, dt: number): DriveResult {
  const hit = nearestRoad(index, nx, ny);
  if (!hit) return 'ok';
  const limit = hit.hw - CAR_RADIUS;
  if (hit.d <= limit) { me.x = nx; me.y = ny; return 'ok'; }
  // Over the kerb: slide along it. Only a square-on hit counts as a crash.
  const ux = (nx - hit.x) / hit.d, uy = (ny - hit.y) / hit.d;
  const into = (Math.cos(me.a) * ux + Math.sin(me.a) * uy) * me.s;
  me.x = hit.x + ux * limit; me.y = hit.y + uy * limit;
  if (into > 150) { me.s *= -0.3; return 'wall'; }
  me.s *= 1 - Math.min(1, (0.9 + 3 * Math.max(0, into) / (Math.abs(me.s) + 1)) * dt);
  return 'ok';
}

/** A point is drivable when the whole car fits inside a road band. */
export function isDrivable(map: GameMap, x: number, y: number) {
  const roads = roadIndex(map);
  if (roads) {
    const hit = nearestRoad(roads, x, y, false);
    return !!hit && hit.d <= hit.hw - CAR_RADIUS;
  }
  const roadWidth = map.roadTiles * map.tile;
  const inBand = (lines: number[], v: number) =>
    lines.some(l => v >= l * map.tile + CAR_RADIUS && v <= l * map.tile + roadWidth - CAR_RADIUS);
  const withinSpan = (lines: number[], v: number) =>
    v >= lines[0] * map.tile + CAR_RADIUS && v <= lines[lines.length - 1] * map.tile + roadWidth - CAR_RADIUS;
  return (inBand(map.roadCols, x) && withinSpan(map.roadRows, y))
    || (inBand(map.roadRows, y) && withinSpan(map.roadCols, x));
}

/** Whether the auto overlaps a bus or car, measured in that vehicle's own frame so it works at any heading. */
function touchesVehicle(me: LocalCar, vehicle: Bus, serverNow: number, length: number, width: number, slack: number) {
  const p = busPosition(vehicle, serverNow);
  const dx = me.x - p.x, dy = me.y - p.y;
  if (Math.abs(dx) > length || Math.abs(dy) > length) return false;
  const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
  return Math.abs(dx * cos + dy * sin) < length / 2 + CAR_RADIUS - slack
    && Math.abs(dy * cos - dx * sin) < width / 2 + CAR_RADIUS - slack;
}

export interface DriveInput { throttle: number; steer: number }
export type DriveResult = 'ok' | 'wall' | 'bus' | 'car';

/** Advances the local auto by dt seconds. Returns what it hit, if anything. */
export function stepCar(me: LocalCar, input: DriveInput, map: GameMap, boosted: boolean, serverNow: number, dt: number): DriveResult {
  const now = Date.now();
  if (now < me.stunnedUntil) {
    me.s = 0;
    me.a = wrapAngle(me.a + dt * 13); // spin out
    return 'ok';
  }

  const top = boosted ? BOOST_SPEED : MAX_SPEED;
  if (input.throttle > 0) me.s += input.throttle * ACCEL * (boosted ? 1.8 : 1) * dt;
  else if (input.throttle < 0) me.s += input.throttle * (me.s > 0 ? ACCEL * 2.2 : ACCEL * 0.7) * dt; // brakes bite harder
  else me.s -= me.s * Math.min(1, 1.1 * dt);
  if (me.s > top) me.s = Math.max(top, me.s - 420 * dt);
  me.s = Math.max(me.s, -REVERSE_SPEED);

  me.steer += (input.steer - me.steer) * Math.min(1, dt * 7);
  // Full lock at low speed, tighter at high speed so it stays controllable
  const grip = clamp(Math.abs(me.s) / 90, 0, 1) * (1 - 0.35 * clamp(Math.abs(me.s) / BOOST_SPEED, 0, 1));
  me.a = wrapAngle(me.a + me.steer * TURN_RATE * grip * Math.sign(me.s || 1) * dt);

  let result: DriveResult = 'ok';
  const nx = me.x + Math.cos(me.a) * me.s * dt;
  const ny = me.y + Math.sin(me.a) * me.s * dt;
  const roads = roadIndex(map);
  if (roads) result = moveOnRoads(me, roads, nx, ny, dt);
  else if (isDrivable(map, nx, ny)) { me.x = nx; me.y = ny; }
  else if (isDrivable(map, nx, me.y)) { me.x = nx; me.s *= 1 - 0.9 * dt; } // scraping a kerb only costs a little speed
  else if (isDrivable(map, me.x, ny)) { me.y = ny; me.s *= 1 - 0.9 * dt; }
  else {
    if (Math.abs(me.s) > 120) result = 'wall';
    me.s *= -0.3;
  }

  // Buses win every argument
  if (now > me.busGraceUntil) {
    for (const bus of map.buses) {
      if (touchesVehicle(me, bus, serverNow, BUS_LENGTH, BUS_WIDTH, 4)) {
        me.stunnedUntil = now + STUN_MS;
        me.busGraceUntil = now + BUS_GRACE_MS;
        return 'bus';
      }
    }
  }

  // Cars just shunt you
  if (now > me.carGraceUntil) {
    for (const car of map.cars ?? []) {
      if (touchesVehicle(me, car, serverNow, CAR_LENGTH, CAR_WIDTH, 5)) {
        me.carGraceUntil = now + 900;
        me.s = -Math.sign(me.s || 1) * Math.min(90, Math.abs(me.s) * 0.5);
        return 'car';
      }
    }
  }
  return result;
}

export interface Point { x: number; y: number }

/**
 * A drivable route from `from` (anywhere on a road) to a stop, as a polyline
 * that follows road centre lines: along the current road, down one cross
 * street, then along the stop's road.
 */
export function routeTo(map: GameMap, from: Point, to: Point): Point[] {
  const roads = roadIndex(map);
  if (roads) return roadRoute(roads, from, to);
  const road = map.roadTiles * map.tile;
  const centre = (line: number) => line * map.tile + road / 2;
  const onRow = map.roadRows.find(r => Math.abs(from.y - centre(r)) <= road / 2);
  const onCol = map.roadCols.find(c => Math.abs(from.x - centre(c)) <= road / 2);

  if (onRow !== undefined && Math.abs(centre(onRow) - to.y) < 1) return [from, to];
  if (onCol !== undefined) return [from, { x: centre(onCol), y: to.y }, to];
  if (onRow === undefined) return [from, to];

  let best = centre(map.roadCols[0]), bestCost = Infinity;
  for (const c of map.roadCols) {
    const cost = Math.abs(from.x - centre(c)) + Math.abs(centre(c) - to.x);
    if (cost < bestCost) { bestCost = cost; best = centre(c); }
  }
  return [from, { x: best, y: centre(onRow) }, { x: best, y: to.y }, to];
}

/**
 * Shortest distances from every junction to one destination, worked out once
 * per destination (there are only a few dozen stops) and then reused, so a
 * route from anywhere is just a walk down the tree.
 */
function routeTree(index: RoadIndex, to: Point) {
  const key = `${to.x},${to.y}`;
  let tree = index.trees.get(key);
  if (tree) return tree;
  const nodeCount = index.links.length;
  const dist = new Float64Array(nodeCount).fill(Infinity);
  const via = new Int32Array(nodeCount).fill(-1);
  const hit = nearestRoad(index, to.x, to.y)!;

  // Binary heap of [distance, node] pairs
  const heap: number[] = [];
  const push = (d: number, node: number) => {
    let i = heap.length;
    heap.push(d, node);
    while (i > 0) {
      const parent = ((i / 2 - 1) >> 1) * 2;
      if (heap[parent] <= heap[i]) break;
      [heap[parent], heap[i], heap[parent + 1], heap[i + 1]] = [heap[i], heap[parent], heap[i + 1], heap[parent + 1]];
      i = parent;
    }
  };
  const pop = () => {
    const top = [heap[0], heap[1]];
    const node = heap.pop()!, d = heap.pop()!;
    if (heap.length) {
      heap[0] = d; heap[1] = node;
      for (let i = 0; ;) {
        const left = i * 2 + 2, right = left + 2;
        let small = i;
        if (left < heap.length && heap[left] < heap[small]) small = left;
        if (right < heap.length && heap[right] < heap[small]) small = right;
        if (small === i) break;
        [heap[small], heap[i], heap[small + 1], heap[i + 1]] = [heap[i], heap[small], heap[i + 1], heap[small + 1]];
        i = small;
      }
    }
    return top;
  };

  for (const node of [index.na[hit.seg], index.nb[hit.seg]]) {
    dist[node] = Math.hypot(index.nodeX[node] - hit.x, index.nodeY[node] - hit.y);
    push(dist[node], node);
  }
  while (heap.length) {
    const [d, node] = pop();
    if (d > dist[node]) continue;
    for (const seg of index.links[node]) {
      const other = index.na[seg] === node ? index.nb[seg] : index.na[seg];
      const next = d + index.len[seg];
      if (next < dist[other]) { dist[other] = next; via[other] = node; push(next, other); }
    }
  }
  tree = { seg: hit.seg, dist, via };
  index.trees.set(key, tree);
  return tree;
}

function roadRoute(index: RoadIndex, from: Point, to: Point): Point[] {
  const tree = routeTree(index, to);
  const here = nearestRoad(index, from.x, from.y);
  if (!here || here.seg === tree.seg) return [from, to];
  const a = index.na[here.seg], b = index.nb[here.seg];
  const viaA = Math.hypot(index.nodeX[a] - from.x, index.nodeY[a] - from.y) + tree.dist[a];
  const viaB = Math.hypot(index.nodeX[b] - from.x, index.nodeY[b] - from.y) + tree.dist[b];
  let node = viaA <= viaB ? a : b;
  if (!Number.isFinite(tree.dist[node])) return [from, to];
  const points: Point[] = [from];
  for (let guard = index.links.length; node >= 0 && guard > 0; guard--) {
    points.push({ x: index.nodeX[node], y: index.nodeY[node] });
    node = tree.via[node];
  }
  points.push(to);
  return points;
}

export function routeLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}
