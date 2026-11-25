/**
 * Urban morphology fields. Identical logic is mirrored in GLSL (ground.ts) so that streets,
 * plazas and parks painted on the ground always match where buildings are (and aren't) placed.
 */
import { hash2, valueNoise } from '../core/rng';

export const DISTRICT_SIZE = 1400;
export const CORE_GRID = 6000;
export const CORE_SIGMA = 1700;

export enum D { Core = 0, Corporate = 1, Residential = 2, Civic = 3, Garden = 4 }
export const DISTRICT_NAMES = ['Zentrum', 'Business', 'Wohnen', 'Civic', 'Gärten'];

// per district type
export const BLOCK = [96, 116, 74, 132, 150];
export const ROAD_W = [16, 18, 12, 16, 12];
export const BLVD_EVERY = [4, 3, 5, 3, 4];
export const BLVD_W = [40, 36, 26, 42, 30];
export const PARK_T = [0.86, 0.80, 0.73, 0.66, 0.54];
export const LANDMARK_P = [0.85, 0.40, 0.18, 0.90, 0.45];
export const EDGE_ROAD = 11; // half width of the avenue on district boundaries

export interface District {
  cx: number; cz: number;     // cell index
  x: number; z: number;       // seed point (world)
  type: D;
  angle: number;
  core: number;
  edgeDist: number;           // distance to the boundary with the next district
  landmark: boolean;
  plazaR: number;
}

export function coreField(x: number, z: number, seed: number): number {
  const gx = Math.floor(x / CORE_GRID), gz = Math.floor(z / CORE_GRID);
  let best = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j;
    const px = (cx + 0.2 + 0.6 * hash2(cx, cz, seed + 21)) * CORE_GRID;
    const pz = (cz + 0.2 + 0.6 * hash2(cx, cz, seed + 22)) * CORE_GRID;
    const s = cx === 0 && cz === 0 ? 1 : 0.45 + 0.55 * hash2(cx, cz, seed + 23);
    const dx = x - px, dz = z - pz;
    const v = s * Math.exp(-(dx * dx + dz * dz) / (2 * CORE_SIGMA * CORE_SIGMA));
    if (v > best) best = v;
  }
  return best;
}

export function coreCenter(cx: number, cz: number, seed: number): [number, number] {
  return [(cx + 0.2 + 0.6 * hash2(cx, cz, seed + 21)) * CORE_GRID, (cz + 0.2 + 0.6 * hash2(cx, cz, seed + 22)) * CORE_GRID];
}

function seedPoint(cx: number, cz: number, seed: number): [number, number] {
  return [(cx + 0.15 + 0.7 * hash2(cx, cz, seed + 11)) * DISTRICT_SIZE, (cz + 0.15 + 0.7 * hash2(cx, cz, seed + 12)) * DISTRICT_SIZE];
}

export function districtType(core: number, h: number): D {
  if (core > 0.55) return D.Core;
  let t: D = h < 0.3 ? D.Corporate : h < 0.62 ? D.Residential : h < 0.8 ? D.Civic : D.Garden;
  if (core > 0.3 && (t === D.Residential || t === D.Garden)) t = D.Corporate;
  return t;
}

export function districtAt(x: number, z: number, seed: number): District {
  const gx = Math.floor(x / DISTRICT_SIZE), gz = Math.floor(z / DISTRICT_SIZE);
  let d1 = Infinity, d2 = Infinity, b1x = 0, b1z = 0, b2x = 0, b2z = 0, bcx = 0, bcz = 0;
  for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
    const cx = gx + i, cz = gz + j;
    const [px, pz] = seedPoint(cx, cz, seed);
    const d = (x - px) ** 2 + (z - pz) ** 2;
    if (d < d1) { d2 = d1; b2x = b1x; b2z = b1z; d1 = d; b1x = px; b1z = pz; bcx = cx; bcz = cz; }
    else if (d < d2) { d2 = d; b2x = px; b2z = pz; }
  }
  const sep = Math.hypot(b2x - b1x, b2z - b1z);
  const edgeDist = (d2 - d1) / (2 * sep);
  const core = coreField(b1x, b1z, seed);
  const type = districtType(core, hash2(bcx, bcz, seed + 13));
  const angle = hash2(bcx, bcz, seed + 17) * Math.PI * 0.5;
  const landmark = hash2(bcx, bcz, seed + 14) < LANDMARK_P[type];
  const plazaR = 80 + 70 * hash2(bcx, bcz, seed + 15);
  return { cx: bcx, cz: bcz, x: b1x, z: b1z, type, angle, core, edgeDist, landmark, plazaR };
}

/** Signed distance (m) to the nearest street edge; negative = on the street. Also reports boulevard proximity. */
export function streetDistance(x: number, z: number, d: District): { dist: number; onBlvd: boolean } {
  const ca = Math.cos(-d.angle), sa = Math.sin(-d.angle);
  const rx = x - d.x, rz = z - d.z;
  const lx = rx * ca - rz * sa, lz = rx * sa + rz * ca;
  const B = BLOCK[d.type];
  const kx = Math.round(lx / B), kz = Math.round(lz / B);
  const hwx = ((kx % BLVD_EVERY[d.type]) === 0 ? BLVD_W[d.type] : ROAD_W[d.type]) / 2;
  const hwz = ((kz % BLVD_EVERY[d.type]) === 0 ? BLVD_W[d.type] : ROAD_W[d.type]) / 2;
  const ex = Math.abs(lx - kx * B) - hwx;
  const ez = Math.abs(lz - kz * B) - hwz;
  const edge = d.edgeDist - EDGE_ROAD;
  const dist = Math.min(ex, ez, edge);
  return { dist, onBlvd: dist < 0 && (ex === dist ? kx % BLVD_EVERY[d.type] === 0 : kz % BLVD_EVERY[d.type] === 0) };
}

export function parkValue(x: number, z: number, seed: number): number {
  return valueNoise(x / 340, z / 340, seed + 50);
}

/** Local frame helpers */
export function toLocal(x: number, z: number, d: District): [number, number] {
  const ca = Math.cos(-d.angle), sa = Math.sin(-d.angle);
  const rx = x - d.x, rz = z - d.z;
  return [rx * ca - rz * sa, rx * sa + rz * ca];
}
export function toWorld(lx: number, lz: number, d: District): [number, number] {
  const ca = Math.cos(d.angle), sa = Math.sin(d.angle);
  return [d.x + lx * ca - lz * sa, d.z + lx * sa + lz * ca];
}

/** Spectacular start: south-west of the primary core, elevated, looking toward its centre. */
export function startPose(seed: number) {
  const [cx, cz] = coreCenter(0, 0, seed);
  const x = cx - 900, z = cz + 1250;
  const yaw = Math.atan2(-(cx - x), -(cz - z));
  return { x, y: 330, z, yaw: yaw + 0.25, pitch: -0.16 };
}
