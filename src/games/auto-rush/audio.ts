// Sound for Auto Rush. One-shot effects, street ambience and the radio are
// audio files in /public/auto-rush; the engine is synthesised live so its
// pitch can follow the speedometer.

const SFX = ["horn", "crash", "cash", "skid", "boost", "pickup", "bushorn", "steal"] as const;
export type SfxName = typeof SFX[number];

const STATIONS = [
  { name: "Deccan Funk FM", file: "radio1" },
  { name: "Nizam Nights", file: "radio2" },
];

const PREFS_KEY = "autoRushAudio";

interface Prefs { sound: boolean; music: boolean; station: number }

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
    return { sound: saved.sound !== false, music: saved.music !== false, station: Number(saved.station) || 0 };
  } catch {
    return { sound: true, music: true, station: 0 };
  }
}

export class GameAudio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private musicGain!: GainNode;
  private engineGain!: GainNode;
  private engineOscs: OscillatorNode[] = [];
  private putter!: OscillatorNode;
  private engineFilter!: BiquadFilterNode;
  private buffers = new Map<string, AudioBuffer>();
  private musicSource: AudioBufferSourceNode | null = null;
  private lastPlayed: Record<string, number> = {};
  private disposed = false;
  prefs: Prefs = loadPrefs();

  get stationName() { return STATIONS[this.prefs.station % STATIONS.length].name; }

  /** Browsers only allow audio after a user gesture, so this is called from input handlers. */
  unlock() {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = this.ctx = new Ctor();

    this.master = ctx.createGain();
    this.master.gain.value = this.prefs.sound ? 1 : 0;
    this.master.connect(ctx.destination);

    this.musicGain = ctx.createGain();
    this.musicGain.gain.value = this.prefs.music ? 0.32 : 0;
    this.musicGain.connect(this.master);

    // Engine: two detuned oscillators through a low-pass, chopped by a slow
    // "putter" LFO that gives the two-stroke rattle.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = "lowpass";
    this.engineFilter.frequency.value = 500;
    const chop = ctx.createGain();
    chop.gain.value = 0.65;
    this.putter = ctx.createOscillator();
    this.putter.type = "square";
    this.putter.frequency.value = 14;
    const putterDepth = ctx.createGain();
    putterDepth.gain.value = 0.35;
    this.putter.connect(putterDepth).connect(chop.gain);
    this.putter.start();
    for (const [type, detune] of [["sawtooth", 0], ["square", -1200]] as const) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.detune.value = detune;
      osc.frequency.value = 60;
      osc.connect(this.engineFilter);
      osc.start();
      this.engineOscs.push(osc);
    }
    this.engineFilter.connect(chop).connect(this.engineGain).connect(this.master);

    void this.loadAll();
  }

  private async load(key: string, url: string) {
    try {
      const data = await (await fetch(url)).arrayBuffer();
      const buffer = await this.ctx!.decodeAudioData(data);
      this.buffers.set(key, buffer);
      return buffer;
    } catch {
      return null; // a missing sound should never break the game
    }
  }

  private async loadAll() {
    await Promise.all(SFX.map(name => this.load(name, `/auto-rush/sfx/${name}.mp3`)));
    const ambience = await this.load("ambience", "/auto-rush/sfx/ambience.mp3");
    if (ambience && this.ctx && !this.disposed) {
      const src = this.ctx.createBufferSource();
      src.buffer = ambience;
      src.loop = true;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.22;
      src.connect(gain).connect(this.master);
      src.start();
    }
    await this.playStation();
  }

  private async playStation() {
    if (!this.ctx || this.disposed) return;
    const station = STATIONS[this.prefs.station % STATIONS.length];
    const buffer = this.buffers.get(station.file) ?? await this.load(station.file, `/auto-rush/music/${station.file}.mp3`);
    if (!buffer || this.disposed) return;
    this.musicSource?.stop();
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    src.connect(this.musicGain);
    src.start();
    this.musicSource = src;
  }

  /** volume 0..1; `minGapMs` stops a sound machine-gunning when triggered every frame. */
  play(name: SfxName, volume = 1, minGapMs = 150) {
    if (!this.ctx || !this.prefs.sound) return;
    const buffer = this.buffers.get(name);
    const now = performance.now();
    if (!buffer || now - (this.lastPlayed[name] ?? 0) < minGapMs) return;
    this.lastPlayed[name] = now;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const gain = this.ctx.createGain();
    gain.gain.value = volume;
    src.connect(gain).connect(this.master);
    src.start();
  }

  /** speed 0..1 of top speed, throttle 0..1 */
  setEngine(speed: number, throttle: number, boosted: boolean) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const freq = 48 + speed * 115 + (boosted ? 25 : 0);
    this.engineOscs.forEach(osc => osc.frequency.setTargetAtTime(freq, t, 0.08));
    this.putter.frequency.setTargetAtTime(9 + speed * 38, t, 0.08);
    this.engineFilter.frequency.setTargetAtTime(350 + speed * 1400 + throttle * 500, t, 0.1);
    this.engineGain.gain.setTargetAtTime(0.05 + speed * 0.07 + throttle * 0.05, t, 0.1);
  }

  private save() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(this.prefs)); } catch { /* private mode */ }
  }

  setSound(on: boolean) {
    this.prefs.sound = on;
    this.save();
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.03);
  }

  setMusic(on: boolean) {
    this.prefs.music = on;
    this.save();
    if (this.ctx) this.musicGain.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.05);
  }

  nextStation() {
    this.prefs.station = (this.prefs.station + 1) % STATIONS.length;
    this.save();
    void this.playStation();
    return this.stationName;
  }

  dispose() {
    this.disposed = true;
    void this.ctx?.close();
    this.ctx = null;
  }
}
