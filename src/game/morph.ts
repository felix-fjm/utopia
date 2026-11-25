/**
 * "Verwandlung" mode: fly into a parked car to drive it, land on a frog to become the frog,
 * and touch one of the glowing orbs on the ground to turn back into the free-flying camera.
 */
import * as THREE from 'three';
import { Flight } from '../controls/flight';
import { patchMaterial } from '../world/shared';
import { CELL, CellContent, CarSpot, FrogSpot, OrbSpot, carGeometries, frogGeometries, frogPose, CAR_COLORS } from './creatures';

/** What the morph game needs from a world (procedural city or real Google 3D city). */
export interface MorphWorld {
  /** push a sphere at (wx,y,wz) out of geometry; returns corrected position and whether it hit */
  collide(wx: number, y: number, wz: number, margin: number): [number, number, number, boolean];
  /** height of the highest walkable surface below maxY at (wx,wz) */
  surfaceAt(wx: number, wz: number, maxY: number): number;
  /** cars / frogs / orbs of a streaming cell (null = not available yet) */
  cell(cx: number, cz: number): CellContent | null;
  /** ground height for an entity, null while unknown (e.g. tiles not loaded yet) */
  groundY(x: number, z: number): number | null;
  /** optional car-specific collision (only real walls block) */
  carCollide?(wx: number, groundY: number, wz: number, margin: number): [number, number, boolean];
  /** optional car road height that ignores small clutter above the wheels */
  carGround?(wx: number, wz: number, y: number): number | null;
}

export interface MorphConfig {
  /** frog take-off speed from slider 0..1 */
  jump: (v: number) => number;
  /** override frog size (m per model unit); undefined = per-frog value */
  frogScale?: number;
  /** minimum capture radius around a frog when flying into it */
  frogCatch: number;
  /** camera near plane per mode */
  near: { fly: number; car: number; frog: number };
}

export type MorphMode = 'fly' | 'car' | 'frog';

const G = 22;                 // gravity for the frog (game feel)
const CAR_R = 2.3;            // car collision radius
const ORB_R = 3.8;
const ORB_Y = 4.0;
export const carMaxFromSlider = (v: number) => 8 + 72 * v;            // m/s
export const jumpFromSlider = (v: number) => 5 + 105 * Math.pow(v, 1.3); // m/s take-off speed
export const DEFAULT_MORPH_CONFIG: MorphConfig = { jump: jumpFromSlider, frogCatch: 0, near: { fly: 1, car: 1, frog: 1 } };
export const jumpHeight = (j: number) => (j * j) / (2 * G);

const orbVert = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vSeed;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vSeed = instanceMatrix[3].x * 0.013 + instanceMatrix[3].z * 0.007;
  vec4 mv = viewMatrix * wp;
  vN = normalize(mat3(viewMatrix) * mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const orbFrag = /* glsl */ `
uniform float uTime;
varying vec3 vN; varying vec3 vV; varying vec3 vW; varying float vSeed;
vec3 hue(float h) { return clamp(abs(fract(h + vec3(0.0, 0.333, 0.667)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main() {
  float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  float fres = pow(f, 2.2);
  float t = uTime;
  float swirl = sin(vW.y * 2.3 + t * 3.1 + sin(vW.x * 0.9 + t * 1.7) * 2.2 + cos(vW.z * 0.8 - t * 1.3) * 2.0);
  float bands = smoothstep(0.55, 1.0, swirl);
  float sparks = smoothstep(0.92, 1.0, sin(vW.x * 5.1 + t * 7.0) * sin(vW.z * 4.7 - t * 6.0) * sin(vW.y * 6.3 + t * 5.0) * 0.5 + 0.5);
  vec3 c1 = hue(fract(vSeed + t * 0.07));
  vec3 c2 = hue(fract(vSeed + 0.45 + t * 0.05));
  vec3 col = mix(c1, c2, 0.5 + 0.5 * swirl) * (0.6 + 1.6 * fres) + vec3(1.0) * (bands * 0.5 + sparks * 1.4);
  float a = clamp(0.1 + fres * 0.85 + bands * 0.3 + sparks * 0.6, 0.0, 1.0);
  gl_FragColor = vec4(col * 1.4, a);
}`;
const beamFrag = /* glsl */ `
uniform float uTime; varying vec2 vUv;
void main() { float fade = pow(1.0 - vUv.y, 1.6); float p = 0.65 + 0.35 * sin(uTime * 4.0 - vUv.y * 20.0);
  gl_FragColor = vec4(vec3(0.85, 0.55, 1.0) * 1.5, fade * p * 0.45); }`;

class Audio {
  ctx: AudioContext | null = null;
  private eng: { o: OscillatorNode; o2: OscillatorNode; g: GainNode; f: BiquadFilterNode } | null = null;
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    try { this.ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)(); } catch { this.ctx = null; }
  }
  private glide(f0: number, f1: number, dur: number, gain: number, type: OscillatorType = 'sine', delay = 0) {
    const c = this.ctx; if (!c) return;
    const o = c.createOscillator(), g = c.createGain();
    const t0 = c.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  morph(to: MorphMode) {
    if (to === 'fly') { this.glide(300, 1400, 0.6, 0.09, 'triangle'); this.glide(450, 2100, 0.6, 0.05, 'sine', 0.05); }
    else if (to === 'car') { this.glide(900, 160, 0.45, 0.1, 'sawtooth'); }
    else { this.glide(1200, 260, 0.35, 0.1, 'square'); this.glide(260, 520, 0.2, 0.08, 'sine', 0.3); }
  }
  boing(strength: number) { this.glide(160 + strength * 2, 520 + strength * 6, 0.28, 0.09); }
  thud() { this.glide(140, 60, 0.18, 0.12, 'sine'); }
  crash() { this.glide(220, 50, 0.3, 0.12, 'sawtooth'); }
  engine(on: boolean) {
    const c = this.ctx; if (!c) return;
    if (on && !this.eng) {
      const o = c.createOscillator(), o2 = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
      o.type = 'sawtooth'; o2.type = 'square'; f.type = 'lowpass'; f.frequency.value = 500;
      g.gain.value = 0.0001;
      o.connect(f); o2.connect(f); f.connect(g).connect(c.destination);
      o.start(); o2.start();
      this.eng = { o, o2, g, f };
    } else if (!on && this.eng) {
      const e = this.eng; this.eng = null;
      e.g.gain.setTargetAtTime(0.0001, c.currentTime, 0.08);
      setTimeout(() => { try { e.o.stop(); e.o2.stop(); } catch { /* */ } }, 400);
    }
  }
  engineLevel(speed: number, throttle: number) {
    const c = this.ctx, e = this.eng; if (!c || !e) return;
    const f = 38 + speed * 2.2;
    e.o.frequency.setTargetAtTime(f, c.currentTime, 0.05);
    e.o2.frequency.setTargetAtTime(f * 0.5, c.currentTime, 0.05);
    e.f.frequency.setTargetAtTime(300 + speed * 25 + throttle * 400, c.currentTime, 0.05);
    e.g.gain.setTargetAtTime(0.025 + Math.min(0.03, speed * 0.0006) + throttle * 0.01, c.currentTime, 0.08);
  }
}

export interface MorphHooks {
  onMode(mode: MorphMode): void;
}

export class Morph {
  readonly group = new THREE.Group();
  mode: MorphMode = 'fly';
  slider = { car: 0.35, frog: 0.3 };
  private cells = new Map<string, CellContent>();
  private taken = new Set<number>();
  private droppedCars: CarSpot[] = [];
  private droppedFrogs: FrogSpot[] = [];
  private nextId = 1;
  private cellKey = '';
  private carsDirty = true;
  // instanced world objects
  private carParts: THREE.InstancedMesh[];
  private carBody: THREE.InstancedMesh;
  private frogBody: THREE.InstancedMesh;
  private frogSpots: THREE.InstancedMesh;
  private orbMesh: THREE.InstancedMesh;
  private orbBeam: THREE.InstancedMesh;
  private orbRing: THREE.InstancedMesh;
  private orbMat: THREE.ShaderMaterial;
  private beamMat: THREE.ShaderMaterial;
  // player avatars
  private carAvatar = new THREE.Group();
  private carAvatarBody: THREE.Mesh;
  private frogAvatar = new THREE.Group();
  private frogAvatarScale = 2.2;
  // state
  car = { x: 0, y: 0, z: 0, h: 0, v: 0, steer: 0, crash: 0 };
  frog = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, h: 0, grounded: true, hopCd: 0, squash: 0, jumpHeld: false };
  private cooldown = 0;
  private visibleOrbs: OrbSpot[] = [];
  private resolveT = 0;
  private cellsMissing = false;
  private visibleCars: CarSpot[] = [];
  private visibleFrogs: { f: FrogSpot; x: number; y: number; z: number; h: number }[] = [];
  private audio = new Audio();
  private dom: Record<string, HTMLElement> = {};
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v3 = new THREE.Vector3();
  private s3 = new THREE.Vector3();
  private up = new THREE.Vector3(0, 1, 0);
  private pose = { x: 0, y: 0, z: 0, h: 0, air: 0 };
  stats = { cars: 0, frogs: 0, orbs: 0, cells: 0 };

  constructor(public seed: number, private camera: THREE.PerspectiveCamera, private flight: Flight, private world: MorphWorld, private hooks: MorphHooks, readonly cfg: MorphConfig = DEFAULT_MORPH_CONFIG) {
    this.group.name = 'morph';
    const cg = carGeometries();
    const carMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#ffffff', metalness: 0.75, roughness: 0.28, envMapIntensity: 1.3 }));
    const glassMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#0d141c', metalness: 0.9, roughness: 0.08, envMapIntensity: 1.6 }));
    const wheelMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#141414', metalness: 0.3, roughness: 0.7 }));
    const lightMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    const CAP = 800;
    const mk = (g: THREE.BufferGeometry, mat: THREE.Material, cap: number, shadow = false) => {
      const im = new THREE.InstancedMesh(g, mat, cap);
      im.frustumCulled = false; im.count = 0; im.castShadow = shadow; im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im); return im;
    };
    this.carBody = mk(cg.body, carMat, CAP, true);
    this.carBody.setColorAt(0, new THREE.Color());
    this.carParts = [this.carBody, mk(cg.glass, glassMat, CAP), mk(cg.wheels, wheelMat, CAP), mk(cg.lights, lightMat, CAP)];
    for (const p of this.carParts.slice(1)) p.instanceMatrix = this.carBody.instanceMatrix;

    const fg = frogGeometries();
    const frogMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 }));
    const spotMat = new THREE.MeshBasicMaterial({ color: '#7dffe0', toneMapped: false });
    this.frogBody = mk(fg.body, frogMat, 400, true);
    this.frogSpots = mk(fg.spots, spotMat, 400);
    this.frogSpots.instanceMatrix = this.frogBody.instanceMatrix;

    this.orbMat = new THREE.ShaderMaterial({ vertexShader: orbVert, fragmentShader: orbFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: { uTime: { value: 0 } } });
    this.orbMesh = mk(new THREE.IcosahedronGeometry(1, 4), this.orbMat, 300);
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }',
      fragmentShader: beamFrag, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, uniforms: { uTime: { value: 0 } },
    });
    const bg = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true); bg.translate(0, 0.5, 0);
    this.orbBeam = mk(bg, this.beamMat, 300);
    const rg = new THREE.RingGeometry(1, 1.35, 48); rg.rotateX(-Math.PI / 2);
    this.orbRing = mk(rg, new THREE.MeshBasicMaterial({ color: '#d98bff', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), 300);

    // avatars
    this.carAvatarBody = new THREE.Mesh(cg.body, carMat.clone());
    patchMaterial(this.carAvatarBody.material as THREE.MeshStandardMaterial);
    this.carAvatar.add(this.carAvatarBody, new THREE.Mesh(cg.glass, glassMat), new THREE.Mesh(cg.wheels, wheelMat), new THREE.Mesh(cg.lights, lightMat));
    this.carAvatarBody.castShadow = true;
    this.carAvatar.visible = false;
    this.frogAvatar.add(new THREE.Mesh(fg.body, frogMat), new THREE.Mesh(fg.spots, spotMat));
    this.frogAvatar.visible = false;
    this.group.add(this.carAvatar, this.frogAvatar);

    this.buildDom();
    window.addEventListener('pointerdown', () => this.audio.unlock(), { capture: true });
    window.addEventListener('keydown', () => this.audio.unlock(), { capture: true });
  }

  setSeed(seed: number) {
    this.seed = seed; this.cells.clear(); this.taken.clear(); this.droppedCars = []; this.droppedFrogs = []; this.carsDirty = true; this.cellKey = '';
    if (this.mode !== 'fly') this.toFlyAt(this.flight.camera.position.x, 30, this.flight.camera.position.z, 0, 0, true);
  }

  // ---------------------------------------------------------------- DOM
  private buildDom() {
    const ui = document.getElementById('ui')!;
    const wrap = document.createElement('div');
    wrap.id = 'morphui';
    wrap.innerHTML = `
      <div id="mmode" class="glass"><b id="mmodet">FLUGMODUS</b><span id="mmodeh"></span></div>
      <div id="mflash"></div>
      <div class="mmk" id="mk-car"><i></i><span></span></div>
      <div class="mmk" id="mk-frog"><i></i><span></span></div>
      <div class="mmk orb" id="mk-orb"><i></i><div class="arrow"></div><span></span></div>`;
    ui.appendChild(wrap);
    for (const id of ['mmode', 'mmodet', 'mmodeh', 'mflash', 'mk-car', 'mk-frog', 'mk-orb']) this.dom[id] = document.getElementById(id)!;
    this.updateModeUI();
  }

  private updateModeUI() {
    const ui = document.getElementById('ui')!;
    ui.classList.toggle('m-car', this.mode === 'car');
    ui.classList.toggle('m-frog', this.mode === 'frog');
    const t = this.dom.mmodet, h = this.dom.mmodeh;
    if (this.mode === 'fly') { t.textContent = 'FLUGMODUS'; h.textContent = 'Flieg in ein Auto oder auf einen Frosch'; }
    if (this.mode === 'car') { t.textContent = 'AUTO'; h.textContent = 'Fahr in eine leuchtende Kugel, um wieder zu fliegen'; }
    if (this.mode === 'frog') { t.textContent = 'FROSCH'; h.textContent = '▲ = Springen · Spring in eine leuchtende Kugel, um wieder zu fliegen'; }
    this.dom.mmode.dataset.mode = this.mode;
  }

  private flash() {
    const f = this.dom.mflash;
    f.dataset.mode = this.mode;
    f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  }

  // ---------------------------------------------------------------- transitions
  private setMode(m: MorphMode) {
    this.mode = m;
    this.cooldown = 1.2;
    this.carAvatar.visible = m === 'car';
    this.frogAvatar.visible = m === 'frog';
    this.audio.engine(m === 'car');
    this.audio.morph(m);
    this.carsDirty = true;
    this.updateModeUI();
    this.flash();
    this.applyNear();
    this.hooks.onMode(m);
  }

  private applyNear() {
    const n = this.cfg.near[this.mode];
    if (this.camera.near !== n) { this.camera.near = n; this.camera.updateProjectionMatrix(); }
  }

  private enterCar(c: CarSpot, fromDropped: boolean) {
    if (fromDropped) this.droppedCars = this.droppedCars.filter((d) => d !== c);
    else this.taken.add(c.id);
    Object.assign(this.car, { x: c.x, y: c.y ?? 0, z: c.z, h: c.h, v: 0, steer: 0, crash: 0 });
    (this.carAvatarBody.material as THREE.MeshStandardMaterial).color.copy(CAR_COLORS[c.color]);
    this.carColor = c.color;
    this.flight.yaw = this.flight.yawT = c.h;
    this.flight.pitch = this.flight.pitchT = -0.22;
    this.setMode('car');
  }
  private carColor = 0;

  private enterFrog(f: FrogSpot, fromDropped: boolean, x: number, y: number, z: number, h: number) {
    if (fromDropped) this.droppedFrogs = this.droppedFrogs.filter((d) => d !== f);
    else this.taken.add(f.id);
    Object.assign(this.frog, { x, y, z, vx: 0, vy: 0, vz: 0, h, grounded: y < 0.05, hopCd: 0.3, squash: 0, jumpHeld: true });
    this.frogAvatarScale = this.cfg.frogScale ?? f.scale;
    this.flight.yaw = this.flight.yawT = h;
    this.flight.pitch = this.flight.pitchT = -0.3;
    this.setMode('frog');
  }

  /** leave the avatar where it is and become the flying camera again */
  private toFlyAt(rx: number, y: number, rz: number, ox: number, oz: number, silent = false) {
    if (this.mode === 'car') this.droppedCars.push({ id: -(this.nextId++), x: this.car.x, y: this.car.y, z: this.car.z, h: this.car.h, color: this.carColor });
    if (this.mode === 'frog') this.droppedFrogs.push({ id: -(this.nextId++), x: this.frog.x, y: this.frog.y, z: this.frog.z, period: 3, phase: 0, range: 0.01, scale: this.frogAvatarScale });
    this.flight.setPose(rx, y, rz, this.flight.yaw, -0.15);
    void ox; void oz;
    if (!silent) this.setMode('fly');
    else { this.mode = 'fly'; this.carAvatar.visible = this.frogAvatar.visible = false; this.audio.engine(false); this.updateModeUI(); this.applyNear(); this.hooks.onMode('fly'); }
  }

  /** back to flying immediately (reset / new city) */
  forceFly() { if (this.mode !== 'fly') this.toFlyAt(this.camera.position.x, Math.max(30, this.camera.position.y), this.camera.position.z, 0, 0, true); }

  // ---------------------------------------------------------------- world queries
  private surfaceAt(wx: number, wz: number, maxY: number): number { return this.world.surfaceAt(wx, wz, maxY); }

  private collide(wx: number, y: number, wz: number, _ox: number, _oz: number, margin: number): [number, number, number, boolean] {
    return this.world.collide(wx, y, wz, margin);
  }

  /** resolve (and cache) the ground height of a spawned object */
  private yOf(e: { x: number; z: number; y?: number }): number | null {
    if (e.y !== undefined) return e.y;
    const g = this.world.groundY(e.x, e.z);
    if (g !== null) e.y = g;
    return g;
  }

  // ---------------------------------------------------------------- per frame
  /** Drives the avatar + camera when not flying. Returns false in fly mode. */
  drive(dt: number, ox: number, oz: number, paused: boolean): boolean {
    if (this.mode === 'fly') return false;
    const inp = this.flight.input;
    if (this.mode === 'car') {
      const c = this.car;
      if (!paused) {
        const max = carMaxFromSlider(this.slider.car) * (inp.boost ? 1.6 : 1);
        const thr = inp.y;
        if (thr > 0.05) c.v += (c.v < 0 ? 30 : 13) * thr * dt * (1 - Math.max(0, c.v) / max);
        else if (thr < -0.05) c.v += (c.v > 0 ? -30 : -9) * -thr * dt;
        else c.v -= Math.sign(c.v) * Math.min(Math.abs(c.v), (2.5 + Math.abs(c.v) * 0.08) * dt);
        c.v = THREE.MathUtils.clamp(c.v, -14, max * 1.02);
        c.steer += (inp.x - c.steer) * (1 - Math.exp(-6 * dt));
        const steerAng = c.steer * (0.55 - Math.min(0.35, Math.abs(c.v) * 0.004));
        // kinematic bicycle model, capped by max lateral acceleration (arcade-stable at speed)
        const kin = (c.v / 2.9) * Math.tan(steerAng);
        const cap = 11 / Math.max(Math.abs(c.v), 1.5);
        c.h -= Math.sign(kin) * Math.min(Math.abs(kin), cap) * dt;
        const steps = Math.max(1, Math.ceil(Math.abs(c.v) * dt / 3));
        let hit = false;
        for (let s = 0; s < steps; s++) {
          c.x += -Math.sin(c.h) * c.v * dt / steps;
          c.z += -Math.cos(c.h) * c.v * dt / steps;
          if (this.world.carCollide) {
            const r = this.world.carCollide(c.x, c.y, c.z, CAR_R);
            if (r[2]) { c.x = r[0]; c.z = r[1]; hit = true; }
          } else {
            const r = this.collide(c.x, c.y + 1, c.z, ox, oz, CAR_R);
            if (r[3]) { c.x = r[0]; c.z = r[2]; hit = true; }
          }
          // follow the road surface (ramps, hills); never climb onto walls or clutter
          const gy = this.world.carGround ? (this.world.carGround(c.x, c.z, c.y) ?? c.y) : this.surfaceAt(c.x, c.z, c.y + 1.4);
          c.y += (gy - c.y) * (gy > c.y ? 1 : Math.min(1, 6 * dt / steps));
        }
        if (hit && Math.abs(c.v) > 6) { c.v *= -0.25; c.crash = 0.5; this.audio.crash(); }
        else if (hit) c.v *= 0.6;
        c.crash = Math.max(0, c.crash - dt);
        this.audio.engineLevel(Math.abs(c.v), Math.max(0, thr));
        // camera follows the heading when the user isn't looking around
        if (performance.now() - this.flight.lastLook > 1400 && Math.abs(c.v) > 1) {
          let d = c.h - this.flight.yawT; d = Math.atan2(Math.sin(d), Math.cos(d));
          this.flight.yawT += d * (1 - Math.exp(-2.2 * dt));
          this.flight.pitchT += (-0.2 - this.flight.pitchT) * (1 - Math.exp(-1.5 * dt));
        }
      }
      this.flight.updateLook(dt, -1.3, 0.35);
      this.carAvatar.position.set(c.x, c.y, c.z);
      this.carAvatar.rotation.set(0, c.h, 0);
      this.carAvatar.rotateZ(-c.steer * Math.min(1, Math.abs(c.v) / 30) * 0.05);
      this.placeCamera(c.x, c.y + 1.6, c.z, 9 + Math.min(10, Math.abs(c.v) * 0.12), ox, oz);
      return true;
    }
    // ---- frog
    const f = this.frog;
    if (!paused) {
      const fwdX = -Math.sin(this.flight.yaw), fwdZ = -Math.cos(this.flight.yaw);
      const rX = Math.cos(this.flight.yaw), rZ = -Math.sin(this.flight.yaw);
      let dx = fwdX * inp.y + rX * inp.x, dz = fwdZ * inp.y + rZ * inp.x;
      const mag = Math.min(1, Math.hypot(dx, dz));
      const dl = Math.hypot(dx, dz);
      if (dl > 0.01) { dx /= dl; dz /= dl; }
      const want = inp.v > 0.5;
      if (f.grounded) {
        f.hopCd -= dt;
        if (mag > 0.12) {
          let d = Math.atan2(-dx, -dz) - f.h; d = Math.atan2(Math.sin(d), Math.cos(d));
          f.h += d * (1 - Math.exp(-10 * dt));
        }
        if (want && !f.jumpHeld) {
          const J = this.cfg.jump(this.slider.frog);
          const fx = -Math.sin(f.h), fz = -Math.cos(f.h);
          const fwd = mag > 0.12 ? 0.5 : 0.18;
          f.vx = fx * J * fwd; f.vz = fz * J * fwd; f.vy = J;
          f.grounded = false; f.squash = -0.35;
          this.audio.boing(J);
        } else if (mag > 0.12 && f.hopCd <= 0) {
          const k = this.frogAvatarScale / 2.2;
          const hop = (5.5 + 2 * mag) * Math.max(0.4, Math.sqrt(k));
          const hs = 7 * mag * Math.max(0.2, k);
          f.vx = -Math.sin(f.h) * hs; f.vz = -Math.cos(f.h) * hs; f.vy = hop;
          f.grounded = false; f.hopCd = 0.42; f.squash = -0.2;
        }
      } else {
        // a little air control
        f.vx += dx * mag * 9 * dt; f.vz += dz * mag * 9 * dt;
      }
      f.jumpHeld = want;
      if (!f.grounded) {
        const prevY = f.y;
        f.vy -= G * dt;
        const sp = Math.hypot(f.vx, f.vy, f.vz);
        const steps = Math.max(1, Math.ceil(sp * dt / 2));
        for (let s = 0; s < steps; s++) {
          f.x += f.vx * dt / steps; f.y += f.vy * dt / steps; f.z += f.vz * dt / steps;
          const r = this.collide(f.x, f.y + 0.8, f.z, ox, oz, 1.2 * this.frogAvatarScale / 2.2);
          if (r[3]) { f.x = r[0]; f.z = r[2]; if (r[1] - 0.8 > f.y) f.y = r[1] - 0.8; f.vx *= 0.3; f.vz *= 0.3; }
        }
        const surf = this.surfaceAt(f.x, f.z, Math.max(prevY, f.y));
        if (f.y <= surf) {
          if (f.vy < -18) this.audio.thud();
          f.y = surf; f.vy = 0; f.vx = 0; f.vz = 0; f.grounded = true; f.squash = 0.35;
        }
      } else {
        // walked off a roof edge?
        const surf = this.surfaceAt(f.x, f.z, f.y);
        if (surf < f.y - 0.3) { f.grounded = false; f.vy = 0; }
      }
      f.squash *= Math.exp(-9 * dt);
      if (performance.now() - this.flight.lastLook > 1600 && mag > 0.1 && f.grounded) {
        let d = f.h - this.flight.yawT; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.flight.yawT += d * (1 - Math.exp(-1.2 * dt));
      }
    }
    this.flight.updateLook(dt, -1.35, 0.6);
    const s = this.frogAvatarScale;
    const sq = f.squash + (f.grounded ? 0 : Math.max(-0.25, Math.min(0.25, f.vy * 0.02)));
    this.frogAvatar.position.set(f.x, f.y, f.z);
    this.frogAvatar.rotation.set(f.grounded ? 0 : THREE.MathUtils.clamp(-f.vy * 0.015, -0.5, 0.5), f.h, 0);
    this.frogAvatar.scale.set(s * (1 + sq * 0.5), s * (1 - sq), s * (1 + sq * 0.5));
    this.placeCamera(f.x, f.y + 1.6 * s / 2.2, f.z, (11 + Math.min(14, Math.max(0, f.y) * 0.05)) * (s / 2.2), ox, oz);
    return true;
  }

  private placeCamera(tx: number, ty: number, tz: number, dist: number, ox: number, oz: number) {
    const cam = this.camera;
    const dir = cam.getWorldDirection(this.v3);
    const lift = Math.min(1.2, dist * 0.15);
    let cx = tx - dir.x * dist, cy = ty - dir.y * dist + lift, cz = tz - dir.z * dist;
    cy = Math.max(cy, this.surfaceAt(cx, cz, cy + 2) + Math.min(1.2, dist * 0.1));
    const r = this.collide(cx, cy, cz, ox, oz, Math.min(1.2, dist * 0.12));
    if (r[3]) { cx = r[0]; cy = r[1]; cz = r[2]; }
    cam.position.set(cx - ox, cy, cz - oz);
  }

  /** Captures, orb exits, entity streaming/animation, markers. */
  update(dt: number, t: number, ox: number, oz: number) {
    this.group.position.set(-ox, 0, -oz);
    this.orbMat.uniforms.uTime.value = t;
    this.beamMat.uniforms.uTime.value = t;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const cam = this.camera.position;
    const px = this.mode === 'car' ? this.car.x : this.mode === 'frog' ? this.frog.x : cam.x + ox;
    const pz = this.mode === 'car' ? this.car.z : this.mode === 'frog' ? this.frog.z : cam.z + oz;
    const py = this.mode === 'car' ? this.car.y + 1 : this.mode === 'frog' ? this.frog.y + 0.5 * this.frogAvatarScale : cam.y;
    // objects whose ground height was unknown become visible once it is known
    this.resolveT -= dt;
    if (this.resolveT <= 0) { this.resolveT = 0.5; if (this.unresolved()) this.carsDirty = true; }
    this.streamCells(px, pz);

    // ---- cars (static per cell set)
    if (this.carsDirty) {
      this.carsDirty = false;
      let n = 0;
      const put = (c: CarSpot) => {
        if (n >= this.carBody.instanceMatrix.count) return;
        const y = this.yOf(c);
        if (y === null) return;
        this.q.setFromAxisAngle(this.up, c.h);
        this.m.compose(this.v3.set(c.x, y, c.z), this.q, this.s3.set(1, 1, 1));
        this.carBody.setMatrixAt(n, this.m);
        this.carBody.setColorAt(n, CAR_COLORS[c.color]);
        n++;
      };
      this.visibleCars = [];
      for (const cc of this.cells.values()) for (const c of cc.cars) if (!this.taken.has(c.id) && this.yOf(c) !== null) { put(c); this.visibleCars.push(c); }
      for (const c of this.droppedCars) { put(c); this.visibleCars.push(c); }
      for (const p of this.carParts) p.count = n;
      this.carBody.instanceMatrix.needsUpdate = true;
      if (this.carBody.instanceColor) this.carBody.instanceColor.needsUpdate = true;
      this.stats.cars = n;

      // orbs
      let o = 0;
      this.visibleOrbs = [];
      for (const cc of this.cells.values()) for (const orb of cc.orbs) {
        if (o >= 300) break;
        const oy = this.yOf(orb);
        if (oy === null) continue;
        this.visibleOrbs.push(orb);
        this.m.compose(this.v3.set(orb.x, oy + ORB_Y, orb.z), this.q.identity(), this.s3.setScalar(ORB_R));
        this.orbMesh.setMatrixAt(o, this.m);
        this.m.compose(this.v3.set(orb.x, oy + ORB_Y, orb.z), this.q, this.s3.set(0.7, 90, 0.7));
        this.orbBeam.setMatrixAt(o, this.m);
        this.m.compose(this.v3.set(orb.x, oy + 0.15, orb.z), this.q, this.s3.setScalar(ORB_R * 1.2));
        this.orbRing.setMatrixAt(o, this.m);
        o++;
      }
      for (const im of [this.orbMesh, this.orbBeam, this.orbRing]) { im.count = o; im.instanceMatrix.needsUpdate = true; }
      this.stats.orbs = o;
    }
    const orbsOn = this.mode !== 'fly';
    this.orbMesh.visible = this.orbBeam.visible = this.orbRing.visible = orbsOn;
    if (orbsOn) {
      // breathing rings
      const k = 1 + 0.25 * Math.sin(t * 3);
      for (let i = 0; i < this.orbRing.count; i++) {
        const orb = this.visibleOrbs[i];
        this.m.compose(this.v3.set(orb.x, (orb.y ?? 0) + 0.15, orb.z), this.q.identity(), this.s3.setScalar(ORB_R * 1.2 * k));
        this.orbRing.setMatrixAt(i, this.m);
      }
      this.orbRing.instanceMatrix.needsUpdate = true;
    }

    // ---- frogs (animated)
    let nf = 0;
    this.visibleFrogs = [];
    const putFrog = (f: FrogSpot, x: number, y: number, z: number, h: number, air: number) => {
      if (nf >= this.frogBody.instanceMatrix.count) return;
      const sq = air > 0 ? 0.12 * air : 0;
      const sc = this.cfg.frogScale ?? f.scale;
      this.q.setFromEuler(new THREE.Euler(-air * 0.35, h, 0, 'YXZ'));
      this.m.compose(this.v3.set(x, y, z), this.q, this.s3.set(sc * (1 - sq * 0.5), sc * (1 + sq), sc * (1 - sq * 0.5)));
      this.frogBody.setMatrixAt(nf++, this.m);
      this.visibleFrogs.push({ f, x, y, z, h });
    };
    for (const cc of this.cells.values()) for (const f of cc.frogs) {
      if (this.taken.has(f.id)) continue;
      if (Math.abs(f.x - px) > 700 || Math.abs(f.z - pz) > 700) continue;
      const base = this.yOf(f);
      if (base === null) continue;
      const p = frogPose(this.scaledFrog(f), t, this.pose);
      putFrog(f, p.x, base + p.y, p.z, p.h, p.air);
    }
    for (const f of this.droppedFrogs) { const p = frogPose(f, t, this.pose); putFrog(f, p.x, (f.y ?? 0) + p.y, p.z, p.h, p.air); }
    this.frogBody.count = this.frogSpots.count = nf;
    this.frogBody.instanceMatrix.needsUpdate = true;
    this.stats.frogs = nf;

    // ---- captures
    if (this.cooldown <= 0) {
      if (this.mode === 'fly') {
        for (const c of this.visibleCars) {
          if (py - (c.y ?? 0) < 7 && py - (c.y ?? 0) > -2 && Math.hypot(c.x - px, c.z - pz) < 4.6) { this.enterCar(c, c.id < 0); break; }
        }
        if (this.mode === 'fly') for (const v of this.visibleFrogs) {
          const s = this.cfg.frogScale ?? v.f.scale;
          const r = Math.max(2.6 * s, this.cfg.frogCatch);
          if (Math.hypot(v.x - px, v.z - pz) < r && py < v.y + Math.max(r, 4) && py > v.y - 1) { this.enterFrog(v.f, v.f.id < 0, v.x, v.y, v.z, v.h); break; }
        }
      } else {
        for (const orb of this.visibleOrbs) {
          if (Math.hypot(orb.x - px, (orb.y ?? 0) + ORB_Y - py, orb.z - pz) < ORB_R + 2.2) {
            this.toFlyAt(orb.x - ox, (orb.y ?? 0) + 22, orb.z - oz, ox, oz);
            break;
          }
        }
      }
    }
    this.updateMarkers(px, py, pz, ox, oz);
  }

  private streamCells(px: number, pz: number) {
    const ccx = Math.floor(px / CELL), ccz = Math.floor(pz / CELL);
    const key = ccx + ',' + ccz;
    if (key === this.cellKey && !this.cellsMissing) return;
    this.cellKey = key;
    this.cellsMissing = false;
    const R = 4;
    const want = new Set<string>();
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const k = ccx + i + ',' + (ccz + j);
      want.add(k);
      if (!this.cells.has(k)) { const c = this.world.cell(ccx + i, ccz + j); if (c) { this.cells.set(k, c); this.carsDirty = true; } else this.cellsMissing = true; }
    }
    for (const k of this.cells.keys()) if (!want.has(k)) this.cells.delete(k);
    // forget "taken" ids of cells that are gone (they respawn when you come back)
    if (this.taken.size > 200) this.taken.clear();
    this.droppedCars = this.droppedCars.filter((c) => Math.hypot(c.x - px, c.z - pz) < 2500);
    this.droppedFrogs = this.droppedFrogs.filter((f) => Math.hypot(f.x - px, f.z - pz) < 2500);
    this.stats.cells = this.cells.size;
    this.carsDirty = true;
  }

  private marker(el: HTMLElement, wx: number, wy: number, wz: number, ox: number, oz: number, label: string, edge: boolean): boolean {
    const rel = this.v3.set(wx - ox, wy, wz - oz);
    const cs = rel.clone().applyMatrix4(this.camera.matrixWorldInverse);
    const ndc = rel.clone().project(this.camera);
    const W = window.innerWidth, H = window.innerHeight;
    const inFront = cs.z < 0;
    const on = inFront && Math.abs(ndc.x) < 0.92 && Math.abs(ndc.y) < 0.85;
    if (!on && !edge) { el.style.display = 'none'; return false; }
    el.style.display = '';
    (el.querySelector('span') as HTMLElement).textContent = label;
    let x: number, y: number;
    if (on) { x = (ndc.x * 0.5 + 0.5) * W; y = (-ndc.y * 0.5 + 0.5) * H; el.classList.remove('edge'); }
    else {
      const ang = Math.atan2(-cs.y, cs.x);
      x = W / 2 + Math.cos(ang) * W * 0.4; y = H / 2 + Math.sin(ang) * H * 0.36;
      el.classList.add('edge');
      const a = el.querySelector('.arrow') as HTMLElement | null;
      if (a) a.style.transform = `rotate(${ang}rad)`;
    }
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    return true;
  }

  private updateMarkers(px: number, py: number, pz: number, ox: number, oz: number) {
    const fmt = (d: number) => (d >= 1000 ? (d / 1000).toFixed(1) + ' km' : Math.round(d) + ' m');
    const hide = (id: string) => (this.dom[id].style.display = 'none');
    if (this.mode === 'fly') {
      hide('mk-orb');
      let best: CarSpot | null = null, bd = 450;
      for (const c of this.visibleCars) { const d = Math.hypot(c.x - px, c.z - pz, py - (c.y ?? 0)); if (d < bd) { bd = d; best = c; } }
      if (best) this.marker(this.dom['mk-car'], best.x, (best.y ?? 0) + 3, best.z, ox, oz, `AUTO · ${fmt(bd)}`, false); else hide('mk-car');
      let bf: (typeof this.visibleFrogs)[0] | null = null, fd = 600;
      for (const v of this.visibleFrogs) { const d = Math.hypot(v.x - px, v.z - pz, py - v.y); if (d < fd) { fd = d; bf = v; } }
      if (bf) this.marker(this.dom['mk-frog'], bf.x, bf.y + Math.max(0.6, 2 * (this.cfg.frogScale ?? 2)), bf.z, ox, oz, `FROSCH · ${fmt(fd)}`, false); else hide('mk-frog');
    } else {
      hide('mk-car'); hide('mk-frog');
      let best: OrbSpot | null = null, bd = Infinity;
      for (const o of this.visibleOrbs) { const d = Math.hypot(o.x - px, o.z - pz); if (d < bd) { bd = d; best = o; } }
      if (best) this.marker(this.dom['mk-orb'], best.x, (best.y ?? 0) + ORB_Y + 6, best.z, ox, oz, `KUGEL · ${fmt(bd)}`, true); else hide('mk-orb');
    }
  }

  /** frogs hop around their home proportionally to their size */
  private scaledFrog(f: FrogSpot): FrogSpot {
    if (this.cfg.frogScale === undefined) return f;
    const k = this.cfg.frogScale / f.scale;
    return { ...f, range: f.range * Math.max(0.05, k), scale: this.cfg.frogScale };
  }

  private unresolved(): boolean {
    let any = false;
    for (const cc of this.cells.values()) {
      for (const e of cc.cars) if (e.y === undefined && this.yOf(e) !== null) any = true;
      for (const e of cc.orbs) if (e.y === undefined && this.yOf(e) !== null) any = true;
      for (const e of cc.frogs) if (e.y === undefined) this.yOf(e);
    }
    return any;
  }

  /** forget cached ground heights near the player (higher-detail tiles have loaded) */
  refreshGround(px: number, pz: number, radius: number) {
    for (const cc of this.cells.values()) for (const list of [cc.cars, cc.orbs, cc.frogs] as { x: number; z: number; y?: number }[][])
      for (const e of list) if (Math.abs(e.x - px) < radius && Math.abs(e.z - pz) < radius) e.y = undefined;
    this.carsDirty = true;
  }

  /** current speed for the HUD */
  get speed(): number {
    if (this.mode === 'car') return Math.abs(this.car.v);
    if (this.mode === 'frog') return Math.hypot(this.frog.vx, this.frog.vy, this.frog.vz);
    return this.flight.currentSpeed;
  }
  get altitude(): number {
    return this.mode === 'car' ? this.car.y : this.mode === 'frog' ? this.frog.y : this.camera.position.y;
  }

  /** test hooks */
  nearest(kind: 'car' | 'frog' | 'orb', px: number, pz: number) {
    const list: { x: number; z: number; y?: number }[] = kind === 'car' ? this.visibleCars : kind === 'frog' ? this.visibleFrogs : this.visibleOrbs;
    let best = null, bd = Infinity;
    for (const e of list) { const d = Math.hypot(e.x - px, e.z - pz); if (d < bd) { bd = d; best = e; } }
    return best ? { ...best, d: bd } : null;
  }
}
