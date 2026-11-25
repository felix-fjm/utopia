// Builds a synthetic 3D Tiles city geo-located in Frankfurt (same format/frames as Google's
// Photorealistic 3D Tiles: ECEF tileset with an ENU root transform, glTF y-up content, unlit
// material) plus a matching Overpass/OSM response. Used by tests/real.mjs, never shipped.
import { Document, NodeIO } from '@gltf-transform/core';
import { KHRMaterialsUnlit } from '@gltf-transform/extensions';
import fs from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const OUT = arg('--out', process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'public/test-tiles');
const LAT0 = parseFloat(arg('--lat', '50.1109')), LON0 = parseFloat(arg('--lon', '8.6721'));   // default = CITIES.frankfurt origin
const SPLIT = process.argv.includes('--split');   // PLATEAU-like: separate buildings + ground tilesets, lit material
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
const mat = (rgb) => SPLIT ? doc.createMaterial().setBaseColorFactor([...rgb, 1]) : doc.createMaterial().setBaseColorFactor([...rgb, 1]).setExtension('KHR_materials_unlit', unlit.createUnlit());
const pos = [], nrm = [], idx = [];
function quad(p0, p1, p2, p3, n) {
  const o = pos.length / 3;
  for (const p of [p0, p1, p2, p3]) { pos.push(...p); nrm.push(...n); }
  idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
}
function box(e, n, w, d, h, y0 = 0) {
  const x0 = e - w / 2, x1 = e + w / 2, z0 = -(n + d / 2), z1 = -(n - d / 2), t = y0 + h;
  quad([x0, t, z0], [x0, t, z1], [x1, t, z1], [x1, t, z0], [0, 1, 0]);
  quad([x0, y0, z1], [x1, y0, z1], [x1, t, z1], [x0, t, z1], [0, 0, 1]);
  quad([x1, y0, z0], [x0, y0, z0], [x0, t, z0], [x1, t, z0], [0, 0, -1]);
  quad([x1, y0, z1], [x1, y0, z0], [x1, t, z0], [x1, t, z1], [1, 0, 0]);
  quad([x0, y0, z0], [x0, y0, z1], [x0, t, z1], [x0, t, z0], [-1, 0, 0]);
}
for (const b of buildings) box(b.e, b.n, b.w, b.d, b.h);
// photogrammetry-style clutter on one street (east = 40, lane at +3.5): melted parked car,
// construction fence, speed bump, tree (trunk + canopy), kerb-high slab
const clutter = [];
const LANE = 43.5;
for (const [kind, n] of [['car', -295], ['fence', -255], ['bump', -235], ['tree', -175], ['slab', -140], ['car', -110], ['tree', -60]]) {
  if (kind === 'car') { box(LANE, n, 2.0, 4.6, 1.5); clutter.push({ kind, n, h: 1.5 }); }
  if (kind === 'fence') { box(LANE, n, 7.0, 0.15, 1.9); clutter.push({ kind, n, h: 1.9 }); }
  if (kind === 'bump') { box(LANE, n, 7.0, 0.9, 0.3); clutter.push({ kind, n, h: 0.3 }); }
  if (kind === 'slab') { box(LANE, n, 7.0, 6.0, 0.18); clutter.push({ kind, n, h: 0.18 }); }
  if (kind === 'tree') { box(LANE, n, 0.45, 0.45, 3.2); box(LANE, n, 5.0, 5.0, 4.5, 3.0); clutter.push({ kind, n, h: 7.5 }); }
}
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
fs.mkdirSync(OUT, { recursive: true });
const io = new NodeIO().registerExtensions([KHRMaterialsUnlit]);
const tileset = (uri) => JSON.stringify({ asset: { version: '1.0' }, geometricError: 2000,
  root: { transform, boundingVolume: { box: [0, 0, 150, HALF, 0, 0, 0, HALF, 0, 0, 0, 160] }, geometricError: 0, refine: 'REPLACE', content: { uri } } });
if (SPLIT) {
  doc.createScene().addChild(doc.createNode('buildings').setMesh(doc.createMesh('b').addPrimitive(bPrim)));
  await io.write(`${OUT}/buildings.glb`, doc);
  // ground as its own document
  const gdoc = new Document(); const gbuf = gdoc.createBuffer();
  const gm = gdoc.createMaterial().setBaseColorFactor([0.3, 0.3, 0.3, 1]);
  const acc = (t, a) => gdoc.createAccessor().setType(t).setArray(a).setBuffer(gbuf);
  const gpr = gdoc.createPrimitive().setAttribute('POSITION', acc('VEC3', new Float32Array(gp))).setAttribute('NORMAL', acc('VEC3', new Float32Array(gn))).setIndices(acc('SCALAR', new Uint32Array(gi))).setMaterial(gm);
  gdoc.createScene().addChild(gdoc.createNode('ground').setMesh(gdoc.createMesh('g').addPrimitive(gpr)));
  await io.write(`${OUT}/ground.glb`, gdoc);
  fs.writeFileSync(`${OUT}/buildings.json`, tileset('buildings.glb'));
  fs.writeFileSync(`${OUT}/ground.json`, tileset('ground.glb'));
} else {
  const mesh = doc.createMesh('city').addPrimitive(bPrim).addPrimitive(gPrim);
  doc.createScene().addChild(doc.createNode('city').setMesh(mesh));
  await io.write(`${OUT}/city.glb`, doc);
  fs.writeFileSync(`${OUT}/tileset.json`, tileset('city.glb'));
}

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
fs.writeFileSync(`${OUT}/osm.json`, JSON.stringify({ elements, testBuildings: buildings.map((b) => ({ ...ll(b.e, b.n), w: b.w, d: b.d, h: b.h })), testLane: { start: ll(LANE, -330), end: ll(LANE, -20), clutter: clutter.map((c) => ({ ...c, ...ll(LANE, c.n) })) } }));
console.log(`[test-tiles] ${buildings.length} buildings, ${parks.length} parks, ${elements.length} OSM ways -> ${OUT}`);
