// Auto Rush: Hyderabad — top-down auto-rickshaw taxi race.
//
// Clients simulate their own auto and report its position (~12 Hz). The server
// owns everything that scores: passengers, pickups, deliveries, steals, chai
// boosts and the match clock, and broadcasts a snapshot 10 times a second.
// Match length reuses the shared `rounds` setting as minutes.

const TILE = 48;
const ROAD_TILES = 2;
const ROAD_COLS = [1, 10, 19, 28, 37, 46];
const ROAD_ROWS = [1, 9, 17, 25, 33];
const COLS = 49;
const ROWS = 36;

const TICK_MS = 100;
const PICKUP_RADIUS = 44;
const DROP_RADIUS = 48;
const CHAI_RADIUS = 34;
const STEAL_RADIUS = 30;
const STEAL_MIN_SPEED = 120;
const STEAL_IMMUNITY_MS = 3000;
const BOOST_MS = 4000;
const RUSH_HOUR_MS = 30000; // fares double in the final stretch
const MAX_CHAIS = 4;
const MAX_SPEED = 420; // px/s incl. boost; used to reject teleporting clients

// [name, emoji, kind] — one per city block, row by row.
const LANDMARKS = [
  ['Golconda Fort', '🏰', 'heritage'], ['Jubilee Hills', '🏡', 'homes'], ['KBR Park', '🌳', 'park'], ['Begumpet', '✈️', 'homes'], ['Secunderabad Station', '🚉', 'transit'],
  ['Gachibowli', '🏟️', 'tech'], ['Hitech City', '💻', 'tech'], ['Banjara Hills', '🛍️', 'homes'], ['Hussain Sagar', '⛵', 'water'], ['Paradise Biryani', '🍛', 'food'],
  ['Shilparamam', '🎨', 'heritage'], ['Birla Mandir', '🛕', 'heritage'], ['Necklace Road', '🎡', 'park'], ['Tank Bund', '🌉', 'water'], ['Uppal Stadium', '🏏', 'transit'],
  ['Nehru Zoo', '🐅', 'park'], ['Laad Bazaar', '💍', 'food'], ['Charminar', '🕌', 'heritage'], ['Salar Jung Museum', '🏛️', 'heritage'], ['Ramoji Film City', '🎬', 'tech'],
];

function buildMap() {
  const blocks = [];
  const stops = [];
  let i = 0;
  for (let r = 0; r < ROAD_ROWS.length - 1; r++) {
    for (let c = 0; c < ROAD_COLS.length - 1; c++) {
      const [name, emoji, kind] = LANDMARKS[i];
      const x = (ROAD_COLS[c] + ROAD_TILES) * TILE;
      const y = (ROAD_ROWS[r] + ROAD_TILES) * TILE;
      const w = (ROAD_COLS[c + 1] - ROAD_COLS[c] - ROAD_TILES) * TILE;
      const h = (ROAD_ROWS[r + 1] - ROAD_ROWS[r] - ROAD_TILES) * TILE;
      blocks.push({ name, emoji, kind, x, y, w, h });
      // Each landmark's stop sits on the road just south of its block
      stops.push({ id: i, name, emoji, x: x + w / 2, y: (ROAD_ROWS[r + 1] + ROAD_TILES / 2) * TILE });
      i++;
    }
  }

  // Buses shuttle back and forth along the middle of the inner roads.
  const minX = (ROAD_COLS[0] + 1) * TILE;
  const maxX = (ROAD_COLS[ROAD_COLS.length - 1] + 1) * TILE;
  const minY = (ROAD_ROWS[0] + 1) * TILE;
  const maxY = (ROAD_ROWS[ROAD_ROWS.length - 1] + 1) * TILE;
  const buses = [
    ...[1, 2, 3].map((r, n) => ({ axis: 'h', fixed: (ROAD_ROWS[r] + 1) * TILE, min: minX, max: maxX, speed: 120 + n * 25, phase: n * 700 })),
    ...[1, 2, 3, 4].map((c, n) => ({ axis: 'v', fixed: (ROAD_COLS[c] + 1) * TILE, min: minY, max: maxY, speed: 110 + n * 20, phase: n * 450 })),
  ];

  return {
    tile: TILE, cols: COLS, rows: ROWS, roadTiles: ROAD_TILES,
    roadCols: ROAD_COLS, roadRows: ROAD_ROWS,
    width: COLS * TILE, height: ROWS * TILE,
    blocks, stops, buses,
  };
}

const MAP = buildMap();
const tickers = new Map(); // roomId -> interval

const rand = (n) => Math.floor(Math.random() * n);
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

function spawnPoint(index) {
  // Intersections, spread across the map
  const cols = MAP.roadCols, rows = MAP.roadRows;
  const c = cols[(index * 2 + 1) % cols.length];
  const r = rows[(index * 3 + 1) % rows.length];
  return { x: (c + 1) * TILE, y: (r + 1) * TILE };
}

function addCar(gs, playerId) {
  const { x, y } = spawnPoint(Object.keys(gs.cars).length);
  gs.cars[playerId] = { x, y, a: 0, s: 0, carrying: null, boostUntil: 0, immuneUntil: 0, deliveries: 0, lastSeen: Date.now() };
  return gs.cars[playerId];
}

function spawnPassenger(gs) {
  const taken = new Set(gs.passengers.filter(p => !p.carrier).map(p => p.from));
  const free = MAP.stops.filter(s => !taken.has(s.id));
  if (free.length === 0) return;
  const from = free[rand(free.length)];
  const far = MAP.stops.filter(s => s.id !== from.id && dist(s.x, s.y, from.x, from.y) > 500);
  const to = far[rand(far.length)];
  const trip = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  gs.passengers.push({
    id: gs.nextId++,
    from: from.id,
    to: to.id,
    fare: Math.round((30 + trip / 14) / 5) * 5,
    carrier: null,
  });
}

function spawnChai(gs) {
  // Anywhere along a road centre line
  const horizontal = Math.random() < 0.5;
  const cols = MAP.roadCols, rows = MAP.roadRows;
  const along = (lines, size) => (lines[0] + 1) * TILE + Math.random() * ((lines[lines.length - 1] - lines[0]) * TILE);
  const chai = horizontal
    ? { x: along(cols), y: (rows[rand(rows.length)] + 1) * TILE }
    : { x: (cols[rand(cols.length)] + 1) * TILE, y: along(rows) };
  gs.chais.push({ id: gs.nextId++, ...chai });
}

function targetPassengerCount(room) {
  const humans = room.players.filter(p => !p.disconnected).length;
  return Math.max(3, Math.min(8, humans + 2));
}

function onStart(room) {
  const minutes = Math.max(1, Math.min(10, Number(room.totalRounds) || 3));
  const gs = {
    status: 'active',
    endsAt: Date.now() + minutes * 60000,
    cars: {},
    passengers: [],
    chais: [],
    nextId: 1,
  };
  room.players.forEach(p => addCar(gs, p.id));
  room.gameState = gs;
  for (let i = 0; i < targetPassengerCount(room); i++) spawnPassenger(gs);
  for (let i = 0; i < MAX_CHAIS; i++) spawnChai(gs);
}

function snapshot(gs) {
  const cars = {};
  for (const [id, c] of Object.entries(gs.cars)) {
    cars[id] = { x: Math.round(c.x), y: Math.round(c.y), a: +c.a.toFixed(2), s: Math.round(c.s), c: c.carrying, b: c.boostUntil, d: c.deliveries };
  }
  return { now: Date.now(), endsAt: gs.endsAt, status: gs.status, cars, passengers: gs.passengers, chais: gs.chais };
}

function initPayload(room) {
  const scores = {};
  room.players.forEach(p => { scores[p.id] = p.score || 0; });
  return { map: MAP, rushHourMs: RUSH_HOUR_MS, scores, ...snapshot(room.gameState) };
}

function isAutoRush(room) {
  return room && room.gameType === 'auto-rush' && room.gameState && room.gameState.cars;
}

function getGameData(room) {
  if (!isAutoRush(room)) return null;
  return { autoRush: initPayload(room) };
}

function finish(io, roomId, room) {
  room.gameState.status = 'finished';
  io.to(roomId).emit('auto-rush:state', snapshot(room.gameState));
  io.to(roomId).emit('playersUpdated', { players: room.players });
  io.to(roomId).emit('auto-rush:gameOver', { players: room.players });
}

function ensureTicker(io, rooms, roomId) {
  if (tickers.has(roomId)) return;
  const interval = setInterval(() => {
    const room = rooms[roomId];
    if (!isAutoRush(room) || room.gameState.status !== 'active') {
      clearInterval(interval);
      tickers.delete(roomId);
      return;
    }
    const gs = room.gameState;
    if (Date.now() >= gs.endsAt) {
      finish(io, roomId, room);
      return;
    }
    while (gs.passengers.length < targetPassengerCount(room)) spawnPassenger(gs);
    while (gs.chais.length < MAX_CHAIS) spawnChai(gs);
    io.to(roomId).volatile.emit('auto-rush:state', snapshot(gs));
  }, TICK_MS);
  tickers.set(roomId, interval);
}

// Everything that can happen when a car arrives somewhere
function resolveInteractions(io, roomId, room, playerId) {
  const gs = room.gameState;
  const car = gs.cars[playerId];
  const now = Date.now();
  const event = (payload) => io.to(roomId).emit('auto-rush:event', payload);

  if (car.carrying) {
    const passenger = gs.passengers.find(p => p.id === car.carrying);
    const dest = passenger && MAP.stops[passenger.to];
    if (!passenger) {
      car.carrying = null;
    } else if (dist(car.x, car.y, dest.x, dest.y) < DROP_RADIUS) {
      const rush = gs.endsAt - now <= RUSH_HOUR_MS;
      const fare = passenger.fare * (rush ? 2 : 1);
      const player = room.players.find(p => p.id === playerId);
      if (player) player.score = (player.score || 0) + fare;
      car.carrying = null;
      car.deliveries++;
      gs.passengers = gs.passengers.filter(p => p.id !== passenger.id);
      event({ type: 'deliver', by: playerId, fare, stop: dest.name, score: player ? player.score : 0 });
      io.to(roomId).emit('playersUpdated', { players: room.players });
    }
  } else {
    const waiting = gs.passengers.find(p => {
      if (p.carrier) return false;
      const stop = MAP.stops[p.from];
      return dist(car.x, car.y, stop.x, stop.y) < PICKUP_RADIUS;
    });
    if (waiting) {
      waiting.carrier = playerId;
      car.carrying = waiting.id;
      car.immuneUntil = now + STEAL_IMMUNITY_MS;
      event({ type: 'pickup', by: playerId, stop: MAP.stops[waiting.to].name });
    } else if (Math.abs(car.s) >= STEAL_MIN_SPEED) {
      // Ram a loaded auto at speed and its passenger jumps ship
      for (const [otherId, other] of Object.entries(gs.cars)) {
        if (otherId === playerId || !other.carrying || now < other.immuneUntil) continue;
        if (dist(car.x, car.y, other.x, other.y) > STEAL_RADIUS) continue;
        const passenger = gs.passengers.find(p => p.id === other.carrying);
        if (!passenger) continue;
        passenger.carrier = playerId;
        car.carrying = passenger.id;
        other.carrying = null;
        car.immuneUntil = now + STEAL_IMMUNITY_MS;
        other.immuneUntil = now + STEAL_IMMUNITY_MS; // no instant steal-back
        event({ type: 'steal', by: playerId, from: otherId });
        break;
      }
    }
  }

  const chai = gs.chais.find(c => dist(car.x, car.y, c.x, c.y) < CHAI_RADIUS);
  if (chai) {
    gs.chais = gs.chais.filter(c => c.id !== chai.id);
    car.boostUntil = now + BOOST_MS;
    event({ type: 'chai', by: playerId });
  }
}

function registerEvents(socket, io, rooms) {
  socket.on('auto-rush:requestState', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!isAutoRush(room)) return;
    const gs = room.gameState;
    // Late joiners get an auto too
    if (gs.status === 'active' && !gs.cars[playerId] && room.players.some(p => p.id === playerId)) {
      addCar(gs, playerId);
    }
    socket.emit('auto-rush:init', initPayload(room));
    if (gs.status === 'active') ensureTicker(io, rooms, roomId);
  });

  // Horns are heard by everyone nearby; the client fades them by distance
  socket.on('auto-rush:horn', ({ roomId, playerId }) => {
    const room = rooms[roomId];
    if (!isAutoRush(room) || room.gameState.status !== 'active') return;
    const car = room.gameState.cars[playerId];
    const now = Date.now();
    if (!car || now - (car.lastHorn || 0) < 400) return;
    car.lastHorn = now;
    socket.to(roomId).emit('auto-rush:horn', { by: playerId });
  });

  socket.on('auto-rush:pos', ({ roomId, playerId, x, y, a, s }) => {
    const room = rooms[roomId];
    if (!isAutoRush(room) || room.gameState.status !== 'active') return;
    const car = room.gameState.cars[playerId];
    if (!car || ![x, y, a, s].every(Number.isFinite)) return;

    // Ignore jumps no auto could have driven since its last report
    const now = Date.now();
    const elapsed = Math.min(1, (now - car.lastSeen) / 1000);
    if (dist(x, y, car.x, car.y) > MAX_SPEED * elapsed * 1.5 + 60) {
      socket.emit('auto-rush:correct', { x: car.x, y: car.y });
      car.lastSeen = now;
      return;
    }

    car.x = Math.max(0, Math.min(MAP.width, x));
    car.y = Math.max(0, Math.min(MAP.height, y));
    car.a = a;
    car.s = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, s));
    car.lastSeen = now;

    resolveInteractions(io, roomId, room, playerId);
    ensureTicker(io, rooms, roomId);
  });
}

module.exports = { onStart, registerEvents, getGameData, minPlayers: 1 };
