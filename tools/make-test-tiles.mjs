// Builds a synthetic 3D Tiles city geo-located in Frankfurt (same format/frames as Google's
// Photorealistic 3D Tiles: ECEF tileset with an ENU root transform, glTF y-up content, unlit
// material) plus a matching Overpass/OSM response. Used by tests/real.mjs, never shipped.
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import fs from 'node:fs';

const OUT = process.argv[2] || 'public/test-tiles';
const LAT0 = 50.1109, LON0 = 8.6721;            // = CITIES.frankfurt origin
const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
const D2R = Math.PI / 180;
const phi = LAT0 * D2R, lam = LON0 * D2R;
const N = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
const M = (a * (1 - e2)) / Math.pow(1 - e2 * Math.sin(phi) ** 2, 1.5);
const ecef = [N * Math.cos(phi) * Math.cos(lam), N * Math.cos(phi) * Math.sin(lam), N * (1 - e2) * Math.sin(phi)];
const E = [-Math.sin(lam), Math.cos(lam), 0];
const Nn = [-Math.sin(phi) * Math.cos(lam), -Math.sin(phi) * Math.sin(lam), Math.cos(phi)];
const U = [Math.cos(phi) * Math.cos(lam), Math.cos(phi) * Math.sin(lam), Math.sin(phi)];
const transform = [...E, 0, ...Nn, 0, ...U, 0, ...ecef, 1]; // column-major ENU -> ECEF
const ll = (east, north) => ({ lat: LAT0 + (north / M) / D2R, lon: LON0 + (east / (N * Math.cos(phi))) / D2R });

// ---- city layout (ENU metres)
const HALF = 1400, BLOCK = 120, ROAD = 16;
const buildings = [];
const parks = [];
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let bx = -HALF; bx < HALF; bx += BLOCK) for (let bz = -HALF; bz < HALF; bz += BLOCK) {
  const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
  // a park east of the centre, one north-west
  if ((cx > 100 && cx < 400 && cz > -300 && cz < -60) || (cx > -500 && cx < -250 && cz > 200 && cz < 450)) { parks.push([bx + ROAD / 2, bz + ROAD / 2, bx + BLOCK - ROAD / 2, bz + BLOCK - ROAD / 2]); continue; }
  const w = 40 + rnd() * 50, d = 40 + rnd() * 50, h = 15 + Math.pow(rnd(), 2) * (Math.hypot(cx, cz) < 600 ? 230 : 70);
  buildings.push({ e: cx, n: cz, w, d, h });
}

// ---- glTF (y-up: x = east, y = up, z = -north)
const doc = new Document();
const unlit = doc.createExtension(KHRMaterialsUnlit);
const buf = doc.createBuffer();
const mat = (rgb) => doc.createMaterial().setBaseColorFactor([...rgb, 1]).setExtension('KHR_materials_unlit', unlit.createUnlit());
const pos = [], nrm = [], idx = [];
function quad(p0, p1, p2, p3, n) {
  const o = pos.length / 3;
  for (const p of [p0, p1, p2, p3]) { pos.push(...p); nrm.push(...n); }
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
function box(e, n, w, d, h) {
  const x0 = e - w / 2, x1 = e + w / 2, z0 = -(n + d / 2), z1 = -(n - d / 2);
  quad([x0, h, z0], [x0, h, z1], [x1, h, z1], [x1, h, z0], [0, 1, 0]);
  quad([x0, 0, z1], [x1, 0, z1], [x1, h, z1], [x0, h, z1], [0, 0, 1]);
  quad([x1, 0, z0], [x0, 0, z0], [x0, h, z0], [x1, h, z0], [0, 0, -1]);
  quad([x1, 0, z1], [x1, 0, z0], [x1, h, z0], [x1, h, z1], [1, 0, 0]);
  quad([x0, 0, z0], [x0, 0, z1], [x0, h, z1], [x0, h, z0], [-1, 0, 0]);
}
for (const b of buildings) box(b.e, b.n, b.w, b.d, b.h);
const mkPrim = (p, nn, ii, m) => doc.createPrimitive()
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(p)).setBuffer(buf))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(nn)).setBuffer(buf))
  .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(ii)).setBuffer(buf)).setMaterial(m);
const bPrim = mkPrim(pos, nrm, idx, mat([0.62, 0.6, 0.58]));
// ground: subdivided plane
const gp = [], gn = [], gi = [];
const S = 28, step = (2 * HALF) / S;
for (let j = 0; j <= S; j++) for (let i = 0; i <= S; i++) { gp.push(-HALF + i * step, 0, -HALF + j * step); gn.push(0, 1, 0); }
for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) { const o = j * (S + 1) + i; gi.push(o, o + S + 1, o + 1, o + 1, o + S + 1, o + S + 2); }
const gPrim = mkPrim(gp, gn, gi, mat([0.25, 0.26, 0.28]));
const mesh = doc.createMesh('city').addPrimitive(bPrim).addPrimitive(gPrim);
doc.createScene().addChild(doc.createNode('city').setMesh(mesh));
fs.mkdirSync(OUT, { recursive: true });
await new NodeIO().registerExtensions([KHRMaterialsUnlit]).write(`${OUT}/city.glb`, doc);

fs.writeFileSync(`${OUT}/tileset.json`, JSON.stringify({
  asset: { version: '1.1' }, geometricError: 2000,
  root: { transform, boundingVolume: { box: [0, 0, 150, HALF, 0, 0, 0, HALF, 0, 0, 0, 160] }, geometricError: 0, refine: 'REPLACE', content: { uri: 'city.glb' } },
}));

// ---- OSM (Overpass JSON)
const elements = [];
let id = 1;
for (let k = -HALF; k <= HALF; k += BLOCK) {
  const main = Math.abs(k) % 480 === 0;
  const hw = main ? 'primary' : 'residential';
  elements.push({ type: 'way', id: id++, tags: { highway: hw, width: '16' }, geometry: [ll(k, -HALF + 20), ll(k, HALF - 20)] });  // north-south street (constant east)
  elements.push({ type: 'way', id: id++, tags: { highway: hw, width: '16' }, geometry: [ll(-HALF + 20, k), ll(HALF - 20, k)] });  // east-west street
}
for (const [x0, z0, x1, z1] of parks) elements.push({ type: 'way', id: id++, tags: { leisure: 'park' }, geometry: [ll(x0, z0), ll(x1, z0), ll(x1, z1), ll(x0, z1), ll(x0, z0)] });
fs.writeFileSync(`${OUT}/osm.json`, JSON.stringify({ elements, testBuildings: buildings.map((b) => ({ ...ll(b.e, b.n), w: b.w, d: b.d, h: b.h })) }));
console.log(`[test-tiles] ${buildings.length} buildings, ${parks.length} parks, ${elements.length} OSM ways -> ${OUT}`);
