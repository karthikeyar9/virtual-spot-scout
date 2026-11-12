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
  Block, GameMap, LocalCar, Snapshot, BOOST_SPEED, busPosition, clamp, colorFor, wrapAngle,
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

interface Templates { auto: THREE.Object3D; bus: THREE.Object3D; charminar: THREE.Object3D | null }

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
  const [auto, bus, charminar] = await Promise.all([
    load("auto", 2.9, MODEL_YAW.auto),
    load("bus", 6.6, MODEL_YAW.bus),
    load("charminar", 15, 0),
  ]);
  return {
    auto: auto ?? fallbackVehicle(2.8, 1.5, 1.7, 0xfacc15),
    bus: bus ?? fallbackVehicle(6.4, 2.6, 2.9, 0xdc2626),
    charminar,
  };
}

// Extra yaw so each generated model's nose points down +x after normalising.
const MODEL_YAW = { auto: Math.PI, bus: Math.PI };

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
  private buses: THREE.Object3D[] = [];
  private passengers: PassengerVisual[] = [];
  private chais: THREE.Group[] = [];
  private destination = new THREE.Group();
  private pointer!: THREE.Mesh;
  private headlight = new THREE.SpotLight(0xfff0cf, 0, 55, 0.62, 0.7, 1.4);
  private water: THREE.MeshStandardMaterial[] = [];
  private camHeading: number | null = null;
  private shakeAmount = 0;
  private time = 0;

  private constructor(canvas: HTMLCanvasElement, private map: GameMap, private templates: Templates, highQuality: boolean) {
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

    this.scene.add(new THREE.HemisphereLight(0x8a7bd8, 0x3a2a26, 1.5));
    const moon = new THREE.DirectionalLight(0xa8b8ff, 0.9);
    moon.position.set(-60, 120, -40);
    this.scene.add(moon);
  }

  private buildCity() {
    const map = this.map;
    const W = map.width * S, H = map.height * S;
    const rand = mulberry32(2026);

    // Street lamps at block corners
    const lamps: { x: number; y: number }[] = [];
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
    const outskirts = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshBasicMaterial({ color: 0x0b0a12 }));
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

    const addBuilding = (style: string, cx: number, cz: number, w: number, d: number, h: number) => {
      walls[style].push(wallsGeometry(w, h, d).translate(cx, 0, cz));
      roofs.push(roofGeometry(w, h, d).translate(cx, 0, cz));
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
      if (b.name === "Charminar" && this.templates.charminar) {
        const monument = this.templates.charminar;
        monument.position.set(cx, 0, cz);
        this.scene.add(monument);
        const wash = new THREE.PointLight(0xffb86b, 260, 45, 1.6); // warm floodlighting
        wash.position.set(cx, 9, cz + 13);
        this.scene.add(wash);
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
          domes.push(new THREE.CylinderGeometry(2.4, 3, 1.2, 10).translate(cx, 0.6, cz));
          domes.push(new THREE.CylinderGeometry(0.55, 0.8, 7, 8).translate(cx, 4.7, cz));
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
    // Buses
    for (let i = 0; i < this.map.buses.length; i++) {
      const bus = this.templates.bus.clone();
      this.scene.add(bus);
      this.buses.push(bus);
    }

    // Waiting passengers: a waving figure in a yellow marker beam
    const skin = new THREE.MeshStandardMaterial({ color: 0xc68642 });
    const shirts = [0xe11d48, 0x2563eb, 0x16a34a, 0xf59e0b, 0x9333ea, 0x0d9488, 0xf97316, 0xdb2777];
    for (let i = 0; i < 8; i++) {
      const figure = new THREE.Group();
      const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.75, 4, 8), new THREE.MeshStandardMaterial({ color: shirts[i] }));
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
    for (let i = 0; i < 6; i++) {
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

    // Buses
    map.buses.forEach((bus, i) => {
      const p = busPosition(bus, serverNow);
      this.buses[i].position.set(p.x * S, 0, p.y * S);
      this.buses[i].rotation.y = -p.angle;
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
