/**
 * Geometry + deterministic placement of parked cars, frogs and morph orbs.
 * Placement is a pure function of (seed, cell) so everything streams like the city itself.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Rng, hash2 } from '../core/rng';
import { districtAt, streetDistance, toLocal, toWorld, BLOCK, ROAD_W, BLVD_EVERY, BLVD_W, parkValue, PARK_T } from '../world/layout';

export const CELL = 250;

export interface CarSpot { id: number; x: number; z: number; h: number; color: number; y?: number; }
export interface FrogSpot { id: number; x: number; z: number; period: number; phase: number; range: number; scale: number; y?: number; }
export interface OrbSpot { id: number; x: number; z: number; hue: number; y?: number; }
export interface CellContent { cars: CarSpot[]; frogs: FrogSpot[]; orbs: OrbSpot[]; }

export const CAR_COLORS = ['#dfe4ea', '#1d2229', '#b8322d', '#2f6fd6', '#e6b43c', '#7a3fc0', '#26a98a', '#f4f4f4', '#ff7a3d', '#6c7884'].map((c) => new THREE.Color(c));

// ------------------------------------------------------------------ geometry (forward = -Z)
function colorize(g: THREE.BufferGeometry, c: THREE.Color): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal'].includes(k)) ng.deleteAttribute(k);
  const n = ng.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return ng;
}
function strip(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (!['position', 'normal'].includes(k)) ng.deleteAttribute(k);
  return ng;
}

export function carGeometries() {
  // side profile in (z, y): low nose at the front (-z), fastback roof
  const prof: [number, number][] = [[-2.35, 0.32], [-2.38, 0.62], [-1.5, 0.82], [-0.55, 1.34], [0.75, 1.36], [1.85, 0.98], [2.34, 0.86], [2.36, 0.32]];
  const shape = new THREE.Shape(prof.map(([z, y]) => new THREE.Vector2(z, y)));
  const body = new THREE.ExtrudeGeometry(shape, { depth: 1.8, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, steps: 1 });
  body.translate(0, 0, -0.9);
  body.rotateY(-Math.PI / 2); // profile axis -> world Z (nose at -Z), extrusion -> width along X
  body.computeVertexNormals();
  const gp: [number, number][] = [[-1.47, 0.86], [-0.56, 1.42], [0.76, 1.44], [1.9, 1.04], [1.92, 0.93], [-1.45, 0.93]];
  const glassShape = new THREE.Shape(gp.map(([z, y]) => new THREE.Vector2(z, y)));
  const glass = new THREE.ExtrudeGeometry(glassShape, { depth: 2.0, bevelEnabled: false });
  glass.translate(0, 0.0, -1.0);
  glass.rotateY(-Math.PI / 2);
  glass.computeVertexNormals();
  const diff = new THREE.BoxGeometry(1.7, 0.2, 0.08); diff.translate(0, 0.42, 2.41);
  const skirtL = new THREE.BoxGeometry(0.06, 0.16, 2.2); skirtL.translate(-0.99, 0.36, 0.02);
  const skirtR = skirtL.clone(); skirtR.translate(1.98, 0, 0);
  const dark = mergeGeometries([strip(glass), strip(diff), strip(skirtL), strip(skirtR)])!;
  const wheels: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) for (const sz of [-1.45, 1.5]) {
    const w = new THREE.CylinderGeometry(0.4, 0.4, 0.34, 16);
    w.rotateZ(Math.PI / 2); w.translate(sx * 1.03, 0.4, sz);
    wheels.push(strip(w));
  }
  const head = new THREE.BoxGeometry(1.5, 0.09, 0.06); head.translate(0, 0.66, -2.4);
  const tail = new THREE.BoxGeometry(1.84, 0.13, 0.08); tail.translate(0, 0.76, 2.41);
  const tailL = new THREE.BoxGeometry(0.06, 0.13, 0.5); tailL.translate(-0.99, 0.76, 2.2);
  const tailR = tailL.clone(); tailR.translate(1.98, 0, 0);
  const under = new THREE.BoxGeometry(1.7, 0.04, 3.8); under.translate(0, 0.22, 0);
  const lights = mergeGeometries([colorize(head, new THREE.Color(1, 1, 1)), colorize(tail, new THREE.Color(1, 0.1, 0.08)), colorize(tailL, new THREE.Color(1, 0.1, 0.08)), colorize(tailR, new THREE.Color(1, 0.1, 0.08)), colorize(under, new THREE.Color(0.2, 0.85, 1))])!;
  return { body: strip(body), glass: dark, wheels: mergeGeometries(wheels)!, lights };
}

export function frogGeometries() {
  const green = new THREE.Color('#4fa83a'), dark = new THREE.Color('#2e6b25'), belly = new THREE.Color('#d6e39a'), white = new THREE.Color('#f5f5ee'), black = new THREE.Color('#111111');
  const parts: THREE.BufferGeometry[] = [];
  const sph = (r: number, sx: number, sy: number, sz: number, x: number, y: number, z: number, c: THREE.Color, seg = 14) => {
    const g = new THREE.SphereGeometry(r, seg, Math.max(6, seg >> 1)); g.scale(sx, sy, sz); g.translate(x, y, z); parts.push(colorize(g, c));
  };
  sph(1, 0.85, 0.55, 1.05, 0, 0.62, 0.1, green);          // body
  sph(1, 0.7, 0.42, 0.65, 0, 0.5, 0.15, belly, 12);       // belly (peeks below)
  sph(1, 0.72, 0.46, 0.58, 0, 0.82, -0.72, green);        // head
  for (const s of [-1, 1]) {
    sph(0.24, 1, 1, 1, s * 0.36, 1.18, -0.82, white, 12); // eyes
    sph(0.12, 1, 1, 0.7, s * 0.4, 1.22, -1.02, black, 8); // pupils
    sph(1, 0.28, 0.26, 0.7, s * 0.72, 0.32, 0.45, dark, 10); // thighs
    sph(1, 0.22, 0.12, 0.55, s * 0.82, 0.1, -0.05, dark, 8);  // feet
    sph(1, 0.13, 0.32, 0.13, s * 0.48, 0.3, -0.62, green, 8); // front legs
    sph(1, 0.2, 0.08, 0.26, s * 0.52, 0.04, -0.78, dark, 8);  // front feet
  }
  const body = mergeGeometries(parts)!;
  const spots: THREE.BufferGeometry[] = [];
  for (const [x, z, r] of [[0.32, 0.25, 0.14], [-0.28, 0.45, 0.12], [0.05, -0.1, 0.16], [-0.38, -0.05, 0.1], [0.25, 0.7, 0.1]] as const) {
    const g = new THREE.SphereGeometry(r, 8, 6); g.scale(1, 0.5, 1); g.translate(x, 1.12 - Math.abs(z - 0.1) * 0.25, z); spots.push(strip(g));
  }
  return { body, spots: mergeGeometries(spots)! };
}

// ------------------------------------------------------------------ placement
function laneSpot(rng: Rng, seed: number, cx: number, cz: number, center: boolean): { x: number; z: number; h: number } | null {
  const px = (cx + rng.next()) * CELL, pz = (cz + rng.next()) * CELL;
  const d = districtAt(px, pz, seed);
  if (d.landmark && Math.hypot(px - d.x, pz - d.z) < d.plazaR + 20) return null;
  const [lx, lz] = toLocal(px, pz, d);
  const B = BLOCK[d.type], N = BLVD_EVERY[d.type];
  const axis = rng.next() < 0.5 ? 0 : 1;
  const k = Math.round((axis === 0 ? lx : lz) / B);
  const blvd = k % N === 0;
  const hw = (blvd ? BLVD_W[d.type] : ROAD_W[d.type]) / 2;
  const side = rng.next() < 0.5 ? 1 : -1;
  const off = center && !blvd ? 0 : side * hw * (blvd ? 0.55 : 0.5);
  const along = axis === 0 ? lz : lx;
  const [wx, wz] = axis === 0 ? toWorld(k * B + off, along, d) : toWorld(along, k * B + off, d);
  const dd = districtAt(wx, wz, seed);
  if (dd.cx !== d.cx || dd.cz !== d.cz || dd.edgeDist < 16) return null;
  if (streetDistance(wx, wz, dd).dist > -1.3) return null;
  // driving direction: right-hand traffic
  const unit = axis === 0 ? [-Math.sin(d.angle), Math.cos(d.angle)] : [Math.cos(d.angle), Math.sin(d.angle)];
  const sgn = (side > 0) === (axis === 0) ? 1 : -1;
  const dx = unit[0] * sgn, dz = unit[1] * sgn;
  return { x: wx, z: wz, h: Math.atan2(-dx, -dz) };
}

export function cellContent(seed: number, cx: number, cz: number): CellContent {
  const rng = new Rng(Math.floor(hash2(cx, cz, seed + 777) * 4294967296));
  const base = (cx * 92821 + cz * 68917) & 0xffffff;
  const cars: CarSpot[] = [], frogs: FrogSpot[] = [], orbs: OrbSpot[] = [];
  for (let i = 0; i < 16 && cars.length < 6; i++) {
    const s = laneSpot(rng, seed, cx, cz, false);
    if (!s || cars.some((c) => Math.hypot(c.x - s.x, c.z - s.z) < 9)) continue;
    cars.push({ id: base * 64 + cars.length, ...s, color: Math.floor(rng.next() * CAR_COLORS.length) });
  }
  for (let i = 0; i < 10 && frogs.length < 3; i++) {
    const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
    const d = districtAt(x, z, seed);
    const sd = streetDistance(x, z, d).dist;
    const park = parkValue(x, z, seed) > PARK_T[d.type] + 0.02 && sd > 3;
    const plaza = d.landmark && Math.hypot(x - d.x, z - d.z) > d.plazaR * 0.97 && Math.hypot(x - d.x, z - d.z) < d.plazaR + 8;
    const walk = sd > 0.8 && sd < 4.5 && rng.next() < 0.35;
    if (!park && !plaza && !walk) continue;
    frogs.push({ id: base * 64 + 20 + frogs.length, x, z, period: 2.2 + rng.next() * 2.6, phase: rng.next() * 10, range: park ? 9 : 4, scale: 1.9 + rng.next() * 0.9 });
  }
  const o1 = laneSpot(rng, seed, cx, cz, true) ?? laneSpot(rng, seed, cx, cz, true);
  if (o1 && rng.next() < 0.75) orbs.push({ id: base * 64 + 40, x: o1.x, z: o1.z, hue: rng.next() });
  for (let i = 0; i < 6; i++) {
    const x = (cx + rng.next()) * CELL, z = (cz + rng.next()) * CELL;
    const d = districtAt(x, z, seed);
    if (parkValue(x, z, seed) > PARK_T[d.type] + 0.03 && streetDistance(x, z, d).dist > 6) { orbs.push({ id: base * 64 + 41, x, z, hue: rng.next() }); break; }
  }
  return { cars, frogs, orbs };
}

/** Animated frog pose at time t: hops between deterministic points around its home. */
export function frogPose(f: FrogSpot, t: number, out: { x: number; y: number; z: number; h: number; air: number }) {
  const tt = t + f.phase;
  const n = Math.floor(tt / f.period);
  const u = tt / f.period - n;
  const pt = (k: number) => { const a = hash2(f.id, k, 5) * Math.PI * 2, r = f.range * Math.sqrt(hash2(f.id, k, 6)); return [f.x + Math.cos(a) * r, f.z + Math.sin(a) * r]; };
  const [x0, z0] = pt(n), [x1, z1] = pt(n + 1);
  const hopT = 0.55 / f.period; // airborne share of the cycle
  const s = Math.min(1, u / hopT);
  const e = s * s * (3 - 2 * s);
  out.x = x0 + (x1 - x0) * e; out.z = z0 + (z1 - z0) * e;
  out.air = u < hopT ? Math.sin(Math.PI * s) : 0;
  out.y = out.air * 1.4 * f.scale;
  out.h = Math.atan2(-(x1 - x0), -(z1 - z0));
  return out;
}
