import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { useSocket } from "@/hooks/useSocket";
import { cn } from "@/lib/utils";
import { GameComponentProps, Player } from "@/games/types";
import { Megaphone, Music, Radio, Share2, Trophy, Volume2, VolumeX } from "lucide-react";
import { GameAudio } from "./audio";
import { RushScene } from "./scene";
import {
  BOOST_SPEED, GameEvent, GameMap, InitPayload, KMH_PER_UNIT, LocalCar, MAX_SPEED, Snapshot,
  Point, busPosition, clamp, colorFor, routeLength, routeTo, stepCar,
} from "./shared";

const SEND_INTERVAL_MS = 80;

// What passengers say. Hyderabadi street Hindi, kept friendly.
const PICKUP_LINES = [
  (stop: string) => `"Bhai, ${stop} chaloge?"`,
  (stop: string) => `"${stop} jaana hai, jaldi chalo miya!"`,
  (stop: string) => `"Meter se chalo — ${stop}."`,
  (stop: string) => `"${stop}! Late ho raha hai, boss."`,
];
const DROP_LINES = ["\"Kirrak driving, miya!\"", "\"Shukriya bhai!\"", "\"Ek number!\"", "\"Chillar rakh lo.\""];
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];

interface Hud {
  timeLeft: number;
  rush: boolean;
  status: string;
  distance: number | null; // metres left on the GPS route
  loaded: boolean;
  kmh: number;
  boosted: boolean;
  scores: { id: string; name: string; score: number; color: string; me: boolean }[];
}

interface Toast { id: number; text: string; tone: "good" | "bad" | "info" }

const AutoRushGame: React.FC<GameComponentProps> = ({
  roomId, playerId, players, onGameComplete, setPlayers, gameData,
}) => {
  const { socket, isConnected } = useSocket();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Everything the frame loop reads lives in refs so it never re-subscribes.
  const mapRef = useRef<GameMap | null>(gameData?.autoRush?.map ?? null);
  const snapRef = useRef<Snapshot | null>(gameData?.autoRush ?? null);
  const rushMsRef = useRef<number>(gameData?.autoRush?.rushHourMs ?? 30000);
  const scoresRef = useRef<Record<string, number>>(gameData?.autoRush?.scores ?? {});
  const clockOffsetRef = useRef(0);
  const meRef = useRef<LocalCar | null>(null);
  const keysRef = useRef<Record<string, boolean>>({});
  const touchRef = useRef<{ ox: number; oy: number; dx: number; dy: number } | null>(null);
  const playersRef = useRef<Player[]>(players);
  const sceneRef = useRef<RushScene | null>(null);
  const audioRef = useRef<GameAudio | null>(null);
  const toastIdRef = useRef(0);
  const routeRef = useRef<Point[] | null>(null);
  playersRef.current = players;
  if (!audioRef.current) audioRef.current = new GameAudio();
  const audio = audioRef.current;

  const [hud, setHud] = useState<Hud>({ timeLeft: 0, rush: false, status: "", distance: null, loaded: false, kmh: 0, boosted: false, scores: [] });
  const [hasMap, setHasMap] = useState(!!mapRef.current);
  const [sceneReady, setSceneReady] = useState(false);
  const [finalPlayers, setFinalPlayers] = useState<Player[] | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [soundOn, setSoundOn] = useState(audio.prefs.sound);
  const [musicOn, setMusicOn] = useState(audio.prefs.music);
  const [station, setStation] = useState(audio.stationName);

  const toast = useCallback((text: string, tone: Toast["tone"] = "info") => {
    const id = ++toastIdRef.current;
    setToasts(list => [...list.slice(-2), { id, text, tone }]);
    setTimeout(() => setToasts(list => list.filter(t => t.id !== id)), 3200);
  }, []);

  const nameOf = useCallback((id: string) => {
    if (id === playerId) return "You";
    return playersRef.current.find(p => p.id === id)?.name ?? "Someone";
  }, [playerId]);

  const honk = useCallback(() => {
    audio.unlock();
    audio.play("horn", 0.9, 350);
    socket?.emit('auto-rush:horn', { roomId, playerId });
  }, [audio, socket, roomId, playerId]);

  // ---- Networking ----

  useEffect(() => {
    if (!socket || !isConnected || !roomId || !playerId) return;

    const applySnapshot = (snap: Snapshot) => {
      snapRef.current = snap;
      clockOffsetRef.current = snap.now - Date.now();
      const mine = snap.cars[playerId];
      if (mine && !meRef.current) {
        meRef.current = { x: mine.x, y: mine.y, a: mine.a, s: 0, steer: 0, stunnedUntil: 0, busGraceUntil: Date.now() + 4000, carGraceUntil: Date.now() + 4000 }; // a few safe seconds after spawning
      }
    };

    const handleInit = (init: InitPayload) => {
      mapRef.current = init.map;
      rushMsRef.current = init.rushHourMs;
      scoresRef.current = { ...init.scores };
      applySnapshot(init);
      setHasMap(true);
      if (init.status === 'finished') setFinalPlayers(prev => prev ?? playersRef.current);
    };

    const handleEvent = (event: GameEvent) => {
      const mine = event.by === playerId;
      if (event.type === 'deliver') {
        scoresRef.current[event.by] = event.score;
        if (mine) {
          audio.play("cash");
          toast(`+₹${event.fare}  ${pick(DROP_LINES)}`, "good");
        } else {
          toast(`${nameOf(event.by)} dropped at ${event.stop} · +₹${event.fare}`);
        }
      } else if (event.type === 'steal') {
        const victim = event.from === playerId;
        if (mine || victim) { audio.play("steal"); sceneRef.current?.shake(0.35); }
        toast(
          mine ? `You stole ${nameOf(event.from)}'s passenger!` : `${nameOf(event.by)} stole ${victim ? "your" : `${nameOf(event.from)}'s`} passenger!`,
          mine ? "good" : victim ? "bad" : "info",
        );
      } else if (event.type === 'chai' && mine) {
        audio.play("boost");
        toast("Irani chai! Full speed ☕", "good");
      } else if (event.type === 'pickup' && mine) {
        audio.play("pickup");
        toast(pick(PICKUP_LINES)(event.stop));
      }
    };

    const handleHorn = ({ by }: { by: string }) => {
      const me = meRef.current, other = snapRef.current?.cars[by];
      if (by === playerId || !me || !other) return;
      const volume = clamp(1 - Math.hypot(other.x - me.x, other.y - me.y) / 900, 0, 1) * 0.8;
      if (volume > 0.05) audio.play("horn", volume, 200);
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
    socket.on('auto-rush:horn', handleHorn);
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
      socket.off('auto-rush:horn', handleHorn);
      socket.off('auto-rush:correct', handleCorrect);
      socket.off('auto-rush:gameOver', handleGameOver);
    };
  }, [socket, isConnected, roomId, playerId, setPlayers, nameOf, toast, audio]);

  // ---- Input ----

  const toggleSound = useCallback(() => {
    audio.unlock();
    audio.setSound(!audio.prefs.sound);
    setSoundOn(audio.prefs.sound);
  }, [audio]);

  const toggleMusic = useCallback(() => {
    audio.unlock();
    audio.setMusic(!audio.prefs.music);
    setMusicOn(audio.prefs.music);
  }, [audio]);

  const nextStation = useCallback(() => {
    audio.unlock();
    if (!audio.prefs.music) { audio.setMusic(true); setMusicOn(true); }
    setStation(audio.nextStation());
  }, [audio]);

  useEffect(() => {
    audio.unlock(); // works when the click that started the match still counts as a gesture
    const driving = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "w", "a", "s", "d", " "];
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      audio.unlock();
      if (driving.includes(key)) { e.preventDefault(); keysRef.current[key] = true; return; }
      if (e.repeat) return;
      if (key === "h") honk();
      else if (key === "m") toggleSound();
      else if (key === "r") nextStation();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      keysRef.current[key] = false;
    };
    const onBlur = () => { keysRef.current = {}; };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [audio, honk, toggleSound, nextStation]);

  useEffect(() => () => audio.dispose(), [audio]);

  // Touch: hold to accelerate, slide sideways to steer, pull down to brake.
  const onPointerDown = (e: React.PointerEvent) => {
    audio.unlock();
    if (e.pointerType === "mouse") return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    touchRef.current = { ox: e.clientX, oy: e.clientY, dx: 0, dy: 0 };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const touch = touchRef.current;
    if (!touch) return;
    touch.dx = e.clientX - touch.ox;
    touch.dy = e.clientY - touch.oy;
  };
  const onPointerUp = () => { touchRef.current = null; };

  // ---- Scene + frame loop ----

  useEffect(() => {
    if (!hasMap) return;
    const canvas = canvasRef.current, wrap = wrapRef.current, map = mapRef.current;
    if (!canvas || !wrap || !map) return;

    let cancelled = false;
    let raf = 0;
    let observer: ResizeObserver | null = null;
    const highQuality = window.matchMedia("(pointer: fine)").matches && window.innerWidth >= 768;

    RushScene.create(canvas, map, highQuality).then(scene => {
      if (cancelled) { scene.dispose(); return; }
      sceneRef.current = scene;
      setSceneReady(true);

      const resize = () => scene.resize(wrap.clientWidth, wrap.clientHeight);
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(wrap);

      let last = performance.now();
      let lastHud = 0, lastMinimap = 0, lastBusHorn = 0;

      const frame = (t: number) => {
        raf = requestAnimationFrame(frame);
        const dt = Math.min(0.05, (t - last) / 1000);
        last = t;
        const snap = snapRef.current;
        if (!snap) return;
        const serverNow = Date.now() + clockOffsetRef.current;
        const me = meRef.current;
        const mine = snap.cars[playerId];
        const boosted = (mine?.b ?? 0) > serverNow;

        let throttle = 0;
        if (me && snap.status === 'active') {
          const keys = keysRef.current;
          const touch = touchRef.current;
          let steer = 0;
          if (touch) {
            throttle = touch.dy > 45 ? -1 : 1;
            steer = clamp(touch.dx / 70, -1, 1);
          } else {
            throttle = (keys.ArrowUp || keys.w ? 1 : 0) - (keys.ArrowDown || keys.s || keys[" "] ? 1 : 0);
            steer = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
          }

          const result = stepCar(me, { throttle, steer }, map, boosted, serverNow, dt);
          if (result === 'bus') {
            audio.play("crash");
            scene.shake(0.9);
            toast("Hit by a bus! 🚌", "bad");
          } else if (result === 'car') {
            audio.play("crash", 0.6, 400);
            audio.play("horn", 0.5, 400);
            scene.shake(0.45);
          } else if (result === 'wall') {
            audio.play("crash", 0.45, 500);
            scene.shake(0.3);
          }
          if (Math.abs(me.steer) > 0.85 && me.s > MAX_SPEED * 0.8) audio.play("skid", 0.3, 1400);

          // A bus bearing down on you leans on its horn
          if (t - lastBusHorn > 4500) {
            for (const bus of map.buses) {
              const b = busPosition(bus, serverNow);
              if (Math.hypot(b.x - me.x, b.y - me.y) < 110) { audio.play("bushorn", 0.55); lastBusHorn = t; break; }
            }
          }
        }
        audio.setEngine(me ? clamp(Math.abs(me.s) / BOOST_SPEED, 0, 1) : 0, Math.max(0, throttle), boosted);

        const names: Record<string, string> = {};
        const ghosts: Record<string, boolean> = {};
        for (const p of playersRef.current as (Player & { disconnected?: boolean })[]) {
          names[p.id] = p.name;
          ghosts[p.id] = !!p.disconnected;
        }

        // GPS: to the drop-off when loaded, otherwise to the best nearby fare
        const carriedNow = mine?.c != null ? snap.passengers.find(p => p.id === mine.c) : undefined;
        let route: Point[] | null = null;
        if (me && snap.status === 'active') {
          if (carriedNow) route = routeTo(map, me, map.stops[carriedNow.to]);
          else {
            let best = Infinity;
            for (const p of snap.passengers) {
              if (p.carrier) continue;
              const candidate = routeTo(map, me, map.stops[p.from]);
              const length = routeLength(candidate);
              if (length < best) { best = length; route = candidate; }
            }
          }
        }
        routeRef.current = route;
        scene.update({ serverNow, myId: playerId, me, snap, names, ghosts, route, routeIsDropOff: !!carriedNow }, dt);
        scene.render();

        if (t - lastMinimap > 120) {
          lastMinimap = t;
          drawMinimap(minimapRef.current, map, snap, playerId, me, route, !!carriedNow);
        }

        if (t - lastHud > 200) {
          lastHud = t;
          const msLeft = Math.max(0, snap.endsAt - serverNow);
          const carried = mine?.c != null ? snap.passengers.find(p => p.id === mine.c) : undefined;
          const rush = msLeft <= rushMsRef.current;
          setHud({
            timeLeft: Math.ceil(msLeft / 1000),
            rush,
            loaded: !!carried,
            distance: routeRef.current ? Math.round(routeLength(routeRef.current) / 12 / 10) * 10 : null,
            status: !mine ? "Spectating"
              : carried ? `Drop at ${map.stops[carried.to].name} · ₹${carried.fare * (rush ? 2 : 1)}`
              : "Pick up a passenger",
            kmh: me ? Math.round(Math.abs(me.s) * KMH_PER_UNIT) : 0,
            boosted,
            scores: Object.keys(snap.cars).map(id => ({
              id,
              name: playersRef.current.find(p => p.id === id)?.name ?? "Player",
              score: scoresRef.current[id] ?? 0,
              color: colorFor(snap.cars, id),
              me: id === playerId,
            })).sort((a, b) => b.score - a.score),
          });
        }
      };
      raf = requestAnimationFrame(frame);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      observer?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [hasMap, playerId, audio, toast]);

  const handleBackToLobby = useCallback(() => {
    setFinalPlayers(null);
    onGameComplete();
  }, [onGameComplete]);

  const handleShare = useCallback(async () => {
    const ranked = [...(finalPlayers ?? [])].sort((a, b) => (b.score || 0) - (a.score || 0));
    const mine = ranked.find(p => p.id === playerId);
    const place = ranked.findIndex(p => p.id === playerId) + 1;
    const text = `I made ₹${mine?.score ?? 0} driving an auto through Hyderabad 🛺💨`
      + (ranked.length > 1 ? ` (finished #${place} of ${ranked.length})` : "")
      + ` Think you can beat me?`;
    const url = `${window.location.origin}/game/auto-rush/create`;
    try {
      if (navigator.share) { await navigator.share({ title: "Auto Rush: Hyderabad", text, url }); return; }
    } catch { return; } // share sheet dismissed
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}`, "_blank", "noopener");
  }, [finalPlayers, playerId]);

  if (!hasMap) {
    return (
      <div className="flex items-center justify-center flex-1">
        <p className="text-muted-foreground animate-pulse">Starting the meter...</p>
      </div>
    );
  }

  const minutes = Math.floor(hud.timeLeft / 60);
  const seconds = String(hud.timeLeft % 60).padStart(2, "0");
  const chip = "pointer-events-auto h-10 min-w-10 px-2.5 rounded-full bg-black/70 text-white backdrop-blur flex items-center justify-center gap-1.5 text-xs font-semibold hover:bg-black/85 active:scale-95 transition";

  return (
    <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden select-none bg-[#0b0a12]" style={{ height: "calc(100dvh - 57px)" }}>
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />

      {!sceneReady && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0b0a12] bg-cover bg-center" style={{ backgroundImage: "linear-gradient(rgba(11,10,18,0.55), rgba(11,10,18,0.9)), url(/auto-rush/cover.jpg)" }}>
          <p className="text-3xl font-black text-white tracking-tight">AUTO RUSH</p>
          <p className="text-amber-300 font-semibold animate-pulse">Loading Hyderabad...</p>
        </div>
      )}

      {/* Clock */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 pointer-events-none">
        <div className={cn(
          "px-4 py-1 rounded-full font-mono text-xl font-bold shadow-lg backdrop-blur",
          hud.rush ? "bg-red-600 text-white animate-pulse" : "bg-black/70 text-white"
        )}>
          {minutes}:{seconds}
        </div>
        {hud.rush && <span className="text-xs font-bold text-white bg-red-600 px-2 py-0.5 rounded-full">RUSH HOUR · 2× FARES</span>}
        <div className="mt-1 flex flex-col items-center gap-1">
          {toasts.map(t => (
            <div key={t.id} className={cn(
              "px-3 py-1.5 rounded-full text-sm font-semibold shadow-lg whitespace-nowrap animate-in fade-in slide-in-from-top-2",
              t.tone === "good" ? "bg-emerald-500 text-white" : t.tone === "bad" ? "bg-red-600 text-white" : "bg-black/75 text-white"
            )}>
              {t.text}
            </div>
          ))}
        </div>
      </div>

      {/* Scoreboard */}
      <div className="absolute top-3 left-3 bg-black/70 backdrop-blur text-white rounded-xl px-3 py-2 text-sm shadow-lg pointer-events-none max-w-[42vw]">
        {hud.scores.map((s, i) => (
          <div key={s.id} className={cn("flex items-center gap-2", s.me && "font-bold")}>
            <span className="w-3 text-gray-400">{i + 1}</span>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
            <span className="truncate">{s.name}</span>
            <span className="ml-auto pl-3 tabular-nums">₹{s.score}</span>
          </div>
        ))}
      </div>

      {/* Sound controls */}
      <div className="absolute top-3 right-3 flex items-center gap-2 pointer-events-none">
        <button type="button" className={cn(chip, "hidden sm:flex max-w-40")} onClick={nextStation} title="Next radio station (R)">
          <Radio className="h-4 w-4 shrink-0" /><span className="truncate">{station}</span>
        </button>
        <button type="button" className={cn(chip, !musicOn && "opacity-60")} onClick={toggleMusic} title="Radio on/off" aria-pressed={musicOn} aria-label="Toggle radio">
          <Music className="h-4 w-4" />{!musicOn && <span>off</span>}
        </button>
        <button type="button" className={cn(chip, !soundOn && "opacity-60")} onClick={toggleSound} title="Sound on/off (M)" aria-pressed={soundOn} aria-label="Toggle sound">
          {soundOn ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
        </button>
      </div>

      {/* Minimap */}
      <div className="absolute top-16 right-3 pointer-events-none">
        <canvas ref={minimapRef} width={480} height={353} className="w-40 sm:w-64 rounded-xl shadow-xl ring-2 ring-white/30" />
        <div className="mt-1 text-center text-[11px] font-semibold text-white/90 bg-black/60 rounded-md px-2 py-0.5">
          {hud.loaded ? "Follow the green line" : "Follow the yellow line"}{hud.distance != null ? ` · ${hud.distance} m` : ""}
        </div>
      </div>

      {/* Speedometer */}
      <div className="absolute bottom-4 right-4 flex items-end gap-2 pointer-events-none">
        <div className={cn("rounded-2xl px-4 py-2 text-right backdrop-blur shadow-lg", hud.boosted ? "bg-orange-500/90 text-white" : "bg-black/70 text-white")}>
          <div className="text-4xl font-black tabular-nums leading-none">{hud.kmh}</div>
          <div className="text-[10px] font-semibold tracking-widest opacity-80">KM/H{hud.boosted ? " · CHAI" : ""}</div>
        </div>
      </div>

      {/* Horn (touch) */}
      <button
        type="button"
        onClick={honk}
        aria-label="Horn"
        className="absolute bottom-24 right-4 h-14 w-14 rounded-full bg-amber-400 text-black shadow-lg flex items-center justify-center active:scale-90 transition md:hidden"
      >
        <Megaphone className="h-6 w-6" />
      </button>

      {/* Current job */}
      <div className={cn(
        "absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-bold shadow-lg pointer-events-none whitespace-nowrap max-w-[58vw] truncate backdrop-blur",
        hud.loaded ? "bg-emerald-500 text-white" : "bg-amber-400 text-black"
      )}>
        {hud.status}{hud.distance != null ? ` · ${hud.distance} m` : ""}
      </div>

      <div className="absolute bottom-4 left-3 text-[11px] text-white/90 bg-black/60 rounded-md px-2 py-1 pointer-events-none hidden md:block">
        WASD / arrows drive · Space brake · H horn · R radio · M mute
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
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleShare}>
              <Share2 className="h-4 w-4 mr-1" /> Challenge friends
            </Button>
            <Button onClick={handleBackToLobby}>Back to Lobby</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function drawMinimap(
  canvas: HTMLCanvasElement | null, map: GameMap, snap: Snapshot, playerId: string, me: LocalCar | null,
  route: Point[] | null, routeIsDropOff: boolean,
) {
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx) return;
  const k = canvas.width / map.width;
  const T = map.tile, road = map.roadTiles * T;
  const x0 = map.roadCols[0] * T, x1 = map.roadCols[map.roadCols.length - 1] * T + road;
  const y0 = map.roadRows[0] * T, y1 = map.roadRows[map.roadRows.length - 1] * T + road;

  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, map.width, map.height);
  ctx.fillStyle = "rgba(12,12,24,0.92)";
  ctx.fillRect(0, 0, map.width, map.height);

  // Blocks, tinted so parks and lakes work as landmarks
  const tint: Record<string, string> = { park: "#1f5c33", water: "#1c5d8f", heritage: "#6b5a3c" };
  for (const b of map.blocks) {
    ctx.fillStyle = tint[b.kind] ?? "#2b2d3a";
    ctx.fillRect(b.x + 8, b.y + 8, b.w - 16, b.h - 16);
  }
  ctx.fillStyle = "#6b7280";
  map.roadCols.forEach(c => ctx.fillRect(c * T, y0, road, y1 - y0));
  map.roadRows.forEach(r => ctx.fillRect(x0, r * T, x1 - x0, road));

  const mine = snap.cars[playerId];
  const carried = mine?.c != null ? snap.passengers.find(p => p.id === mine.c) : undefined;

  // GPS route
  if (route && route.length > 1) {
    ctx.strokeStyle = routeIsDropOff ? "#4ade80" : "#facc15";
    ctx.lineWidth = 34; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath();
    route.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.stroke();
  }

  const dot = (x: number, y: number, r: number, color: string, outline = "#0b0b14") => {
    ctx.fillStyle = outline;
    ctx.beginPath(); ctx.arc(x, y, r + 10, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  for (const p of snap.passengers) if (!p.carrier) dot(map.stops[p.from].x, map.stops[p.from].y, 26, "#facc15");
  if (carried) {
    const dest = map.stops[carried.to];
    dot(dest.x, dest.y, 46 + Math.sin(Date.now() / 150) * 10, "#4ade80");
    ctx.fillStyle = "#ffffff"; ctx.font = "700 62px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(dest.name, clamp(dest.x, 330, map.width - 330), dest.y > 220 ? dest.y - 76 : dest.y + 130);
  }
  for (const [id, car] of Object.entries(snap.cars)) if (id !== playerId) dot(car.x, car.y, 30, colorFor(snap.cars, id));
  if (me) {
    // A wedge showing which way you're facing
    ctx.save();
    ctx.translate(me.x, me.y); ctx.rotate(me.a);
    ctx.fillStyle = "#0b0b14";
    ctx.beginPath(); ctx.moveTo(86, 0); ctx.lineTo(-52, -58); ctx.lineTo(-52, 58); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath(); ctx.moveTo(66, 0); ctx.lineTo(-38, -42); ctx.lineTo(-38, 42); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
}

export default AutoRushGame;
