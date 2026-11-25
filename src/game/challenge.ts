import * as THREE from 'three';
import { GateDef, GATE_COUNT, GATE_LABEL, RouteBuilder } from './route';
import { patchMaterial } from '../world/shared';

type GateState = 'idle' | 'next' | 'active' | 'passed';

interface Gate extends GateDef {
  group: THREE.Group;
  frame: THREE.Mesh;
  membrane: THREE.Mesh;
  label: THREE.Sprite;
  beam: THREE.Group;
  state: GateState;
  split?: number;
}

const COLORS = { active: new THREE.Color('#ffd27a'), next: new THREE.Color('#7fe3ff'), idle: new THREE.Color('#5f7fa8'), passed: new THREE.Color('#6dffa8') };

// ------------------------------------------------------------------ shaders
const membraneVert = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const membraneFrag = /* glsl */ `
uniform vec3 uColor; uniform float uTime, uOpacity;
varying vec2 vUv;
void main(){
  vec2 e = min(vUv, 1.0 - vUv);
  float edge = pow(1.0 - clamp(min(e.x, e.y) * 6.0, 0.0, 1.0), 3.0);
  float scan = 0.5 + 0.5 * sin(vUv.y * 70.0 - uTime * 7.0);
  float sweep = smoothstep(0.0, 0.04, 0.04 - abs(fract(vUv.y * 0.5 - uTime * 0.35) - 0.5) + 0.0);
  float a = (0.07 + 0.05 * scan + 0.6 * edge + 0.25 * sweep) * uOpacity;
  gl_FragColor = vec4(uColor * (1.2 + edge), a);
}`;
const beamVert = /* glsl */ `varying float vY; varying vec3 vN; varying vec3 vV;
void main(){ vY = position.y; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const beamFrag = /* glsl */ `uniform vec3 uColor; uniform float uOpacity, uTime; varying float vY; varying vec3 vN; varying vec3 vV;
void main(){
  float f = pow(abs(dot(vN, vV)), 1.6);
  float fade = pow(1.0 - clamp(vY, 0.0, 1.0), 1.3);
  float pulse = 0.75 + 0.25 * sin(uTime * 3.0 - vY * 30.0);
  gl_FragColor = vec4(uColor * 1.6, f * fade * pulse * uOpacity);
}`;

function roundedRectCurve(w: number, h: number, r: number): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  const cs: [number, number, number][] = [[w - r, h - r, 0], [-w + r, h - r, Math.PI / 2], [-w + r, -h + r, Math.PI], [w - r, -h + r, Math.PI * 1.5]];
  for (const [cx, cy, a0] of cs) for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0)); }
  return new THREE.CatmullRomCurve3(pts, true, 'centripetal');
}

function labelTexture(n: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(8,14,26,0.55)';
  g.beginPath(); g.arc(128, 128, 112, 0, Math.PI * 2); g.fill();
  g.lineWidth = 10; g.strokeStyle = '#ffffff'; g.stroke();
  g.fillStyle = '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '600 34px -apple-system, Helvetica, Arial, sans-serif';
  g.fillText('TOR', 128, 72);
  g.font = '700 112px -apple-system, Helvetica, Arial, sans-serif';
  g.fillText(String(n), 128, 148);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function signTexture(n: number, angle: number, dist: number, dy: number): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d')!;
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, 'rgba(10,30,52,0.88)'); grd.addColorStop(1, 'rgba(6,16,30,0.88)');
  g.fillStyle = grd; g.fillRect(0, 0, 512, 256);
  g.strokeStyle = '#7fe3ff'; g.lineWidth = 8; g.strokeRect(6, 6, 500, 244);
  for (let y = 14; y < 250; y += 6) { g.fillStyle = 'rgba(127,227,255,0.05)'; g.fillRect(8, y, 496, 2); }
  // arrow (up = straight ahead, like a road sign)
  g.save(); g.translate(128, 128); g.rotate(angle);
  g.fillStyle = '#ffd27a';
  g.beginPath(); g.moveTo(0, -86); g.lineTo(62, -18); g.lineTo(22, -18); g.lineTo(22, 78); g.lineTo(-22, 78); g.lineTo(-22, -18); g.lineTo(-62, -18); g.closePath(); g.fill();
  g.restore();
  g.fillStyle = '#ffffff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.font = '600 40px -apple-system, Helvetica, Arial, sans-serif'; g.fillText('TOR', 262, 92);
  g.font = '800 92px -apple-system, Helvetica, Arial, sans-serif'; g.fillText(String(n), 340, 112);
  g.font = '500 44px -apple-system, Helvetica, Arial, sans-serif'; g.fillStyle = '#bfefff';
  g.fillText(`${Math.round(dist)} m`, 262, 178);
  if (Math.abs(dy) > 35) { g.fillStyle = '#ffd27a'; g.font = '600 30px -apple-system, Helvetica, Arial, sans-serif'; g.fillText(dy > 0 ? '▲ STEIGEN' : '▼ SINKEN', 262, 226); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ audio
class Sfx {
  private ctx: AudioContext | null = null;
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { this.ctx = null; }
  }
  tone(freq: number, t0: number, dur: number, gain = 0.12, type: OscillatorType = 'sine') {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(0, c.currentTime + t0);
    g.gain.linearRampToValueAtTime(gain, c.currentTime + t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(c.currentTime + t0); o.stop(c.currentTime + t0 + dur + 0.05);
  }
  gate(n: number) { const base = 440 * Math.pow(2, (n % 12) / 24); [0, 4, 7].forEach((s, k) => this.tone(base * Math.pow(2, s / 12), k * 0.07, 0.5, 0.1)); }
  checkpoint() { [0, 4, 7, 12].forEach((s, k) => this.tone(523 * Math.pow(2, s / 12), k * 0.09, 0.7, 0.11, 'triangle')); }
  win() { [0, 4, 7, 12, 16, 19, 24].forEach((s, k) => this.tone(392 * Math.pow(2, s / 12), k * 0.11, 1.3, 0.1, 'triangle')); }
  wrong() { this.tone(180, 0, 0.25, 0.08, 'sawtooth'); }
  count(final: boolean) { this.tone(final ? 880 : 520, 0, 0.25, 0.1); }
}

export interface ChallengeHooks {
  setPaused(p: boolean): void;
  teleport(wx: number, y: number, wz: number, yaw: number, pitch: number): void;
  collisionsOn(): boolean;
  newRoute(): void;
  freeFly(): void;
}

export class Challenge {
  readonly group = new THREE.Group();
  gates: Gate[] = [];
  current = 0;                     // index of active gate (0-based)
  running = false;
  finished = false;
  time = 0;
  penalty = 0;
  ghostUsed = false;
  trailOn = true;
  private startPos: { x: number; y: number; z: number; yaw: number };
  private sfx = new Sfx();
  private signs: THREE.Mesh[] = [];
  private trail: THREE.InstancedMesh;
  private trailPts: THREE.Vector3[] = [];
  private bursts: { mesh: THREE.Mesh; t: number }[] = [];
  private frameGeoCache = new Map<string, THREE.TubeGeometry>();
  private beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).translate(0, 0.5, 0);
  private dom: Record<string, HTMLElement> = {};
  private tmp = new THREE.Vector3();
  private seedKey: string;
  private countdown = -1;

  constructor(private camera: THREE.PerspectiveCamera, private route: RouteBuilder, defs: GateDef[], start: { x: number; y: number; z: number; yaw: number }, seed: number, private hooks: ChallengeHooks) {
    this.startPos = start;
    this.seedKey = 'utopia-challenge-best-' + seed;
    this.group.name = 'challenge';
    for (const d of defs) this.gates.push(this.buildGate(d));
    const orb = new THREE.SphereGeometry(1, 10, 8);
    this.trail = new THREE.InstancedMesh(orb, new THREE.MeshBasicMaterial({ color: '#ffe2a0', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), 120);
    this.trail.frustumCulled = false;
    this.trail.count = 0;
    this.group.add(this.trail);
    this.buildDom();
    window.addEventListener('pointerdown', () => this.sfx.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.sfx.unlock(), { capture: true });
    this.reset();
  }

  // ---------------------------------------------------------------- construction
  private frameGeo(w: number, h: number): THREE.TubeGeometry {
    const k = w.toFixed(1) + 'x' + h.toFixed(1);
    let g = this.frameGeoCache.get(k);
    if (!g) { g = new THREE.TubeGeometry(roundedRectCurve(w, h, Math.min(w, h) * 0.35), 96, Math.max(0.9, w * 0.07), 10, true); this.frameGeoCache.set(k, g); }
    return g;
  }

  private buildGate(d: GateDef): Gate {
    const group = new THREE.Group();
    const fm = patchMaterial(new THREE.MeshStandardMaterial({ color: '#1a2330', metalness: 0.8, roughness: 0.3, emissive: COLORS.idle.clone(), emissiveIntensity: 1.2 }));
    const frame = new THREE.Mesh(this.frameGeo(d.w, d.h), fm);
    const mm = new THREE.ShaderMaterial({ vertexShader: membraneVert, fragmentShader: membraneFrag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: COLORS.idle.clone() }, uTime: { value: 0 }, uOpacity: { value: 0.5 } } });
    const membrane = new THREE.Mesh(new THREE.PlaneGeometry(d.w * 2 - 1, d.h * 2 - 1), mm);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(d.i), transparent: true, depthWrite: false, fog: false, color: COLORS.idle.clone() }));
    const ls = Math.max(14, d.w * 0.9);
    label.scale.set(ls, ls, 1);
    label.position.set(0, d.h + ls * 0.62, 0);
    const beam = new THREE.Group();
    const bm = (op: number) => new THREE.ShaderMaterial({ vertexShader: beamVert, fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide,
      uniforms: { uColor: { value: COLORS.active.clone() }, uOpacity: { value: op }, uTime: { value: 0 } } });
    const core = new THREE.Mesh(this.beamGeo, bm(0.9)); core.scale.set(2.2, 2200, 2.2);
    const halo = new THREE.Mesh(this.beamGeo, bm(0.35)); halo.scale.set(9, 1500, 9);
    beam.add(core, halo);
    beam.position.y = d.h;
    // little corner beacons
    const lampGeo = new THREE.SphereGeometry(Math.max(0.8, d.w * 0.05), 8, 6);
    for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const lamp = new THREE.Mesh(lampGeo, new THREE.MeshBasicMaterial({ color: '#ffffff', fog: false }));
      lamp.position.set(sx * d.w * 1.04, sy * d.h * 1.04, 0);
      group.add(lamp);
    }
    group.add(frame, membrane, label, beam);
    group.rotation.y = Math.atan2(d.nx, d.nz);
    group.userData.world = new THREE.Vector3(d.x, d.y, d.z);
    this.group.add(group);
    return { ...d, group, frame, membrane, label, beam, state: 'idle' };
  }

  private setState(g: Gate, s: GateState) {
    g.state = s;
    const col = COLORS[s];
    const fm = g.frame.material as THREE.MeshStandardMaterial;
    fm.emissive.copy(col);
    fm.emissiveIntensity = s === 'active' ? 2.2 : s === 'next' ? 1.4 : s === 'passed' ? 0.6 : 0.8;
    const mm = g.membrane.material as THREE.ShaderMaterial;
    mm.uniforms.uColor.value.copy(col);
    mm.uniforms.uOpacity.value = s === 'active' ? 1 : s === 'next' ? 0.45 : s === 'passed' ? 0 : 0.18;
    g.membrane.visible = s !== 'passed';
    (g.label.material as THREE.SpriteMaterial).color.copy(col);
    g.label.visible = s !== 'passed';
    g.beam.visible = s === 'active' || s === 'next';
    for (const b of g.beam.children as THREE.Mesh[]) {
      const u = (b.material as THREE.ShaderMaterial).uniforms;
      u.uColor.value.copy(s === 'active' ? COLORS.active : COLORS.next);
    }
    g.beam.scale.setScalar(s === 'active' ? 1 : 0.55);
  }

  // ---------------------------------------------------------------- DOM
  private buildDom() {
    const ui = document.getElementById('ui')!;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
      <div id="ghud" class="glass"><div id="gnum">TOR 1 / ${GATE_COUNT}</div><div id="gtime">00:00.0</div></div>
      <div id="gbar"><i></i></div>
      <div id="gmark"><div class="ring"><span id="gmarkn">1</span></div><div class="arrow"></div><div id="gmarkd"></div></div>
      <div id="gtoast"></div>
      <div id="gflash"></div>
      <div id="gcount"></div>
      <div id="gstart" class="goverlay"><div class="gcard glass">
        <div class="gtitle">UTOPIA <b>CHALLENGE</b></div>
        <p>Fliege durch alle <b>${GATE_COUNT} Tore</b> – in der richtigen Reihenfolge. Die Strecke führt über die Skyline, zwischen Türmen hindurch, tief in Straßenschluchten und knapp über Parks.</p>
        <ul>
          <li><i class="d gold"></i>Goldene Lichtsäule = aktuelles Tor, blaue = das danach</li>
          <li><i class="d cyan"></i>Leuchtspur und Hologramm-Schilder zeigen den Weg</li>
          <li><i class="d white"></i>Kompass am Bildrand zeigt Richtung, Distanz und Höhe</li>
          <li><i class="d red"></i>Verflogen? ↺ bringt dich zum letzten Tor (+5 s)</li>
        </ul>
        <div class="gbest" id="gbest"></div>
        <button id="gstartbtn">Start</button>
      </div></div>
      <div id="gwin" class="goverlay"><div class="gcard glass">
        <div class="gtitle">GESCHAFFT</div>
        <div class="gbig" id="gwintime"></div>
        <div id="gwininfo"></div>
        <div class="gsplits" id="gsplits"></div>
        <div class="gbtns"><button id="gagain">Nochmal</button><button id="gnew">Neue Strecke</button><button id="gfree" class="sec">Frei fliegen</button></div>
      </div></div>`;
    ui.appendChild(wrap);
    for (const id of ['ghud', 'gnum', 'gtime', 'gbar', 'gmark', 'gmarkn', 'gmarkd', 'gtoast', 'gflash', 'gcount', 'gstart', 'gbest', 'gwin', 'gwintime', 'gwininfo', 'gsplits']) this.dom[id] = document.getElementById(id)!;
    const tap = (id: string, fn: () => void) => document.getElementById(id)!.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.sfx.unlock(); fn(); });
    tap('gstartbtn', () => this.begin());
    tap('gagain', () => { this.reset(); this.begin(); });
    tap('gnew', () => this.hooks.newRoute());
    tap('gfree', () => { this.dom.gwin.classList.remove('show'); this.hooks.setPaused(false); });
  }

  private fmt(t: number) {
    const m = Math.floor(t / 60), s = t - m * 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
  }

  private toast(html: string, ms = 1600) {
    const t = this.dom.gtoast;
    t.innerHTML = html;
    t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
    clearTimeout((t as unknown as { _h: number })._h);
    (t as unknown as { _h: number })._h = window.setTimeout(() => t.classList.remove('show'), ms);
  }

  // ---------------------------------------------------------------- flow
  reset() {
    this.current = 0; this.time = 0; this.penalty = 0; this.running = false; this.finished = false; this.ghostUsed = false; this.countdown = -1;
    for (const g of this.gates) { g.split = undefined; this.setState(g, 'idle'); }
    this.activate(0);
    const s = this.startPos, g1 = this.gates[0];
    const hd = Math.hypot(g1.x - s.x, g1.z - s.z);
    this.hooks.teleport(s.x, s.y, s.z, Math.atan2(-(g1.x - s.x), -(g1.z - s.z)), Math.max(-0.5, Math.min(0.5, Math.atan2(g1.y - s.y, hd))));
    this.hooks.setPaused(true);
    this.dom.gwin.classList.remove('show');
    this.dom.gstart.classList.add('show');
    let best: string | null = null;
    try { best = localStorage.getItem(this.seedKey); } catch { /* private mode */ }
    this.dom.gbest.textContent = best ? `Bestzeit auf dieser Strecke: ${this.fmt(parseFloat(best))}` : '';
    this.updateHud();
  }

  /** test hook */
  skipCountdown() { this.countdown = 0.001; }

  begin() {
    this.dom.gstart.classList.remove('show');
    this.dom.gwin.classList.remove('show');
    this.countdown = 3.0;
    this.sfx.count(false);
  }

  private activate(k: number) {
    this.current = k;
    this.gates.forEach((g, i) => { if (g.state !== 'passed') this.setState(g, i === k ? 'active' : i === k + 1 ? 'next' : 'idle'); });
    this.buildSigns();
    this.buildTrail();
  }

  private prevPoint(): THREE.Vector3 {
    const p = this.current > 0 ? this.gates[this.current - 1] : null;
    return p ? new THREE.Vector3(p.x, p.y, p.z) : new THREE.Vector3(this.startPos.x, this.startPos.y, this.startPos.z);
  }

  private buildSigns() {
    for (const s of this.signs) { this.group.remove(s); (s.material as THREE.MeshBasicMaterial).map?.dispose(); (s.material as THREE.Material).dispose(); }
    this.signs = [];
    const g = this.gates[this.current];
    if (!g) return;
    const a = this.prevPoint(), b = new THREE.Vector3(g.x, g.y, g.z);
    const dir = b.clone().sub(a); dir.y = 0;
    const len = dir.length();
    if (len < 200) return;
    dir.normalize();
    const right = new THREE.Vector3(-dir.z, 0, dir.x);
    for (const t of [0.3, 0.62]) {
      const base = a.clone().lerp(b, t);
      for (const side of [1, -1]) {
        const p = base.clone().addScaledVector(right, side * 34);
        p.y = Math.max(p.y, 14) + 6;
        if (!this.route.clear(p.x, p.y, p.z, 14, 8, 3)) continue;
        const to = b.clone().sub(p);
        const ang = Math.atan2(to.dot(right), to.clone().setY(0).dot(dir));
        const tex = signTexture(g.i, ang, to.length(), b.y - p.y);
        const m = new THREE.Mesh(new THREE.PlaneGeometry(26, 13), new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, toneMapped: false }));
        m.position.copy(p);
        m.rotation.y = Math.atan2(-dir.x, -dir.z); // faces the arriving pilot
        m.userData.world = p.clone();
        this.group.add(m);
        this.signs.push(m);
        break;
      }
    }
  }

  private buildTrail() {
    this.trailPts = [];
    const g = this.gates[this.current];
    if (!g) { this.trail.count = 0; return; }
    const a = this.prevPoint(), b = new THREE.Vector3(g.x, g.y, g.z);
    const len = a.distanceTo(b);
    const n = Math.min(119, Math.floor(len / 20));
    for (let k = 1; k < n; k++) {
      const p = a.clone().lerp(b, k / n);
      if (!this.route.clear(p.x, p.y, p.z, 1, 1, 2)) continue;
      this.trailPts.push(p);
    }
  }

  respawn() {
    if (!this.running) return;
    const p = this.prevPoint();
    const g = this.gates[this.current];
    const yaw = Math.atan2(-(g.x - p.x), -(g.z - p.z));
    const pitch = Math.atan2(g.y - p.y, Math.hypot(g.x - p.x, g.z - p.z));
    // stand a little behind the last gate
    const back = this.current > 0 ? 30 : 0;
    this.hooks.teleport(p.x + Math.sin(yaw) * back, p.y, p.z + Math.cos(yaw) * back, yaw, Math.max(-0.6, Math.min(0.6, pitch)));
    this.penalty += 5;
    this.toast('↺ Zurück zum letzten Tor <span class="pen">+5 s</span>');
  }

  private pass(k: number) {
    const g = this.gates[k];
    g.split = this.time + this.penalty;
    this.setState(g, 'passed');
    this.burst(g);
    this.dom.gflash.classList.remove('on'); void this.dom.gflash.offsetWidth; this.dom.gflash.classList.add('on');
    if (k === this.gates.length - 1) { this.finish(); return; }
    const prevSplit = k ? this.gates[k - 1].split! : 0;
    if ((k + 1) % 10 === 0) { this.sfx.checkpoint(); this.toast(`<b>Checkpoint ${k + 1}/${GATE_COUNT}</b> · ${this.fmt(g.split)}`, 2200); }
    else { this.sfx.gate(k); this.toast(`<b>Tor ${g.i}</b> ✓ <span class="split">+${(g.split - prevSplit).toFixed(1)} s</span> · nächstes: ${GATE_LABEL[this.gates[k + 1].type]}`); }
    this.activate(k + 1);
  }

  private burst(g: Gate) {
    const mat = new THREE.MeshBasicMaterial({ color: COLORS.passed, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const m = new THREE.Mesh(g.frame.geometry, mat);
    m.position.set(g.x, g.y, g.z);
    m.rotation.y = g.group.rotation.y;
    m.userData.world = new THREE.Vector3(g.x, g.y, g.z);
    this.group.add(m);
    this.bursts.push({ mesh: m, t: 0 });
  }

  private finish() {
    this.running = false; this.finished = true;
    this.sfx.win();
    const total = this.time + this.penalty;
    this.hooks.setPaused(true);
    let best = Infinity;
    try { best = parseFloat(localStorage.getItem(this.seedKey) ?? 'Infinity'); } catch { /* */ }
    const valid = !this.ghostUsed;
    const record = valid && total < best;
    if (record) { try { localStorage.setItem(this.seedKey, String(total)); } catch { /* */ } }
    this.dom.gwintime.textContent = this.fmt(total);
    this.dom.gwininfo.innerHTML = `Alle ${GATE_COUNT} Tore${this.penalty ? ` · inkl. ${this.penalty} s Strafzeit` : ''}<br>` +
      (!valid ? 'Ghost-Modus genutzt – keine Bestzeit-Wertung' : record ? '<b class="rec">Neue Bestzeit!</b>' : isFinite(best) ? `Bestzeit: ${this.fmt(best)}` : '');
    this.dom.gsplits.innerHTML = this.gates.map((g, i) => `<span><em>${i + 1}</em>${this.fmt(g.split!)}</span>`).join('');
    this.dom.gwin.classList.add('show');
    this.trail.count = 0;
    for (const s of this.signs) s.visible = false;
  }

  private updateHud() {
    const k = Math.min(this.current + 1, GATE_COUNT);
    this.dom.gnum.innerHTML = this.finished ? `<b>${GATE_COUNT}</b> / ${GATE_COUNT} ✓` : `TOR <b>${k}</b> / ${GATE_COUNT}`;
    this.dom.gtime.textContent = this.fmt(this.time + this.penalty);
    (this.dom.gbar.firstElementChild as HTMLElement).style.width = `${(this.gates.filter((g) => g.state === 'passed').length / GATE_COUNT) * 100}%`;
  }

  // ---------------------------------------------------------------- per frame
  update(dt: number, simTime: number, p0: THREE.Vector3, p1: THREE.Vector3, ox: number, oz: number, paused: boolean) {
    this.group.position.set(-ox, 0, -oz);
    // children use world coordinates; the group's offset makes them render-space
    for (const g of this.gates) {
      g.group.position.set(g.x, g.y, g.z);
      (g.membrane.material as ShaderMaterialU).uniforms.uTime.value = simTime;
      if (g.beam.visible) for (const b of g.beam.children as THREE.Mesh[]) (b.material as ShaderMaterialU).uniforms.uTime.value = simTime;
    }
    // countdown
    if (this.countdown > 0) {
      const before = Math.ceil(this.countdown);
      this.countdown -= dt;
      const after = Math.ceil(this.countdown);
      this.dom.gcount.textContent = this.countdown > 0 ? String(after) : 'LOS!';
      this.dom.gcount.classList.add('show');
      if (after !== before && this.countdown > 0) this.sfx.count(false);
      if (this.countdown <= 0) {
        this.sfx.count(true);
        this.running = true;
        this.hooks.setPaused(false);
        setTimeout(() => this.dom.gcount.classList.remove('show'), 700);
      }
    }
    if (this.running && !paused) {
      this.time += dt;
      if (!this.hooks.collisionsOn()) this.ghostUsed = true;
      // gate crossing test against the active gate (segment vs. door rectangle)
      const k = this.current;
      const crossed = (g: Gate) => {
        const s0 = (p0.x - g.x) * g.nx + (p0.z - g.z) * g.nz;
        const s1 = (p1.x - g.x) * g.nx + (p1.z - g.z) * g.nz;
        if (s0 === s1 || s0 * s1 > 0) return false;
        const t = s0 / (s0 - s1);
        const ix = p0.x + (p1.x - p0.x) * t, iy = p0.y + (p1.y - p0.y) * t, iz = p0.z + (p1.z - p0.z) * t;
        const lx = (ix - g.x) * g.nz - (iz - g.z) * g.nx;
        return Math.abs(lx) < g.w && Math.abs(iy - g.y) < g.h;
      };
      if (k < this.gates.length && crossed(this.gates[k])) this.pass(k);
      else for (let j = k + 1; j < this.gates.length; j++) if (crossed(this.gates[j])) { this.sfx.wrong(); this.toast(`Falsche Reihenfolge – erst <b>Tor ${k + 1}</b>!`); break; }
    }
    // pulse the active gate
    const act = this.gates[this.current];
    if (act && act.state === 'active') {
      const s = 1 + 0.035 * Math.sin(simTime * 4);
      act.frame.scale.set(s, s, 1);
    }
    // bursts
    this.bursts = this.bursts.filter((b) => {
      b.t += dt;
      const s = 1 + b.t * 2.2;
      b.mesh.scale.set(s, s, 1);
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 0.9 - b.t * 1.2);
      if (b.t > 0.8) { this.group.remove(b.mesh); (b.mesh.material as THREE.Material).dispose(); return false; }
      return true;
    });
    // trail: pulses that travel toward the gate
    const pts = this.trailOn && !this.finished ? this.trailPts : [];
    const m = new THREE.Matrix4();
    let n = 0;
    for (let i = 0; i < pts.length && n < 120; i++) {
      const w = Math.max(0, Math.sin(i * 0.45 - simTime * 5));
      const s = 1.6 + 2.6 * Math.pow(w, 5);
      m.makeScale(s, s, s).setPosition(pts[i]);
      this.trail.setMatrixAt(n++, m);
    }
    this.trail.count = n;
    this.trail.instanceMatrix.needsUpdate = true;
    this.updateMarker(p1, ox, oz);
    this.updateHud();
  }

  private updateMarker(p: THREE.Vector3, ox: number, oz: number) {
    const mk = this.dom.gmark;
    const g = this.gates[this.current];
    if (!g || this.finished || this.dom.gstart.classList.contains('show')) { mk.style.display = 'none'; return; }
    mk.style.display = '';
    const rel = this.tmp.set(g.x - ox, g.y, g.z - oz);
    const camSpace = rel.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = rel.clone().project(this.camera);
    const W = window.innerWidth, H = window.innerHeight;
    const dist = Math.hypot(g.x - p.x, g.y - p.y, g.z - p.z);
    const dy = g.y - p.y;
    this.dom.gmarkn.textContent = String(g.i);
    this.dom.gmarkd.innerHTML = `${dist >= 1000 ? (dist / 1000).toFixed(1) + ' km' : Math.round(dist) + ' m'}${Math.abs(dy) > 25 ? ` <span>${dy > 0 ? '▲' : '▼'} ${Math.round(Math.abs(dy))}</span>` : ''}`;
    const inFront = camSpace.z < 0;
    const onScreen = inFront && Math.abs(ndc.x) < 0.9 && Math.abs(ndc.y) < 0.82;
    let x: number, y: number;
    if (onScreen) {
      x = (ndc.x * 0.5 + 0.5) * W; y = (-ndc.y * 0.5 + 0.5) * H;
      mk.classList.remove('edge');
    } else {
      let ax = camSpace.x, ay = camSpace.y;
      if (!inFront && Math.hypot(ax, ay) < 1e-3) ay = -1;
      const ang = Math.atan2(-ay, ax);
      const rx = W * 0.42, ry = H * 0.38;
      x = W / 2 + Math.cos(ang) * rx; y = H / 2 + Math.sin(ang) * ry;
      mk.classList.add('edge');
      (mk.querySelector('.arrow') as HTMLElement).style.transform = `rotate(${ang}rad)`;
    }
    mk.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  }

  dispose() {
    this.group.removeFromParent();
    this.group.traverse((o) => { const m = o as THREE.Mesh; if (m.geometry && m.geometry !== this.beamGeo) m.geometry.dispose(); const mat = m.material as THREE.Material | undefined; if (mat) { (mat as THREE.SpriteMaterial).map?.dispose(); mat.dispose(); } });
    this.beamGeo.dispose();
    document.getElementById('ghud')?.parentElement?.remove();
  }
}

type ShaderMaterialU = THREE.ShaderMaterial;
