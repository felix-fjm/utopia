import * as THREE from 'three';
import { QUALITY, QualityName, QualitySettings, autoQuality, isTouchDevice } from './core/quality';
import { patchFogChunks, sharedUniforms } from './world/shared';
import { ArchetypeRegistry } from './world/archetypes';
import { registerInfrastructure, registerPlaceholders } from './world/placeholderAssets';
import { fetchManifest, loadUtopia } from './world/utopiaAssets';
import { CityGenerator } from './world/cityGen';
import { CityRenderer } from './world/cityRenderer';
import { Environment, PresetName } from './world/environment';
import { Ground } from './world/ground';
import { Traffic } from './world/traffic';
import { districtAt, startPose, DISTRICT_NAMES } from './world/layout';
import { setAnisotropy } from './world/materials';
import { Flight, sliderToSpeed, speedToSlider, WorldQuery } from './controls/flight';
import { InputController } from './controls/input';
import { UI } from './ui/ui';
import { RouteBuilder } from './game/route';
import { Challenge } from './game/challenge';
import { proceduralWorld } from './game/cityWorld';
import { Morph, MorphMode, MorphWorld, MorphConfig, carMaxFromSlider, jumpHeight } from './game/morph';
import { cityFromEnv } from './real/cities';
import { TilesWorld, TileSource, TilesAuth } from './real/tilesWorld';
import { NeonSigns } from './real/neonSigns';
import { storedAuth, askAuth, forgetAuth } from './real/auth';
import { fetchOsm, OsmIndex } from './real/osm';
import { CellContent } from './game/creatures';
import { Rng, hash2 } from './core/rng';

patchFogChunks();

const params = new URLSearchParams(location.search);
let seed = parseInt(params.get('seed') ?? '', 10);
if (!Number.isFinite(seed)) seed = 1337;
let qualityName: QualityName = autoQuality();
let Q: QualitySettings = QUALITY[qualityName];
let preset: PresetName = (params.get('preset') as PresetName) || (cityFromEnv(params.get('city'))?.preset as PresetName | undefined) || 'golden';
const CHALLENGE = import.meta.env.VITE_GAME === 'challenge' || params.get('mode') === 'challenge';
let challenge: Challenge | null = null;
if (CHALLENGE) document.title = 'UTOPIA Challenge – 30 Tore';
/** real Google 3D city (Frankfurt, Sydney, Hong Kong) – always the morph game */
const REAL = CHALLENGE ? null : cityFromEnv(params.get('city'));
const MORPH = !CHALLENGE && (!!REAL || import.meta.env.VITE_GAME === 'morph' || params.get('mode') === 'morph');
let morph: Morph | null = null;
if (MORPH) document.title = REAL ? `UTOPIA Verwandlung – ${REAL.name}` : 'UTOPIA Verwandlung – Auto & Frosch';
let tw: TilesWorld | null = null;
let signs: NeonSigns | null = null;
let osm: OsmIndex | null = null;
let osmFailed = false;
/** realistic sizes in the real cities: car 4.6 m (model size), frog ≈ 13 cm */
const REAL_MORPH: MorphConfig = { jump: (v) => 1.2 + 28 * Math.pow(v, 1.4), frogScale: 0.06, frogCatch: 2.5, near: { fly: 0.5, car: 0.2, frog: 0.02 } };
const REAL_TINT: Record<string, [number, number, number]> = { golden: [1.0, 0.86, 0.72], day: [1, 1, 1], blue: [0.5, 0.56, 0.78], night: [0.15, 0.16, 0.25] };
function syncSlider() {
  const m = morph?.mode ?? 'fly';
  if (m === 'car') { ui.setSpeed(morph!.slider.car, 0); ui.els.speedv.textContent = `${Math.round(carMaxFromSlider(morph!.slider.car) * 3.6)} km/h`; }
  else if (m === 'frog') { ui.setSpeed(morph!.slider.frog, 0); const h = jumpHeight(morph!.cfg.jump(morph!.slider.frog)); ui.els.speedv.textContent = `Sprung ${h < 10 ? h.toFixed(1) : Math.round(h)} m`; }
  else ui.setSpeed(speedToSlider(flight.speed), flight.speed);
}
function setSlider(v: number) {
  const m = morph?.mode ?? 'fly';
  if (m === 'car' || m === 'frog') morph!.slider[m] = v;
  else flight.speed = sliderToSpeed(v);
  syncSlider();
}

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('gl') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: Q.antialias, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: params.has('capture') });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
let pixelRatio = Math.min(window.devicePixelRatio, Q.maxPixelRatio);
renderer.setPixelRatio(pixelRatio);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, 1, 1, 20000);
scene.add(camera);

// ---------------------------------------------------------------- world
const reg = new ArchetypeRegistry();
registerInfrastructure(reg);
const gen = new CityGenerator(seed, reg);
const city = new CityRenderer(gen, reg);
const env = new Environment(renderer, scene);
const ground = new Ground(Q.viewRadius * 2.6);
const traffic = new Traffic(seed, QUALITY.ultra.vehicles);
if (!REAL) scene.add(city.group, ground.mesh, traffic.body, traffic.lights);

// floating origin: world = render + origin
const origin = { x: 0, z: 0 };
const flight = new Flight(camera);

const lastP = new THREE.Vector3(NaN, NaN, NaN);
const world: WorldQuery = REAL ? {
  // real city: swept ray + sphere probes against the photogrammetry mesh (origin stays 0)
  collide: (p, margin = 5) => {
    if (!tw || !tw.ready) return false;
    margin = Math.min(margin, 2.5); // real streets are narrow: allow low, close flight
    let hit = false;
    // a jump of more than one physics sub-step is a teleport, not motion -> no sweep
    if (Number.isFinite(lastP.x) && lastP.distanceTo(p) < 40) {
      const h = tw.sweep(lastP.x, lastP.y, lastP.z, p.x, p.y, p.z);
      if (h) { const dir = p.clone().sub(lastP).normalize(); p.copy(h.point).addScaledVector(dir, -margin); hit = true; }
    }
    const r = tw.collideSphere(p.x, p.y, p.z, margin, true);
    if (r[3]) { p.set(r[0], r[1], r[2]); hit = true; }
    lastP.copy(p);
    return hit;
  },
  heightAhead: (wx, wz) => tw?.groundAt(wx, wz, 3000) ?? 0,
  worldX: (rx) => rx,
  worldZ: (rz) => rz,
} : {
  collide: (p, margin) => city.collide(p, origin.x, origin.z, margin),
  heightAhead: (wx, wz) => city.heightAt(wx, wz),
  worldX: (rx) => rx + origin.x,
  worldZ: (rz) => rz + origin.z,
};

/** fallback content when OpenStreetMap is unreachable: no cars, but frogs and orbs */
function fallbackCell(cx: number, cz: number): CellContent {
  const rng = new Rng(Math.floor(hash2(cx, cz, 99) * 4294967296));
  const base = ((cx * 92821 + cz * 68917) & 0xffffff) * 64;
  return {
    cars: [],
    frogs: [{ id: base + 20, x: (cx + rng.next()) * 250, z: (cz + rng.next()) * 250, period: 3, phase: rng.next() * 9, range: 6, scale: 2.2 }],
    orbs: [{ id: base + 40, x: (cx + rng.next()) * 250, z: (cz + rng.next()) * 250, hue: rng.next() }],
  };
}

function realWorld(): MorphWorld {
  return {
    collide: (x, y, z, m) => (tw && tw.ready ? tw.collideSphere(x, y, z, m) : [x, y, z, false]),
    surfaceAt: (x, z, maxY) => (tw ? tw.surfaceAt(x, z, maxY) : 0),
    cell: (cx, cz) => (osm ? osm.cell(cx, cz) : osmFailed ? fallbackCell(cx, cz) : null),
    groundY: (x, z) => (tw && tw.ready ? tw.groundAt(x, z, 1500) : null),
    carCollide: (x, gy, z, m) => (tw && tw.ready ? tw.wallCollide(x, gy, z, m) : [x, z, false]),
    carGround: (x, z, y) => (tw && tw.ready ? tw.roadAt(x, z, y) : y),
  };
}

function applyPreset(p: PresetName) {
  preset = p;
  env.apply(p, REAL ? 9000 : Q.viewRadius);
  if (tw) tw.setTint(new THREE.Color(...REAL_TINT[p]));
  ui.setPreset(p);
}

function resetPose() {
  if (REAL) { realStart(); return; }
  const s = startPose(seed);
  origin.x = s.x; origin.z = s.z;
  // morph mode starts low so cars and frogs are in view right away
  flight.setPose(0, MORPH ? 80 : s.y, 0, s.yaw, MORPH ? -0.32 : s.pitch);
}

function realStart() {
  if (!tw) return;
  const a = tw.toLocal(REAL!.start[0], REAL!.start[1]), b = tw.toLocal(REAL!.look[0], REAL!.look[1]);
  const g = tw.groundAt(a.x, a.z, 3000) ?? 30;
  origin.x = 0; origin.z = 0;
  const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z));
  flight.setPose(a.x, g + REAL!.startAlt, a.z, yaw, -0.28);
  lastP.set(NaN, NaN, NaN);
}

function recenter() {
  if (REAL) return;
  const p = camera.position;
  if (Math.abs(p.x) > 1500 || Math.abs(p.z) > 1500) {
    origin.x += p.x; origin.z += p.z;
    p.x = 0; p.z = 0;
  }
}

// ---------------------------------------------------------------- UI
const ui = new UI({
  onPreset: (p) => applyPreset(p),
  onQuality: (q) => applyQuality(q),
  onSpeedSlider: (v) => setSlider(v),
  onSensitivity: (v) => { flight.sensitivity = v; },
  onToggle: (k, on) => {
    if (k === 'pause') flight.paused = on;
    if (k === 'autopilot') { if (on && morph && morph.mode !== 'fly') on = false; if (on) flight.autopilot = true; else flight.stopAutopilot(); }
    if (k === 'collisions') flight.collisions = on;
    if (k === 'dev') devOn = on;
    ui.setToggle(k, on);
  },
  onReset: () => { if (challenge) challenge.reset(); else { morph?.forceFly(); resetPose(); } },
  onNewCity: () => newCity(),
});
const input = new InputController(document.getElementById('touch')!, ui.els.joy, ui.els.knob, ui.els.lookRing, flight, {
  onActivity: () => ui.activity(),
  onWheel: (d) => { const cur = parseFloat((ui.els.speed as HTMLInputElement).value); setSlider(Math.min(1, Math.max(0, cur - d * 0.0006))); },
  onKey: (code) => {
    const map: Record<string, PresetName> = { Digit1: 'golden', Digit2: 'day', Digit3: 'blue', Digit4: 'night' };
    if (map[code]) applyPreset(map[code]);
    if (code === 'KeyP' && !(challenge && !challenge.running)) { flight.paused = !flight.paused; ui.setToggle('pause', flight.paused); }
    if (code === 'KeyR') { if (challenge) challenge.respawn(); else { morph?.forceFly(); resetPose(); } }
    if (code === 'KeyO' && !CHALLENGE && (!morph || morph.mode === 'fly')) { flight.autopilot ? flight.stopAutopilot() : (flight.autopilot = true); ui.setToggle('autopilot', flight.autopilot); }
    if (code === 'KeyG') { flight.collisions = !flight.collisions; ui.setToggle('collisions', flight.collisions); }
    if (code === 'KeyF' || code === 'Backquote') { devOn = !devOn; ui.setToggle('dev', devOn); }
    if (code === 'KeyI') ui.setToggle('immersive', !ui.root.classList.contains('immersive'));
  },
});
ui.bindHold(ui.els['b-up'], (on) => (input.holdUp = on));
ui.bindHold(ui.els['b-down'], (on) => (input.holdDown = on));
ui.bindHold(ui.els.boost, (on) => (input.holdBoost = on));

let devOn = params.has('dev');

function newCity() {
  seed = (Math.random() * 1e9) | 0;
  gen.seed = seed; traffic.setSeed(seed);
  city.reset();
  morph?.setSeed(seed);
  resetPose();
  try { const u = new URL(location.href); u.searchParams.set('seed', String(seed)); history.replaceState(null, '', u); } catch { /* sandboxed */ }
  if (CHALLENGE) void setupChallenge();
}

async function setupChallenge(progress?: (f: number) => void) {
  challenge?.dispose();
  challenge = null;
  flight.paused = true;
  const rb = new RouteBuilder(gen, reg, seed);
  const defs = await rb.build(progress);
  const s = startPose(seed);
  challenge = new Challenge(camera, rb, defs, { x: s.x, y: s.y, z: s.z, yaw: s.yaw }, seed, {
    setPaused: (p) => { flight.paused = p; if (!p) ui.setToggle('pause', false); },
    teleport: (wx, y, wz, yaw, pitch) => { origin.x = wx; origin.z = wz; flight.setPose(0, y, 0, yaw, pitch); },
    collisionsOn: () => flight.collisions,
    newRoute: () => newCity(),
    freeFly: () => { flight.paused = false; },
  });
  scene.add(challenge.group);
  (window as unknown as { __challenge: Challenge }).__challenge = challenge;
}

function applyQuality(q: QualityName) {
  qualityName = q; Q = QUALITY[q];
  city.viewRadius = Q.viewRadius; city.lod1 = Q.lod1; city.lod2 = Q.lod2;
  city.genBudgetMs = Q.genBudget * 1.5;
  city.setShadows(Q.shadows);
  env.setShadows(Q.shadows, Q.shadowMapSize);
  env.setViewRadius(REAL ? 9000 : Q.viewRadius);
  ground.setSize(Q.viewRadius * 4.4);
  traffic.setCapacity(Q.vehicles);
  camera.far = REAL ? 30000 : Q.viewRadius * 2.8;
  if (REAL) { env.setShadows(false, 1024); tw?.setErrorTarget({ performance: 32, balanced: 20, high: 12, ultra: 7 }[q]); }
  camera.updateProjectionMatrix();
  pixelRatio = Math.min(window.devicePixelRatio, Q.maxPixelRatio);
  renderer.setPixelRatio(pixelRatio);
  ui.setQuality(q);
}

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, true);
  camera.aspect = w / h;
  // ~100° horizontal in landscape, 72° vertical in portrait
  camera.fov = w > h ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(50)) / camera.aspect)) : 72;
  camera.updateProjectionMatrix();
  input.layout();
}
window.addEventListener('resize', resize);
window.visualViewport?.addEventListener('resize', resize);

// ---------------------------------------------------------------- adaptive resolution
const perf = { ema: 16.7, lastAdjust: 0, fps: 60, frames: 0, acc: 0, worst: 0, worstShown: 0 };
function adapt(ms: number, now: number) {
  perf.ema += (ms - perf.ema) * 0.05;
  perf.frames++; perf.acc += ms; perf.worst = Math.max(perf.worst, ms);
  if (perf.acc >= 500) { perf.fps = (perf.frames * 1000) / perf.acc; perf.frames = 0; perf.acc = 0; perf.worstShown = perf.worst; perf.worst = 0; }
  if (params.has('fixedres') || now - perf.lastAdjust < 1200) return;
  const maxPr = Math.min(window.devicePixelRatio, Q.maxPixelRatio);
  if (perf.ema > 19.5 && pixelRatio > Q.minPixelRatio) {
    pixelRatio = Math.max(Q.minPixelRatio, pixelRatio - (perf.ema > 28 ? 0.25 : 0.1));
    renderer.setPixelRatio(pixelRatio); perf.lastAdjust = now;
  } else if (perf.ema < 15.5 && pixelRatio < maxPr && now - perf.lastAdjust > 3500) {
    pixelRatio = Math.min(maxPr, pixelRatio + 0.1);
    renderer.setPixelRatio(pixelRatio); perf.lastAdjust = now;
  }
}

// ---------------------------------------------------------------- loop
let last = performance.now();
let hudT = 0, devT = 0, simTime = 0, groundT = 0, attrT = 0;
const fwd = new THREE.Vector3();
const prevW = new THREE.Vector3(), curW = new THREE.Vector3();
function frame(now: number) {
  const ms = now - last;
  last = now;
  const dt = Math.min(0.05, ms / 1000);
  input.apply();
  prevW.set(camera.position.x + origin.x, camera.position.y, camera.position.z + origin.z);
  if (!morph || !morph.drive(dt, origin.x, origin.z, flight.paused)) flight.update(dt, world);
  recenter();
  if (!flight.paused) simTime += dt;
  sharedUniforms.uTime.value = simTime;

  const wx = camera.position.x + origin.x, wz = camera.position.z + origin.z;
  camera.getWorldDirection(fwd);
  if (REAL) {
    tw?.update();
    if (morph && now - groundT > 3000) {
      groundT = now;
      const px = morph.mode === 'car' ? morph.car.x : morph.mode === 'frog' ? morph.frog.x : wx;
      const pz = morph.mode === 'car' ? morph.car.z : morph.mode === 'frog' ? morph.frog.z : wz;
      morph.refreshGround(px, pz, 350);
    }
    if (signs) {
      const px = morph?.mode === 'car' ? morph.car.x : morph?.mode === 'frog' ? morph.frog.x : wx;
      const pz = morph?.mode === 'car' ? morph.car.z : morph?.mode === 'frog' ? morph.frog.z : wz;
      signs.update(px, pz);
    }
    if (now - attrT > 2000 && tw) { attrT = now; ui.els.attr.textContent = [tw.attributions(), '© OpenStreetMap-Mitwirkende'].filter(Boolean).join(' · '); }
  } else {
    city.stream(wx, wz, fwd.x, fwd.z);
    city.update(camera, origin.x, origin.z);
    ground.update(camera, origin.x, origin.z, seed);
    traffic.update(simTime, wx, wz, origin.x, origin.z);
  }
  if (morph) morph.update(dt, simTime, origin.x, origin.z);
  if (challenge) {
    curW.set(wx, camera.position.y, wz);
    challenge.update(dt, simTime, prevW, curW, origin.x, origin.z, flight.paused);
  }
  env.update(camera);
  renderer.render(scene, camera);
  adapt(ms, now);

  if (now - hudT > 150) {
    hudT = now;
    const dname = REAL ? REAL.name.toUpperCase() : DISTRICT_NAMES[districtAt(wx, wz, seed).type].toUpperCase();
    ui.setHUD(morph ? morph.altitude : camera.position.y, morph ? morph.speed : flight.currentSpeed, `${dname} · ${morph && morph.mode === 'car' ? 'AUTO' : morph && morph.mode === 'frog' ? 'FROSCH' : flight.autopilot ? 'AUTOPILOT' : flight.collisions ? 'KOLLISION AN' : 'GHOST'}`);
  }
  if (devOn && now - devT > 250) {
    devT = now;
    const i = renderer.info, s = city.stats;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    const sz = renderer.getDrawingBufferSize(new THREE.Vector2());
    ui.els.dev.textContent =
      `FPS        ${perf.fps.toFixed(1)}\nFrame      ${perf.ema.toFixed(1)} ms (max ${perf.worstShown.toFixed(0)})\n` +
      `Draw calls ${i.render.calls}\nTriangles  ${(i.render.triangles / 1e6).toFixed(2)} M\n` +
      `Chunks     ${s.visibleChunks} sichtbar / ${s.loadedChunks} geladen / ${s.pending} offen\n` +
      `Instanzen  ${s.instances}  Batches ${s.batches}\nGen        ${s.genMs.toFixed(1)} ms\n` +
      `Auflösung  ${sz.x}×${sz.y} @${pixelRatio.toFixed(2)}x\nGPU-Res.   ${i.memory.geometries} Geo / ${i.memory.textures} Tex\n` +
      (mem ? `JS-Heap    ${(mem.usedJSHeapSize / 1048576).toFixed(0)} MB\n` : '') +
      `Qualität   ${qualityName}\nWelt       ${wx.toFixed(0)}, ${wz.toFixed(0)}\nAssets     ${REAL ? 'Google 3D · ' + REAL.name : reg.kitLabel}` +
      (morph ? `\nObjekte    ${morph.stats.cars} Autos / ${morph.stats.frogs} Frösche / ${morph.stats.orbs} Kugeln` : '') +
      (osm ? `\nOSM        ${osm.roadsKm.toFixed(0)} km Straßen, ${osm.parks} Parks` : '') +
      (signs ? `\nNeon       ${signs.count} Schilder` : '') +
      (tw ? `\nKachel-RAM ${Math.round(tw.memoryUse() * 100)} %` : '') +
      (tw ? '\nKacheln    ' + tw.layerStatus().map((l) => `${l.label}${l.ready ? '✓' : l.error ? '✗' : '…'}${l.fallback ? '(alt)' : ''}`).join(' ') : '');
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- boot
async function boot() {
  resize();
  applyQuality(qualityName);
  ui.setPreset(preset);
  ui.setToggle('collisions', flight.collisions);
  ui.setToggle('dev', devOn);
  flight.speed = CHALLENGE ? 90 : 60;
  if (CHALLENGE) {
    (document.querySelector('#loading .t') as HTMLElement).innerHTML = 'UTOPIA<div style="font-size:13px;letter-spacing:.6em;margin-top:10px;color:#ffd27a">CHALLENGE</div>';
    // autopilot button becomes "back to last gate"
    const old = ui.els['b-auto'];
    const btn = old.cloneNode(false) as HTMLElement;
    btn.title = 'Zurück zum letzten Tor (R)';
    btn.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.5-5.8"/><path d="M4 4v4.5h4.5"/></svg>';
    old.replaceWith(btn);
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); challenge?.respawn(); });
    document.querySelector('.toggle[data-t="autopilot"]')?.parentElement?.remove();
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = 'Leuchtspur zum Tor <div class="toggle on" id="t-trail"></div>';
    document.querySelector('.toggle[data-t="collisions"]')!.parentElement!.after(row);
    const tt = row.querySelector('.toggle') as HTMLElement;
    tt.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); tt.classList.toggle('on'); if (challenge) challenge.trailOn = tt.classList.contains('on'); });
    const rb = document.getElementById('b-reset')!; rb.textContent = 'Challenge neu starten';
    const nb = document.getElementById('b-city')!; nb.textContent = 'Neue Strecke';
  }
  if (MORPH) {
    (document.querySelector('#loading .t') as HTMLElement).innerHTML = `${REAL ? REAL.name.toUpperCase() : 'UTOPIA'}<div style="font-size:13px;letter-spacing:.5em;margin-top:10px;color:#8dff7a">VERWANDLUNG</div>`;
    morph = new Morph(seed, camera, flight, REAL ? realWorld() : proceduralWorld(city, () => seed, origin), {
      onMode: (m: MorphMode) => {
        if (flight.autopilot) { flight.stopAutopilot(); ui.setToggle('autopilot', false); }
        flight.input.x = flight.input.y = flight.input.v = 0;
        syncSlider();
      },
    }, REAL ? REAL_MORPH : undefined);
    scene.add(morph.group);
    (window as unknown as { __morph: Morph }).__morph = morph;
  }
  ui.setSpeed(speedToSlider(flight.speed), flight.speed);

  if (REAL) { await bootReal(); return; }
  ui.loading(0.02, 'Assets prüfen');
  const base = './assets/utopia/';
  const manifest = params.has('placeholders') ? null : await fetchManifest(base);
  let note = '';
  if (manifest) {
    try {
      await loadUtopia(reg, renderer, base, manifest, (f, msg) => ui.loading(0.05 + f * 0.45, msg));
    } catch (e) {
      console.error(e);
      note = 'Utopia-Assets konnten nicht geladen werden – Platzhalter aktiv.';
      registerPlaceholders(reg);
    }
  } else {
    registerPlaceholders(reg);
    note = 'Die lizenzierten KitBash3D-Utopia-Assets sind nicht installiert. Gezeigt werden temporäre Platzhalter-Gebäude zur Validierung von Engine, Streaming und Steuerung. Pipeline: siehe README („Utopia-Assets einbinden“).';
  }
  ui.setBadge(reg.temporary ? (manifest?.test ? 'Test-Kit · nicht Utopia' : 'Temporäre Platzhalter · nicht Utopia') : reg.kitLabel || 'KitBash3D', !reg.temporary);
  ui.els.assetnote.textContent = note || `Assets: ${reg.kitLabel}. Original-Assets bleiben lokal und werden nicht veröffentlicht.`;

  env.apply(preset, Q.viewRadius);
  resetPose();
  const pre = city.preload(origin.x, origin.z, Math.min(Q.viewRadius, 2600));
  for (const f of pre) {
    ui.loading(0.5 + f * 0.45, 'Megacity wird generiert');
    await new Promise((r) => setTimeout(r, 0));
  }
  if (CHALLENGE) {
    ui.loading(0.95, 'Torstrecke wird abgesteckt');
    await setupChallenge((f) => ui.loading(0.95 + f * 0.05));
  }
  // warm up shaders
  city.update(camera, origin.x, origin.z);
  ground.update(camera, origin.x, origin.z, seed);
  renderer.compile(scene, camera);
  ui.loading(1, isTouchDevice() ? 'Links: fliegen · Rechts: blicken' : 'WASD fliegen · Maus ziehen: blicken');
  if (challenge) challenge.reset();
  setTimeout(() => ui.loaded(), 350);
  last = performance.now();
  requestAnimationFrame(frame);
}

async function bootReal() {
  const city0 = REAL!;
  const plateau = city0.kind === 'plateau';
  ui.setBadge(plateau ? `PLATEAU 3D · ${city0.name}` : `Google Photorealistic 3D · ${city0.name}`, true);
  document.getElementById('b-city')!.style.display = 'none';
  // city switcher in the settings
  const row = document.createElement('div');
  row.className = 'seg';
  row.style.cssText = 'grid-template-columns:repeat(3,1fr);margin-top:8px';
  row.innerHTML = (['frankfurt', 'sydney', 'hongkong'] as const).map((c) => `<button data-c="${c}" class="${c === city0.id ? 'on' : ''}">${{ tokyo: 'Neo Tokio', frankfurt: 'Frankfurt', sydney: 'Sydney', hongkong: 'Hongkong' }[c]}</button>`).join('');
  document.getElementById('b-reset')!.parentElement!.after(row);
  row.querySelectorAll<HTMLElement>('button').forEach((b) => b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); const u = new URL(location.href); u.searchParams.set('city', b.dataset.c!); location.href = u.toString(); }));
  const keyBtn = document.createElement('button');
  keyBtn.textContent = 'Zugang (Token) ändern';
  keyBtn.style.cssText = 'margin-top:8px;width:100%;font:500 12px -apple-system,sans-serif;color:var(--txt);background:rgba(255,255,255,.08);border:1px solid var(--line);border-radius:10px;padding:10px 6px;';
  keyBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); forgetAuth(); location.reload(); });
  row.after(keyBtn);
  const attr = document.createElement('div');
  attr.id = 'attr';
  attr.style.cssText = 'position:absolute;left:calc(var(--sal) + 14px);bottom:calc(var(--sab) + 4px);font:500 9px -apple-system,sans-serif;color:rgba(255,255,255,.75);text-shadow:0 1px 2px #000;pointer-events:none;max-width:60vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
  ui.root.appendChild(attr);
  ui.els.attr = attr;
  ui.els.assetnote.textContent = plateau
    ? 'Gebäude: 3D都市モデル（国土交通省 PLATEAU）を加工して作成 – im eigenen Neon-Stil eingefärbt. Gelände: PLATEAU-Terrain/Cesium. Straßen & Parks: © OpenStreetMap-Mitwirkende (ODbL). Auto 4,9 m, Frosch ≈ 14 cm, Linksverkehr.'
    : 'Fotorealistische 3D-Kacheln: Google Maps Platform (über Cesium ion oder Google). Straßen & Parks: © OpenStreetMap-Mitwirkende (ODbL). Auto in Originalgröße (4,9 m), Frosch ≈ 14 cm.';

  // test hooks: ?tileset= (buildings / google stand-in) and ?terrain= (PLATEAU ground stand-in)
  const testTiles = params.get('tileset'), testTerrain = params.get('terrain');
  const sourcesFor = (auth: TilesAuth | null): TileSource[] => {
    if (!plateau) return [testTiles ? { kind: 'url', key: testTiles, style: 'photo', primary: true, label: 'Test' } : { kind: auth!.kind, key: auth!.key, style: 'photo', primary: true, label: 'Google 3D' }];
    const ground: TileSource = testTerrain ? { kind: 'url', key: testTerrain, style: 'ground', primary: true, label: 'Gelände' }
      : { kind: 'ion', key: auth!.key, assetId: '2488101', fallback: '1', style: 'ground', primary: true, label: 'Gelände' };
    const blds: TileSource[] = testTiles ? [{ kind: 'url', key: testTiles, style: 'neon', label: 'Gebäude' }]
      : (city0.wards ?? []).map((w) => ({ kind: 'url' as const, style: 'neon' as const, label: w,
        key: `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/${w}-bldg-lod2-latest/tileset.json`,
        fallback: `https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/${w}-bldg-lod1-latest/tileset.json` }));
    return [ground, ...blds];
  };
  const needsAuth = !(plateau ? testTerrain : testTiles);
  let auth = needsAuth ? storedAuth(params) : null;
  if (auth && plateau && auth.kind !== 'ion') auth = null; // PLATEAU terrain needs a Cesium ion token
  let lastErr = '';
  for (;;) {
    if (needsAuth && !auth) { ui.loaded(); auth = await askAuth(city0.name, lastErr, plateau); document.getElementById('loading')!.classList.remove('done'); }
    ui.loading(0.1, 'Verbinde mit 3D-Kacheln');
    tw = new TilesWorld(renderer, camera, city0, sourcesFor(auth));
    scene.add(tw.group);
    applyQuality(qualityName);
    // warm up: stream until the root tileset is there
    const t0 = performance.now();
    while (!tw.ready && !tw.error && performance.now() - t0 < 30000) {
      tw.update(); renderer.render(scene, camera);
      await new Promise((r) => requestAnimationFrame(r));
    }
    if (tw.ready) break;
    lastErr = tw.error ? `Fehler: ${tw.error}` : 'Keine Antwort vom Kachel-Server.';
    if (/403/.test(lastErr) && auth?.kind === 'google') lastErr += ' – Google sperrt die 3D-Kacheln für EU-Konten. Bitte Cesium ion probieren.';
    if (/40[13]/.test(lastErr) && auth?.kind === 'ion') lastErr += ' – Bitte prüfen: Token korrekt kopiert? Asset im Cesium „Asset Depot“ zu „My Assets“ hinzugefügt?';
    tw.dispose(); tw = null;
    if (!needsAuth) { ui.loading(0, lastErr); return; }
    forgetAuth(); auth = null;
  }
  applyPreset(preset);
  // street data in parallel
  const osmP = fetchOsm(city0.lat, city0.lon, 3000, params.get('osm') ?? undefined)
    .then((ways) => {
      osm = new OsmIndex(ways, (la, lo) => { const v = tw!.toLocal(la, lo); return [v.x, v.z]; }, seed, city0.leftHandTraffic);
      if (plateau) { signs = new NeonSigns(tw!, () => osm, seed); scene.add(signs.mesh); }
    })
    .catch((e) => { console.warn('OSM failed', e); osmFailed = true; });
  // wait for the ground under the start point
  const a = tw!.toLocal(city0.start[0], city0.start[1]);
  flight.setPose(a.x, 400, a.z, 0, -0.5);
  const t1 = performance.now();
  while (tw!.groundAt(a.x, a.z, 3000) === null && performance.now() - t1 < 25000) {
    ui.loading(0.2 + Math.min(0.6, (performance.now() - t1) / 25000), `${city0.name} wird geladen`);
    tw!.update(); renderer.render(scene, camera);
    await new Promise((r) => requestAnimationFrame(r));
  }
  realStart();
  ui.loading(0.85, 'Straßen & Parks (OpenStreetMap)');
  await Promise.race([osmP, new Promise((r) => setTimeout(r, 12000))]);
  if (osmFailed) ui.els.assetnote.textContent += ' Straßendaten waren nicht erreichbar – ohne Autos, nur Frösche & Kugeln.';
  ui.loading(1, isTouchDevice() ? 'Links: fliegen · Rechts: blicken' : 'WASD fliegen · Maus ziehen: blicken');
  setTimeout(() => ui.loaded(), 350);
  last = performance.now();
  requestAnimationFrame(frame);
}

boot();

// test / debug hooks
(window as unknown as Record<string, unknown>).__utopia = {
  THREE, flight, city, camera, renderer, reg, input, origin, env,
  get tw() { return tw; }, get osm() { return osm; },
  get seed() { return seed; },
  get quality() { return qualityName; },
  get pixelRatio() { return pixelRatio; },
  perf,
};
