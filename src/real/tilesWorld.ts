/**
 * Real-world 3D Tiles as a playable world: Google Photorealistic 3D Tiles (Google key or
 * Cesium ion) or PLATEAU buildings + terrain. Every source is re-oriented so the city centre is
 * the origin with +Y up (metres) and made collidable with BVH-accelerated raycasts.
 */
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, CesiumIonAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { CityDef } from './cities';
import { patchMaterial } from '../world/shared';
import { neonFacadeMaterial, wetGroundMaterial } from './neonMaterials';
import { isIOS, isTouchDevice } from '../core/quality';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type AuthKind = 'ion' | 'google' | 'url';
export interface TilesAuth { kind: AuthKind; key: string; }
export type TileStyle = 'photo' | 'neon' | 'ground';
export interface TileSource {
  kind: AuthKind;
  /** token / key / tileset URL */
  key: string;
  assetId?: string;
  style: TileStyle;
  /** alternative tileset URL (url sources) or ion asset id (ion sources) if the first one fails */
  fallback?: string;
  /** a primary source must load for the world to be ready (e.g. the ground) */
  primary?: boolean;
  label?: string;
}

const D2R = Math.PI / 180;
const tint = new THREE.Color(1, 1, 1);

interface Layer { src: TileSource; tiles: TilesRenderer; ready: boolean; error: string; triedFallback: boolean; }

export class TilesWorld {
  readonly group = new THREE.Group();
  private layers: Layer[] = [];
  private ray = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];
  private v = new THREE.Vector3();
  private d = new THREE.Vector3();
  private lastGround = 0;
  private materials = new Set<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>();
  private draco = new DRACOLoader().setDecoderPath('./assets/draco/');
  private errorTarget = 10;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, readonly city: CityDef, sources: TileSource[]) {
    this.group.name = 'tiles';
    (this.ray as unknown as { firstHitOnly: boolean }).firstHitOnly = true;
    for (const s of sources) this.layers.push(this.makeLayer(s, false));
  }

  private makeLayer(src: TileSource, useFallback: boolean): Layer {
    const city = this.city;
    const key = useFallback && src.kind === 'url' && src.fallback ? src.fallback : src.key;
    const asset = useFallback && src.kind === 'ion' && src.fallback ? src.fallback : src.assetId;
    const tiles = src.kind === 'url' ? new TilesRenderer(key) : new TilesRenderer();
    if (src.kind === 'google') tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: key, autoRefreshToken: true }));
    if (src.kind === 'ion') tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: key, assetId: asset ?? '2275207', autoRefreshToken: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: this.draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new ReorientationPlugin({ lat: city.lat * D2R, lon: city.lon * D2R, height: 0 }));
    tiles.errorTarget = this.errorTarget;
    // memory budget for streamed tiles: when it is full the renderer stops refining, so dense
    // cities ended up detailed only around the first area in view. Mobile Safari gets less.
    const GB = 2 ** 30, mobile = isIOS() || isTouchDevice();
    tiles.lruCache.minBytesSize = (mobile ? 0.35 : 0.6) * GB;
    tiles.lruCache.maxBytesSize = (mobile ? 0.6 : 1.1) * GB;
    tiles.lruCache.unloadPercent = 0.1;
    tiles.setCamera(this.camera);
    tiles.setResolutionFromRenderer(this.camera, this.renderer);
    const layer: Layer = { src, tiles, ready: false, error: '', triedFallback: useFallback };
    tiles.addEventListener('load-root-tileset', () => { layer.ready = true; });
    tiles.addEventListener('load-error', (e: { error?: Error }) => {
      if (layer.ready) return;
      layer.error = String(e?.error?.message ?? e?.error ?? 'Ladefehler');
      if (src.fallback && !layer.triedFallback) {
        // swap to the fallback source (e.g. LOD1 buildings, Cesium World Terrain)
        const i = this.layers.indexOf(layer);
        this.group.remove(tiles.group);
        queueMicrotask(() => tiles.dispose());
        const nl = this.makeLayer(src, true);
        if (i >= 0) this.layers[i] = nl; else this.layers.push(nl);
      }
    });
    tiles.addEventListener('load-model', ({ scene }: { scene: THREE.Object3D }) => this.prepare(scene, src.style));
    tiles.addEventListener('dispose-model', ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (m.geometry as unknown as { disposeBoundsTree: () => void }).disposeBoundsTree();
        if (src.style === 'photo') for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshBasicMaterial[]) this.materials.delete(mat);
      });
    });
    this.group.add(tiles.group);
    return layer;
  }

  private prepare(scene: THREE.Object3D, style: TileStyle) {
    scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const g = m.geometry;
      if (style !== 'photo' && !g.attributes.normal) g.computeVertexNormals();
      (g as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
      if (style === 'neon') { m.material = neonFacadeMaterial(); return; }
      if (style === 'ground') { m.material = wetGroundMaterial(); m.receiveShadow = false; return; }
      for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as (THREE.MeshBasicMaterial | THREE.MeshStandardMaterial)[]) {
        if (this.materials.has(mat)) continue;
        patchMaterial(mat);
        mat.fog = true;
        // photographic textures: show them as captured (no filmic tone curve), tint multiplies
        mat.toneMapped = false;
        mat.userData.base = mat.color.clone();
        mat.color.copy(mat.userData.base).multiply(tint);
        this.materials.add(mat);
      }
    });
  }

  /** the world is playable once all primary sources have their root tileset */
  private primaries(): Layer[] { const p = this.layers.filter((l) => l.src.primary); return p.length ? p : this.layers.slice(0, 1); }
  get ready(): boolean { return this.primaries().every((l) => l.ready); }
  get error(): string {
    const failed = this.primaries().find((l) => l.error && !l.ready && (l.triedFallback || !l.src.fallback));
    return failed ? failed.error : '';
  }
  layerStatus() { return this.layers.map((l) => ({ label: l.src.label ?? l.src.kind, ready: l.ready, error: l.error, fallback: l.triedFallback })); }

  /** global colour multiplier for photographic tiles – used for time-of-day moods */
  setTint(c: THREE.Color) {
    tint.copy(c);
    for (const m of this.materials) m.color.copy(m.userData.base ?? new THREE.Color(1, 1, 1)).multiply(c);
  }

  setErrorTarget(e: number) { e *= this.city.detailScale ?? 1; this.errorTarget = e; for (const l of this.layers) l.tiles.errorTarget = e; }

  memoryUse() { const c = this.layers[0]?.tiles.lruCache as unknown as { cachedBytes: number; maxBytesSize: number }; return c ? c.cachedBytes / c.maxBytesSize : 0; }

  update() {
    this.camera.updateMatrixWorld();
    for (const l of this.layers) {
      l.tiles.setCamera(this.camera);
      l.tiles.setResolutionFromRenderer(this.camera, this.renderer);
      l.tiles.update();
    }
  }

  /** latitude/longitude (degrees) -> local metres; y is the ellipsoid height 0 (use groundAt for terrain) */
  toLocal(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
    const t = this.layers[0].tiles;
    t.group.updateMatrixWorld(true);
    t.ellipsoid.getCartographicToPosition(lat * D2R, lon * D2R, 0, out);
    return out.applyMatrix4(t.group.matrixWorld);
  }

  // ---------------------------------------------------------------- raycasts
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): THREE.Intersection | null {
    this.ray.set(this.v.set(ox, oy, oz), this.d.set(dx, dy, dz).normalize());
    this.ray.far = far;
    this.hits.length = 0;
    for (const l of this.layers) this.ray.intersectObject(l.tiles.group, true, this.hits);
    let best: THREE.Intersection | null = null;
    for (const h of this.hits) if (!best || h.distance < best.distance) best = h;
    return best;
  }

  normalOf(h: THREE.Intersection): THREE.Vector3 {
    return h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
  }

  /** highest surface below maxY (null when nothing is loaded there) */
  groundAt(x: number, z: number, maxY: number): number | null {
    const h = this.cast(x, maxY, z, 0, -1, 0, 4000);
    if (!h) return null;
    this.lastGround = h.point.y;
    return h.point.y;
  }

  surfaceAt(x: number, z: number, maxY: number): number {
    const g = this.groundAt(x, z, maxY + 0.6);
    return g ?? this.lastGround;
  }

  /**
   * Push a sphere out of steep geometry (walls, facades). Walkable surfaces (|n.y| > 0.7)
   * are handled by surfaceAt so cars and frogs don't fight the ground.
   */
  collideSphere(x: number, y: number, z: number, r: number, includeFloors = false): [number, number, number, boolean] {
    let hit = false;
    for (const [dx, dy, dz] of PROBE_DIRS) {
      const h = this.cast(x, y, z, dx, dy, dz, r);
      if (!h) continue;
      const n = this.normalOf(h);
      if (!includeFloors && Math.abs(n.y) > 0.7 && dy !== 1) continue;
      if (n.x * dx + n.y * dy + n.z * dz > 0) n.negate();
      const push = r - h.distance;
      x += n.x * push; y += n.y * push; z += n.z * push;
      hit = true;
    }
    return [x, y, z, hit];
  }

  /**
   * Car collision for photogrammetry: only blocks at real building walls. A wall must be hit
   * horizontally at 2.6 m AND at 7 m above the road at about the same distance with a vertical
   * surface – trees, fences, construction sites, kerbs and "melted" parked cars do not qualify.
   */
  wallCollide(x: number, groundY: number, z: number, r: number): [number, number, boolean] {
    let hit = false;
    for (const [dx, , dz] of PROBE_DIRS) {
      if (dx === 0 && dz === 0) continue;
      const lo = this.cast(x, groundY + 2.6, z, dx, 0, dz, r);
      if (!lo) continue;
      const nl = this.normalOf(lo);
      if (Math.abs(nl.y) > 0.35) continue;
      const hi = this.cast(x, groundY + 7, z, dx, 0, dz, r + 2.5);
      if (!hi || Math.abs(hi.distance - lo.distance) > 1.8 || Math.abs(this.normalOf(hi).y) > 0.35) continue;
      if (nl.x * dx + nl.z * dz > 0) nl.negate();
      const push = r - lo.distance;
      x += nl.x * push; z += nl.z * push;
      hit = true;
    }
    return [x, z, hit];
  }

  /** road height for a car at height y: ignores anything more than ~0.45 m above the wheels (bumps, clutter) */
  roadAt(x: number, z: number, y: number): number | null {
    return this.groundAt(x, z, y + 0.45);
  }

  sweep(ax: number, ay: number, az: number, bx: number, by: number, bz: number): THREE.Intersection | null {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    return this.cast(ax, ay, az, dx, dy, dz, len);
  }

  attributions(): string {
    const parts: string[] = [];
    for (const l of this.layers) {
      const list = l.tiles.getAttributions() as { type: string; value: unknown }[];
      for (const a of list) if (a.type === 'string' && typeof a.value === 'string' && !parts.includes(a.value)) parts.push(a.value);
    }
    return parts.join(' · ');
  }

  dispose() { for (const l of this.layers) l.tiles.dispose(); this.group.removeFromParent(); }
}

const s = Math.SQRT1_2;
const PROBE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [s, 0, -s], [-s, 0, s], [-s, 0, -s], [0, 1, 0], [0, -1, 0],
];
