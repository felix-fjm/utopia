/**
 * Neon signs on real facades: from points on OpenStreetMap streets a horizontal ray is cast to
 * both sides; where it meets a steep wall a glowing vertical/horizontal sign is mounted.
 * Texts are generic Japanese shop words drawn into one atlas (no brands, no trademarks).
 */
import * as THREE from 'three';
import { Rng, hash2 } from '../core/rng';
import { CELL } from '../game/creatures';
import { OsmIndex } from './osm';
import { TilesWorld } from './tilesWorld';
import { sharedUniforms } from '../world/shared';

const WORDS = ['ラーメン', 'カラオケ', 'ホテル', '居酒屋', '寿司', 'バー', 'ゲーム', '薬', '焼肉', 'カフェ', '電気', '本屋', '24時間', '餃子', '酒場', 'ネオン'];
const COLORS = ['#ff3fb4', '#3ff7ff', '#ffe13f', '#7dff5a', '#ff6a3f', '#b45cff', '#ff4060', '#40a0ff'];
const COLS = 8, ROWS = 4; // atlas: 16 vertical + 16 horizontal signs

function atlas(): THREE.CanvasTexture {
  const W = 1024, H = 1024, cw = W / COLS, ch = H / ROWS;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const rng = new Rng(77);
  for (let i = 0; i < COLS * ROWS; i++) {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = col * cw, y = row * ch;
    const word = WORDS[i % WORDS.length];
    const color = COLORS[Math.floor(rng.next() * COLORS.length)];
    g.save();
    g.beginPath(); g.rect(x + 3, y + 3, cw - 6, ch - 6); g.clip();
    g.fillStyle = '#07070c'; g.fillRect(x, y, cw, ch);
    g.strokeStyle = color; g.lineWidth = 5; g.shadowColor = color; g.shadowBlur = 14;
    g.strokeRect(x + 9, y + 9, cw - 18, ch - 18);
    g.fillStyle = color;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const vertical = row < 2;
    if (vertical) {
      const chars = [...word];
      const size = Math.min(cw * 0.62, (ch - 40) / chars.length * 0.9);
      g.font = `700 ${size}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif`;
      chars.forEach((chh, k) => g.fillText(chh, x + cw / 2, y + 20 + (k + 0.5) * ((ch - 40) / chars.length)));
    } else {
      // horizontal: the atlas cell is drawn rotated so one quad layout serves both orientations
      g.translate(x + cw / 2, y + ch / 2); g.rotate(-Math.PI / 2);
      const size = Math.min(cw * 0.5, (ch - 40) / Math.max(2, [...word].length) * 1.0);
      g.font = `700 ${size}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", sans-serif`;
      g.fillText(word, 0, 0, ch - 40);
    }
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

interface Sign { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; tile: number; horiz: boolean; }

export class NeonSigns {
  readonly mesh: THREE.InstancedMesh;
  private cells = new Map<string, Sign[] | null>();
  private tries = new Map<string, number>();
  private tileAttr: THREE.InstancedBufferAttribute;
  private dirty = true;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  count = 0;

  constructor(private tw: TilesWorld, private osm: () => OsmIndex | null, private seed: number) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const cap = 900;
    this.tileAttr = new THREE.InstancedBufferAttribute(new Float32Array(cap * 2), 2);
    geo.setAttribute('aTile', this.tileAttr);
    const mat = new THREE.MeshBasicMaterial({ map: atlas(), toneMapped: false, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = sharedUniforms.uNight;
      sh.uniforms.uTime = sharedUniforms.uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec2 aTile;\nvarying float vSeed;')
        .replace('#include <uv_vertex>', `#include <uv_vertex>\n#ifdef USE_MAP\nvMapUv = (vec2(uv.x, uv.y) + aTile) / vec2(${COLS}.0, ${ROWS}.0);\n#endif\nvSeed = aTile.x * 7.0 + aTile.y * 3.0 + instanceMatrix[3].x * 0.01;`);
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying float vSeed;')
        .replace('#include <map_fragment>', `#include <map_fragment>
          float on = step(0.08, fract(sin(floor(uTime * 9.0 + vSeed * 13.0) * 43758.5) * 1.0) + 0.06 * step(0.9, fract(vSeed)));
          diffuseColor.rgb *= mix(0.55, 2.4, uNight) * mix(1.0, on, step(0.85, fract(vSeed * 3.7)));`);
    };
    mat.customProgramCacheKey = () => 'neon-signs';
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  private build(cx: number, cz: number): Sign[] | null {
    const osm = this.osm();
    if (!osm) return null;
    const pts = osm.roadSamples(cx, cz, 14);
    const rng = new Rng(Math.floor(hash2(cx, cz, this.seed + 616) * 4294967296));
    const out: Sign[] = [];
    let anyGround = false;
    for (const p of pts) {
      const gy = this.tw.groundAt(p.x, p.z, 3000);
      if (gy === null) continue;
      anyGround = true;
      for (const side of [1, -1]) {
        if (rng.next() < 0.35) continue;
        const rx = -p.dz * side, rz = p.dx * side;
        const y = gy + 6 + rng.next() * 22;
        const hit = this.tw.cast(p.x, y, p.z, rx, 0, rz, p.half + 22);
        if (!hit) continue;
        const n = this.tw.normalOf(hit);
        if (Math.abs(n.y) > 0.25) continue;
        if (n.x * rx + n.z * rz > 0) n.negate();
        const horiz = rng.next() < 0.35;
        const tile = horiz ? 16 + Math.floor(rng.next() * 16) : Math.floor(rng.next() * 16);
        const w = horiz ? 7 + rng.next() * 5 : 1.8 + rng.next() * 1.2;
        const h = horiz ? 1.8 + rng.next() * 0.8 : 5 + rng.next() * 5;
        // vertical signs stick out of the wall (Tokyo style), horizontal ones lie flat on it
        const off = horiz ? 0.35 : w / 2 + 0.3;
        if (horiz) out.push({ x: hit.point.x + n.x * off, y, z: hit.point.z + n.z * off, nx: n.x, nz: n.z, w, h, tile, horiz });
        else {
          // blade sign: perpendicular to the wall, readable from the street in both directions
          const tx = -n.z, tz = n.x;
          out.push({ x: hit.point.x + n.x * off, y, z: hit.point.z + n.z * off, nx: tx, nz: tz, w, h, tile, horiz });
        }
      }
    }
    return anyGround ? out : null;
  }

  update(px: number, pz: number) {
    const ccx = Math.floor(px / CELL), ccz = Math.floor(pz / CELL);
    const R = 2;
    const want = new Set<string>();
    for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
      const k = ccx + i + ',' + (ccz + j);
      want.add(k);
      if (this.cells.get(k)) continue;
      const t = this.tries.get(k) ?? 0;
      if (t > 40) continue;
      this.tries.set(k, t + 1);
      const s = this.build(ccx + i, ccz + j);
      if (s) { this.cells.set(k, s); this.dirty = true; }
      break; // at most one new cell per frame
    }
    for (const k of this.cells.keys()) if (!want.has(k)) { this.cells.delete(k); this.tries.delete(k); this.dirty = true; }
    if (!this.dirty) return;
    this.dirty = false;
    let n = 0;
    const cap = this.mesh.instanceMatrix.count;
    const arr = this.tileAttr.array as Float32Array;
    for (const list of this.cells.values()) for (const s of list ?? []) {
      if (n >= cap) break;
      // horizontal atlas cells are drawn rotated: rotate the quad back by 90° and swap sizes
      this.e.set(0, Math.atan2(s.nx, s.nz), s.horiz ? Math.PI / 2 : 0, 'YXZ');
      this.q.setFromEuler(this.e);
      this.m.compose(new THREE.Vector3(s.x, s.y, s.z), this.q, new THREE.Vector3(s.horiz ? s.h : s.w, s.horiz ? s.w : s.h, 1));
      this.mesh.setMatrixAt(n, this.m);
      arr[n * 2] = s.tile % COLS; arr[n * 2 + 1] = ROWS - 1 - Math.floor(s.tile / COLS);
      n++;
    }
    this.mesh.count = n;
    this.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.tileAttr.needsUpdate = true;
  }
}
