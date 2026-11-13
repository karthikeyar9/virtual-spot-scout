// The 3D world for Auto Rush: a night-time Hyderabad built from the server's
// map, a chase camera, and visuals for everything in a snapshot. Game logic
// stays 2D (x, y in map pixels); this file only draws it. World units are
// metres: 12 map pixels = 1 m, map +x → world +x, map +y → world +z.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import {
  Block, Bus, GameMap, LocalCar, Point, Roads, Snapshot, BOOST_SPEED, busPosition, clamp, colorFor, roadClearance, roadIndex, wrapAngle,
} from "./shared";

const S = 1 / 12; // map px → metres
const GROUND_TEX_SCALE = 1.5; // texture px per map px

export interface FrameState {
  serverNow: number;
  myId: string;
  me: LocalCar | null;
  snap: Snapshot;
  names: Record<string, string>;
  ghosts: Record<string, boolean>; // disconnected players
  /** GPS line to the next pickup or drop-off, in map pixels. */
  route: Point[] | null;
  routeIsDropOff: boolean;
}

// ---- Small helpers ----

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat = false) {
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  draw(canvas.getContext("2d")!);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** A text sprite that always faces the camera and shows through buildings. */
class Label {
  readonly sprite: THREE.Sprite;
  private canvas = document.createElement("canvas");
  private texture: THREE.CanvasTexture;
  private current = "";

  constructor(private worldWidth: number) {
    this.canvas.width = 512; this.canvas.height = 96;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthTest: false, transparent: true }));
    this.sprite.renderOrder = 10;
    this.sprite.scale.set(worldWidth, worldWidth * 96 / 512, 1);
  }

  set(text: string, bg = "rgba(10,10,20,0.82)", fg = "#ffffff") {
    const key = `${text}|${bg}|${fg}`;
    if (key === this.current) return;
    this.current = key;
    const ctx = this.canvas.getContext("2d")!;
    ctx.clearRect(0, 0, 512, 96);
    ctx.font = "600 44px system-ui, sans-serif";
    const w = Math.min(500, ctx.measureText(text).width + 44);
    ctx.fillStyle = bg;
    ctx.beginPath(); ctx.roundRect(256 - w / 2, 10, w, 76, 24); ctx.fill();
    ctx.fillStyle = fg;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(text, 256, 50, 470);
    this.texture.needsUpdate = true;
  }
}

// ---- Asset loading ----

interface Templates {
  auto: THREE.Object3D;
  bus: THREE.Object3D;
  cars: THREE.Object3D[];
  landmarks: Record<string, THREE.Object3D>;
}

/** Scales a loaded model so its longest horizontal side is `length` metres, sits it on the ground and points its nose down +x. */
function normalise(model: THREE.Object3D, length: number, yaw: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  model.position.set(-centre.x, -box.min.y, -centre.z);
  const turn = new THREE.Group();
  turn.add(model);
  turn.rotation.y = (size.z > size.x ? Math.PI / 2 : 0) + yaw;
  turn.scale.setScalar(length / Math.max(size.x, size.z));
  const wrapper = new THREE.Group();
  wrapper.add(turn);
  return wrapper;
}

function fallbackVehicle(length: number, width: number, height: number, color: number) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshStandardMaterial({ color, roughness: 0.6 }),
  );
  mesh.position.y = height / 2 + 0.2;
  const group = new THREE.Group();
  group.add(mesh);
  return group;
}

// Extra yaw so each generated vehicle's nose points down +x after normalising.
const MODEL_YAW = { auto: Math.PI, bus: Math.PI, car0: 0, car1: 0 };

// Landmark models, keyed by the block they stand on. `size` is the footprint in metres.
const LANDMARK_MODELS: Record<string, { file: string; size: number; yaw?: number; light: number }> = {
  "Charminar": { file: "charminar", size: 19, light: 0xffb86b },
  "Golconda Fort": { file: "golconda", size: 24, light: 0xffc98a },
  "Birla Mandir": { file: "birla", size: 20, light: 0xdfe8ff },
  "Hussain Sagar": { file: "buddha", size: 7, light: 0xfff1cf },
  "Hitech City": { file: "cybertower", size: 22, light: 0x9fd4ff },
  "Secunderabad Station": { file: "clocktower", size: 8, light: 0xffd9a0 },
  "Salar Jung Museum": { file: "museum", size: 24, light: 0xffe2b0 },
};

async function loadTemplates(): Promise<Templates> {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const load = async (name: string, length: number, yaw: number) => {
    try {
      const gltf = await loader.loadAsync(`/auto-rush/models/${name}.glb`);
      return normalise(gltf.scene, length, yaw);
    } catch {
      return null; // fall back to a simple shape rather than failing the game
    }
  };
  const names = Object.keys(LANDMARK_MODELS);
  const [auto, bus, car0, car1, ...landmarkModels] = await Promise.all([
    load("auto", 2.9, MODEL_YAW.auto),
    load("bus", 6.6, MODEL_YAW.bus),
    load("car0", 3.9, MODEL_YAW.car0),
    load("car1", 4.1, MODEL_YAW.car1),
    ...names.map(name => load(LANDMARK_MODELS[name].file, LANDMARK_MODELS[name].size, LANDMARK_MODELS[name].yaw ?? 0)),
  ]);
  const landmarks: Record<string, THREE.Object3D> = {};
  names.forEach((name, i) => { const model = landmarkModels[i]; if (model) landmarks[name] = model; });
  return {
    auto: auto ?? fallbackVehicle(2.8, 1.5, 1.7, 0xfacc15),
    bus: bus ?? fallbackVehicle(6.4, 2.6, 2.9, 0xdc2626),
    cars: [car0 ?? fallbackVehicle(3.8, 1.7, 1.3, 0xe5e7eb), car1 ?? fallbackVehicle(4, 1.7, 1.3, 0x1e3a8a)],
    landmarks,
  };
}

// ---- Static city ----

const FACADE_TILE_W = 9; // metres covered by one facade texture repeat
const FACADE_TILE_H = 15;

interface FacadeStyle { wall: string; frame: string; lit: string[]; litChance: number; cols: number; rows: number }
const FACADES: Record<string, FacadeStyle> = {
  glass: { wall: "#16202e", frame: "#0c131c", lit: ["#9fd4ff", "#d6f0ff", "#7fb6ff"], litChance: 0.45, cols: 6, rows: 6 },
  apartment: { wall: "#4a3a33", frame: "#2a201c", lit: ["#ffd58a", "#ffbf6b", "#ffe9bd"], litChance: 0.4, cols: 4, rows: 6 },
  shop: { wall: "#3d2f3f", frame: "#221a24", lit: ["#ff9de0", "#ffd166", "#7af0ff"], litChance: 0.65, cols: 3, rows: 6 },
  stone: { wall: "#7a6a52", frame: "#5a4d3b", lit: ["#ffcf80"], litChance: 0.25, cols: 4, rows: 6 },
};

function facadeMaterial(style: FacadeStyle, seed: number) {
  const rand = mulberry32(seed);
  const cells: { x: number; y: number; w: number; h: number; color: string | null }[] = [];
  const cw = 256 / style.cols, ch = 384 / style.rows;
  for (let r = 0; r < style.rows; r++) {
    for (let c = 0; c < style.cols; c++) {
      cells.push({
        x: c * cw + cw * 0.24, y: r * ch + ch * 0.26, w: cw * 0.52, h: ch * 0.44,
        color: rand() < style.litChance ? style.lit[Math.floor(rand() * style.lit.length)] : null,
      });
    }
  }
  const map = canvasTexture(256, 384, ctx => {
    ctx.fillStyle = style.wall; ctx.fillRect(0, 0, 256, 384);
    for (const cell of cells) {
      ctx.fillStyle = style.frame; ctx.fillRect(cell.x - 3, cell.y - 3, cell.w + 6, cell.h + 6);
      ctx.fillStyle = cell.color ?? "#0a0d12"; ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
    }
  }, true);
  const emissiveMap = canvasTexture(256, 384, ctx => {
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, 256, 384);
    for (const cell of cells) if (cell.color) { ctx.fillStyle = cell.color; ctx.fillRect(cell.x, cell.y, cell.w, cell.h); }
  }, true);
  return new THREE.MeshStandardMaterial({ map, emissiveMap, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.8 });
}

/** The four walls of a box, with UVs scaled so windows keep a real-world size. */
function wallsGeometry(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const uv = geo.attributes.uv;
  for (let i = 0; i < 24; i++) {
    const face = Math.floor(i / 4); // 0,1 = ±x   2,3 = ±y   4,5 = ±z
    const across = Math.max(1, Math.round((face < 2 ? d : w) / FACADE_TILE_W * 2) / 2);
    uv.setXY(i, uv.getX(i) * across, uv.getY(i) * (h / FACADE_TILE_H));
  }
  const index = Array.from(geo.index!.array);
  geo.setIndex([...index.slice(0, 12), ...index.slice(24, 36)]);
  geo.clearGroups();
  geo.translate(0, h / 2, 0);
  return geo;
}

function roofGeometry(w: number, h: number, d: number) {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, h, 0);
  return geo;
}

function drawGround(ctx: CanvasRenderingContext2D, map: GameMap, lamps: { x: number; y: number }[]) {
  const G = GROUND_TEX_SCALE;
  const T = map.tile, road = map.roadTiles * T;
  const x0 = map.roadCols[0] * T, x1 = map.roadCols[map.roadCols.length - 1] * T + road;
  const y0 = map.roadRows[0] * T, y1 = map.roadRows[map.roadRows.length - 1] * T + road;
  ctx.scale(G, G);

  ctx.fillStyle = "#141419"; ctx.fillRect(0, 0, map.width, map.height);
  ctx.fillStyle = "#23252c"; ctx.fillRect(x0, y0, x1 - x0, y1 - y0); // asphalt

  // Asphalt grain and patches
  const rand = mulberry32(7);
  for (let i = 0; i < 9000; i++) {
    ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.12)";
    ctx.fillRect(x0 + rand() * (x1 - x0), y0 + rand() * (y1 - y0), 2 + rand() * 5, 2 + rand() * 5);
  }

  // Blocks: kerb, then pavement / grass / lake bed
  const floor: Record<string, string> = { park: "#17361f", water: "#0a1c2c" };
  for (const b of map.blocks) {
    ctx.fillStyle = "#6b6f78"; ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = floor[b.kind] ?? "#34363e"; ctx.fillRect(b.x + 5, b.y + 5, b.w - 10, b.h - 10);
  }

  // Lane markings
  ctx.strokeStyle = "rgba(250,204,21,0.75)"; ctx.lineWidth = 2.5; ctx.setLineDash([22, 18]);
  ctx.beginPath();
  map.roadCols.forEach(c => { ctx.moveTo(c * T + road / 2, y0); ctx.lineTo(c * T + road / 2, y1); });
  map.roadRows.forEach(r => { ctx.moveTo(x0, r * T + road / 2); ctx.lineTo(x1, r * T + road / 2); });
  ctx.stroke(); ctx.setLineDash([]);

  // Intersections: clear the dashes, add zebra crossings
  for (const c of map.roadCols) for (const r of map.roadRows) {
    const ix = c * T, iy = r * T;
    ctx.fillStyle = "#23252c"; ctx.fillRect(ix, iy, road, road);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    for (let k = 0; k < 6; k++) {
      const o = 8 + k * (road - 16) / 6;
      ctx.fillRect(ix + o, iy - 16, 7, 12); ctx.fillRect(ix + o, iy + road + 4, 7, 12);
      ctx.fillRect(ix - 16, iy + o, 12, 7); ctx.fillRect(ix + road + 4, iy + o, 12, 7);
    }
  }

  // Auto stands
  for (const stop of map.stops) {
    ctx.strokeStyle = "rgba(250,204,21,0.9)"; ctx.lineWidth = 3;
    ctx.strokeRect(stop.x - 34, stop.y - 22, 68, 44);
    ctx.fillStyle = "rgba(250,204,21,0.9)";
    ctx.font = "700 15px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("AUTO", stop.x, stop.y);
  }

  // Pools of street-lamp light, baked in so they cost nothing at runtime
  ctx.globalCompositeOperation = "lighter";
  for (const lamp of lamps) {
    const glow = ctx.createRadialGradient(lamp.x, lamp.y, 0, lamp.x, lamp.y, 95);
    glow.addColorStop(0, "rgba(255,176,96,0.42)"); glow.addColorStop(1, "rgba(255,176,96,0)");
    ctx.fillStyle = glow; ctx.fillRect(lamp.x - 95, lamp.y - 95, 190, 190);
  }
  ctx.globalCompositeOperation = "source-over";
}

/** Collects flat, upward-facing triangles (roads, kerbs, the lake) into one geometry. */
class Surface {
  private position: number[] = [];
  private uv: number[] = [];
  private index: number[] = [];

  /** A ribbon of the given half-width along a polyline. UVs run 0..1 across and in metres along. */
  ribbon(points: { x: number; z: number }[], half: number, y: number) {
    const base = this.position.length / 3;
    const unit = (x: number, z: number) => { const l = Math.hypot(x, z); return l > 0 ? [x / l, z / l] : null; };
    let along = 0;
    for (let i = 0; i < points.length; i++) {
      const p = points[i], prev = points[i - 1], next = points[i + 1];
      if (prev) along += Math.hypot(p.x - prev.x, p.z - prev.z);
      const before = prev ? unit(p.x - prev.x, p.z - prev.z) : null;
      const after = next ? unit(next.x - p.x, next.z - p.z) : null;
      const a = before ?? after ?? [1, 0], b = after ?? before ?? [1, 0];
      const t = unit(a[0] + b[0], a[1] + b[1]) ?? a;
      // Widen at bends so the ribbon keeps its width (capped, for hairpins)
      const miter = Math.min(1.8, 1 / Math.max(0.2, t[0] * a[0] + t[1] * a[1]));
      const nx = -t[1] * half * miter, nz = t[0] * half * miter;
      this.position.push(p.x + nx, y, p.z + nz, p.x - nx, y, p.z - nz);
      this.uv.push(0, along, 1, along);
      if (i > 0) { const k = base + i * 2; this.index.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
  }

  /** A filled circle, used to round off road ends and junctions. */
  disc(centre: { x: number; z: number }, radius: number, y: number) {
    const base = this.position.length / 3, sides = 14;
    this.position.push(centre.x, y, centre.z);
    this.uv.push(0.5, 0);
    for (let i = 0; i < sides; i++) {
      const angle = i / sides * Math.PI * 2;
      this.position.push(centre.x + Math.cos(angle) * radius, y, centre.z + Math.sin(angle) * radius);
      this.uv.push(0.5, 0);
      this.index.push(base, base + 1 + i, base + 1 + (i + 1) % sides);
    }
  }

  rect(x: number, z: number, w: number, d: number, y: number) {
    const base = this.position.length / 3;
    this.position.push(x, y, z, x + w, y, z, x, y, z + d, x + w, y, z + d);
    this.uv.push(0, 0, 1, 0, 0, 1, 1, 1);
    this.index.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }

  get empty() { return this.index.length === 0; }

  /** With `worldTile`, UVs are replaced by world position so a texture tiles evenly whatever the road's shape. */
  build(worldTile?: number) {
    const geo = new THREE.BufferGeometry();
    const count = this.position.length / 3;
    const uv = new Float32Array(this.uv);
    if (worldTile) for (let i = 0; i < count; i++) { uv[i * 2] = this.position[i * 3] / worldTile; uv[i * 2 + 1] = this.position[i * 3 + 2] / worldTile; }
    const normal = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) normal[i * 3 + 1] = 1;
    geo.setAttribute("position", new THREE.Float32BufferAttribute(this.position, 3));
    geo.setAttribute("normal", new THREE.BufferAttribute(normal, 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    geo.setIndex(this.index);
    return geo;
  }
}

const NEON = ["#ff3fa4", "#35e0ff", "#ffd23f", "#7dff6b", "#ff7b3f", "#b98cff"];

function neonSign(name: string, color: string) {
  const tex = canvasTexture(1024, 192, ctx => {
    ctx.fillStyle = "rgba(8,6,16,0.9)"; ctx.beginPath(); ctx.roundRect(4, 4, 1016, 184, 28); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 8; ctx.shadowColor = color; ctx.shadowBlur = 26;
    ctx.beginPath(); ctx.roundRect(14, 14, 996, 164, 22); ctx.stroke();
    ctx.font = "800 96px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = color;
    ctx.fillText(name.toUpperCase(), 512, 100, 940);
    ctx.shadowBlur = 0; ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillText(name.toUpperCase(), 512, 100, 940);
  });
  return new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10 * 192 / 1024),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false }),
  );
}

// ---- The scene ----

interface CarVisual { group: THREE.Group; body: THREE.Object3D; marker: THREE.Mesh; label: Label; x: number; y: number; a: number }
interface PassengerVisual { group: THREE.Group; figure: THREE.Group; label: Label }

export class RushScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(62, 1, 0.3, 700);
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private cars = new Map<string, CarVisual>();
  private traffic: { def: Bus; visual: THREE.Object3D; heading: number }[] = [];
  private dome!: THREE.Mesh;
  private walkers: { block: Block; offset: number; speed: number }[] = [];
  private walkerBodies!: THREE.InstancedMesh;
  private walkerHeads!: THREE.InstancedMesh;
  private routeSegments: THREE.Mesh[] = [];
  private routeTexture!: THREE.CanvasTexture;
  private passengers: PassengerVisual[] = [];
  private chais: THREE.Group[] = [];
  private destination = new THREE.Group();
  private pointer!: THREE.Mesh;
  private headlight = new THREE.SpotLight(0xfff0cf, 0, 55, 0.62, 0.7, 1.4);
  private water: THREE.MeshStandardMaterial[] = [];
  private camHeading: number | null = null;
  private shakeAmount = 0;
  private time = 0;

  private constructor(canvas: HTMLCanvasElement, private map: GameMap, private templates: Templates, private highQuality: boolean) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: highQuality, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, highQuality ? 2 : 1.5));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.buildSky();
    this.buildCity();
    this.buildDynamic();

    if (highQuality) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.6, 0.9);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    }
  }

  static async create(canvas: HTMLCanvasElement, map: GameMap, highQuality: boolean) {
    return new RushScene(canvas, map, await loadTemplates(), highQuality);
  }

  private buildSky() {
    this.scene.fog = new THREE.FogExp2(0x1b1233, 0.0085);
    const sky = canvasTexture(16, 256, ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, 256);
      g.addColorStop(0, "#05040f"); g.addColorStop(0.42, "#1c1140"); g.addColorStop(0.5, "#5b2a63");
      g.addColorStop(0.56, "#d0603a"); g.addColorStop(0.6, "#2a1530"); g.addColorStop(1, "#0a0812");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    });
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(520, 24, 16),
      new THREE.MeshBasicMaterial({ map: sky, side: THREE.BackSide, fog: false, depthWrite: false }),
    );
    dome.position.set(this.map.width * S / 2, 0, this.map.height * S / 2);
    this.scene.add(dome);
    this.dome = dome; // follows the camera, since a real city is wider than the dome

    this.scene.add(new THREE.HemisphereLight(0x8a7bd8, 0x3a2a26, 1.5));
    const moon = new THREE.DirectionalLight(0xa8b8ff, 0.9);
    moon.position.set(-60, 120, -40);
    this.scene.add(moon);
  }

  private buildCity() {
    const map = this.map;
    const W = map.width * S, H = map.height * S;
    const rand = mulberry32(2026);

    const lamps: { x: number; y: number }[] = [];
    if (map.roads) {
      this.buildRoads(map.roads, lamps);
    } else {
      // Street lamps at block corners
      for (const b of map.blocks) {
        for (const [dx, dy] of [[10, 10], [b.w - 10, 10], [10, b.h - 10], [b.w - 10, b.h - 10], [b.w / 2, 10], [b.w / 2, b.h - 10]]) {
          lamps.push({ x: b.x + dx, y: b.y + dy });
        }
      }

      // Ground
      const groundTex = canvasTexture(
        Math.round(map.width * GROUND_TEX_SCALE), Math.round(map.height * GROUND_TEX_SCALE),
        ctx => drawGround(ctx, map, lamps),
      );
      groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(W, H),
        new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.42, metalness: 0.15 }),
      );
      ground.rotation.x = -Math.PI / 2;
      ground.position.set(W / 2, 0, H / 2);
      this.scene.add(ground);
    }
    const outskirts = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(1400, W + 600), Math.max(1400, H + 600)), new THREE.MeshBasicMaterial({ color: 0x0b0a12 }));
    outskirts.rotation.x = -Math.PI / 2;
    outskirts.position.set(W / 2, -0.05, H / 2);
    this.scene.add(outskirts);

    // Lamp posts: instanced poles and heads, plus one additive glow sprite each
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.1, 5.2, 6);
    poleGeo.translate(0, 2.6, 0);
    const poles = new THREE.InstancedMesh(poleGeo, new THREE.MeshStandardMaterial({ color: 0x2a2a30 }), lamps.length);
    const heads = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffc98a, toneMapped: false }), lamps.length);
    const glowPositions = new Float32Array(lamps.length * 3);
    const m = new THREE.Matrix4();
    lamps.forEach((lamp, i) => {
      poles.setMatrixAt(i, m.makeTranslation(lamp.x * S, 0, lamp.y * S));
      heads.setMatrixAt(i, m.makeTranslation(lamp.x * S, 5.3, lamp.y * S));
      glowPositions.set([lamp.x * S, 5.3, lamp.y * S], i * 3);
    });
    this.scene.add(poles, heads);
    const glowTex = canvasTexture(64, 64, ctx => {
      const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,210,150,0.9)"); g.addColorStop(0.35, "rgba(255,170,90,0.3)"); g.addColorStop(1, "rgba(255,170,90,0)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    });
    const glowGeo = new THREE.BufferGeometry();
    glowGeo.setAttribute("position", new THREE.BufferAttribute(glowPositions, 3));
    this.scene.add(new THREE.Points(glowGeo, new THREE.PointsMaterial({
      map: glowTex, size: 3.2, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    })));

    // Buildings, merged per material so the whole city is a handful of draw calls
    const walls: Record<string, THREE.BufferGeometry[]> = { glass: [], apartment: [], shop: [], stone: [] };
    const roofs: THREE.BufferGeometry[] = [];
    const trunks: THREE.BufferGeometry[] = [];
    const leaves: THREE.BufferGeometry[] = [];
    const domes: THREE.BufferGeometry[] = [];

    const addBuilding = (style: string, cx: number, cz: number, w: number, d: number, h: number, yaw = 0) => {
      walls[style].push(wallsGeometry(w, h, d).rotateY(yaw).translate(cx, 0, cz));
      roofs.push(roofGeometry(w, h, d).rotateY(yaw).translate(cx, 0, cz));
    };
    const addTree = (x: number, z: number, size: number) => {
      trunks.push(new THREE.CylinderGeometry(0.15, 0.2, 1.6 * size, 5).translate(x, 0.8 * size, z));
      leaves.push(new THREE.IcosahedronGeometry(1.5 * size, 0).translate(x, 2.6 * size, z));
    };
    const gridOf = (b: Block, cols: number, rows: number, style: string, minH: number, maxH: number, fill = 0.8) => {
      const bx = b.x * S + 1.6, bz = b.y * S + 1.6, bw = b.w * S - 3.2, bd = b.h * S - 3.2;
      const cw = bw / cols, cd = bd / rows;
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const h = minH + rand() * (maxH - minH);
        addBuilding(style, bx + cw * (c + 0.5), bz + cd * (r + 0.5), cw * fill, cd * fill, h);
      }
    };

    for (const b of map.blocks) {
      const cx = (b.x + b.w / 2) * S, cz = (b.y + b.h / 2) * S;
      const landmark = this.templates.landmarks[b.name];
      if (landmark) {
        landmark.position.set(cx, b.kind === "water" ? 1.2 : 0, cz);
        this.scene.add(landmark);
        if (this.highQuality) {
          const wash = new THREE.PointLight(LANDMARK_MODELS[b.name].light, 55, 40, 1.4); // soft floodlighting
          wash.position.set(cx, 15, cz + b.h * S / 2 - 2);
          this.scene.add(wash);
        }
      }
      if (landmark && b.kind !== "water") {
        // The model is the block; just ring it with a few trees
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) addTree(cx + sx * (b.w * S / 2 - 2.2), cz + sz * (b.h * S / 2 - 2.2), 0.9);
      } else if (b.kind === "tech") {
        gridOf(b, 2, 2, "glass", 20, 38);
      } else if (b.kind === "homes") {
        gridOf(b, 3, 2, "apartment", 7, 15);
      } else if (b.kind === "food") {
        gridOf(b, 3, 2, "shop", 4.5, 9, 0.88);
      } else if (b.kind === "transit") {
        addBuilding("apartment", cx, cz, b.w * S * 0.78, b.h * S * 0.42, 6);
        addBuilding("glass", cx - b.w * S * 0.25, cz - b.h * S * 0.3, 6, 5, 12);
      } else if (b.kind === "heritage") {
        // A walled compound with a domed hall in the middle
        const w = b.w * S - 5, d = b.h * S - 5;
        addBuilding("stone", cx, cz - d / 2, w, 1.2, 4.5);
        addBuilding("stone", cx - w / 2, cz, 1.2, d, 4.5);
        addBuilding("stone", cx + w / 2, cz, 1.2, d, 4.5);
        addBuilding("stone", cx, cz, w * 0.5, d * 0.5, 9);
        domes.push(new THREE.SphereGeometry(Math.min(w, d) * 0.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(cx, 9, cz));
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          addBuilding("stone", cx + sx * w * 0.25, cz + sz * d * 0.25, 1.6, 1.6, 13);
          domes.push(new THREE.SphereGeometry(1.1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(cx + sx * w * 0.25, 13, cz + sz * d * 0.25));
        }
      } else if (b.kind === "park") {
        for (let i = 0; i < 16; i++) addTree(cx + (rand() - 0.5) * (b.w * S - 5), cz + (rand() - 0.5) * (b.h * S - 5), 0.8 + rand() * 0.9);
      } else if (b.kind === "water") {
        const mat = new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.12, metalness: 0.75, emissive: 0x06243d });
        const lake = new THREE.Mesh(new THREE.PlaneGeometry(b.w * S - 2, b.h * S - 2), mat);
        lake.rotation.x = -Math.PI / 2;
        lake.position.set(cx, 0.06, cz);
        this.scene.add(lake);
        this.water.push(mat);
        if (b.name === "Hussain Sagar") {
          // The lake's rock island and its standing statue
          domes.push(new THREE.CylinderGeometry(4.2, 4.8, 1.2, 12).translate(cx, 0.6, cz));
          if (!landmark) domes.push(new THREE.CylinderGeometry(0.55, 0.8, 7, 8).translate(cx, 4.7, cz));
        } else {
          for (let i = 0; i < 6; i++) addTree(cx - b.w * S / 2 + 3 + i * (b.w * S - 6) / 5, cz + b.h * S / 2 - 2.2, 0.8);
        }
      }

      // Neon name boards facing the roads north and south of the block
      const color = NEON[Math.floor(rand() * NEON.length)];
      const south = neonSign(b.name, color);
      south.position.set(cx, 4.4, (b.y + b.h) * S - 0.7);
      const north = neonSign(b.name, color);
      north.position.set(cx, 4.4, b.y * S + 0.7);
      north.rotation.y = Math.PI;
      this.scene.add(south, north);
    }

    if (map.roads) this.lineStreets(map.roads, addBuilding, addTree, rand);

    // A dark skyline ring outside the playable grid, for depth
    for (let i = 0; i < 70; i++) {
      const angle = rand() * Math.PI * 2;
      const rx = W / 2 + 26 + rand() * 90, rz = H / 2 + 26 + rand() * 90;
      addBuilding(rand() < 0.5 ? "glass" : "apartment", W / 2 + Math.cos(angle) * rx, H / 2 + Math.sin(angle) * rz, 10 + rand() * 12, 10 + rand() * 12, 14 + rand() * 46);
    }

    let seed = 11;
    for (const [style, geos] of Object.entries(walls)) {
      if (geos.length) this.scene.add(new THREE.Mesh(mergeGeometries(geos), facadeMaterial(FACADES[style], seed++)));
    }
    const merged = (geos: THREE.BufferGeometry[], material: THREE.Material) => {
      if (geos.length) this.scene.add(new THREE.Mesh(mergeGeometries(geos), material));
    };
    merged(roofs, new THREE.MeshStandardMaterial({ color: 0x15161b, roughness: 0.9 }));
    merged(trunks, new THREE.MeshStandardMaterial({ color: 0x3b2a1e }));
    merged(leaves, new THREE.MeshStandardMaterial({ color: 0x1f6b35, roughness: 0.9, flatShading: true }));
    merged(domes, new THREE.MeshStandardMaterial({ color: 0xb9a888, roughness: 0.7 }));
  }

  /**
   * Real-road maps: the ground, tarmac ribbons with kerbs and lane dashes, the
   * lake and the auto stands. Fills `lamps` with street-lamp positions.
   */
  private buildRoads(roads: Roads, lamps: { x: number; y: number }[]) {
    const map = this.map;
    const W = map.width * S, H = map.height * S;
    const index = roadIndex(map)!;
    // Flat layers sit a few centimetres apart; the offset stops them flickering at a distance
    const layer = (order: number) => ({ polygonOffset: true, polygonOffsetFactor: -order, polygonOffsetUnits: -order });

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ color: 0x1b1c22, roughness: 0.92 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(W / 2, 0, H / 2);
    this.scene.add(ground);

    const kerb = new Surface(), tarmac = new Surface(), dashes = new Surface();
    for (const way of roads.ways) {
      const points = way.n.map(n => ({ x: roads.nodes[n * 2] * S, z: roads.nodes[n * 2 + 1] * S }));
      const half = way.w / 2 * S;
      kerb.ribbon(points, half + 0.45, 0.02);
      tarmac.ribbon(points, half, 0.04);
      dashes.ribbon(points, 0.11, 0.06);
      for (const end of [points[0], points[points.length - 1]]) {
        kerb.disc(end, half + 0.45, 0.02);
        tarmac.disc(end, half, 0.04);
      }
    }
    const grain = canvasTexture(256, 256, ctx => {
      ctx.fillStyle = "#23252c"; ctx.fillRect(0, 0, 256, 256);
      const rand = mulberry32(7);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = rand() < 0.5 ? "rgba(255,255,255,0.035)" : "rgba(0,0,0,0.12)";
        ctx.fillRect(rand() * 256, rand() * 256, 2 + rand() * 5, 2 + rand() * 5);
      }
    }, true);
    grain.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const dashTex = canvasTexture(8, 64, ctx => { ctx.fillStyle = "rgba(250,204,21,0.75)"; ctx.fillRect(0, 0, 8, 35); }, true);
    dashTex.repeat.set(1, 0.3); // one dash-and-gap every 3.3 m
    this.scene.add(
      new THREE.Mesh(kerb.build(), new THREE.MeshStandardMaterial({ color: 0x6b6f78, roughness: 0.9, side: THREE.DoubleSide, ...layer(1) })),
      new THREE.Mesh(tarmac.build(14), new THREE.MeshStandardMaterial({ map: grain, roughness: 0.42, metalness: 0.15, side: THREE.DoubleSide, ...layer(2) })),
      new THREE.Mesh(dashes.build(), new THREE.MeshBasicMaterial({ map: dashTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, ...layer(3) })),
    );

    // Landmark plots: a paved (or grassed) pad beside the road
    const paved = new Surface(), grass = new Surface();
    for (const b of map.blocks) {
      if (b.kind !== "water") (b.kind === "park" ? grass : paved).rect(b.x * S, b.y * S, b.w * S, b.h * S, 0.02);
    }
    if (!paved.empty) this.scene.add(new THREE.Mesh(paved.build(), new THREE.MeshStandardMaterial({ color: 0x34363e, roughness: 0.9, side: THREE.DoubleSide, ...layer(1) })));
    if (!grass.empty) this.scene.add(new THREE.Mesh(grass.build(), new THREE.MeshStandardMaterial({ color: 0x17361f, roughness: 0.95, side: THREE.DoubleSide, ...layer(1) })));

    // Hussain Sagar
    const lake = new Surface();
    const water = map.water ?? [];
    for (let i = 0; i < water.length; i += 4) lake.rect(water[i] * S, water[i + 1] * S, water[i + 2] * S, water[i + 3] * S, 0.03);
    if (!lake.empty) {
      const mat = new THREE.MeshStandardMaterial({ color: 0x0d3f66, roughness: 0.12, metalness: 0.75, emissive: 0x06243d, side: THREE.DoubleSide, ...layer(1) });
      this.scene.add(new THREE.Mesh(lake.build(), mat));
      this.water.push(mat);
    }

    // Auto stands, painted across the road at each stop
    const standTex = canvasTexture(136, 88, ctx => {
      ctx.strokeStyle = "rgba(250,204,21,0.9)"; ctx.lineWidth = 6; ctx.strokeRect(3, 3, 130, 82);
      ctx.fillStyle = "rgba(250,204,21,0.9)";
      ctx.font = "700 30px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("AUTO", 68, 46);
    });
    const standGeo = new THREE.PlaneGeometry(68 * S, 44 * S);
    standGeo.rotateX(-Math.PI / 2);
    const standMat = new THREE.MeshBasicMaterial({ map: standTex, transparent: true, depthWrite: false, ...layer(4) });
    for (const stop of map.stops) {
      const stand = new THREE.Mesh(standGeo, standMat);
      stand.position.set(stop.x * S, 0.07, stop.y * S);
      stand.rotation.y = -(stop.a ?? 0);
      this.scene.add(stand);
    }

    // Street lamps down alternating sides of every road, thinned where roads bunch up
    const lit = new Set<number>();
    for (const way of roads.ways) {
      let carry = 210, side = 1;
      for (let k = 1; k < way.n.length; k++) {
        const ax = roads.nodes[way.n[k - 1] * 2], ay = roads.nodes[way.n[k - 1] * 2 + 1];
        const bx = roads.nodes[way.n[k] * 2], by = roads.nodes[way.n[k] * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        for (; carry < len; carry += 420, side = -side) {
          const x = ax + ux * carry - uy * side * (way.w / 2 + 9), y = ay + uy * carry + ux * side * (way.w / 2 + 9);
          const cell = Math.floor(x / 190) * 4096 + Math.floor(y / 190);
          if (lit.has(cell) || roadClearance(index, x, y) < 4) continue;
          lit.add(cell);
          lamps.push({ x, y });
        }
        carry -= len;
      }
    }

    // A pool of light under each lamp
    if (this.highQuality && lamps.length) {
      const poolTex = canvasTexture(64, 64, ctx => {
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, "rgba(255,176,96,0.42)"); g.addColorStop(1, "rgba(255,176,96,0)");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
      });
      const poolGeo = new THREE.PlaneGeometry(16, 16);
      poolGeo.rotateX(-Math.PI / 2);
      const pools = new THREE.InstancedMesh(poolGeo, new THREE.MeshBasicMaterial({
        map: poolTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...layer(5),
      }), lamps.length);
      const m = new THREE.Matrix4();
      lamps.forEach((lamp, i) => pools.setMatrixAt(i, m.makeTranslation(lamp.x * S, 0.08, lamp.y * S)));
      pools.frustumCulled = false;
      this.scene.add(pools);
    }
  }

  /** Real-road maps: buildings and trees along both sides of every road, facing it, wherever there is room. */
  private lineStreets(
    roads: Roads,
    addBuilding: (style: string, cx: number, cz: number, w: number, d: number, h: number, yaw?: number) => void,
    addTree: (x: number, z: number, size: number) => void,
    rand: () => number,
  ) {
    const map = this.map;
    const index = roadIndex(map)!;
    const density = this.highQuality ? 1 : 0.55;

    const lake = new Set<number>();
    const water = map.water ?? [];
    for (let i = 0; i < water.length; i += 4) {
      for (let x = water[i]; x < water[i] + water[i + 2]; x += 48) lake.add(Math.floor(x / 48) * 4096 + Math.floor(water[i + 1] / 48));
    }
    const inLake = (x: number, y: number) => lake.has(Math.floor(x / 48) * 4096 + Math.floor(y / 48));
    const inPlot = (x: number, y: number, margin: number) =>
      map.blocks.some(b => x > b.x - margin && x < b.x + b.w + margin && y > b.y - margin && y < b.y + b.h + margin);

    // Footprints already used, bucketed so the overlap test stays cheap
    const CELL = 200;
    const taken = new Map<number, { x: number; y: number; r: number }[]>();
    const claim = (x: number, y: number, r: number) => {
      const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
      for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
        for (const other of taken.get(i * 4096 + j) ?? []) if (Math.hypot(other.x - x, other.y - y) < other.r + r) return false;
      }
      const key = cx * 4096 + cy;
      const bucket = taken.get(key);
      if (bucket) bucket.push({ x, y, r }); else taken.set(key, [{ x, y, r }]);
      return true;
    };

    for (const way of roads.ways) {
      let carry = 60 + rand() * 80;
      for (let k = 1; k < way.n.length; k++) {
        const ax = roads.nodes[way.n[k - 1] * 2], ay = roads.nodes[way.n[k - 1] * 2 + 1];
        const bx = roads.nodes[way.n[k] * 2], by = roads.nodes[way.n[k] * 2 + 1];
        const len = Math.hypot(bx - ax, by - ay) || 1;
        const ux = (bx - ax) / len, uy = (by - ay) / len;
        for (; carry < len; carry += 100 + rand() * 70) {
          const px = ax + ux * carry, py = ay + uy * carry;
          for (const side of [-1, 1]) {
            const roll = rand(), front = 84 + rand() * 72, depth = 80 + rand() * 70, tall = rand(), kind = rand();
            if (roll > density) continue;
            if (roll < 0.1 * density) {
              const tx = px - uy * side * (way.w / 2 + 28), ty = py + ux * side * (way.w / 2 + 28);
              if (roadClearance(index, tx, ty) > 10 && !inLake(tx, ty) && !inPlot(tx, ty, 10) && claim(tx, ty, 14)) addTree(tx * S, ty * S, 0.8 + tall * 0.8);
              continue;
            }
            const off = way.w / 2 + 24 + depth / 2;
            const cx = px - uy * side * off, cy = py + ux * side * off;
            const radius = Math.max(front, depth) * 0.55;
            if (cx < 40 || cy < 40 || cx > map.width - 40 || cy > map.height - 40) continue;
            if (inLake(cx, cy) || inPlot(cx, cy, radius)) continue;
            // The whole footprint must be clear of every road, not just the one it faces
            let clear = true;
            for (let i = -1; i <= 1 && clear; i++) for (let j = -1; j <= 1 && clear; j++) {
              const sx = cx + ux * i * front / 2 - uy * j * depth / 2, sy = cy + uy * i * front / 2 + ux * j * depth / 2;
              clear = roadClearance(index, sx, sy) >= 10;
            }
            if (!clear || !claim(cx, cy, radius)) continue;
            // The old city in the south is low and crowded; it gets taller and glassier toward the lake
            const oldCity = cy / map.height > 0.62;
            const [style, low, high] = oldCity
              ? (kind < 0.55 ? ["shop", 4.5, 9] as const : kind < 0.8 ? ["stone", 5, 9] as const : ["apartment", 7, 13] as const)
              : (kind < 0.45 ? ["apartment", 8, 18] as const : kind < 0.75 ? ["shop", 5, 10] as const : ["glass", 14, 34] as const);
            addBuilding(style, cx * S, cy * S, front * S, depth * S, low + tall * (high - low), -Math.atan2(uy, ux));
          }
        }
        carry -= len;
      }
    }
  }

  private makeBeam(color: number, radius: number, height: number) {
    const tex = canvasTexture(4, 64, ctx => {
      const g = ctx.createLinearGradient(0, 0, 0, 64);
      g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(1, "rgba(255,255,255,0.75)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, 4, 64);
    });
    const geo = new THREE.CylinderGeometry(radius, radius, height, 20, 1, true);
    geo.translate(0, height / 2, 0);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    }));
  }

  private buildDynamic() {
    // Traffic: buses and cars, each with headlights so you can see them coming
    const lightMaterial = new THREE.MeshBasicMaterial({ color: 0xfff3c4, toneMapped: false });
    const addTraffic = (def: Bus, template: THREE.Object3D, length: number, width: number) => {
      const visual = new THREE.Group();
      visual.add(template.clone());
      for (const z of [-width * 0.32, width * 0.32]) {
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), lightMaterial);
        lamp.position.set(length / 2, 0.7, z);
        visual.add(lamp);
      }
      this.scene.add(visual);
      this.traffic.push({ def, visual, heading: 0 });
    };
    for (const bus of this.map.buses) addTraffic(bus, this.templates.bus, 6.6, 2.6);
    for (const car of this.map.cars ?? []) addTraffic(car, this.templates.cars[(car.style ?? 0) % this.templates.cars.length], 3.9, 1.7);

    // Pedestrians strolling round the pavements. Purely scenery: they keep to
    // the kerb and are placed from the clock, so they cost almost nothing.
    const rand = mulberry32(99);
    const count = this.highQuality ? 90 : 40;
    const bodyGeo = mergeGeometries([
      new THREE.CapsuleGeometry(0.19, 0.42, 3, 8).translate(0, 1.08, 0), // torso
      new THREE.CylinderGeometry(0.075, 0.065, 0.74, 6).translate(0, 0.37, -0.1), // legs
      new THREE.CylinderGeometry(0.075, 0.065, 0.74, 6).translate(0, 0.37, 0.1),
      new THREE.CylinderGeometry(0.055, 0.05, 0.55, 5).translate(0, 1.05, -0.26), // arms
      new THREE.CylinderGeometry(0.055, 0.05, 0.55, 5).translate(0, 1.05, 0.26),
    ]);
    const headGeo = new THREE.SphereGeometry(0.15, 8, 6);
    headGeo.translate(0, 1.62, 0);
    this.walkerBodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ roughness: 0.9 }), count);
    this.walkerHeads = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xc68642, roughness: 0.8 }), count);
    const clothes = [0xe11d48, 0x2563eb, 0xf59e0b, 0x16a34a, 0xf8fafc, 0x9333ea, 0xfb7185, 0x0ea5e9, 0xfacc15];
    const tint = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const block = this.map.blocks[Math.floor(rand() * this.map.blocks.length)];
      this.walkers.push({ block, offset: rand() * 1000, speed: (0.9 + rand() * 0.9) * (rand() < 0.5 ? 1 : -1) });
      this.walkerBodies.setColorAt(i, tint.set(clothes[Math.floor(rand() * clothes.length)]));
    }
    this.walkerBodies.frustumCulled = this.walkerHeads.frustumCulled = false;
    this.scene.add(this.walkerBodies, this.walkerHeads);

    // GPS line painted on the road: chevrons that flow toward the objective
    this.routeTexture = canvasTexture(64, 64, ctx => {
      ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 12; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(14, 12); ctx.lineTo(42, 32); ctx.lineTo(14, 52); ctx.stroke();
    }, true);
    // Enough pieces for a winding real-road route; the grid only ever needs three
    for (let i = 0; i < 48; i++) {
      const texture = this.routeTexture.clone();
      const geo = new THREE.PlaneGeometry(1, 1);
      geo.rotateX(-Math.PI / 2);
      const segment = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        map: texture, transparent: true, opacity: 0.85, depthWrite: false, toneMapped: false,
      }));
      segment.visible = false;
      segment.renderOrder = 2;
      this.scene.add(segment);
      this.routeSegments.push(segment);
    }

    // Waiting passengers: a waving figure in a yellow marker beam
    const skin = new THREE.MeshStandardMaterial({ color: 0xc68642 });
    const shirts = [0xe11d48, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0d9488, 0xf97316, 0xdb2777];
    for (let i = 0; i < 16; i++) {
      const figure = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 8), new THREE.MeshStandardMaterial({ color: shirts[i % shirts.length] }));
      torso.position.y = 0.95;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.21, 10, 8), skin);
      head.position.y = 1.75;
      const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.55, 3, 6), skin);
      arm.position.set(0.32, 1.75, 0); arm.rotation.z = -0.5;
      figure.add(torso, head, arm);
      const label = new Label(7.5);
      label.sprite.position.y = 4.3;
      const group = new THREE.Group();
      group.add(figure, this.makeBeam(0xffd23f, 1.7, 9), label.sprite);
      group.visible = false;
      this.scene.add(group);
      this.passengers.push({ group, figure, label });
    }

    // Drop-off marker
    const ring = new THREE.Mesh(new THREE.TorusGeometry(3, 0.16, 8, 32), new THREE.MeshBasicMaterial({ color: 0x4ade80, toneMapped: false }));
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.25;
    this.destination.add(this.makeBeam(0x4ade80, 3, 26), ring);
    this.destination.visible = false;
    this.scene.add(this.destination);

    // Chai cups
    for (let i = 0; i < 16; i++) {
      const cup = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.3, 0.7, 12),
        new THREE.MeshStandardMaterial({ color: 0xf5e6c8, emissive: 0xff8a1f, emissiveIntensity: 1.6 }),
      );
      const group = new THREE.Group();
      group.add(cup, this.makeBeam(0xff8a1f, 0.8, 4));
      group.visible = false;
      this.scene.add(group);
      this.chais.push(group);
    }

    // Arrow over the player's auto pointing at the next objective
    const shape = new THREE.Shape();
    shape.moveTo(0.9, 0); shape.lineTo(-0.5, 0.6); shape.lineTo(-0.2, 0); shape.lineTo(-0.5, -0.6); shape.closePath();
    const arrowGeo = new THREE.ShapeGeometry(shape);
    arrowGeo.rotateX(-Math.PI / 2);
    this.pointer = new THREE.Mesh(arrowGeo, new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, toneMapped: false, depthTest: false }));
    this.pointer.renderOrder = 9;
    this.pointer.visible = false;
    this.scene.add(this.pointer);

    this.scene.add(this.headlight, this.headlight.target);
  }

  private carVisual(id: string, color: string, x: number, y: number, a: number): CarVisual {
    let car = this.cars.get(id);
    if (car) return car;
    const body = this.templates.auto.clone();
    const marker = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.6, 4),
      new THREE.MeshBasicMaterial({ color, toneMapped: false }),
    );
    marker.rotation.x = Math.PI;
    marker.position.y = 2.75;
    const label = new Label(4.2);
    label.sprite.position.y = 3.5;
    const tailMaterial = new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false });
    const tails = [-0.5, 0.5].map(z => {
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.09, 0.16), tailMaterial);
      tail.position.set(-1.46, 0.62, z);
      return tail;
    });
    const group = new THREE.Group();
    group.add(body, marker, label.sprite, ...tails);
    this.scene.add(group);
    car = { group, body, marker, label, x, y, a };
    this.cars.set(id, car);
    return car;
  }

  resize(width: number, height: number) {
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(width, height);
  }

  /** Kick the camera, e.g. on a crash. */
  shake(amount: number) { this.shakeAmount = Math.max(this.shakeAmount, amount); }

  update(frame: FrameState, dt: number) {
    const { snap, me, myId, serverNow } = frame;
    const map = this.map;
    this.time += dt;

    // Autos
    const seen = new Set<string>();
    for (const [id, state] of Object.entries(snap.cars)) {
      const mine = id === myId && me;
      const car = this.carVisual(id, colorFor(snap.cars, id), state.x, state.y, state.a);
      seen.add(id);
      if (mine) { car.x = me.x; car.y = me.y; car.a = me.a; }
      else {
        const k = Math.min(1, dt * 12);
        car.x += (state.x - car.x) * k;
        car.y += (state.y - car.y) * k;
        car.a = wrapAngle(car.a + wrapAngle(state.a - car.a) * k);
      }
      const speed = mine ? me.s : state.s;
      car.group.position.set(car.x * S, 0, car.y * S);
      car.group.rotation.y = -car.a;
      // Three-wheelers lean out of corners; a little engine shudder sells the speed
      car.body.rotation.x = mine ? me.steer * clamp(speed / BOOST_SPEED, 0, 1) * 0.3 : 0;
      car.body.position.y = Math.abs(speed) > 20 ? Math.sin(this.time * 38) * 0.012 : 0;
      car.marker.position.y = 2.75 + Math.sin(this.time * 4) * 0.12;
      car.marker.visible = !mine;
      car.label.sprite.visible = !mine;
      if (!mine) car.label.set(`${state.c != null ? "🧍 " : ""}${frame.names[id] ?? "Player"}`);
      car.group.visible = !(frame.ghosts[id] && Math.floor(this.time * 4) % 2 === 0);
      if (mine && Date.now() < me.busGraceUntil) car.body.visible = Math.floor(this.time * 10) % 2 === 0;
      else car.body.visible = true;
    }
    for (const [id, car] of this.cars) {
      if (!seen.has(id)) { this.scene.remove(car.group); this.cars.delete(id); }
    }

    // Traffic
    for (const entry of this.traffic) {
      const p = busPosition(entry.def, serverNow);
      entry.visual.position.set(p.x * S, 0, p.y * S);
      // Ease round bends; a full about-turn at the end of a route just flips
      const turn = wrapAngle(p.angle - entry.heading);
      entry.heading = Math.abs(turn) > 2.6 ? p.angle : wrapAngle(entry.heading + turn * Math.min(1, dt * 8));
      entry.visual.rotation.y = -entry.heading;
    }

    // Pedestrians: walk each block's kerb as one loop
    const matrix = new THREE.Matrix4(), spin = new THREE.Quaternion(), place = new THREE.Vector3(), unit = new THREE.Vector3(1, 1, 1), upAxis = new THREE.Vector3(0, 1, 0);
    this.walkers.forEach((walker, i) => {
      const inset = 0.75;
      const w = walker.block.w * S - inset * 2, h = walker.block.h * S - inset * 2;
      const lap = 2 * (w + h);
      const d = (((walker.offset + this.time * walker.speed) % lap) + lap) % lap;
      let x = 0, z = 0, heading = 0;
      if (d < w) { x = d; z = 0; heading = 0; }
      else if (d < w + h) { x = w; z = d - w; heading = Math.PI / 2; }
      else if (d < 2 * w + h) { x = w - (d - w - h); z = h; heading = Math.PI; }
      else { x = 0; z = h - (d - 2 * w - h); heading = -Math.PI / 2; }
      if (walker.speed < 0) heading += Math.PI;
      place.set(walker.block.x * S + inset + x, Math.abs(Math.sin(this.time * 7 + i)) * 0.05, walker.block.y * S + inset + z);
      matrix.compose(place, spin.setFromAxisAngle(upAxis, -heading), unit);
      this.walkerBodies.setMatrixAt(i, matrix);
      this.walkerHeads.setMatrixAt(i, matrix);
    });
    this.walkerBodies.instanceMatrix.needsUpdate = true;
    this.walkerHeads.instanceMatrix.needsUpdate = true;

    // GPS line
    const route = frame.route;
    this.routeSegments.forEach((segment, i) => {
      const from = route?.[i], to = route?.[i + 1];
      const length = from && to ? Math.hypot(to.x - from.x, to.y - from.y) * S : 0;
      segment.visible = length > 1;
      if (!from || !to || length <= 1) return;
      segment.position.set((from.x + to.x) / 2 * S, 0.09, (from.y + to.y) / 2 * S);
      segment.rotation.y = -Math.atan2(to.y - from.y, to.x - from.x);
      segment.scale.set(length, 1, 1.1);
      const material = segment.material as THREE.MeshBasicMaterial;
      material.color.set(frame.routeIsDropOff ? 0x4ade80 : 0xffd23f);
      material.map!.repeat.set(length / 1.5, 1);
      material.map!.offset.x = -this.time * 1.6;
    });

    // Waiting passengers
    const waiting = snap.passengers.filter(p => !p.carrier);
    this.passengers.forEach((visual, i) => {
      const p = waiting[i];
      visual.group.visible = !!p;
      if (!p) return;
      const stop = map.stops[p.from];
      visual.group.position.set(stop.x * S, 0, stop.y * S + 1.6);
      visual.figure.position.y = Math.abs(Math.sin(this.time * 5 + p.id)) * 0.25;
      visual.figure.rotation.y = this.time * 1.5 + p.id;
      visual.label.set(`₹${p.fare} → ${map.stops[p.to].name}`, "rgba(250,204,21,0.95)", "#111827");
    });

    // My drop-off
    const myState = snap.cars[myId];
    const carried = myState?.c != null ? snap.passengers.find(p => p.id === myState.c) : undefined;
    this.destination.visible = !!carried;
    if (carried) {
      const dest = map.stops[carried.to];
      this.destination.position.set(dest.x * S, 0, dest.y * S);
      this.destination.scale.setScalar(1 + Math.sin(this.time * 5) * 0.08);
    }

    // Chai
    this.chais.forEach((visual, i) => {
      const chai = snap.chais[i];
      visual.visible = !!chai;
      if (!chai) return;
      visual.position.set(chai.x * S, 0.9 + Math.sin(this.time * 3 + chai.id) * 0.15, chai.y * S);
      visual.rotation.y = this.time * 2;
    });

    for (const mat of this.water) mat.emissiveIntensity = 0.8 + Math.sin(this.time * 1.3) * 0.3;

    this.updateCamera(frame, carried ? map.stops[carried.to] : undefined, waiting.map(p => map.stops[p.from]), dt);
  }

  private updateCamera(frame: FrameState, dest: { x: number; y: number } | undefined, pickups: { x: number; y: number }[], dt: number) {
    const { me, snap, myId, serverNow } = frame;
    const map = this.map;

    if (!me) {
      // Spectators get a slow aerial orbit
      const cx = map.width * S / 2, cz = map.height * S / 2;
      this.camera.position.set(cx + Math.cos(this.time * 0.08) * 120, 80, cz + Math.sin(this.time * 0.08) * 120);
      this.camera.lookAt(cx, 0, cz);
      this.pointer.visible = false;
      this.headlight.intensity = 0;
      return;
    }

    const boosted = (snap.cars[myId]?.b ?? 0) > serverNow;
    const speedFrac = clamp(Math.abs(me.s) / BOOST_SPEED, 0, 1);
    const stunned = Date.now() < me.stunnedUntil;

    // The camera swings round behind the auto a beat late, which is what makes turns feel fast
    if (this.camHeading === null) this.camHeading = me.a;
    if (!stunned) this.camHeading = wrapAngle(this.camHeading + wrapAngle(me.a - this.camHeading) * Math.min(1, dt * 4.5));
    const fx = Math.cos(this.camHeading), fz = Math.sin(this.camHeading);
    const px = me.x * S, pz = me.y * S;
    const back = 6.4 + speedFrac * 1.6, up = 2.9 + speedFrac * 0.5;

    this.shakeAmount = Math.max(0, this.shakeAmount - dt * 1.8);
    const jitter = this.shakeAmount + (boosted ? 0.03 : 0) + speedFrac * 0.012;
    this.camera.position.set(
      px - fx * back + (Math.random() - 0.5) * jitter,
      up + (Math.random() - 0.5) * jitter,
      pz - fz * back + (Math.random() - 0.5) * jitter,
    );
    this.camera.lookAt(px + fx * 6, 1.3, pz + fz * 6);
    const fov = 60 + speedFrac * 16 + (boosted ? 7 : 0);
    if (Math.abs(this.camera.fov - fov) > 0.05) {
      this.camera.fov += (fov - this.camera.fov) * Math.min(1, dt * 5);
      this.camera.updateProjectionMatrix();
    }

    // Headlight
    const hx = Math.cos(me.a), hz = Math.sin(me.a);
    this.headlight.intensity = 170;
    this.headlight.position.set(px + hx * 1.3, 1.1, pz + hz * 1.3);
    this.headlight.target.position.set(px + hx * 16, 0, pz + hz * 16);

    // Objective arrow: drop-off if loaded, otherwise the nearest waiting passenger
    let target = dest;
    if (!target) {
      let best = Infinity;
      for (const p of pickups) {
        const d = Math.hypot(p.x - me.x, p.y - me.y);
        if (d < best) { best = d; target = p; }
      }
    }
    this.pointer.visible = !!target;
    if (target) {
      this.pointer.position.set(px, 3.1 + Math.sin(this.time * 4) * 0.12, pz);
      this.pointer.rotation.y = -Math.atan2(target.y - me.y, target.x - me.x);
      (this.pointer.material as THREE.MeshBasicMaterial).color.set(dest ? 0x4ade80 : 0xffd23f);
    }

    if (this.bloom) this.bloom.strength = 0.5 + (boosted ? 0.35 : 0);
  }

  render() {
    this.dome.position.set(this.camera.position.x, 0, this.camera.position.z);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      for (const material of materials) {
        for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
        material.dispose();
      }
    });
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
