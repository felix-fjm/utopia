import * as THREE from 'three';
import { patchMaterial, sharedUniforms } from './shared';
import { BLOCK, ROAD_W, BLVD_EVERY, BLVD_W, PARK_T, LANDMARK_P, EDGE_ROAD, DISTRICT_SIZE, CORE_GRID, CORE_SIGMA } from './layout';

const arr = (a: number[]) => `float[5](${a.map((v) => v.toFixed(3)).join(',')})`;

/** GLSL mirror of layout.ts (hash, value noise, districts, streets, parks, plazas). */
const layoutGLSL = /* glsl */ `
uniform int uSeed;
uniform vec2 uOrigin;
float h2(int x, int y, int s) {
  uint h = (uint(x) * 0x27d4eb2du) ^ (uint(y) * 0x165667b1u) ^ (uint(s) * 0x9e3779b1u);
  h = (h ^ (h >> 15u)) * 0x85ebca6bu;
  h = (h ^ (h >> 13u)) * 0xc2b2ae35u;
  h ^= h >> 16u;
  return float(h) * (1.0 / 4294967296.0);
}
float vnoise(vec2 p, int s) {
  vec2 i = floor(p); vec2 f = p - i;
  int xi = int(i.x), yi = int(i.y);
  float a = h2(xi, yi, s), b = h2(xi + 1, yi, s), c = h2(xi, yi + 1, s), d = h2(xi + 1, yi + 1, s);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
const float DSZ = ${DISTRICT_SIZE.toFixed(1)};
const float CGRID = ${CORE_GRID.toFixed(1)};
const float CSIG = ${CORE_SIGMA.toFixed(1)};
const float BLOCK[5] = ${arr(BLOCK)};
const float ROADW[5] = ${arr(ROAD_W)};
const float BLVDN[5] = ${arr(BLVD_EVERY)};
const float BLVDW[5] = ${arr(BLVD_W)};
const float PARKT[5] = ${arr(PARK_T)};
const float LMP[5] = ${arr(LANDMARK_P)};
float coreField(vec2 p) {
  int gx = int(floor(p.x / CGRID)), gz = int(floor(p.y / CGRID));
  float best = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    int cx = gx + i, cz = gz + j;
    vec2 c = vec2((float(cx) + 0.2 + 0.6 * h2(cx, cz, uSeed + 21)) * CGRID, (float(cz) + 0.2 + 0.6 * h2(cx, cz, uSeed + 22)) * CGRID);
    float s = (cx == 0 && cz == 0) ? 1.0 : 0.45 + 0.55 * h2(cx, cz, uSeed + 23);
    vec2 d = p - c;
    best = max(best, s * exp(-dot(d, d) / (2.0 * CSIG * CSIG)));
  }
  return best;
}
struct Dist { vec2 c; int type; float angle; float edge; bool landmark; float plazaR; };
Dist districtAt(vec2 p) {
  int gx = int(floor(p.x / DSZ)), gz = int(floor(p.y / DSZ));
  float d1 = 1e20, d2 = 1e20; vec2 b1 = vec2(0), b2 = vec2(0); int bx = 0, bz = 0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    int cx = gx + i, cz = gz + j;
    vec2 s = vec2((float(cx) + 0.15 + 0.7 * h2(cx, cz, uSeed + 11)) * DSZ, (float(cz) + 0.15 + 0.7 * h2(cx, cz, uSeed + 12)) * DSZ);
    vec2 dd = p - s; float d = dot(dd, dd);
    if (d < d1) { d2 = d1; b2 = b1; d1 = d; b1 = s; bx = cx; bz = cz; }
    else if (d < d2) { d2 = d; b2 = s; }
  }
  Dist r;
  r.c = b1;
  r.edge = (d2 - d1) / (2.0 * length(b2 - b1));
  float core = coreField(b1);
  float hv = h2(bx, bz, uSeed + 13);
  int t = hv < 0.3 ? 1 : hv < 0.62 ? 2 : hv < 0.8 ? 3 : 4;
  if (core > 0.3 && (t == 2 || t == 4)) t = 1;
  if (core > 0.55) t = 0;
  r.type = t;
  r.angle = h2(bx, bz, uSeed + 17) * 1.5707963;
  r.landmark = h2(bx, bz, uSeed + 14) < LMP[t];
  r.plazaR = 80.0 + 70.0 * h2(bx, bz, uSeed + 15);
  return r;
}
`;

const fragMain = /* glsl */ `
  vec2 P = vWorldXZ;
  Dist D = districtAt(P);
  float ca = cos(-D.angle), sa = sin(-D.angle);
  vec2 R = P - D.c;
  vec2 L = vec2(R.x * ca - R.y * sa, R.x * sa + R.y * ca);
  float B = BLOCK[D.type];
  vec2 K = floor(L / B + 0.5);
  float hwx = (mod(K.x, BLVDN[D.type]) == 0.0 ? BLVDW[D.type] : ROADW[D.type]) * 0.5;
  float hwz = (mod(K.y, BLVDN[D.type]) == 0.0 ? BLVDW[D.type] : ROADW[D.type]) * 0.5;
  vec2 A = L - K * B;               // offset from nearest grid lines
  float ex = abs(A.x) - hwx, ez = abs(A.y) - hwz;
  float edge = D.edge - ${EDGE_ROAD.toFixed(1)};
  float sd = min(min(ex, ez), edge);
  float park = vnoise(P / 340.0, uSeed + 50);
  bool isPark = park > PARKT[D.type];
  float plazaD = length(P - D.c);
  bool isPlaza = D.landmark && plazaD < D.plazaR + 12.0;
  float fw = max(fwidth(P.x), fwidth(P.y));
  float fine = 1.0 - smoothstep(0.6, 3.0, fw);      // fade small detail with distance

  float n = vnoise(P / 7.0, uSeed + 90) * 0.5 + vnoise(P / 53.0, uSeed + 91) * 0.5;
  vec3 col; float rough = 0.85; vec3 emis = vec3(0.0);
  vec3 asphalt = vec3(0.075, 0.078, 0.088) * (0.85 + 0.3 * n);
  vec3 walk = vec3(0.42, 0.40, 0.38) * (0.9 + 0.2 * n);
  float bv = h2(int(K.x), int(K.y), uSeed + 93);
  vec3 lot = mix(vec3(0.19, 0.185, 0.18), vec3(0.26, 0.25, 0.235), bv) * (0.85 + 0.3 * n);
  if (sd < 0.0) {
    col = asphalt; rough = 0.55;
    // lane markings along the road direction
    float across, along, hw;
    if (edge == sd) { across = D.edge; along = P.x + P.y; hw = ${EDGE_ROAD.toFixed(1)}; }
    else if (ex < ez) { across = A.x; along = L.y; hw = hwx; }
    else { across = A.y; along = L.x; hw = hwz; }
    float lines = 0.0;
    float dash = step(0.45, fract(along / 9.0));
    for (int li = -2; li <= 2; li++) {
      float pos = float(li) * hw * 0.4;
      float w = li == 0 ? 0.28 : 0.14;
      float m = 1.0 - smoothstep(w, w + fw, abs(across - pos));
      lines = max(lines, m * (li == 0 ? 1.0 : dash));
    }
    lines *= fine;
    col = mix(col, vec3(0.85, 0.82, 0.70), lines * 0.7);
    // glowing light lines in the road (futuristic guidance strips)
    float strip = (1.0 - smoothstep(0.35, 0.35 + fw, abs(abs(across) - hw * 0.85))) * fine;
    emis += vec3(0.2, 0.75, 1.0) * strip * (0.1 + 0.55 * uNight);
    emis += vec3(1.0, 0.75, 0.4) * lines * 0.12 * uNight;
  } else if (isPlaza) {
    float rings = sin(plazaD * 0.55) * 0.5 + 0.5;
    col = mix(vec3(0.62, 0.59, 0.54), vec3(0.72, 0.69, 0.64), rings * fine);
    rough = 0.45;
    float lr = 1.0 - smoothstep(0.3, 0.3 + fw, abs(fract(plazaD / 24.0) - 0.5) * 24.0);
    emis += vec3(1.0, 0.8, 0.55) * lr * fine * 0.9 * uNight;
    if (plazaD < 18.0) { col = vec3(0.12, 0.28, 0.35); rough = 0.05; }
  } else if (isPark && sd > 2.0) {
    float g = vnoise(P / 4.0, uSeed + 92);
    col = mix(vec3(0.16, 0.26, 0.11), vec3(0.26, 0.36, 0.16), g * 0.6 + n * 0.4);
    rough = 0.95;
    float path = 1.0 - smoothstep(1.2, 1.2 + fw, abs(sin(L.x / 37.0 + sin(L.y / 23.0) * 1.7)) * 22.0);
    col = mix(col, vec3(0.55, 0.50, 0.42), path * fine);
  } else if (sd < 6.0) {
    col = walk; rough = 0.7;
    float curb = 1.0 - smoothstep(0.25, 0.25 + fw, sd);
    col = mix(col, vec3(0.65, 0.63, 0.6), curb * fine);
    float lamp = (1.0 - smoothstep(0.0, 1.2 + fw, abs(sd - 1.0))) * step(0.9, fract((ex < ez ? L.y : L.x) / 28.0));
    emis += vec3(1.0, 0.78, 0.5) * lamp * fine * 1.2 * uNight;
  } else {
    col = lot; rough = 0.8;
    if (bv > 0.72) { col = mix(vec3(0.15, 0.22, 0.10), vec3(0.22, 0.30, 0.14), n); rough = 0.95; }
    vec2 tile = abs(fract(L / 6.0) - 0.5);
    col *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.03 + fw / 6.0, min(tile.x, tile.y))) * fine;
  }
  diffuseColor.rgb = col;
  gEmissive = emis;
  gRough = rough;
`;

export class Ground {
  readonly mesh: THREE.Mesh;
  readonly uniforms = { uSeed: { value: 0 }, uOrigin: { value: new THREE.Vector2() } };

  constructor(size: number) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0, envMapIntensity: 0.6 });
    patchMaterial(mat, (shader) => {
      shader.uniforms.uSeed = this.uniforms.uSeed;
      shader.uniforms.uOrigin = this.uniforms.uOrigin;
      shader.uniforms.uNight = sharedUniforms.uNight;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform vec2 uOrigin;\nvarying vec2 vWorldXZ;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz + uOrigin;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec2 vWorldXZ;\n' + layoutGLSL)
        .replace('#include <map_fragment>', 'vec3 gEmissive = vec3(0.0); float gRough = 0.85;\n{' + fragMain + '}')
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;');
    });
    mat.customProgramCacheKey = () => 'utopia-ground';
    const geo = new THREE.PlaneGeometry(1, 1, 1, 1);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -2;
    this.setSize(size);
  }

  setSize(size: number) { this.mesh.scale.set(size, 1, size); }

  update(cam: THREE.Camera, ox: number, oz: number, seed: number) {
    const snap = 64;
    this.mesh.position.set(Math.round(cam.position.x / snap) * snap, 0, Math.round(cam.position.z / snap) * snap);
    this.uniforms.uOrigin.value.set(ox, oz);
    this.uniforms.uSeed.value = seed;
  }
}
