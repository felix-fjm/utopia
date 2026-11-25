// Generates a small SYNTHETIC kit in the same layout the Blender exporter produces
// (assets-private/export/utopia_lod{0,1,2}.glb + index.json), so the optimiser and the
// runtime loader can be tested end-to-end without the licensed Utopia files.
// The app labels it "Test-Kit · nicht Utopia".
import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';
import fs from 'node:fs';

const OUT = 'assets-private/export';
fs.mkdirSync(OUT, { recursive: true });
const tex = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#6d86a3' } })
  .composite(Array.from({ length: 64 }, (_, i) => ({ input: { create: { width: 26, height: 22, channels: 3, background: i % 3 ? '#1d2c3d' : '#e9d3a5' } }, left: (i % 8) * 32 + 3, top: Math.floor(i / 8) * 32 + 5 })))
  .png().toBuffer();

function cylinder(seg, r, h, taper) {
  const pos = [], nrm = [], uv = [], idx = [];
  for (let y = 0; y <= 1; y++) for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2, rr = r * (y ? taper : 1);
    pos.push(Math.cos(a) * rr, y * h, Math.sin(a) * rr); nrm.push(Math.cos(a), 0, Math.sin(a)); uv.push((i / seg) * 6, y * h / 20);
  }
  for (let i = 0; i < seg; i++) { const a = i, b = i + 1, c = i + seg + 2, d = i + seg + 1; idx.push(a, d, b, b, d, c); }
  return { pos, nrm, uv, idx };
}
const models = [
  ['test-spire', 420, 32, 0.35], ['test-tower-a', 220, 26, 0.7], ['test-tower-b', 180, 30, 0.9],
  ['test-mid-a', 90, 28, 0.85], ['test-mid-b', 60, 22, 1], ['test-low', 25, 40, 0.95], ['test-civic-hall', 70, 110, 0.6],
];
const io = new NodeIO();
const index = { kit: 'SYNTHETIC TEST KIT (not Utopia)', test: true, unit: 1, lods: 3, models: [] };
for (let l = 0; l < 3; l++) {
  const doc = new Document();
  const buf = doc.createBuffer();
  const img = doc.createTexture('facade').setImage(new Uint8Array(tex)).setMimeType('image/png');
  const mat = doc.createMaterial('glass').setBaseColorTexture(img).setMetallicFactor(0.5).setRoughnessFactor(0.25);
  const scene = doc.createScene();
  for (const [id, h, r, taper] of models) {
    const g = cylinder([48, 16, 6][l], r, h, taper);
    const prim = doc.createPrimitive()
      .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.pos)).setBuffer(buf))
      .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(g.nrm)).setBuffer(buf))
      .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(g.uv)).setBuffer(buf))
      .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(g.idx)).setBuffer(buf))
      .setMaterial(mat);
    scene.addChild(doc.createNode(l ? `${id}__lod${l}` : id).setMesh(doc.createMesh(id).addPrimitive(prim)));
    if (l === 0) index.models.push({ id, name: id === 'test-civic-hall' ? 'KB3D_TEST_CityHall' : id, node: id, height: h, radius: r, triangles: [96, 32, 12] });
  }
  await io.write(`${OUT}/utopia_lod${l}.glb`, doc);
}
fs.writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 2));
console.log('[test-kit] wrote synthetic kit to', OUT);
