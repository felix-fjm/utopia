/**
 * Google Photorealistic 3D Tiles (via Google Map Tiles API or Cesium ion) as a playable world:
 * streamed with 3DTilesRendererJS, re-oriented so the city centre is the origin with +Y up
 * (metres), and made collidable with BVH-accelerated raycasts.
 */
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, CesiumIonAuthPlugin, GLTFExtensionsPlugin, ReorientationPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from 'three-mesh-bvh';
import { CityDef } from './cities';
import { patchMaterial } from '../world/shared';

(THREE.BufferGeometry.prototype as unknown as { computeBoundsTree: unknown }).computeBoundsTree = computeBoundsTree;
(THREE.BufferGeometry.prototype as unknown as { disposeBoundsTree: unknown }).disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

export type AuthKind = 'ion' | 'google' | 'url';
export interface TilesAuth { kind: AuthKind; key: string; }

const D2R = Math.PI / 180;
const tint = new THREE.Color(1, 1, 1);

export class TilesWorld {
  readonly tiles: TilesRenderer;
  ready = false;
  error = '';
  private ray = new THREE.Raycaster();
  private hits: THREE.Intersection[] = [];
  private v = new THREE.Vector3();
  private d = new THREE.Vector3();
  private lastGround = 0;
  private materials = new Set<THREE.MeshBasicMaterial | THREE.MeshStandardMaterial>();
  loadedOnce = false;

  constructor(private renderer: THREE.WebGLRenderer, private camera: THREE.PerspectiveCamera, readonly city: CityDef, auth: TilesAuth) {
    const tiles = auth.kind === 'url' ? new TilesRenderer(auth.key) : new TilesRenderer();
    if (auth.kind === 'google') tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: auth.key, autoRefreshToken: true }));
    if (auth.kind === 'ion') tiles.registerPlugin(new CesiumIonAuthPlugin({ apiToken: auth.key, assetId: '2275207', autoRefreshToken: true }));
    const draco = new DRACOLoader().setDecoderPath('./assets/draco/');
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
    tiles.registerPlugin(new TileCompressionPlugin());
    tiles.registerPlugin(new TilesFadePlugin());
    tiles.registerPlugin(new ReorientationPlugin({ lat: city.lat * D2R, lon: city.lon * D2R, height: 0 }));
    tiles.errorTarget = 10;
    tiles.setCamera(camera);
    tiles.setResolutionFromRenderer(camera, renderer);
    this.ray.firstHitOnly = true;
    (this.ray as unknown as { firstHitOnly: boolean }).firstHitOnly = true;

    tiles.addEventListener('load-root-tileset', () => { this.ready = true; });
    tiles.addEventListener('tiles-load-end', () => { this.loadedOnce = true; });
    tiles.addEventListener('load-error', (e: { error?: Error; url?: string }) => {
      const msg = String(e?.error?.message ?? e?.error ?? '');
      if (!this.ready) this.error = msg || 'Kacheln konnten nicht geladen werden';
    });
    tiles.addEventListener('load-model', ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (m.geometry as unknown as { computeBoundsTree: () => void }).computeBoundsTree();
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
    });
    tiles.addEventListener('dispose-model', ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        (m.geometry as unknown as { disposeBoundsTree: () => void }).disposeBoundsTree();
        for (const mat of (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshBasicMaterial[]) this.materials.delete(mat);
      });
    });
    this.tiles = tiles;
  }

  /** global colour multiplier for the (unlit, photographic) tiles – used for time-of-day moods */
  setTint(c: THREE.Color) {
    tint.copy(c);
    for (const m of this.materials) m.color.copy(m.userData.base ?? new THREE.Color(1, 1, 1)).multiply(c);
  }

  setErrorTarget(e: number) { this.tiles.errorTarget = e; }

  update() {
    this.camera.updateMatrixWorld();
    this.tiles.setCamera(this.camera);
    this.tiles.setResolutionFromRenderer(this.camera, this.renderer);
    this.tiles.update();
  }

  /** latitude/longitude (degrees) -> local metres; y is the ellipsoid height 0 (use groundAt for terrain) */
  toLocal(lat: number, lon: number, out = new THREE.Vector3()): THREE.Vector3 {
    this.tiles.group.updateMatrixWorld(true);
    this.tiles.ellipsoid.getCartographicToPosition(lat * D2R, lon * D2R, 0, out);
    return out.applyMatrix4(this.tiles.group.matrixWorld);
  }

  // ---------------------------------------------------------------- raycasts
  cast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, far: number): THREE.Intersection | null {
    this.ray.set(this.v.set(ox, oy, oz), this.d.set(dx, dy, dz).normalize());
    this.ray.far = far;
    this.hits.length = 0;
    this.ray.intersectObject(this.tiles.group, true, this.hits);
    let best: THREE.Intersection | null = null;
    for (const h of this.hits) if (!best || h.distance < best.distance) best = h;
    return best;
  }

  private normalOf(h: THREE.Intersection): THREE.Vector3 {
    const n = h.face ? h.face.normal.clone().transformDirection(h.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
    return n;
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
    const dirs = PROBE_DIRS;
    for (const [dx, dy, dz] of dirs) {
      const h = this.cast(x, y, z, dx, dy, dz, r);
      if (!h) continue;
      const n = this.normalOf(h);
      if (!includeFloors && Math.abs(n.y) > 0.7 && dy !== 1) continue;
      // make the normal face the probe origin
      if (n.x * dx + n.y * dy + n.z * dz > 0) n.negate();
      const push = r - h.distance;
      x += n.x * push; y += n.y * push; z += n.z * push;
      hit = true;
    }
    return [x, y, z, hit];
  }

  /** swept test for fast flight: returns the hit point distance along the segment or -1 */
  sweep(ax: number, ay: number, az: number, bx: number, by: number, bz: number): THREE.Intersection | null {
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return null;
    return this.cast(ax, ay, az, dx, dy, dz, len);
  }

  attributions(): string {
    const list = this.tiles.getAttributions() as { type: string; value: unknown }[];
    const parts: string[] = [];
    for (const a of list) if (a.type === 'string' && typeof a.value === 'string') parts.push(a.value);
    return parts.join(' · ');
  }

  dispose() { this.tiles.dispose(); }
}

const s = Math.SQRT1_2;
const PROBE_DIRS: [number, number, number][] = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [s, 0, s], [s, 0, -s], [-s, 0, s], [-s, 0, -s], [0, 1, 0], [0, -1, 0],
];
