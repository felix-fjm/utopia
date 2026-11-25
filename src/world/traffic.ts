import * as THREE from 'three';
import { hash2 } from '../core/rng';
import { districtAt, toWorld, BLOCK, BLVD_EVERY } from './layout';
import { patchMaterial } from './shared';
import { stripMaterials } from './materials';

const CELL = 1600;
const LANES_PER_CELL = 7;

interface Lane { ox: number; oz: number; dx: number; dz: number; y: number; speed: number; len: number; phase: number; }

/**
 * Deterministic air traffic: lanes belong to world cells (so they never pop while visible),
 * low lanes follow boulevards (clear of buildings), high lanes cross above the skyline.
 */
export class Traffic {
  readonly body: THREE.InstancedMesh;
  readonly lights: THREE.InstancedMesh;
  private lanes = new Map<string, Lane[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3(1, 1, 1);
  private e = new THREE.Euler();
  private capacity: number;

  constructor(private seed: number, capacity: number) {
    this.capacity = capacity;
    const bodyGeo = new THREE.CapsuleGeometry(1.5, 6, 3, 8);
    bodyGeo.rotateZ(Math.PI / 2);
    bodyGeo.scale(1, 0.55, 1);
    const bodyMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#c9ced6', metalness: 0.85, roughness: 0.25 }));
    const lg = new THREE.BoxGeometry(1.2, 0.35, 2.6); lg.translate(-4.6, 0, 0);
    const lf = new THREE.BoxGeometry(0.6, 0.3, 2.2); lf.translate(4.7, 0, 0);
    const lightGeo = new THREE.BufferGeometry();
    const merged = [lg, lf].map((g) => g.toNonIndexed());
    const pos = new Float32Array(merged[0].attributes.position.array.length + merged[1].attributes.position.array.length);
    pos.set(merged[0].attributes.position.array as Float32Array, 0);
    pos.set(merged[1].attributes.position.array as Float32Array, merged[0].attributes.position.array.length);
    lightGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const col = new Float32Array(pos.length);
    const nA = merged[0].attributes.position.count;
    for (let i = 0; i < pos.length / 3; i++) {
      const c = i < nA ? [1.0, 0.25, 0.3] : [0.85, 0.95, 1.0];
      col.set(c, i * 3);
    }
    lightGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    lightGeo.computeVertexNormals();
    const lightMat = new THREE.MeshStandardMaterial({ color: '#111', vertexColors: false, emissive: '#ffffff', emissiveIntensity: 1 });
    // use vertex colors as emissive tint
    patchMaterial(lightMat, (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 color;\nvarying vec3 vTint;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvTint = color;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vTint;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vTint * 2.5;');
    });
    lightMat.customProgramCacheKey = () => 'traffic-lights';
    stripMaterials.push(lightMat);
    this.body = new THREE.InstancedMesh(bodyGeo, bodyMat, capacity);
    this.lights = new THREE.InstancedMesh(lightGeo, lightMat, capacity);
    for (const im of [this.body, this.lights]) { im.frustumCulled = false; im.instanceMatrix.setUsage(THREE.DynamicDrawUsage); im.count = 0; }
  }

  setSeed(seed: number) { this.seed = seed; this.lanes.clear(); }

  setCapacity(n: number) { this.capacity = Math.min(n, this.body.instanceMatrix.count); }

  private cellLanes(cx: number, cz: number): Lane[] {
    const k = cx + ',' + cz;
    let ls = this.lanes.get(k);
    if (ls) return ls;
    ls = [];
    const seed = this.seed;
    for (let i = 0; i < LANES_PER_CELL; i++) {
      const h = (n: number) => hash2(cx * 31 + i, cz * 17 - i, seed + 300 + n);
      const px = (cx + h(1)) * CELL, pz = (cz + h(2)) * CELL;
      const d = districtAt(px, pz, seed);
      const high = h(3) < 0.45;
      let ox = px, oz = pz, ang = d.angle + (h(4) < 0.5 ? 0 : Math.PI / 2);
      let y: number;
      if (!high) {
        // snap onto a boulevard of this district (no buildings there)
        const B = BLOCK[d.type] * BLVD_EVERY[d.type];
        const along = (h(5) - 0.5) * 600;
        const k2 = Math.round((h(6) - 0.5) * 6);
        const axisZ = h(4) < 0.5;
        const [wx, wz] = axisZ ? toWorld(k2 * B, along, d) : toWorld(along, k2 * B, d);
        ox = wx; oz = wz;
        ang = axisZ ? d.angle + Math.PI / 2 : d.angle;
        y = 58 + h(7) * 26;
      } else {
        y = 380 + h(7) * 420;
      }
      if (h(8) < 0.5) ang += Math.PI;
      const dx = Math.cos(ang), dz = Math.sin(ang);
      ls.push({ ox, oz, dx, dz, y, speed: high ? 70 + h(9) * 90 : 28 + h(9) * 40, len: high ? 4200 : 1100, phase: h(10) * 10000 });
    }
    this.lanes.set(k, ls);
    if (this.lanes.size > 64) { const first = this.lanes.keys().next().value!; this.lanes.delete(first); }
    return ls;
  }

  update(t: number, camWX: number, camWZ: number, ox: number, oz: number) {
    const ccx = Math.floor(camWX / CELL), ccz = Math.floor(camWZ / CELL);
    const lanes: Lane[] = [];
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) lanes.push(...this.cellLanes(ccx + i, ccz + j));
    const per = Math.max(1, Math.floor(this.capacity / lanes.length));
    let n = 0;
    const arr = this.body.instanceMatrix.array as Float32Array;
    for (const L of lanes) {
      const yaw = -Math.atan2(L.dz, L.dx);
      this.e.set(0, yaw, 0);
      this.q.setFromEuler(this.e);
      for (let v = 0; v < per && n < this.capacity; v++) {
        const s = ((t * L.speed + L.phase + (v * L.len) / per) % L.len) - L.len / 2;
        this.p.set(L.ox + L.dx * s - ox, L.y + Math.sin(t * 0.7 + v) * 1.5, L.oz + L.dz * s - oz);
        this.m.compose(this.p, this.q, this.s);
        this.m.toArray(arr, n * 16);
        n++;
      }
    }
    (this.lights.instanceMatrix.array as Float32Array).set(arr.subarray(0, n * 16));
    this.body.count = this.lights.count = n;
    this.body.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }
}
