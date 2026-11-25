import * as THREE from 'three';
import { Rng } from '../core/rng';
import { patchMaterial } from './shared';

/** Materials whose emissive intensity follows the time-of-day preset. */
export const windowMaterials: THREE.MeshStandardMaterial[] = [];
export const stripMaterials: THREE.MeshStandardMaterial[] = [];

let anisotropy = 4;
export function setAnisotropy(a: number) { anisotropy = a; }

type FacadeStyle = 'ribbon' | 'grid' | 'diagrid';

function facadeTextures(style: FacadeStyle, tint: [string, string], seed: number) {
  const W = 256, H = 512; // one tile = 16 m x 32 m (4 x 8 floors)
  const rng = new Rng(seed);
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const e = document.createElement('canvas'); e.width = W; e.height = H;
  const g = c.getContext('2d')!, ge = e.getContext('2d')!;
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, tint[0]); grad.addColorStop(1, tint[1]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, W, H);
  const floors = 8, fh = H / floors;
  const warm = ['#ffd9a0', '#ffe8c4', '#fff2dc', '#cfe8ff', '#ffc98a'];
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    // slab / spandrel
    g.fillStyle = style === 'ribbon' ? 'rgba(235,232,225,0.92)' : 'rgba(40,46,56,0.85)';
    g.fillRect(0, y, W, style === 'ribbon' ? fh * 0.28 : fh * 0.12);
    const cols = style === 'grid' ? 8 : style === 'diagrid' ? 4 : 1;
    for (let k = 0; k < cols; k++) {
      const x0 = (k * W) / cols, cw = W / cols;
      // subtle per-pane reflection variance
      g.fillStyle = `rgba(255,255,255,${0.02 + rng.next() * 0.04})`;
      g.fillRect(x0 + 2, y + fh * 0.3, cw - 4, fh * 0.66);
      if (style !== 'ribbon') { g.fillStyle = 'rgba(25,28,34,0.9)'; g.fillRect(x0, y, 3, fh); }
    }
    // lit windows (emissive): occupancy comes in runs, like real offices
    const segs = 16;
    let lit = rng.next() < 0.3;
    for (let k = 0; k < segs; k++) {
      if (rng.next() < (lit ? 0.35 : 0.14)) lit = !lit;
      if (lit) {
        ge.fillStyle = rng.pick(warm);
        ge.globalAlpha = 0.55 + rng.next() * 0.45;
        ge.fillRect((k * W) / segs + 1, y + fh * 0.34, W / segs - 2, fh * 0.58);
      }
    }
    ge.globalAlpha = 1;
  }
  if (style === 'diagrid') {
    g.strokeStyle = 'rgba(225,222,214,0.95)'; g.lineWidth = 6;
    for (let i = -2; i < 4; i++) {
      g.beginPath(); g.moveTo(i * W / 2, 0); g.lineTo(i * W / 2 + W, H); g.stroke();
      g.beginPath(); g.moveTo(i * W / 2 + W, 0); g.lineTo(i * W / 2, H); g.stroke();
    }
  }
  const mk = (cv: HTMLCanvasElement, srgb: boolean) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = anisotropy;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  };
  return { map: mk(c, true), emissive: mk(e, true) };
}

export function makeFacade(style: FacadeStyle, tint: [string, string], seed: number, metalness = 0.55, roughness = 0.14) {
  const t = facadeTextures(style, tint, seed);
  const m = new THREE.MeshStandardMaterial({
    map: t.map, emissiveMap: t.emissive, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.2,
    metalness, roughness, envMapIntensity: 1.25,
  });
  windowMaterials.push(m);
  return patchMaterial(m);
}

export function makeSolid(color: string, metalness: number, roughness: number) {
  return patchMaterial(new THREE.MeshStandardMaterial({ color, metalness, roughness, envMapIntensity: 1.0 }));
}

export function makeStrip(color: string) {
  const m = new THREE.MeshStandardMaterial({ color: '#cfd6de', metalness: 0.2, roughness: 0.3, emissive: new THREE.Color(color), emissiveIntensity: 0.5 });
  stripMaterials.push(m);
  return patchMaterial(m);
}

export interface MaterialSet {
  glassBlue: THREE.MeshStandardMaterial;
  glassRibbon: THREE.MeshStandardMaterial;
  glassGold: THREE.MeshStandardMaterial;
  glassDiagrid: THREE.MeshStandardMaterial;
  white: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  stripCyan: THREE.MeshStandardMaterial;
  stripWarm: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
}

let cached: MaterialSet | null = null;
export function materials(): MaterialSet {
  if (cached) return cached;
  cached = {
    glassBlue: makeFacade('grid', ['#3e5a78', '#26405c'], 11),
    glassRibbon: makeFacade('ribbon', ['#1e3449', '#56728c'], 12),
    glassGold: makeFacade('ribbon', ['#4a3c2c', '#7d6a50'], 13, 0.7, 0.16),
    glassDiagrid: makeFacade('diagrid', ['#23394f', '#7c97b0'], 14),
    white: makeSolid('#e8e4dc', 0.05, 0.42),
    metal: makeSolid('#c7ae84', 1.0, 0.26),
    dark: makeSolid('#2b2f36', 0.6, 0.35),
    stripCyan: makeStrip('#8fe6ff'),
    stripWarm: makeStrip('#ffc27a'),
    foliage: makeSolid('#4b6b3a', 0.0, 0.85),
    concrete: makeSolid('#a9a59d', 0.0, 0.7),
  };
  return cached;
}
