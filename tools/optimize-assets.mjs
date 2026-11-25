// Optimise Blender-exported Utopia LOD GLBs for mobile Safari and write the runtime manifest.
//   node tools/optimize-assets.mjs [--in assets-private/export] [--out public/assets/utopia] [--ktx2]
// - dedup/prune/weld, meshopt geometry compression (EXT_meshopt_compression + quantization)
// - textures resized per LOD (2048/1024/512) and re-encoded as WebP (Safari 14+),
//   or KTX2/Basis (GPU-compressed, lowest memory) with --ktx2 if the KTX-Software `ktx` CLI is installed
// - categorises models (supertower/tower/mid/low/landmark); override with <in>/categories.json
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, meshopt, textureCompress, resample } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const IN = arg('--in', 'assets-private/export');
const OUT = arg('--out', 'public/assets/utopia');
const KTX2 = process.argv.includes('--ktx2');
const TEX = [2048, 1024, 512];

const index = JSON.parse(fs.readFileSync(path.join(IN, 'index.json'), 'utf8'));
const overrides = fs.existsSync(path.join(IN, 'categories.json')) ? JSON.parse(fs.readFileSync(path.join(IN, 'categories.json'), 'utf8')) : {};
fs.mkdirSync(OUT, { recursive: true });

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

let hasKtx = false;
if (KTX2) { try { execFileSync('ktx', ['--version'], { stdio: 'ignore' }); hasKtx = true; } catch { console.warn('[assets] --ktx2 requested but `ktx` CLI not found -> WebP fallback'); } }

const lods = [];
for (let l = 0; l < index.lods; l++) {
  const src = path.join(IN, `utopia_lod${l}.glb`);
  const dst = path.join(OUT, `utopia_lod${l}.glb`);
  const doc = await io.read(src);
  await doc.transform(
    dedup(), prune(), weld(), resample(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', quality: l === 0 ? 85 : 78, resize: [TEX[l] ?? 512, TEX[l] ?? 512] }),
    meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
  );
  await io.write(dst, doc);
  if (hasKtx) {
    // GPU texture compression: ETC1S for colour, UASTC for normal maps (needs @gltf-transform/cli)
    execFileSync('npx', ['--yes', '@gltf-transform/cli', 'etc1s', dst, dst, '--slots', '{baseColorTexture,emissiveTexture}'], { stdio: 'inherit' });
    execFileSync('npx', ['--yes', '@gltf-transform/cli', 'uastc', dst, dst, '--slots', '{normalTexture,metallicRoughnessTexture,occlusionTexture}'], { stdio: 'inherit' });
  }
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`[assets] LOD${l}: ${src} -> ${dst} (${kb} KB)`);
  lods.push(`utopia_lod${l}.glb`);
}

const LANDMARK = /hall|museum|arena|stadium|monument|temple|library|dome|opera|cathedral|capitol|plaza/i;
const models = index.models.map((m) => {
  let category = overrides[m.id];
  if (!category) {
    if (LANDMARK.test(m.name) || m.radius > 95) category = 'landmark';
    else if (m.height >= 300) category = 'supertower';
    else if (m.height >= 140) category = 'tower';
    else if (m.height >= 45) category = 'mid';
    else category = 'low';
  }
  return { id: m.id, name: m.name, node: m.node, category, height: m.height, radius: m.radius, triangles: m.triangles };
});
const manifest = { kit: index.kit, test: !!index.test, generator: 'tools/optimize-assets.mjs', lods, models };
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const counts = models.reduce((a, m) => ((a[m.category] = (a[m.category] || 0) + 1), a), {});
console.log(`[assets] manifest: ${models.length} models`, counts);
console.log('[assets] Reminder: these files are derived from licensed KitBash3D assets – do not commit or deploy them publicly.');
