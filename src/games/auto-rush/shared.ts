// Wire types (mirror backend/games/auto-rush.js) and the driving rules shared
// by the simulation, the 3D scene and the minimap.

export interface Stop { id: number; name: string; emoji: string; x: number; y: number }
export interface Block { name: string; emoji: string; kind: string; x: number; y: number; w: number; h: number }
/** A bus or car shuttling along one road. `lane` is its offset from the road's centre line. */
export interface Bus { axis: 'h' | 'v'; fixed: number; min: number; max: number; speed: number; phase: number; lane?: number; style?: number }
export interface GameMap {
  tile: number; roadTiles: number; roadCols: number[]; roadRows: number[];
  width: number; height: number; blocks: Block[]; stops: Stop[]; buses: Bus[]; cars?: Bus[];
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

export function busPosition(bus: Bus, serverNow: number) {
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

/** A point is drivable when the whole car fits inside a road band. */
export function isDrivable(map: GameMap, x: number, y: number) {
  const roadWidth = map.roadTiles * map.tile;
  const inBand = (lines: number[], v: number) =>
    lines.some(l => v >= l * map.tile + CAR_RADIUS && v <= l * map.tile + roadWidth - CAR_RADIUS);
  const withinSpan = (lines: number[], v: number) =>
    v >= lines[0] * map.tile + CAR_RADIUS && v <= lines[lines.length - 1] * map.tile + roadWidth - CAR_RADIUS;
  return (inBand(map.roadCols, x) && withinSpan(map.roadRows, y))
    || (inBand(map.roadRows, y) && withinSpan(map.roadCols, x));
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
  if (isDrivable(map, nx, ny)) { me.x = nx; me.y = ny; }
  else if (isDrivable(map, nx, me.y)) { me.x = nx; me.s *= 1 - 0.9 * dt; } // scraping a kerb only costs a little speed
  else if (isDrivable(map, me.x, ny)) { me.y = ny; me.s *= 1 - 0.9 * dt; }
  else {
    if (Math.abs(me.s) > 120) result = 'wall';
    me.s *= -0.3;
  }

  // Buses win every argument
  if (now > me.busGraceUntil) {
    for (const bus of map.buses) {
      const b = busPosition(bus, serverNow);
      const halfX = (bus.axis === 'h' ? BUS_LENGTH : BUS_WIDTH) / 2 + CAR_RADIUS - 4;
      const halfY = (bus.axis === 'h' ? BUS_WIDTH : BUS_LENGTH) / 2 + CAR_RADIUS - 4;
      if (Math.abs(me.x - b.x) < halfX && Math.abs(me.y - b.y) < halfY) {
        me.stunnedUntil = now + STUN_MS;
        me.busGraceUntil = now + BUS_GRACE_MS;
        return 'bus';
      }
    }
  }

  // Cars just shunt you
  if (now > me.carGraceUntil) {
    for (const car of map.cars ?? []) {
      const c = busPosition(car, serverNow);
      const halfX = (car.axis === 'h' ? CAR_LENGTH : CAR_WIDTH) / 2 + CAR_RADIUS - 5;
      const halfY = (car.axis === 'h' ? CAR_WIDTH : CAR_LENGTH) / 2 + CAR_RADIUS - 5;
      if (Math.abs(me.x - c.x) < halfX && Math.abs(me.y - c.y) < halfY) {
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

export function routeLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return total;
}
