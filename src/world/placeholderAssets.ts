/**
 * TEMPORARY placeholder architecture.
 *
 * These parametric neo-futurist buildings exist only to validate the engine (generation,
 * streaming, LOD, instancing, controls) while the licensed KitBash3D Utopia kit is not
 * available. They are flagged `temporary: true` and the UI labels them as such.
 * As soon as public/assets/utopia/manifest.json exists, they are replaced by the kit.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ArchetypeRegistry, ArchetypePart, Category } from './archetypes';
import { materials, MaterialSet } from './materials';

const TILE_W = 16, TILE_H = 32;

type Bag = Map<THREE.Material, THREE.BufferGeometry[]>;

function clean(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(ng.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') ng.deleteAttribute(k);
  if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((ng.attributes.position.count) * 2), 2));
  return ng;
}

function put(bag: Bag, m: THREE.Material, g: THREE.BufferGeometry) {
  if (!bag.has(m)) bag.set(m, []);
  bag.get(m)!.push(clean(g));
}

function finish(bag: Bag): ArchetypePart[] {
  const parts: ArchetypePart[] = [];
  for (const [mat, geos] of bag) {
    const merged = mergeGeometries(geos, false)!;
    merged.computeBoundingSphere();
    merged.computeBoundingBox();
    parts.push({ geometry: merged, material: mat, castShadow: true });
  }
  return parts;
}

/** Generalised prism: cross-section polygon swept up with taper and twist. UVs in metres. */
function sweep(section: THREE.Vector2[], height: number, rings: number,
  scaleAt: (t: number) => number, twist: number, cap = true): THREE.BufferGeometry {
  const n = section.length;
  const pos: number[] = [], uv: number[] = [];
  const perim: number[] = [0];
  for (let i = 1; i <= n; i++) perim.push(perim[i - 1] + section[i % n].distanceTo(section[i - 1]));
  const ringPts: THREE.Vector3[][] = [];
  for (let r = 0; r <= rings; r++) {
    const t = r / rings, s = scaleAt(t), a = twist * t;
    const ca = Math.cos(a), sa = Math.sin(a);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const p = section[i % n];
      const x = p.x * s, z = p.y * s;
      pts.push(new THREE.Vector3(x * ca - z * sa, t * height, x * sa + z * ca));
    }
    ringPts.push(pts);
  }
  for (let r = 0; r < rings; r++) {
    for (let i = 0; i < n; i++) {
      const a = ringPts[r][i], b = ringPts[r][i + 1], c = ringPts[r + 1][i + 1], d = ringPts[r + 1][i];
      const u0 = perim[i] / TILE_W, u1 = perim[i + 1] / TILE_W;
      const v0 = a.y / TILE_H, v1 = d.y / TILE_H;
      pos.push(a.x, a.y, a.z, c.x, c.y, c.z, b.x, b.y, b.z, a.x, a.y, a.z, d.x, d.y, d.z, c.x, c.y, c.z);
      uv.push(u0, v0, u1, v1, u1, v0, u0, v0, u0, v1, u1, v1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  if (!cap) return g;
  const top = ringPts[rings].slice(0, n);
  const tris = THREE.ShapeUtils.triangulateShape(top.map((p) => new THREE.Vector2(p.x, p.z)), []);
  const cp: number[] = [], cu: number[] = [];
  for (const [i0, i1, i2] of tris) for (const i of [i0, i2, i1]) { cp.push(top[i].x, top[i].y, top[i].z); cu.push(top[i].x / TILE_W, top[i].z / TILE_W); }
  const capG = new THREE.BufferGeometry();
  capG.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
  capG.setAttribute('uv', new THREE.Float32BufferAttribute(cu, 2));
  capG.computeVertexNormals();
  // ensure cap faces up
  const nrm = capG.attributes.normal;
  if (nrm.count && nrm.getY(0) < 0) {
    const arr = capG.attributes.position.array as Float32Array;
    for (let i = 0; i < arr.length; i += 9) for (let k = 0; k < 3; k++) { const t = arr[i + 3 + k]; arr[i + 3 + k] = arr[i + 6 + k]; arr[i + 6 + k] = t; }
    capG.computeVertexNormals();
  }
  return mergeGeometries([clean(g), clean(capG)])!;
}

const roundedRect = (w: number, d: number, r: number, seg: number) => {
  const pts: THREE.Vector2[] = [];
  const cs: [number, number, number][] = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, Math.PI / 2], [-w / 2 + r, -d / 2 + r, Math.PI], [w / 2 - r, -d / 2 + r, Math.PI * 1.5]];
  for (const [cx, cz, a0] of cs) for (let i = 0; i <= seg; i++) { const a = a0 + (i / seg) * Math.PI / 2; pts.push(new THREE.Vector2(cx + Math.cos(a) * r, cz + Math.sin(a) * r)); }
  return pts;
};
const ellipse = (rx: number, rz: number, seg: number) => Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; return new THREE.Vector2(Math.cos(a) * rx, Math.sin(a) * rz); });
const lens = (len: number, wid: number, seg: number) => {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i < seg; i++) { const t = i / seg; const x = -len / 2 + len * t; pts.push(new THREE.Vector2(x, wid / 2 * Math.sin(Math.PI * t) ** 0.8)); }
  for (let i = 0; i < seg; i++) { const t = i / seg; const x = len / 2 - len * t; pts.push(new THREE.Vector2(x, -wid / 2 * Math.sin(Math.PI * t) ** 0.8)); }
  return pts;
};
const softTri = (r: number, seg: number) => Array.from({ length: seg }, (_, i) => { const a = (i / seg) * Math.PI * 2; const k = r * (1 + 0.16 * Math.cos(3 * a)); return new THREE.Vector2(Math.cos(a) * k, Math.sin(a) * k); });

function ring(radius: number, y: number, tube: number, seg: number): THREE.BufferGeometry {
  const g = new THREE.TorusGeometry(radius, tube, 4, seg);
  g.rotateX(Math.PI / 2); g.translate(0, y, 0);
  return g;
}
function cyl(rt: number, rb: number, h: number, y: number, seg: number) {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg, 1);
  g.translate(0, y + h / 2, 0);
  return g;
}
function sphere(r: number, y: number, seg: number, sy = 1) {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg / 2));
  g.scale(1, sy, 1); g.translate(0, y, 0);
  return g;
}

function podium(b: Bag, M: MaterialSet, w: number, dep: number, d: number) {
  put(b, M.white, sweep(roundedRect(w, dep, 14, segs(d, 6)), 9, 1, () => 1, 0));
  put(b, M.glassRibbon, sweep(roundedRect(w - 8, dep - 8, 11, segs(d, 6)), 8, 1, () => 1, 0).translate(0, 9, 0));
  if (d < 2) put(b, M.foliage, sweep(roundedRect(w - 10, dep - 10, 10, segs(d, 6)), 1.2, 1, () => 1, 0).translate(0, 17, 0));
}

/** detail: 0 = full, 1 = medium, 2 = far */
type Builder = (M: MaterialSet, d: number) => Bag;
const segs = (d: number, hi: number) => (d === 0 ? hi : d === 1 ? Math.max(6, hi >> 1) : Math.max(4, hi >> 2));
const ringsN = (d: number, hi: number) => (d === 0 ? hi : d === 1 ? Math.max(2, hi >> 1) : 1);

interface Def { id: string; cat: Category; h: number; r: number; build: Builder; }

const DEFS: Def[] = [
  { id: 'helix-spire', cat: 'supertower', h: 480, r: 58, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.white, cyl(46, 52, 18, 0, segs(d, 32)));
    put(b, M.glassDiagrid, sweep(softTri(34, segs(d, 36)), 420, ringsN(d, 24), (t) => 1 - 0.22 * t * t, Math.PI * 0.9));
    podium(b, M, 110, 80, d);
    put(b, M.metal, cyl(0.6, 3.5, 70, 420, segs(d, 10)));
    put(b, M.white, sweep(softTri(26, segs(d, 36)), 6, 1, (t) => 1 - 0.3 * t, Math.PI * 0.9).translate(0, 420, 0));
    if (d === 0) for (let y = 60; y < 420; y += 60) put(b, M.stripCyan, ring(34 * (1 - 0.22 * (y / 420) ** 2) * 1.12, y, 0.7, 36));
    return b; } },
  { id: 'needle-crown', cat: 'supertower', h: 540, r: 58, build: (M, d) => {
    const b: Bag = new Map();
    const prof = [[38, 0], [36, 120], [33, 260], [27, 380], [16, 450], [2, 540]] as const;
    const pts = prof.map(([r, y]) => new THREE.Vector2(r, y));
    const lat = new THREE.LatheGeometry(pts, segs(d, 40));
    fixLatheUV(lat);
    put(b, M.glassBlue, lat);
    put(b, M.white, cyl(40, 44, 12, 0, segs(d, 32)));
    if (d < 2) for (const y of [120, 260, 380]) put(b, M.white, cyl(prof.find((p) => p[1] === y)![0] * 1.18, prof.find((p) => p[1] === y)![0] * 1.18, 4, y - 2, segs(d, 40)));
    if (d === 0) put(b, M.stripWarm, ring(28.5, 384, 0.8, 40));
    podium(b, M, 96, 96, d);
    return b; } },
  { id: 'lens-twin', cat: 'supertower', h: 440, r: 36, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassRibbon, sweep(lens(62, 26, segs(d, 20)), 440, ringsN(d, 20), (t) => 1 - 0.3 * t, Math.PI * 0.5));
    put(b, M.white, cyl(42, 46, 22, 0, segs(d, 32)));
    if (d === 0) put(b, M.metal, sweep(lens(30, 10, 10), 60, 4, (t) => 1 - 0.8 * t, 0.3).translate(0, 440, 0));
    return b; } },
  { id: 'terrace-stack', cat: 'supertower', h: 400, r: 40, build: (M, d) => {
    const b: Bag = new Map();
    let y = 0, r = 40;
    for (let i = 0; i < 6; i++) {
      const h = 66 - i * 4;
      put(b, i % 2 ? M.glassBlue : M.glassGold, cyl(r * 0.92, r, h, y, segs(d, 40)));
      if (d < 2) put(b, M.white, cyl(r * 1.08, r * 1.08, 3, y + h - 3, segs(d, 40)));
      if (d === 0) put(b, M.foliage, cyl(r * 1.02, r * 1.05, 1.5, y + h, segs(d, 32)));
      y += h; r *= 0.86;
    }
    put(b, M.metal, cyl(0.5, 2.5, 40, y, 8));
    return b; } },
  { id: 'monolith', cat: 'supertower', h: 450, r: 62, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassRibbon, sweep(roundedRect(62, 44, 16, segs(d, 6)), 420, ringsN(d, 14), (t) => 1 - 0.14 * t, 0));
    for (const y of [140, 280]) put(b, M.white, sweep(roundedRect(64, 46, 17, segs(d, 6)), 6, 1, () => 1 - 0.14 * (y / 420), 0).translate(0, y, 0));
    put(b, M.metal, sweep(roundedRect(50, 34, 12, segs(d, 6)), 30, 2, (t) => 1 - 0.55 * t, 0).translate(0, 420, 0));
    if (d === 0) for (let y = 30; y < 420; y += 70) put(b, M.stripWarm, sweep(roundedRect(63.5, 45.5, 16.5, 6), 0.8, 1, () => 1 - 0.14 * (y / 420), 0, false).translate(0, y, 0));
    podium(b, M, 120, 90, d);
    return b; } },
  { id: 'twin-link', cat: 'supertower', h: 400, r: 62, build: (M, d) => {
    const b: Bag = new Map();
    for (const sx of [-1, 1]) put(b, M.glassBlue, sweep(lens(46, 26, segs(d, 14)), 360 + sx * 40, ringsN(d, 12), (t) => 1 - 0.2 * t, sx * 0.4).translate(sx * 30, 0, 0));
    put(b, M.white, sweep(roundedRect(44, 18, 8, segs(d, 4)), 24, 1, () => 1, 0).translate(0, 230, 0));
    put(b, M.glassGold, sweep(roundedRect(40, 14, 6, segs(d, 4)), 16, 1, () => 1, 0).translate(0, 234, 0));
    podium(b, M, 120, 70, d);
    return b; } },
  { id: 'slab-curve', cat: 'tower', h: 190, r: 46, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassRibbon, sweep(lens(72, 26, segs(d, 16)), 186, ringsN(d, 10), (t) => 1 - 0.08 * t, 0.25));
    put(b, M.white, sweep(lens(70, 24, segs(d, 16)), 4, 1, () => 1, 0.25).translate(0, 186, 0));
    podium(b, M, 86, 52, d);
    return b; } },
  { id: 'ribbon-tower', cat: 'tower', h: 250, r: 40, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassRibbon, sweep(roundedRect(40, 28, 10, segs(d, 6)), 236, ringsN(d, 12), (t) => 1 - 0.18 * t, 0));
    podium(b, M, 70, 56, d);
    put(b, M.white, sweep(roundedRect(34, 22, 8, segs(d, 6)), 14, 1, (t) => 1 - 0.5 * t, 0).translate(0, 236, 0));
    return b; } },
  { id: 'twist-tri', cat: 'tower', h: 270, r: 24, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassDiagrid, sweep(softTri(22, segs(d, 30)), 262, ringsN(d, 18), (t) => 1 - 0.25 * t, Math.PI * 0.66));
    put(b, M.metal, sweep(softTri(17, segs(d, 30)), 8, 1, (t) => 1 - 0.6 * t, 0).rotateY(Math.PI * 0.66).translate(0, 262, 0));
    if (d === 0) for (let y = 40; y < 262; y += 44) put(b, M.stripCyan, ring(22 * (1 - 0.25 * y / 262) * 1.1, y, 0.5, 30));
    return b; } },
  { id: 'ellipse-blade', cat: 'tower', h: 210, r: 28, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassBlue, sweep(ellipse(30, 13, segs(d, 32)), 210, ringsN(d, 10), (t) => 1 - 0.35 * Math.sin(t * Math.PI) * 0.5, 0));
    put(b, M.white, sweep(ellipse(34, 16, segs(d, 32)), 12, 1, () => 1, 0));
    if (d < 2) put(b, M.white, sweep(ellipse(33, 15, segs(d, 32)), 4, 1, () => 1, 0).translate(0, 206, 0));
    return b; } },
  { id: 'bulb-tower', cat: 'tower', h: 230, r: 24, build: (M, d) => {
    const b: Bag = new Map();
    const pts = [[16, 0], [14, 80], [12, 150], [22, 175], [24, 195], [16, 218], [3, 230]].map(([r, y]) => new THREE.Vector2(r, y));
    const lat = new THREE.LatheGeometry(new THREE.SplineCurve(pts).getPoints(d === 0 ? 40 : d === 1 ? 16 : 7), segs(d, 36));
    fixLatheUV(lat);
    put(b, M.glassGold, lat);
    put(b, M.white, cyl(26, 30, 16, 0, segs(d, 32)));
    if (d === 0) put(b, M.stripWarm, ring(24.5, 190, 0.8, 40));
    return b; } },
  { id: 'organic-block', cat: 'mid', h: 96, r: 30, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassRibbon, sweep(roundedRect(52, 34, 14, segs(d, 6)), 90, ringsN(d, 6), (t) => 1 - 0.1 * t, 0.2));
    put(b, M.white, sweep(roundedRect(48, 30, 12, segs(d, 6)), 8, 2, (t) => 1 - 0.4 * t * t, 0.2).translate(0, 90, 0));
    return b; } },
  { id: 'pebble', cat: 'mid', h: 70, r: 26, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassBlue, sweep(ellipse(26, 18, segs(d, 28)), 64, ringsN(d, 8), (t) => 1 - 0.3 * t * t, 0));
    put(b, M.white, sphere(1, 0, segs(d, 24), 1).scale(19, 6, 13).translate(0, 64, 0));
    return b; } },
  { id: 'step-tower', cat: 'mid', h: 118, r: 24, build: (M, d) => {
    const b: Bag = new Map();
    for (let i = 0; i < 4; i++) {
      const w = 40 - i * 7, y = i * 28;
      put(b, i % 2 ? M.glassGold : M.glassRibbon, sweep(roundedRect(w, w * 0.8, 6, segs(d, 4)), 26, 1, () => 1, 0).translate(i * 2, y, 0));
      put(b, M.white, sweep(roundedRect(w + 3, w * 0.8 + 3, 7, segs(d, 4)), 2, 1, () => 1, 0).translate(i * 2, y + 26, 0));
    }
    return b; } },
  { id: 'wave-slab', cat: 'mid', h: 82, r: 34, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.glassDiagrid, sweep(lens(66, 22, segs(d, 16)), 80, ringsN(d, 8), (t) => 1 - 0.15 * Math.sin(t * Math.PI), 0.5));
    return b; } },
  { id: 'podium-flow', cat: 'low', h: 26, r: 42, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.white, sweep(lens(80, 50, segs(d, 18)), 14, 2, (t) => 1 - 0.12 * t, 0));
    put(b, M.glassRibbon, sweep(lens(64, 36, segs(d, 18)), 12, 2, (t) => 1 - 0.3 * t, 0.15).translate(0, 14, 0));
    return b; } },
  { id: 'dome-pavilion', cat: 'low', h: 32, r: 34, build: (M, d) => {
    const b: Bag = new Map();
    const g = new THREE.SphereGeometry(32, segs(d, 32), segs(d, 16), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 0.95, 1);
    put(b, M.glassDiagrid, g);
    put(b, M.white, cyl(34, 34, 3, 0, segs(d, 32)));
    return b; } },
  { id: 'orbital-arch', cat: 'landmark', h: 300, r: 150, build: (M, d) => {
    const b: Bag = new Map();
    const t = new THREE.TorusGeometry(150, 11, segs(d, 12), segs(d, 72), Math.PI);
    t.scale(1, 2.0, 1);
    put(b, M.white, t);
    if (d === 0) { const s = new THREE.TorusGeometry(150, 2.2, 6, 96, Math.PI); s.scale(1, 2.0, 1); s.translate(0, 0, 11.5); put(b, M.stripCyan, s); }
    put(b, M.glassBlue, sphere(1, 0, segs(d, 24)).scale(18, 18, 18).translate(0, 300, 0));
    return b; } },
  { id: 'sky-bulb', cat: 'landmark', h: 360, r: 56, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.white, cyl(9, 16, 300, 0, segs(d, 24)));
    put(b, M.glassGold, sphere(1, 0, segs(d, 40)).scale(46, 30, 46).translate(0, 318, 0));
    put(b, M.white, cyl(56, 56, 3, 312, segs(d, 48)));
    put(b, M.white, cyl(60, 70, 10, 0, segs(d, 40)));
    if (d === 0) put(b, M.stripWarm, ring(56.5, 313.5, 1, 64));
    return b; } },
  { id: 'grand-dome', cat: 'landmark', h: 170, r: 110, build: (M, d) => {
    const b: Bag = new Map();
    put(b, M.white, cyl(110, 116, 40, 0, segs(d, 64)));
    for (let i = 0; i < (d === 0 ? 32 : d === 1 ? 16 : 0); i++) { const a = (i / 32) * Math.PI * 2 * (d === 0 ? 1 : 2); put(b, M.white, cyl(2.5, 2.5, 40, 0, 8).translate(Math.cos(a) * 118, 0, Math.sin(a) * 118)); }
    const g = new THREE.SphereGeometry(100, segs(d, 48), segs(d, 20), 0, Math.PI * 2, 0, Math.PI / 2);
    g.scale(1, 1.25, 1); g.translate(0, 40, 0);
    put(b, M.glassDiagrid, g);
    put(b, M.metal, cyl(2, 10, 20, 165, 12));
    return b; } },
  { id: 'crystal-spire', cat: 'landmark', h: 640, r: 60, build: (M, d) => {
    const b: Bag = new Map();
    const pts = [[60, 0], [52, 80], [38, 260], [22, 460], [8, 600], [0.5, 640]].map(([r, y]) => new THREE.Vector2(r, y));
    const lat = new THREE.LatheGeometry(pts, 5);
    fixLatheUV(lat);
    put(b, M.glassDiagrid, lat);
    const lat2 = new THREE.LatheGeometry(pts.map((p) => new THREE.Vector2(p.x * 0.7, p.y * 0.82)), 5, Math.PI / 5);
    fixLatheUV(lat2);
    put(b, M.glassGold, lat2.translate(0, 8, 0));
    if (d === 0) for (let y = 100; y < 560; y += 92) put(b, M.stripCyan, ring(60 * (1 - y / 700) * 0.95, y, 0.9, 5));
    return b; } },
];

function fixLatheUV(g: THREE.BufferGeometry) {
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    const ang = uv.getX(i);
    uv.setXY(i, (ang * 2 * Math.PI * Math.max(r, 4)) / TILE_W, p.getY(i) / TILE_H);
  }
}

function infraParts(M: MaterialSet) {
  // Unit-sized meshes, scaled per instance
  const deck = new THREE.BoxGeometry(1, 1, 1); deck.translate(0, -0.5, 0);
  const deckStripL = new THREE.BoxGeometry(1, 0.25, 0.04); deckStripL.translate(0, 0.12, 0.48);
  const deckStripR = deckStripL.clone(); deckStripR.translate(0, 0, -0.96);
  const pillar = new THREE.CylinderGeometry(0.5, 0.62, 1, 12); pillar.translate(0, 0.5, 0);
  const bridge = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1); bridge.rotateZ(Math.PI / 2); bridge.scale(1, 1, 1);
  const crown = new THREE.SphereGeometry(1, 10, 7); crown.scale(1, 1.25, 1); crown.translate(0, 1.6, 0);
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 6); trunk.translate(0, 0.6, 0);
  const rail = new THREE.BoxGeometry(1, 1, 1);
  const p = (g: THREE.BufferGeometry, m: THREE.Material, shadow = true): ArchetypePart => ({ geometry: clean(g), material: m, castShadow: shadow });
  return {
    deck: [p(deck, M.concrete), p(mergeGeometries([clean(deckStripL), clean(deckStripR)])!, M.stripWarm, false)],
    pillar: [p(pillar, M.white)],
    bridge: [p(bridge, M.white)],
    tree: [p(crown, M.foliage), p(trunk, M.dark, false)],
    rail: [p(rail, M.stripCyan, false)],
  };
}

export function registerInfrastructure(reg: ArchetypeRegistry): void {
  const M = materials();
  const ip = infraParts(M);
  for (const kind of ['deck', 'pillar', 'bridge', 'tree', 'rail'] as const) {
    reg.add({ id: 'infra-' + kind, category: 'infra', infra: kind, height: 1, radius: 1, minScale: 1, maxScale: 1, lods: [ip[kind], ip[kind], ip[kind]], temporary: false });
  }
}

export function registerPlaceholders(reg: ArchetypeRegistry): void {
  const M = materials();
  for (const def of DEFS) {
    const lods = [0, 1, 2].map((d) => finish(def.build(M, d)));
    reg.add({ id: 'temp-' + def.id, category: def.cat, height: def.h, radius: def.r, minScale: def.cat === 'landmark' ? 0.85 : 0.6, maxScale: def.cat === 'landmark' ? 1.2 : 1.5, lods, temporary: true, colliderFactor: def.id === 'orbital-arch' ? 0 : def.cat === 'landmark' ? 0.45 : 0.8 });
  }
  reg.temporary = true;
  reg.kitLabel = 'Temporäre Platzhalter-Assets';
}
