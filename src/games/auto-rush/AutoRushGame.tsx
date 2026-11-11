import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { GameComponentProps, Player } from "@/games/types";
import { Trophy } from "lucide-react";

// ---- Wire types (mirrors backend/games/auto-rush.js) ----

interface Stop { id: number; name: string; emoji: string; x: number; y: number }
interface Block { name: string; emoji: string; kind: string; x: number; y: number; w: number; h: number }
interface Bus { axis: 'h' | 'v'; fixed: number; min: number; max: number; speed: number; phase: number }
interface GameMap {
  tile: number; roadTiles: number; roadCols: number[]; roadRows: number[];
  width: number; height: number; blocks: Block[]; stops: Stop[]; buses: Bus[];
}
interface Passenger { id: number; from: number; to: number; fare: number; carrier: string | null }
interface Chai { id: number; x: number; y: number }
interface CarSnapshot { x: number; y: number; a: number; s: number; c: number | null; b: number; d: number }
interface Snapshot {
  now: number; endsAt: number; status: 'active' | 'finished';
  cars: Record<string, CarSnapshot>; passengers: Passenger[]; chais: Chai[];
}
interface InitPayload extends Snapshot { map: GameMap; rushHourMs: number; scores: Record<string, number> }
type GameEvent =
  | { type: 'deliver'; by: string; fare: number; stop: string; score: number }
  | { type: 'pickup'; by: string; stop: string }
  | { type: 'steal'; by: string; from: string }
  | { type: 'chai'; by: string };

// ---- Tuning ----

const CAR_RADIUS = 14;
const MAX_SPEED = 250;
const BOOST_SPEED = 400;
const REVERSE_SPEED = 110;
const ACCEL = 380;
const TURN_RATE = 3.2;
const SEND_INTERVAL_MS = 80;
const BUS_LENGTH = 76;
const BUS_WIDTH = 34;
const STUN_MS = 900;
const BUS_GRACE_MS = 2500;

const CAR_COLORS = ["#ef4444", "#3b82f6", "#22c55e", "#a855f7", "#ec4899", "#14b8a6", "#f97316", "#64748b"];
const BLOCK_COLORS: Record<string, string> = {
  heritage: "#e7c9a1", homes: "#d6d3d1", park: "#a7d7a0", tech: "#bcd4f5",
  water: "#8ecdf0", food: "#f6c7a8", transit: "#d9c8ee",
};

const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function busPosition(bus: Bus, serverNow: number) {
  const span = bus.max - bus.min;
  const travelled = ((serverNow / 1000) * bus.speed + bus.phase) % (2 * span);
  const along = bus.min + (travelled < span ? travelled : 2 * span - travelled);
  const forward = travelled < span;
  return bus.axis === 'h'
    ? { x: along, y: bus.fixed, angle: forward ? 0 : Math.PI }
    : { x: bus.fixed, y: along, angle: forward ? Math.PI / 2 : -Math.PI / 2 };
}

// A point is drivable when the whole car fits inside a road band.
function isDrivable(map: GameMap, x: number, y: number) {
  const roadWidth = map.roadTiles * map.tile;
  const inBand = (lines: number[], v: number) =>
    lines.some(l => v >= l * map.tile + CAR_RADIUS && v <= l * map.tile + roadWidth - CAR_RADIUS);
  const withinSpan = (lines: number[], v: number) =>
    v >= lines[0] * map.tile + CAR_RADIUS && v <= lines[lines.length - 1] * map.tile + roadWidth - CAR_RADIUS;
  return (inBand(map.roadCols, x) && withinSpan(map.roadRows, y))
    || (inBand(map.roadRows, y) && withinSpan(map.roadCols, x));
}

interface LocalCar { x: number; y: number; a: number; s: number; stunnedUntil: number; busGraceUntil: number }
interface RemoteCar { x: number; y: number; a: number }

interface Hud {
  timeLeft: number;
  rush: boolean;
  status: string;
  scores: { id: string; name: string; score: number; color: string; me: boolean }[];
}

const AutoRushGame: React.FC<GameComponentProps> = ({
  roomId, playerId, players, onGameComplete, setPlayers, gameData,
}) => {
  const { socket, isConnected } = useSocket();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Everything the render loop reads lives in refs so it never re-subscribes.
  const mapRef = useRef<GameMap | null>(gameData?.autoRush?.map ?? null);
  const snapRef = useRef<Snapshot | null>(gameData?.autoRush ?? null);
  const rushMsRef = useRef<number>(gameData?.autoRush?.rushHourMs ?? 30000);
  const scoresRef = useRef<Record<string, number>>(gameData?.autoRush?.scores ?? {});
  const clockOffsetRef = useRef(0);
  const meRef = useRef<LocalCar | null>(null);
  const remotesRef = useRef<Record<string, RemoteCar>>({});
  const keysRef = useRef<Record<string, boolean>>({});
  const stickRef = useRef<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const playersRef = useRef<Player[]>(players);
  const feedRef = useRef<{ text: string; until: number }[]>([]);
  playersRef.current = players;

  const [hud, setHud] = useState<Hud>({ timeLeft: 0, rush: false, status: "", scores: [] });
  const [ready, setReady] = useState(!!mapRef.current);
  const [finalPlayers, setFinalPlayers] = useState<Player[] | null>(null);

  const nameOf = useCallback((id: string) => {
    if (id === playerId) return "You";
    return playersRef.current.find(p => p.id === id)?.name ?? "Someone";
  }, [playerId]);

  // ---- Networking ----

  useEffect(() => {
    if (!socket || !isConnected || !roomId || !playerId) return;

    const applySnapshot = (snap: Snapshot) => {
      snapRef.current = snap;
      clockOffsetRef.current = snap.now - Date.now();
      const mine = snap.cars[playerId];
      if (mine && !meRef.current) {
        meRef.current = { x: mine.x, y: mine.y, a: mine.a, s: 0, stunnedUntil: 0, busGraceUntil: 0 };
      }
    };

    const handleInit = (init: InitPayload) => {
      mapRef.current = init.map;
      rushMsRef.current = init.rushHourMs;
      scoresRef.current = { ...init.scores };
      applySnapshot(init);
      setReady(true);
      if (init.status === 'finished') setFinalPlayers(prev => prev ?? playersRef.current);
    };

    const handleEvent = (event: GameEvent) => {
      let text = "";
      if (event.type === 'deliver') {
        scoresRef.current[event.by] = event.score;
        text = `${nameOf(event.by)} dropped at ${event.stop} · +₹${event.fare}`;
      } else if (event.type === 'steal') {
        text = `${nameOf(event.by)} stole ${event.from === playerId ? "your" : `${nameOf(event.from)}'s`} passenger!`;
      } else if (event.type === 'chai' && event.by === playerId) {
        text = "Chai break! Speed boost ☕";
      } else if (event.type === 'pickup' && event.by === playerId) {
        text = `Passenger wants ${event.stop}`;
      }
      if (text) feedRef.current = [...feedRef.current.slice(-2), { text, until: Date.now() + 3500 }];
    };

    const handleCorrect = ({ x, y }: { x: number; y: number }) => {
      if (meRef.current) { meRef.current.x = x; meRef.current.y = y; meRef.current.s = 0; }
    };

    const handleGameOver = ({ players: final }: { players: Player[] }) => {
      setPlayers(final);
      setFinalPlayers(final);
    };

    socket.on('auto-rush:init', handleInit);
    socket.on('auto-rush:state', applySnapshot);
    socket.on('auto-rush:event', handleEvent);
    socket.on('auto-rush:correct', handleCorrect);
    socket.on('auto-rush:gameOver', handleGameOver);
    socket.emit('auto-rush:requestState', { roomId, playerId });

    const sender = setInterval(() => {
      const me = meRef.current;
      if (!me || snapRef.current?.status !== 'active') return;
      socket.emit('auto-rush:pos', { roomId, playerId, x: me.x, y: me.y, a: me.a, s: me.s });
    }, SEND_INTERVAL_MS);

    return () => {
      clearInterval(sender);
      socket.off('auto-rush:init', handleInit);
      socket.off('auto-rush:state', applySnapshot);
      socket.off('auto-rush:event', handleEvent);
      socket.off('auto-rush:correct', handleCorrect);
      socket.off('auto-rush:gameOver', handleGameOver);
    };
  }, [socket, isConnected, roomId, playerId, setPlayers, nameOf]);

  // ---- Input ----

  useEffect(() => {
    const tracked = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", " "];
    const onKey = (down: boolean) => (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (!tracked.includes(key)) return;
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      e.preventDefault();
      keysRef.current[key] = down;
    };
    const down = onKey(true), up = onKey(false);
    const blur = () => { keysRef.current = {}; };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return; // desktop drives with the keyboard
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    stickRef.current = { ox: e.clientX - rect.left, oy: e.clientY - rect.top, dx: 0, dy: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const stick = stickRef.current;
    if (!stick) return;
    const rect = e.currentTarget.getBoundingClientRect();
    stick.dx = e.clientX - rect.left - stick.ox;
    stick.dy = e.clientY - rect.top - stick.oy;
  };
  const onPointerUp = () => { stickRef.current = null; };

  // ---- Simulation + rendering ----

  useEffect(() => {
    if (!ready) return;
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let viewW = 0, viewH = 0;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      viewW = wrap.clientWidth;
      viewH = wrap.clientHeight;
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
      canvas.style.width = `${viewW}px`;
      canvas.style.height = `${viewH}px`;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(wrap);

    const colorOf = (id: string) => {
      const ids = Object.keys(snapRef.current?.cars ?? {}).sort();
      return CAR_COLORS[Math.max(0, ids.indexOf(id)) % CAR_COLORS.length];
    };

    const step = (dt: number, serverNow: number) => {
      const map = mapRef.current!;
      const snap = snapRef.current!;
      const me = meRef.current;
      if (!me || snap.status !== 'active') return;

      const boosted = (snap.cars[playerId]?.b ?? 0) > serverNow;
      const top = boosted ? BOOST_SPEED : MAX_SPEED;

      if (Date.now() < me.stunnedUntil) {
        me.s = 0;
        me.a = wrapAngle(me.a + dt * 14); // spin out
        return;
      }

      const keys = keysRef.current;
      let throttle = 0, steer = 0;
      const stick = stickRef.current;
      if (stick && Math.hypot(stick.dx, stick.dy) > 12) {
        // Touch: point the stick where you want to go
        const diff = wrapAngle(Math.atan2(stick.dy, stick.dx) - me.a);
        steer = clamp(diff * 2.5, -1, 1);
        throttle = clamp(Math.hypot(stick.dx, stick.dy) / 50, 0.4, 1);
      } else {
        throttle = (keys.ArrowUp || keys.w ? 1 : 0) - (keys.ArrowDown || keys.s || keys[" "] ? 1 : 0);
        steer = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
      }

      if (throttle !== 0) me.s += throttle * ACCEL * (boosted ? 1.6 : 1) * dt;
      else me.s -= me.s * Math.min(1, 2.2 * dt);
      if (me.s > top) me.s = Math.max(top, me.s - 500 * dt);
      me.s = Math.max(me.s, -REVERSE_SPEED);

      const grip = clamp(Math.abs(me.s) / 110, 0, 1);
      me.a = wrapAngle(me.a + steer * TURN_RATE * grip * Math.sign(me.s || 1) * dt);

      const nx = me.x + Math.cos(me.a) * me.s * dt;
      const ny = me.y + Math.sin(me.a) * me.s * dt;
      if (isDrivable(map, nx, ny)) { me.x = nx; me.y = ny; }
      else if (isDrivable(map, nx, me.y)) { me.x = nx; me.s *= 1 - 3 * dt; }
      else if (isDrivable(map, me.x, ny)) { me.y = ny; me.s *= 1 - 3 * dt; }
      else me.s *= -0.3;

      // Buses win every argument
      if (Date.now() > me.busGraceUntil) {
        for (const bus of map.buses) {
          const b = busPosition(bus, serverNow);
          const halfX = (bus.axis === 'h' ? BUS_LENGTH : BUS_WIDTH) / 2 + CAR_RADIUS - 4;
          const halfY = (bus.axis === 'h' ? BUS_WIDTH : BUS_LENGTH) / 2 + CAR_RADIUS - 4;
          if (Math.abs(me.x - b.x) < halfX && Math.abs(me.y - b.y) < halfY) {
            me.stunnedUntil = Date.now() + STUN_MS;
            me.busGraceUntil = Date.now() + BUS_GRACE_MS;
            feedRef.current = [...feedRef.current.slice(-2), { text: "Hit by a bus! 🚌", until: Date.now() + 2500 }];
            break;
          }
        }
      }
    };

    const drawAuto = (x: number, y: number, angle: number, color: string, opts: { loaded: boolean; boosted: boolean; ghost: boolean }) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      if (opts.ghost) ctx.globalAlpha = 0.5;
      if (opts.boosted) {
        ctx.fillStyle = "rgba(251, 146, 60, 0.8)";
        ctx.beginPath();
        ctx.moveTo(-17, -6); ctx.lineTo(-30 - Math.random() * 8, 0); ctx.lineTo(-17, 6);
        ctx.fill();
      }
      ctx.fillStyle = "#111827"; // wheels
      ctx.fillRect(-13, -12, 8, 4); ctx.fillRect(-13, 8, 8, 4); ctx.fillRect(11, -2, 7, 4);
      ctx.fillStyle = "#facc15"; // body
      ctx.beginPath(); ctx.roundRect(-16, -10, 26, 20, 5); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, -9); ctx.lineTo(18, -4); ctx.lineTo(18, 4); ctx.lineTo(10, 9); ctx.fill();
      ctx.fillStyle = "#1f2937"; // canopy
      ctx.beginPath(); ctx.roundRect(-13, -8, 17, 16, 3); ctx.fill();
      ctx.fillStyle = color; // player stripe
      ctx.fillRect(-13, -2.5, 17, 5);
      if (opts.loaded) {
        ctx.fillStyle = "#fde68a";
        ctx.beginPath(); ctx.arc(-6, 0, 4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
    };

    const label = (text: string, x: number, y: number, size: number, fill = "#111827", bg?: string) => {
      ctx.font = `600 ${size}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (bg) {
        const w = ctx.measureText(text).width + 10;
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.roundRect(x - w / 2, y - size * 0.75, w, size * 1.5, 6); ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.fillText(text, x, y);
    };

    const render = (serverNow: number, dt: number) => {
      const map = mapRef.current!;
      const snap = snapRef.current!;
      const me = meRef.current;
      const dpr = window.devicePixelRatio || 1;
      const zoom = clamp(Math.min(viewW, viewH * 1.6) / 900, 0.55, 1.15);
      const worldW = viewW / zoom, worldH = viewH / zoom;
      const focus = me ?? { x: map.width / 2, y: map.height / 2 };
      const camX = worldW >= map.width ? (map.width - worldW) / 2 : clamp(focus.x - worldW / 2, 0, map.width - worldW);
      const camY = worldH >= map.height ? (map.height - worldH) / 2 : clamp(focus.y - worldH / 2, 0, map.height - worldH);
      const T = map.tile, roadW = map.roadTiles * T;

      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -camX * dpr * zoom, -camY * dpr * zoom);
      ctx.fillStyle = "#86a876";
      ctx.fillRect(camX, camY, worldW, worldH);

      // Roads
      const x0 = map.roadCols[0] * T, x1 = map.roadCols[map.roadCols.length - 1] * T + roadW;
      const y0 = map.roadRows[0] * T, y1 = map.roadRows[map.roadRows.length - 1] * T + roadW;
      ctx.fillStyle = "#4b5563";
      map.roadCols.forEach(c => ctx.fillRect(c * T, y0, roadW, y1 - y0));
      map.roadRows.forEach(r => ctx.fillRect(x0, r * T, x1 - x0, roadW));
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 2;
      ctx.setLineDash([14, 14]);
      ctx.beginPath();
      map.roadCols.forEach(c => { ctx.moveTo(c * T + roadW / 2, y0); ctx.lineTo(c * T + roadW / 2, y1); });
      map.roadRows.forEach(r => { ctx.moveTo(x0, r * T + roadW / 2); ctx.lineTo(x1, r * T + roadW / 2); });
      ctx.stroke();
      ctx.setLineDash([]);

      // City blocks
      for (const block of map.blocks) {
        ctx.fillStyle = BLOCK_COLORS[block.kind] ?? "#d6d3d1";
        ctx.beginPath(); ctx.roundRect(block.x + 6, block.y + 6, block.w - 12, block.h - 12, 14); ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 2; ctx.stroke();
        ctx.font = "64px system-ui, sans-serif";
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#111827";
        ctx.fillText(block.emoji, block.x + block.w / 2, block.y + block.h / 2 - 18);
        label(block.name, block.x + block.w / 2, block.y + block.h / 2 + 46, 20, "#374151");
      }

      // Stops, passengers, destination
      const myCar = snap.cars[playerId];
      const myPassenger = myCar?.c != null ? snap.passengers.find(p => p.id === myCar.c) : undefined;
      const pulse = 0.5 + 0.5 * Math.sin(serverNow / 180);
      for (const stop of map.stops) {
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.beginPath(); ctx.arc(stop.x, stop.y, 20, 0, Math.PI * 2); ctx.fill();
      }
      if (myPassenger) {
        const dest = map.stops[myPassenger.to];
        ctx.strokeStyle = `rgba(34,197,94,${0.5 + pulse * 0.5})`;
        ctx.lineWidth = 6;
        ctx.beginPath(); ctx.arc(dest.x, dest.y, 30 + pulse * 10, 0, Math.PI * 2); ctx.stroke();
        ctx.font = "30px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText("🏁", dest.x, dest.y);
      }
      for (const p of snap.passengers) {
        if (p.carrier) continue;
        const stop = map.stops[p.from];
        const bob = Math.sin(serverNow / 250 + p.id) * 3;
        ctx.font = "28px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = "#111827";
        ctx.fillText("🙋", stop.x, stop.y + bob);
        label(`₹${p.fare} → ${map.stops[p.to].name}`, stop.x, stop.y - 30, 13, "#fff", "rgba(17,24,39,0.8)");
      }

      // Chai
      ctx.font = "24px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      for (const chai of snap.chais) ctx.fillText("☕", chai.x, chai.y + Math.sin(serverNow / 300 + chai.id) * 2);

      // Buses
      for (const bus of map.buses) {
        const b = busPosition(bus, serverNow);
        ctx.save();
        ctx.translate(b.x, b.y); ctx.rotate(b.angle);
        ctx.fillStyle = "#dc2626";
        ctx.beginPath(); ctx.roundRect(-BUS_LENGTH / 2, -BUS_WIDTH / 2, BUS_LENGTH, BUS_WIDTH, 6); ctx.fill();
        ctx.fillStyle = "#fecaca";
        ctx.fillRect(BUS_LENGTH / 2 - 12, -BUS_WIDTH / 2 + 4, 7, BUS_WIDTH - 8);
        ctx.fillStyle = "#fff";
        ctx.fillRect(-BUS_LENGTH / 2 + 8, -3, BUS_LENGTH - 30, 6);
        ctx.restore();
      }

      // Other autos (smoothed toward their last reported position)
      const players = playersRef.current;
      for (const [id, car] of Object.entries(snap.cars)) {
        if (id === playerId) continue;
        const remote = remotesRef.current[id] ?? (remotesRef.current[id] = { x: car.x, y: car.y, a: car.a });
        const k = Math.min(1, dt * 12);
        remote.x += (car.x - remote.x) * k;
        remote.y += (car.y - remote.y) * k;
        remote.a = wrapAngle(remote.a + wrapAngle(car.a - remote.a) * k);
        const player = players.find(p => p.id === id) as (Player & { disconnected?: boolean }) | undefined;
        drawAuto(remote.x, remote.y, remote.a, colorOf(id), { loaded: car.c != null, boosted: car.b > serverNow, ghost: !!player?.disconnected });
        label(player?.name ?? "Player", remote.x, remote.y - 28, 13, "#fff", "rgba(17,24,39,0.7)");
      }
      if (me) {
        const flicker = Date.now() < me.busGraceUntil && Math.floor(Date.now() / 100) % 2 === 0;
        drawAuto(me.x, me.y, me.a, colorOf(playerId), { loaded: myCar?.c != null, boosted: (myCar?.b ?? 0) > serverNow, ghost: flicker });
      }

      // ---- Screen-space overlays ----
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Arrow toward the destination, or the nearest waiting passenger
      if (me) {
        let target: Stop | undefined;
        if (myPassenger) target = map.stops[myPassenger.to];
        else {
          let best = Infinity;
          for (const p of snap.passengers) {
            if (p.carrier) continue;
            const stop = map.stops[p.from];
            const d = Math.hypot(stop.x - me.x, stop.y - me.y);
            if (d < best) { best = d; target = stop; }
          }
        }
        if (target) {
          const sx = (target.x - camX) * zoom, sy = (target.y - camY) * zoom;
          if (sx < 20 || sx > viewW - 20 || sy < 20 || sy > viewH - 20) {
            const cx = (me.x - camX) * zoom, cy = (me.y - camY) * zoom;
            const ang = Math.atan2(sy - cy, sx - cx);
            const reach = Math.min(
              Math.abs(Math.cos(ang)) > 0.001 ? (viewW / 2 - 36) / Math.abs(Math.cos(ang)) : Infinity,
              Math.abs(Math.sin(ang)) > 0.001 ? (viewH / 2 - 36) / Math.abs(Math.sin(ang)) : Infinity,
            );
            const ax = clamp(cx + Math.cos(ang) * reach, 30, viewW - 30);
            const ay = clamp(cy + Math.sin(ang) * reach, 30, viewH - 30);
            ctx.save();
            ctx.translate(ax, ay); ctx.rotate(ang);
            ctx.fillStyle = myPassenger ? "#22c55e" : "#facc15";
            ctx.strokeStyle = "#111827"; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -12); ctx.lineTo(-4, 0); ctx.lineTo(-10, 12); ctx.closePath();
            ctx.fill(); ctx.stroke();
            ctx.restore();
          }
        }
      }

      // Minimap
      const mmW = Math.min(150, viewW * 0.32), mmScale = mmW / map.width, mmH = map.height * mmScale;
      const mmX = viewW - mmW - 10, mmY = viewH - mmH - 10;
      ctx.fillStyle = "rgba(17,24,39,0.75)";
      ctx.beginPath(); ctx.roundRect(mmX - 4, mmY - 4, mmW + 8, mmH + 8, 8); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      map.roadCols.forEach(c => ctx.fillRect(mmX + c * T * mmScale, mmY + y0 * mmScale, roadW * mmScale, (y1 - y0) * mmScale));
      map.roadRows.forEach(r => ctx.fillRect(mmX + x0 * mmScale, mmY + r * T * mmScale, (x1 - x0) * mmScale, roadW * mmScale));
      const dot = (x: number, y: number, r: number, color: string) => {
        ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(mmX + x * mmScale, mmY + y * mmScale, r, 0, Math.PI * 2); ctx.fill();
      };
      for (const p of snap.passengers) if (!p.carrier) dot(map.stops[p.from].x, map.stops[p.from].y, 2.5, "#facc15");
      if (myPassenger) dot(map.stops[myPassenger.to].x, map.stops[myPassenger.to].y, 4 + pulse * 2, "#22c55e");
      for (const [id, car] of Object.entries(snap.cars)) if (id !== playerId) dot(car.x, car.y, 3, colorOf(id));
      if (me) { dot(me.x, me.y, 4.5, "#fff"); dot(me.x, me.y, 3, colorOf(playerId)); }

      // Touch stick
      const stick = stickRef.current;
      if (stick) {
        ctx.strokeStyle = "rgba(255,255,255,0.6)"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(stick.ox, stick.oy, 46, 0, Math.PI * 2); ctx.stroke();
        const mag = Math.hypot(stick.dx, stick.dy) || 1, lim = Math.min(mag, 46);
        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.beginPath(); ctx.arc(stick.ox + stick.dx / mag * lim, stick.oy + stick.dy / mag * lim, 20, 0, Math.PI * 2); ctx.fill();
      }

      // Event feed
      const feed = feedRef.current.filter(f => f.until > Date.now());
      feedRef.current = feed;
      feed.forEach((f, i) => label(f.text, viewW / 2, 84 + i * 28, 15, "#fff", "rgba(17,24,39,0.8)"));
    };

    let raf = 0;
    let last = performance.now();
    let lastHud = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const snap = snapRef.current;
      if (!snap || !mapRef.current) return;
      const serverNow = Date.now() + clockOffsetRef.current;
      step(dt, serverNow);
      render(serverNow, dt);

      if (t - lastHud > 250) {
        lastHud = t;
        const msLeft = Math.max(0, snap.endsAt - serverNow);
        const mine = snap.cars[playerId];
        const carried = mine?.c != null ? snap.passengers.find(p => p.id === mine.c) : undefined;
        const rush = msLeft <= rushMsRef.current;
        const status = !mine ? "Spectating"
          : carried ? `Drop at ${mapRef.current.stops[carried.to].name} · ₹${carried.fare * (rush ? 2 : 1)}`
          : "Find a passenger 🙋";
        setHud({
          timeLeft: Math.ceil(msLeft / 1000),
          rush,
          status,
          scores: Object.keys(snap.cars).map(id => ({
            id,
            name: playersRef.current.find(p => p.id === id)?.name ?? "Player",
            score: scoresRef.current[id] ?? 0,
            color: colorOf(id),
            me: id === playerId,
          })).sort((a, b) => b.score - a.score),
        });
      }
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [ready, playerId]);

  const handleBackToLobby = useCallback(() => {
    setFinalPlayers(null);
    onGameComplete();
  }, [onGameComplete]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground animate-pulse">Starting the meter...</p>
      </div>
    );
  }

  const minutes = Math.floor(hud.timeLeft / 60);
  const seconds = String(hud.timeLeft % 60).padStart(2, "0");

  return (
    <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden select-none" style={{ height: "calc(100dvh - 57px)" }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {/* Clock */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
        <div className={cn(
          "px-4 py-1 rounded-full font-mono text-xl font-bold shadow-lg",
          hud.rush ? "bg-red-600 text-white animate-pulse" : "bg-gray-900/85 text-white"
        )}>
          {minutes}:{seconds}
        </div>
        {hud.rush && <span className="text-xs font-bold text-white bg-red-600 px-2 py-0.5 rounded-full">RUSH HOUR · 2× FARES</span>}
      </div>

      {/* Scoreboard */}
      <div className="absolute top-3 left-3 bg-gray-900/85 text-white rounded-xl px-3 py-2 text-sm shadow-lg pointer-events-none max-w-[45vw]">
        {hud.scores.map((s, i) => (
          <div key={s.id} className={cn("flex items-center gap-2", s.me && "font-bold")}>
            <span className="w-3 text-gray-400">{i + 1}</span>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="truncate">{s.name}</span>
            <span className="ml-auto pl-3 tabular-nums">₹{s.score}</span>
          </div>
        ))}
      </div>

      {/* Current job */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-gray-900/85 text-white rounded-full px-4 py-2 text-sm font-semibold shadow-lg pointer-events-none whitespace-nowrap max-w-[60vw] truncate">
        {hud.status}
      </div>

      <div className="absolute bottom-4 left-3 text-[11px] text-white/90 bg-gray-900/60 rounded-md px-2 py-1 pointer-events-none hidden md:block">
        Arrows / WASD to drive · ram loaded autos to steal their fare
      </div>

      <Dialog open={!!finalPlayers} onOpenChange={(open) => { if (!open) handleBackToLobby(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-yellow-500" /> Meter down!
            </DialogTitle>
            <DialogDescription>Final earnings</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {[...(finalPlayers ?? [])]
              .sort((a, b) => (b.score || 0) - (a.score || 0))
              .map((player, i) => (
                <div key={player.id} className="flex justify-between p-3 rounded-md bg-secondary/80">
                  <span>{i === 0 ? "🏆 " : ""}{player.name}{player.id === playerId ? " (You)" : ""}</span>
                  <span className="font-semibold">₹{player.score ?? 0}</span>
                </div>
              ))}
          </div>
          <DialogFooter>
            <Button onClick={handleBackToLobby}>Back to Lobby</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AutoRushGame;
