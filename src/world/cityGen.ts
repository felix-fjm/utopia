import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { Archetype, ArchetypeRegistry, Category } from './archetypes';
import { D, District, districtAt, streetDistance, parkValue, PARK_T, BLOCK, BLVD_EVERY, toLocal, toWorld } from './layout';

export const CHUNK = 500;
const G = 30; // candidate lattice spacing (m)
const SETBACK = 4;
const OCCUPANCY = [0.99, 0.93, 0.9, 0.78, 0.6];

export interface ChunkData {
  cx: number; cz: number;
  x0: number; z0: number;
  /** archetype index -> packed local matrices (16 floats each, translation relative to chunk origin) */
  instances: Map<number, Float32Array>;
  maxH: number;
  /** packed colliders: x, z, r, h (world coords) */
  colliders: Float32Array;
  buildingCount: number;
  instanceCount: number;
}

interface Cand { x: number; z: number; a: Archetype; s: number; rot: number; r: number; h: number; pr: number; key: number; }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

function targetHeight(d: District, r1: number, r2: number): number {
  const c = d.core;
  switch (d.type) {
    case D.Core: return 110 + (140 + 560 * Math.pow(c, 1.1)) * Math.pow(r1, 1.5);
    case D.Corporate: return 55 + (110 + 280 * c) * Math.pow(r1, 1.3);
    case D.Residential: return 22 + 95 * Math.pow(r1, 1.2);
    case D.Civic: return 14 + 62 * r1;
    default: return r2 < 0.08 ? 120 + 80 * r1 : 12 + 46 * r1;
  }
}

function catFor(h: number): Category {
  return h > 340 ? 'supertower' : h > 150 ? 'tower' : h > 45 ? 'mid' : 'low';
}
const DOWN: Record<Category, Category | null> = { supertower: 'tower', tower: 'mid', mid: 'low', low: null, landmark: null };

export class CityGenerator {
  constructor(public seed: number, public reg: ArchetypeRegistry) {}

  private candidate(i: number, j: number, cache: Map<number, Cand | null>): Cand | null {
    const key = i * 73856093 ^ j * 19349663;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const seed = this.seed;
    const res = this.computeCandidate(i, j, seed, key);
    cache.set(key, res);
    return res;
  }

  private computeCandidate(i: number, j: number, seed: number, key: number): Cand | null {
    const x = (i + 0.15 + 0.7 * hash2(i, j, seed + 31)) * G;
    const z = (j + 0.15 + 0.7 * hash2(i, j, seed + 32)) * G;
    const d = districtAt(x, z, seed);
    if (d.landmark && Math.hypot(x - d.x, z - d.z) < d.plazaR + 12) return null;
    if (parkValue(x, z, seed) > PARK_T[d.type]) return null;
    const sd = streetDistance(x, z, d).dist;
    const maxR = sd - SETBACK;
    if (maxR < 9) return null;
    if (hash2(i, j, seed + 33) > OCCUPANCY[d.type]) return null;
    const h0 = targetHeight(d, hash2(i, j, seed + 34), hash2(i, j, seed + 35));
    let cat: Category | null = catFor(h0);
    const pickR = hash2(i, j, seed + 36);
    while (cat) {
      const list = this.reg.buildings(cat);
      if (list.length) {
        const start = Math.floor(pickR * list.length);
        for (let k = 0; k < list.length; k++) {
          const a = list[(start + k) % list.length];
          let s = Math.min(a.maxScale, Math.max(a.minScale, h0 / a.height));
          if (a.radius * s > maxR) s = maxR / a.radius;
          if (s < a.minScale) continue;
          const quarter = Math.floor(hash2(i, j, seed + 37) * 4);
          let rot = -d.angle + quarter * Math.PI * 0.5;
          if ((d.type === D.Civic || d.type === D.Garden) && cat !== 'supertower') rot += (hash2(i, j, seed + 38) - 0.5) * 0.5;
          const r = a.radius * s;
          return { x, z, a, s, rot, r, h: a.height * s, pr: r * (0.75 + 0.5 * hash2(i, j, seed + 39)), key };
        }
      }
      cat = DOWN[cat];
    }
    return null;
  }

  generate(cx: number, cz: number): ChunkData {
    const seed = this.seed;
    const x0 = cx * CHUNK, z0 = cz * CHUNK;
    const buckets = new Map<number, number[]>();
    const colliders: number[] = [];
    let maxH = 60, buildingCount = 0, instanceCount = 0;
    const push = (a: Archetype, m: THREE.Matrix4) => {
      let b = buckets.get(a.index);
      if (!b) buckets.set(a.index, (b = []));
      const e = m.elements;
      for (let k = 0; k < 16; k++) b.push(e[k]);
      instanceCount++;
    };
    const place = (a: Archetype, x: number, z: number, y: number, rot: number, sx: number, sy: number, sz: number) => {
      _p.set(x - x0, y, z - z0);
      _q.setFromAxisAngle(_up, rot);
      _s.set(sx, sy, sz);
      _m.compose(_p, _q, _s);
      push(a, _m);
    };

    // --- buildings: priority-based conflict resolution on a global lattice (chunk-seam safe)
    const cache = new Map<number, Cand | null>();
    const i0 = Math.floor(x0 / G), j0 = Math.floor(z0 / G);
    const n = Math.ceil(CHUNK / G);
    const accepted: Cand[] = [];
    const W = 5;
    for (let j = j0; j < j0 + n; j++) for (let i = i0; i < i0 + n; i++) {
      const c = this.candidate(i, j, cache);
      if (!c) continue;
      if (c.x < x0 || c.x >= x0 + CHUNK || c.z < z0 || c.z >= z0 + CHUNK) continue;
      let ok = true;
      for (let dj = -W; dj <= W && ok; dj++) for (let di = -W; di <= W; di++) {
        if (!di && !dj) continue;
        const o = this.candidate(i + di, j + dj, cache);
        if (!o) continue;
        if (o.pr > c.pr || (o.pr === c.pr && o.key > c.key)) {
          const md = c.r + o.r + 6;
          if ((o.x - c.x) ** 2 + (o.z - c.z) ** 2 < md * md) { ok = false; break; }
        }
      }
      if (!ok) continue;
      accepted.push(c);
      place(c.a, c.x, c.z, 0, c.rot, c.s, c.s, c.s);
      const cf = c.a.colliderFactor ?? 0.8;
      if (cf > 0) colliders.push(c.x, c.z, c.r * cf, c.h);
      maxH = Math.max(maxH, c.h);
      buildingCount++;
    }

    // --- landmarks at district seed points (centre of their plaza)
    const lms = this.reg.buildings('landmark');
    const districts = new Map<string, District>();
    for (let sz = 0; sz <= 4; sz++) for (let sx = 0; sx <= 4; sx++) {
      const d = districtAt(x0 + (sx / 4) * CHUNK, z0 + (sz / 4) * CHUNK, seed);
      districts.set(d.cx + ',' + d.cz, d);
    }
    // seeds can lie in this chunk even if not sampled above
    for (const d of this.neighbourDistricts(x0, z0)) districts.set(d.cx + ',' + d.cz, d);
    for (const d of districts.values()) {
      if (!d.landmark || !lms.length) continue;
      if (d.x < x0 || d.x >= x0 + CHUNK || d.z < z0 || d.z >= z0 + CHUNK) continue;
      const a = lms[Math.floor(hash2(d.cx, d.cz, seed + 40) * lms.length)];
      const s = Math.min(a.maxScale, Math.max(a.minScale, (d.plazaR * 0.9) / a.radius));
      const rot = -d.angle + Math.floor(hash2(d.cx, d.cz, seed + 41) * 4) * Math.PI / 2;
      place(a, d.x, d.z, 0, rot, s, s, s);
      const cf = a.colliderFactor ?? 0.45;
      if (cf > 0) colliders.push(d.x, d.z, a.radius * s * cf, a.height * s);
      maxH = Math.max(maxH, a.height * s);
      buildingCount++;
    }

    // --- parks: trees
    const tree = this.reg.infra.get('tree');
    if (tree) {
      const T = 20;
      for (let j = Math.floor(z0 / T); j < Math.floor((z0 + CHUNK) / T); j++) for (let i = Math.floor(x0 / T); i < Math.floor((x0 + CHUNK) / T); i++) {
        const x = (i + hash2(i, j, seed + 61)) * T, z = (j + hash2(i, j, seed + 62)) * T;
        const d = districtAt(x, z, seed);
        const pv = parkValue(x, z, seed);
        if (pv <= PARK_T[d.type] + 0.015) continue;
        if (streetDistance(x, z, d).dist < 3) continue;
        if (hash2(i, j, seed + 63) < 0.25) continue;
        const s = 3 + 4 * hash2(i, j, seed + 64);
        place(tree, x, z, 0, hash2(i, j, seed + 65) * 6.28, s, s * (0.9 + 0.4 * hash2(i, j, seed + 66)), s);
      }
    }

    // --- elevated infrastructure on boulevards: highway decks + pillars (core/corporate), monorail (core)
    const deck = this.reg.infra.get('deck'), pillar = this.reg.infra.get('pillar'), rail = this.reg.infra.get('rail');
    for (const d of districts.values()) {
      if (d.type !== D.Core && d.type !== D.Corporate) continue;
      if (!deck || !pillar || !rail) break;
      const B = BLOCK[d.type], N = BLVD_EVERY[d.type];
      // local bbox of chunk
      let minx = Infinity, maxx = -Infinity, minz = Infinity, maxz = -Infinity;
      for (const [px, pz] of [[x0, z0], [x0 + CHUNK, z0], [x0, z0 + CHUNK], [x0 + CHUNK, z0 + CHUNK]]) {
        const [lx, lz] = toLocal(px, pz, d);
        minx = Math.min(minx, lx); maxx = Math.max(maxx, lx); minz = Math.min(minz, lz); maxz = Math.max(maxz, lz);
      }
      const step = 24;
      const deckY = d.type === D.Core ? 42 : 32;
      for (let axis = 0; axis < 2; axis++) {
        const lo = axis === 0 ? minx : minz, hi = axis === 0 ? maxx : maxz;
        const alo = axis === 0 ? minz : minx, ahi = axis === 0 ? maxz : maxx;
        for (let k = Math.ceil(lo / (B * N)) * N; k * B <= hi; k += N) {
          const isRail = d.type === D.Core && axis === 1;
          const isDeck = axis === 0 || (d.type === D.Corporate && Math.abs(k / N) % 2 === 1);
          if (!isRail && !isDeck) continue;
          for (let t = Math.floor(alo / step) * step; t <= ahi; t += step) {
            const [lx, lz] = axis === 0 ? [k * B, t + step / 2] : [t + step / 2, k * B];
            const [wx, wz] = toWorld(lx, lz, d);
            if (wx < x0 || wx >= x0 + CHUNK || wz < z0 || wz >= z0 + CHUNK) continue;
            const dd = districtAt(wx, wz, seed);
            if (dd.cx !== d.cx || dd.cz !== d.cz || dd.edgeDist < 30) continue;
            if (d.landmark && Math.hypot(wx - d.x, wz - d.z) < d.plazaR + 40) continue;
            const rot = -d.angle + (axis === 0 ? Math.PI / 2 : 0);
            const tIdx = Math.round(t / step);
            if (isDeck) {
              place(deck, wx, wz, deckY, rot, step + 0.6, 2.4, 22);
              if (tIdx % 3 === 0) place(pillar, wx, wz, 0, 0, 5, deckY - 2.4, 5);
            }
            if (isRail) {
              const ry = 96;
              place(rail, wx, wz, ry, rot, step + 0.2, 1.4, 1.4);
              if (tIdx % 4 === 0) place(pillar, wx, wz, 0, 0, 2.2, ry - 0.7, 2.2);
            }
            maxH = Math.max(maxH, 100);
          }
        }
      }
    }

    // --- sky bridges between neighbouring tall towers
    const bridge = this.reg.infra.get('bridge');
    if (bridge) {
      let count = 0;
      for (let a = 0; a < accepted.length && count < 10; a++) {
        const A = accepted[a];
        if (A.h < 120) continue;
        for (let b = a + 1; b < accepted.length; b++) {
          const Bc = accepted[b];
          if (Bc.h < 120) continue;
          const dist = Math.hypot(Bc.x - A.x, Bc.z - A.z);
          if (dist > A.r + Bc.r + 70 || dist < A.r + Bc.r + 8) continue;
          if (hash2(A.key, Bc.key, seed + 71) < 0.45) continue;
          const y = Math.min(A.h, Bc.h) * (0.35 + 0.35 * hash2(A.key, Bc.key, seed + 72));
          const rot = -Math.atan2(Bc.z - A.z, Bc.x - A.x);
          place(bridge, (A.x + Bc.x) / 2, (A.z + Bc.z) / 2, y, rot, dist * 0.7, 7, 9);
          count++;
          break;
        }
      }
    }

    const instances = new Map<number, Float32Array>();
    for (const [k, v] of buckets) instances.set(k, new Float32Array(v));
    return { cx, cz, x0, z0, instances, maxH, colliders: new Float32Array(colliders), buildingCount, instanceCount };
  }

  private neighbourDistricts(x0: number, z0: number): District[] {
    // District seed points closest to the chunk corners' neighbourhood
    const out: District[] = [];
    const size = 1400;
    const gx = Math.floor((x0 + CHUNK / 2) / size), gz = Math.floor((z0 + CHUNK / 2) / size);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cz = gz + j;
      const px = (cx + 0.15 + 0.7 * hash2(cx, cz, this.seed + 11)) * size;
      const pz = (cz + 0.15 + 0.7 * hash2(cx, cz, this.seed + 12)) * size;
      if (px >= x0 && px < x0 + CHUNK && pz >= z0 && pz < z0 + CHUNK) out.push(districtAt(px, pz, this.seed));
    }
    return out;
  }
}
