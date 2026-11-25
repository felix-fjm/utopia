/**
 * Runtime loader for the optimised KitBash3D Utopia kit produced by tools/optimize-assets.mjs.
 *
 * Layout (never committed / published, see .gitignore):
 *   public/assets/utopia/manifest.json
 *   public/assets/utopia/utopia_lod2.glb   (coarse, loaded first -> fast start)
 *   public/assets/utopia/utopia_lod1.glb
 *   public/assets/utopia/utopia_lod0.glb   (full detail, streamed last)
 * One GLB per LOD keeps the kit's 7 shared PBR materials/textures deduplicated in GPU memory.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ArchetypePart, ArchetypeRegistry, Category } from './archetypes';
import { patchMaterial } from './shared';
import { windowMaterials } from './materials';

export interface ManifestModel {
  id: string;
  name: string;
  node: string;          // node name inside each LOD glb
  category: Category;
  height: number;        // metres
  radius: number;        // footprint bounding radius, metres
  triangles: number[];   // per LOD
}

export interface Manifest {
  kit: string;
  test?: boolean;
  generator: string;
  lods: string[];        // relative URLs, index = LOD level
  models: ManifestModel[];
}

export async function fetchManifest(base: string): Promise<Manifest | null> {
  try {
    const r = await fetch(base + 'manifest.json', { cache: 'no-cache' });
    if (!r.ok) return null;
    const ct = r.headers.get('content-type') ?? '';
    if (!ct.includes('json')) return null; // SPA fallbacks return index.html
    return (await r.json()) as Manifest;
  } catch {
    return null;
  }
}

function partsFromNode(root: THREE.Object3D): ArchetypePart[] {
  // keep the node's own transform (meshopt quantisation stores its dequantisation scale/offset there),
  // drop only the parent (scene) transform
  root.updateWorldMatrix(true, true);
  const inv = root.parent ? new THREE.Matrix4().copy(root.parent.matrixWorld).invert() : new THREE.Matrix4();
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mats = Array.isArray(m.material) ? m.material : [m.material];
    const g = dequantize(m.geometry.clone());
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld));
    if (mats.length === 1 || !g.groups.length) {
      const mat = mats[0];
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g);
    } else {
      for (const grp of g.groups) {
        const mat = mats[grp.materialIndex ?? 0];
        const sub = g.index ? extractGroup(g, grp.start, grp.count) : g;
        if (!byMat.has(mat)) byMat.set(mat, []);
        byMat.get(mat)!.push(sub);
      }
    }
  });
  const parts: ArchetypePart[] = [];
  for (const [mat, geos] of byMat) {
    let merged: THREE.BufferGeometry | null = null;
    try { merged = geos.length === 1 ? geos[0] : mergeGeometries(geos.map(normaliseAttrs), false); } catch { merged = null; }
    const list = merged ? [merged] : geos;
    for (const g of list) {
      g.computeBoundingSphere();
      parts.push({ geometry: g, material: mat, castShadow: true });
    }
  }
  return parts;
}

/** Quantised (KHR_mesh_quantization) attributes must become Float32 before transforms are baked in. */
function dequantize(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const name of Object.keys(g.attributes)) {
    const a = g.getAttribute(name) as THREE.BufferAttribute;
    if (a.array instanceof Float32Array && !(a as unknown as { isInterleavedBufferAttribute?: boolean }).isInterleavedBufferAttribute) continue;
    const out = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) out[i * a.itemSize + k] = a.getComponent(i, k);
    g.setAttribute(name, new THREE.BufferAttribute(out, a.itemSize));
  }
  return g;
}

function normaliseAttrs(g: THREE.BufferGeometry): THREE.BufferGeometry {
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'tangent'].includes(k)) g.deleteAttribute(k);
  g.morphAttributes = {};
  return g;
}

function extractGroup(g: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const out = g.clone();
  const idx = g.index!.array.slice(start, start + count);
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  out.clearGroups();
  return out;
}

function prepareMaterial(m: THREE.Material, renderer: THREE.WebGLRenderer) {
  const sm = m as THREE.MeshStandardMaterial;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap'] as const) {
    const t = sm[key] as THREE.Texture | null;
    if (t) t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }
  if (sm.emissiveMap && !windowMaterials.includes(sm)) windowMaterials.push(sm);
  patchMaterial(sm);
}

/**
 * Registers the kit as archetypes and streams LOD2 -> LOD1 -> LOD0.
 * Resolves once the coarse level is usable so the city can appear quickly.
 */
export async function loadUtopia(reg: ArchetypeRegistry, renderer: THREE.WebGLRenderer, base: string, manifest: Manifest,
  progress: (f: number, msg: string) => void): Promise<void> {
  const ktx2 = new KTX2Loader().setTranscoderPath('./assets/basis/').detectSupport(renderer);
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setKTX2Loader(ktx2);
  const order = manifest.lods.map((_, i) => i).reverse(); // coarse first
  const archByNode = new Map<string, ReturnType<ArchetypeRegistry['add']>>();
  let first = true;
  const loadLevel = async (lod: number) => {
    const gltf = await loader.loadAsync(base + manifest.lods[lod], (e) => {
      if (first && e.total) progress(e.loaded / e.total, `Utopia-Assets laden (LOD${lod})`);
    });
    const seen = new Set<THREE.Material>();
    gltf.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) for (const mat of Array.isArray(m.material) ? m.material : [m.material]) if (!seen.has(mat)) { seen.add(mat); prepareMaterial(mat, renderer); }
    });
    if (first) reg.clearBuildings();
    for (const mm of manifest.models) {
      const node = gltf.scene.getObjectByName(mm.node) ?? gltf.scene.getObjectByName(`${mm.node}__lod${lod}`) ?? gltf.scene.getObjectByName(`${mm.node}_lod${lod}`);
      if (!node) continue;
      const parts = partsFromNode(node);
      let a = archByNode.get(mm.node);
      if (!a) {
        const lods: (ArchetypePart[] | null)[] = manifest.lods.map(() => null);
        a = reg.add({ id: mm.id, category: mm.category, height: mm.height, radius: mm.radius, minScale: mm.category === 'landmark' ? 0.95 : 0.85, maxScale: mm.category === 'landmark' ? 1.05 : 1.18, lods, temporary: !!manifest.test, colliderFactor: 0.7 });
        archByNode.set(mm.node, a);
      }
      a.lods[lod] = parts;
    }
    reg.version++;
    if (first) {
      reg.temporary = !!manifest.test;
      reg.kitLabel = manifest.kit;
      first = false;
    }
  };
  await loadLevel(order[0]);
  // refine in the background
  (async () => { for (const l of order.slice(1)) { try { await loadLevel(l); } catch (e) { console.warn('LOD load failed', l, e); } } })();
}
