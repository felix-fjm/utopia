import * as THREE from 'three';
import { ArchetypeRegistry, Archetype } from './archetypes';
import { CHUNK, ChunkData, CityGenerator } from './cityGen';

interface Batch {
  arch: Archetype;
  lod: number;
  attr: THREE.InstancedBufferAttribute;
  meshes: THREE.InstancedMesh[];
  capacity: number;
  count: number;
}

export interface CityStats {
  loadedChunks: number;
  visibleChunks: number;
  instances: number;
  batches: number;
  pending: number;
  genMs: number;
}

const OVERHANG = 190; // max horizontal overhang of geometry beyond its chunk (landmarks)

/**
 * Streams procedurally generated chunks around the camera and renders all of them through a
 * small, fixed set of instanced draw calls: one per (archetype, LOD, material part).
 * Per-chunk frustum culling + distance LOD selection happen on the CPU each frame; instance
 * matrices are copied into shared GPU buffers with the floating-origin offset applied.
 */
export class CityRenderer {
  readonly group = new THREE.Group();
  readonly chunks = new Map<string, ChunkData>();
  private batches = new Map<number, Batch>();
  private frustum = new THREE.Frustum();
  private projView = new THREE.Matrix4();
  private box = new THREE.Box3();
  private regVersion = -1;
  private layoutVersion = 0;
  stats: CityStats = { loadedChunks: 0, visibleChunks: 0, instances: 0, batches: 0, pending: 0, genMs: 0 };
  shadows = false;

  viewRadius = 3600;
  lod1 = 650;
  lod2 = 1600;
  genBudgetMs = 6;

  constructor(public gen: CityGenerator, public reg: ArchetypeRegistry) {
    this.group.name = 'city';
  }

  /** Drop all chunks (e.g. new seed or new asset set). */
  reset(): void {
    this.chunks.clear();
    for (const b of this.batches.values()) for (const m of b.meshes) { this.group.remove(m); m.dispose(); }
    this.batches.clear();
  }

  private batchFor(a: Archetype, lod: number, need: number): Batch | null {
    const key = a.index * 4 + lod;
    let b = this.batches.get(key);
    if (b && b.capacity >= need) return b;
    const parts = a.lods[lod];
    if (!parts) return null;
    const cap = Math.max(64, b ? b.capacity * 2 : 64, need);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 16), 16);
    attr.setUsage(THREE.DynamicDrawUsage);
    if (b) {
      (attr.array as Float32Array).set((b.attr.array as Float32Array).subarray(0, b.count * 16));
      for (const m of b.meshes) { this.group.remove(m); m.dispose(); }
    }
    const meshes = parts.map((p) => {
      const m = new THREE.InstancedMesh(p.geometry, p.material, cap);
      m.instanceMatrix = attr;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.castShadow = this.shadows && lod === 0 && !!p.castShadow;
      m.receiveShadow = lod < 2;
      m.count = 0;
      this.group.add(m);
      return m;
    });
    const nb: Batch = { arch: a, lod, attr, meshes, capacity: cap, count: b ? b.count : 0 };
    this.batches.set(key, nb);
    return nb;
  }

  setShadows(on: boolean) {
    this.shadows = on;
    for (const b of this.batches.values()) b.meshes.forEach((m, i) => (m.castShadow = on && b.lod === 0 && !!b.arch.lods[b.lod]?.[i]?.castShadow));
  }

  /** Synchronously generate everything within `radius` (used for the initial load). */
  *preload(wx: number, wz: number, radius: number): Generator<number> {
    const keys = this.neededChunks(wx, wz, radius);
    let done = 0;
    for (const [k, cx, cz] of keys) {
      if (!this.chunks.has(k)) this.chunks.set(k, this.gen.generate(cx, cz));
      done++;
      if (done % 6 === 0) yield done / keys.length;
    }
    yield 1;
  }

  private neededChunks(wx: number, wz: number, radius: number): [string, number, number, number][] {
    const out: [string, number, number, number][] = [];
    const c0x = Math.floor(wx / CHUNK), c0z = Math.floor(wz / CHUNK);
    const R = Math.ceil(radius / CHUNK) + 1;
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const cx = c0x + i, cz = c0z + j;
      const dx = Math.max(0, Math.abs((cx + 0.5) * CHUNK - wx) - CHUNK / 2);
      const dz = Math.max(0, Math.abs((cz + 0.5) * CHUNK - wz) - CHUNK / 2);
      const d = Math.hypot(dx, dz);
      if (d <= radius) out.push([cx + ',' + cz, cx, cz, d]);
    }
    out.sort((a, b) => a[3] - b[3]);
    return out;
  }

  /** Stream chunks: generate missing ones (time-budgeted), unload far ones. */
  stream(wx: number, wz: number, lookX = 0, lookZ = 0): void {
    if (this.layoutVersion !== this.reg.layoutVersion) {
      this.layoutVersion = this.reg.layoutVersion;
      this.chunks.clear();
    }
    if (this.regVersion !== this.reg.version) {
      // asset set changed (e.g. Utopia LODs streamed in) -> rebuild batches lazily
      this.regVersion = this.reg.version;
      for (const b of this.batches.values()) for (const m of b.meshes) { this.group.remove(m); m.dispose(); }
      this.batches.clear();
    }
    // bias streaming slightly toward the travel direction
    const need = this.neededChunks(wx + lookX * 200, wz + lookZ * 200, this.viewRadius);
    const t0 = performance.now();
    let pending = 0;
    for (const [k, cx, cz] of need) {
      if (this.chunks.has(k)) continue;
      if (performance.now() - t0 < this.genBudgetMs) this.chunks.set(k, this.gen.generate(cx, cz));
      else pending++;
    }
    this.stats.genMs = performance.now() - t0;
    this.stats.pending = pending;
    const unloadR = this.viewRadius + CHUNK * 1.5;
    for (const [k, c] of this.chunks) {
      const dx = Math.max(0, Math.abs(c.x0 + CHUNK / 2 - wx) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(c.z0 + CHUNK / 2 - wz) - CHUNK / 2);
      if (Math.hypot(dx, dz) > unloadR) this.chunks.delete(k);
    }
    this.stats.loadedChunks = this.chunks.size;
  }

  /** Fill instance buffers for this frame. ox/oz = floating origin (world coords of render-space 0). */
  update(camera: THREE.PerspectiveCamera, ox: number, oz: number): void {
    camera.updateMatrixWorld();
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView);
    for (const b of this.batches.values()) b.count = 0;
    const cp = camera.position;
    let visible = 0, inst = 0;
    const lod1 = this.lod1, lod2 = this.lod2;
    for (const c of this.chunks.values()) {
      const rx = c.x0 - ox, rz = c.z0 - oz;
      this.box.min.set(rx - OVERHANG, -5, rz - OVERHANG);
      this.box.max.set(rx + CHUNK + OVERHANG, c.maxH + 10, rz + CHUNK + OVERHANG);
      if (!this.frustum.intersectsBox(this.box)) continue;
      // distance from camera to the chunk's core footprint
      const dx = Math.max(0, Math.abs(rx + CHUNK / 2 - cp.x) - CHUNK / 2);
      const dz = Math.max(0, Math.abs(rz + CHUNK / 2 - cp.z) - CHUNK / 2);
      const dy = Math.max(0, cp.y - c.maxH);
      const dist = Math.sqrt(dx * dx + dz * dz + dy * dy * 0.25);
      if (dist > this.viewRadius) continue;
      const wantLod = dist < lod1 ? 0 : dist < lod2 ? 1 : 2;
      visible++;
      for (const [ai, src] of c.instances) {
        const a = this.reg.list[ai];
        if (!a) continue;
        const lod = this.reg.resolveLod(a, a.category === 'infra' ? Math.min(wantLod, 1) : wantLod);
        if (lod < 0) continue;
        const n = src.length >> 4;
        const key = ai * 4 + lod;
        let b = this.batches.get(key);
        if (!b || b.count + n > b.capacity) b = this.batchFor(a, lod, (b ? b.count : 0) + n)!;
        if (!b) continue;
        const dst = b.attr.array as Float32Array;
        const off = b.count * 16;
        dst.set(src, off);
        for (let k = 0; k < n; k++) {
          const o = off + k * 16;
          dst[o + 12] += rx;
          dst[o + 14] += rz;
        }
        b.count += n;
        inst += n;
      }
    }
    for (const b of this.batches.values()) {
      for (const m of b.meshes) m.count = b.count;
      if (b.count) {
        b.attr.clearUpdateRanges();
        b.attr.addUpdateRange(0, b.count * 16);
        b.attr.needsUpdate = true;
      }
    }
    this.stats.visibleChunks = visible;
    this.stats.instances = inst;
    this.stats.batches = this.batches.size;
  }

  /** Push a point (world coords) out of building collision cylinders. Returns true if it collided. */
  collide(p: THREE.Vector3, ox: number, oz: number, margin = 4): boolean {
    const wx = p.x + ox, wz = p.z + oz;
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    let hit = false;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunks.get(cx + i + ',' + (cz + j));
      if (!c) continue;
      const col = c.colliders;
      for (let k = 0; k < col.length; k += 4) {
        const h = col[k + 3];
        if (p.y > h + margin) continue;
        const dx = wx - col[k], dz = wz - col[k + 1];
        const r = col[k + 2] + margin;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        const d = Math.sqrt(d2) || 0.001;
        // push out either sideways or upward, whichever is shorter
        const side = r - d, up = h + margin - p.y;
        if (up < side * 0.6) p.y += up;
        else { p.x += (dx / d) * side; p.z += (dz / d) * side; }
        hit = true;
      }
    }
    return hit;
  }

  /** Height of the tallest collider covering (world x,z) – used by autopilot terrain following. */
  heightAt(wx: number, wz: number, margin = 30): number {
    const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
    let h = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = this.chunks.get(cx + i + ',' + (cz + j));
      if (!c) continue;
      const col = c.colliders;
      for (let k = 0; k < col.length; k += 4) {
        const dx = wx - col[k], dz = wz - col[k + 1], r = col[k + 2] / 0.8 + margin;
        if (dx * dx + dz * dz < r * r && col[k + 3] > h) h = col[k + 3];
      }
    }
    return h;
  }
}
