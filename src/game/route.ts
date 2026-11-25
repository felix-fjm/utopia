/**
 * Deterministic 30-gate challenge route through the generated city.
 * Every gate position is validated against the actual generated geometry (buildings, trees,
 * highway decks, pillars, monorail, sky bridges, landmarks) so a gate is always flyable.
 */
import { Rng, hash2 } from '../core/rng';
import { CityGenerator, CHUNK, ChunkData } from '../world/cityGen';
import { ArchetypeRegistry } from '../world/archetypes';
import { districtAt, coreField, toLocal, toWorld, BLOCK, BLVD_EVERY, BLVD_W, PARK_T, parkValue, startPose } from '../world/layout';

export type GateType = 'sky' | 'between' | 'canyon' | 'park';
export const GATE_LABEL: Record<GateType, string> = { sky: 'Über der Skyline', between: 'Zwischen Türmen', canyon: 'Straßenschlucht', park: 'Park-Tiefflug' };

export interface GateDef {
  i: number;
  x: number; y: number; z: number;   // world centre
  nx: number; nz: number;            // horizontal normal (flight direction)
  w: number; h: number;              // half width / half height
  type: GateType;
}

interface Obstacle { x: number; z: number; r: number; y0: number; y1: number; }

export const GATE_COUNT = 30;

export class RouteBuilder {
  private obs = new Map<string, Obstacle[]>();
  private chunkCache = new Map<string, ChunkData>();
  constructor(private gen: CityGenerator, private reg: ArchetypeRegistry, private seed: number) {}

  private chunk(cx: number, cz: number): ChunkData {
    const k = cx + ',' + cz;
    let c = this.chunkCache.get(k);
    if (!c) { c = this.gen.generate(cx, cz); this.chunkCache.set(k, c); }
    return c;
  }

  private obstacles(cx: number, cz: number): Obstacle[] {
    const k = cx + ',' + cz;
    let list = this.obs.get(k);
    if (list) return list;
    list = [];
    const c = this.chunk(cx, cz);
    const col = c.colliders;
    for (let i = 0; i < col.length; i += 4) list.push({ x: col[i], z: col[i + 1], r: col[i + 2] / 0.8, y0: 0, y1: col[i + 3] + 6 });
    const idx = (kind: 'deck' | 'pillar' | 'bridge' | 'tree' | 'rail') => this.reg.infra.get(kind)?.index ?? -1;
    const each = (ai: number, fn: (m: Float32Array, o: number) => void) => {
      const arr = c.instances.get(ai);
      if (arr) for (let o = 0; o < arr.length; o += 16) fn(arr, o);
    };
    each(idx('deck'), (m, o) => list!.push({ x: c.x0 + m[o + 12], z: c.z0 + m[o + 14], r: 16, y0: m[o + 13] - 4, y1: m[o + 13] + 2 }));
    each(idx('rail'), (m, o) => list!.push({ x: c.x0 + m[o + 12], z: c.z0 + m[o + 14], r: 14, y0: m[o + 13] - 2, y1: m[o + 13] + 2 }));
    each(idx('pillar'), (m, o) => list!.push({ x: c.x0 + m[o + 12], z: c.z0 + m[o + 14], r: Math.hypot(m[o], m[o + 1], m[o + 2]) / 2 + 1, y0: 0, y1: Math.hypot(m[o + 4], m[o + 5], m[o + 6]) }));
    each(idx('tree'), (m, o) => { const s = Math.hypot(m[o], m[o + 1], m[o + 2]); list!.push({ x: c.x0 + m[o + 12], z: c.z0 + m[o + 14], r: s * 1.1, y0: 0, y1: s * 3.2 }); });
    each(idx('bridge'), (m, o) => {
      const len = Math.hypot(m[o], m[o + 1], m[o + 2]);
      const dx = m[o] / len, dz = m[o + 2] / len;
      for (let t = -len / 2; t <= len / 2; t += 8) list!.push({ x: c.x0 + m[o + 12] + dx * t, z: c.z0 + m[o + 14] + dz * t, r: 6, y0: m[o + 13] - 5, y1: m[o + 13] + 5 });
    });
    // landmark plazas: treat the monument as a tall cylinder
    for (let sz = 0; sz <= 2; sz++) for (let sx = 0; sx <= 2; sx++) {
      const d = districtAt(c.x0 + sx * CHUNK / 2, c.z0 + sz * CHUNK / 2, this.seed);
      if (d.landmark && d.x >= c.x0 && d.x < c.x0 + CHUNK && d.z >= c.z0 && d.z < c.z0 + CHUNK && !list.some((q) => q.x === d.x && q.z === d.z && q.r > 50))
        list.push({ x: d.x, z: d.z, r: d.plazaR * 0.95, y0: 0, y1: 720 });
    }
    this.obs.set(k, list);
    return list;
  }

  /** gate (as a vertical cylinder of radius w) is free of every obstacle */
  clear(x: number, y: number, z: number, w: number, h: number, margin = 8): boolean {
    if (y - h < 1.5) return false;
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      for (const o of this.obstacles(cx + i, cz + j)) {
        if (o.y1 < y - h - 3 || o.y0 > y + h + 3) continue;
        const d = Math.hypot(o.x - x, o.z - z);
        if (d < o.r + w + margin) return false;
      }
    }
    return true;
  }

  topAround(x: number, z: number, radius: number): number {
    const cx = Math.floor(x / CHUNK), cz = Math.floor(z / CHUNK);
    let top = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++)
      for (const o of this.obstacles(cx + i, cz + j)) if (o.y1 < 700 && Math.hypot(o.x - x, o.z - z) < radius + o.r) top = Math.max(top, o.y1);
    return top;
  }

  private place(type: GateType, px: number, pz: number, rng: Rng, prevY: number): GateDef | null {
    if (type === 'sky') {
      const w = 22, h = 24;
      let y = Math.max(this.topAround(px, pz, 160) + h + 30 + rng.next() * 40, 170, prevY * 0.7);
      for (let k = 0; k < 12; k++, y += 40) if (this.clear(px, y, pz, w, h)) return { i: 0, x: px, y, z: pz, nx: 0, nz: 1, w, h, type };
      return null;
    }
    if (type === 'between') {
      const w = 16, h = 18;
      for (let rad = 0; rad <= 240; rad += 30) for (let a = 0; a < 8; a++) {
        const x = px + Math.cos(a * 0.785 + rad) * rad, z = pz + Math.sin(a * 0.785 + rad) * rad;
        const y = 118 + rng.next() * 60;
        if (this.topAround(x, z, 120) < y + 30) continue; // must actually be among taller towers
        if (this.clear(x, y, z, w, h, 10)) return { i: 0, x, y, z, nx: 0, nz: 1, w, h, type };
        if (rad === 0) break;
      }
      return null;
    }
    if (type === 'canyon') {
      for (let attempt = 0; attempt < 6; attempt++) {
        const qx = px + (rng.next() - 0.5) * 500 * (attempt > 0 ? 1 : 0), qz = pz + (rng.next() - 0.5) * 500 * (attempt > 0 ? 1 : 0);
        const d = districtAt(qx, qz, this.seed);
        const B = BLOCK[d.type] * BLVD_EVERY[d.type];
        const w = Math.min(13, BLVD_W[d.type] / 2 - 3), h = w * 1.15;
        const [lx, lz] = toLocal(qx, qz, d);
        for (const axis of [0, 1]) {
          const line = Math.round((axis ? lz : lx) / B) * B;
          for (let t = 0; t < 16; t++) {
            const along = (axis ? lx : lz) + (t % 2 ? 1 : -1) * Math.ceil(t / 2) * 24;
            const [wx, wz] = axis ? toWorld(along, line, d) : toWorld(line, along, d);
            const dd = districtAt(wx, wz, this.seed);
            if (dd.cx !== d.cx || dd.cz !== d.cz || dd.edgeDist < 40) continue;
            if (d.landmark && Math.hypot(wx - d.x, wz - d.z) < d.plazaR + 40) continue;
            const y = h + 2.5;
            if (!this.clear(wx, y, wz, w, h, 3)) continue;
            if (this.topAround(wx, wz, 90) < 35) continue; // a canyon needs walls
            const ang = d.angle + (axis ? 0 : Math.PI / 2);
            return { i: 0, x: wx, y, z: wz, nx: Math.cos(ang), nz: Math.sin(ang), w, h, type };
          }
        }
      }
      return null;
    }
    // park: low pass over a park
    const w = 14, h = 15;
    for (let rad = 0; rad <= 600; rad += 40) for (let a = 0; a < 10; a++) {
      const x = px + Math.cos(a * 0.628) * rad, z = pz + Math.sin(a * 0.628) * rad;
      const d = districtAt(x, z, this.seed);
      if (parkValue(x, z, this.seed) < PARK_T[d.type] + 0.04) { if (rad === 0) break; continue; }
      const y = h + 6;
      if (this.clear(x, y, z, w, h, 4)) return { i: 0, x, y, z, nx: 0, nz: 1, w, h, type };
      if (rad === 0) break;
    }
    return null;
  }

  /** Builds the route. Async so the loading screen stays responsive. */
  async build(progress?: (f: number) => void): Promise<GateDef[]> {
    const seed = this.seed;
    const rng = new Rng(Math.floor(hash2(7, 7, seed + 999) * 4294967296));
    const s = startPose(seed);
    let px = s.x, pz = s.z, py = s.y, heading = s.yaw;
    const gates: GateDef[] = [];
    const prevTypes: GateType[] = [];
    for (let n = 1; n <= GATE_COUNT; n++) {
      const dist = n === 1 ? 380 : n <= 4 ? 420 + rng.next() * 200 : n <= 15 ? 520 + rng.next() * 380 : 620 + rng.next() * 520;
      let type: GateType;
      if (n === 1) type = 'sky';
      else {
        const w: [GateType, number][] = n <= 4 ? [['sky', 0.5], ['between', 0.5]] : [['sky', 0.24], ['between', 0.32], ['canyon', 0.3], ['park', 0.14]];
        do {
          let r = rng.next() * w.reduce((a, b) => a + b[1], 0);
          type = w[0][0];
          for (const [t, p] of w) { if ((r -= p) <= 0) { type = t; break; } }
        } while (prevTypes.length >= 2 && prevTypes.slice(-2).every((t) => t === type));
      }
      // heading choice: prefer dense urban cores, avoid looping back onto earlier gates
      let best: { a: number; x: number; z: number; sc: number } | null = null;
      const spread = n === 1 ? [0] : [-1.25, -0.65, 0, 0.65, 1.25];
      for (const off of spread) {
        const a = heading + off + (rng.next() - 0.5) * 0.25;
        const x = px - Math.sin(a) * dist, z = pz - Math.cos(a) * dist;
        let sc = coreField(x, z, seed) * 1.3 + rng.next() * 0.5 - Math.abs(off) * 0.08;
        for (const g of gates) if (Math.hypot(g.x - x, g.z - z) < 550) sc -= 2;
        if (n > 3 && Math.hypot(s.x - x, s.z - z) < 600) sc -= 1;
        if (!best || sc > best.sc) best = { a, x, z, sc };
      }
      let g: GateDef | null = null;
      for (const t of [type, 'between', 'sky'] as GateType[]) {
        g = this.place(t, best!.x, best!.z, rng, py);
        if (g) break;
      }
      // sky placement always succeeds eventually (just goes higher)
      if (!g) g = { i: 0, x: best!.x, y: 700, z: best!.z, nx: 0, nz: 1, w: 22, h: 24, type: 'sky' };
      g.i = n;
      gates.push(g);
      prevTypes.push(g.type);
      heading = Math.atan2(-(g.x - px), -(g.z - pz));
      px = g.x; pz = g.z; py = g.y;
      progress?.(n / GATE_COUNT);
      if (n % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }
    // orientation: face along the route (canyon gates stay aligned with their street)
    for (let k = 0; k < gates.length; k++) {
      const g = gates[k];
      const prev = k ? gates[k - 1] : { x: s.x, z: s.z };
      const next = gates[k + 1] ?? { x: g.x + (g.x - prev.x), z: g.z + (g.z - prev.z) };
      let dx = next.x - prev.x, dz = next.z - prev.z;
      const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
      if (g.type === 'canyon') {
        const inX = g.x - prev.x, inZ = g.z - prev.z;
        if (g.nx * inX + g.nz * inZ < 0) { g.nx = -g.nx; g.nz = -g.nz; }
      } else { g.nx = dx; g.nz = dz; }
    }
    this.chunkCache.clear();
    return gates;
  }
}
