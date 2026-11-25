/**
 * "Neo Tokyo" look for untextured PLATEAU buildings: one shared material that draws a
 * world-space window grid on every facade (glass by day, lit offices and neon bands by night)
 * and a wet, reflective street surface. One material for all tiles = one shader program.
 */
import * as THREE from 'three';
import { patchMaterial, sharedUniforms } from '../world/shared';

let facade: THREE.MeshStandardMaterial | null = null;
let ground: THREE.MeshStandardMaterial | null = null;

const hashGLSL = /* glsl */ `
float nh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(nh(i), nh(i + vec2(1, 0)), f.x), mix(nh(i + vec2(0, 1)), nh(i + vec2(1, 1)), f.x), f.y); }
`;

export function neonFacadeMaterial(): THREE.MeshStandardMaterial {
  if (facade) return facade;
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, metalness: 0.3, envMapIntensity: 0.7 });
  patchMaterial(m, (sh) => {
    sh.uniforms.uNight = sharedUniforms.uNight;
    sh.uniforms.uTime = sharedUniforms.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nvarying vec3 vWN;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nuniform float uTime;\nvarying vec3 vWP;\nvarying vec3 vWN;\n' + hashGLSL)
      .replace('#include <map_fragment>', /* glsl */ `
        vec3 nW = normalize(vWN);
        float roof = smoothstep(0.55, 0.75, abs(nW.y));
        vec2 tg = normalize(vec2(-nW.z, nW.x) + 1e-5);
        float u = dot(vWP.xz, tg) / 2.4;
        float fl = vWP.y / 3.6;
        vec2 cellId = vec2(floor(u), floor(fl));
        vec2 f = vec2(fract(u), fract(fl));
        float win = step(0.12, f.x) * step(f.x, 0.88) * step(0.26, f.y) * step(f.y, 0.88);
        vec2 region = floor(vWP.xz / 35.0);
        float bh = nh(region * 0.37 + 3.1);                     // per-building-ish variation
        // offices are lit in runs of windows per floor, not like static noise
        vec2 run = vec2(floor(u / 5.0), cellId.y);
        float litRatio = mix(0.10, 0.36, bh);
        float lit = step(1.0 - litRatio, nh(run * 0.173 + region * 1.31)) * step(0.15, nh(cellId * 0.71));
        // thin neon strip along a slab every few floors (some buildings only)
        float band = step(0.72, bh) * (1.0 - step(0.045, fract(fl / 7.0 + bh)));
        // vertical neon edge strips on a few towers
        float edge = step(0.9, nh(region + 9.1)) * (1.0 - step(0.05, fract(u / 11.0 + bh)));
        float aa = clamp(1.0 - max(fwidth(u), fwidth(fl)) * 1.8, 0.0, 1.0);
        win = mix(0.55, win, aa);
        lit = mix(litRatio * 0.85, lit, aa);
        band *= aa; edge *= aa;
        float glass = win * (1.0 - roof);
        vec3 concrete = mix(vec3(0.20, 0.21, 0.24), vec3(0.30, 0.30, 0.32), bh);
        vec3 glassCol = mix(vec3(0.05, 0.08, 0.12), vec3(0.10, 0.12, 0.16), bh);
        diffuseColor.rgb = mix(concrete, glassCol, glass);
        vec3 warm = mix(vec3(1.0, 0.76, 0.46), vec3(0.62, 0.86, 1.0), step(0.68, nh(cellId + 7.7)));
        vec3 neonC = mix(vec3(1.0, 0.2, 0.7), vec3(0.2, 0.95, 1.0), step(0.5, nh(region + 2.2)));
        float flick = 0.85 + 0.15 * sin(uTime * 3.0 + bh * 40.0);
        gEmissive = warm * glass * lit * (0.04 + 0.85 * uNight)
                  + neonC * (band + edge) * (1.0 - roof) * (0.3 + 2.2 * uNight) * flick
                  + vec3(0.9, 0.2, 0.25) * roof * step(0.985, nh(floor(vWP.xz / 6.0))) * 3.0 * uNight; // roof beacons
        gRough = mix(0.75, 0.18, glass);
        gMetal = mix(0.05, 0.6, glass);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = gRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = gMetal;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += gEmissive;')
      .replace('void main() {', 'void main() {\nvec3 gEmissive = vec3(0.0); float gRough = 0.6; float gMetal = 0.3;');
  });
  m.customProgramCacheKey = () => 'neon-facade';
  facade = m;
  return m;
}

export function wetGroundMaterial(): THREE.MeshStandardMaterial {
  if (ground) return ground;
  const m = new THREE.MeshStandardMaterial({ color: 0x1c1d22, roughness: 0.5, metalness: 0.2, envMapIntensity: 1.4 });
  patchMaterial(m, (sh) => {
    sh.uniforms.uNight = sharedUniforms.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
      .replace('#include <fog_vertex>', '#include <fog_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying vec3 vWP;\n' + hashGLSL)
      .replace('#include <roughnessmap_fragment>', /* glsl */ `#include <roughnessmap_fragment>
        float puddle = smoothstep(0.52, 0.68, vn(vWP.xz / 7.0) * 0.6 + vn(vWP.xz / 29.0) * 0.4);
        roughnessFactor = mix(0.55, mix(0.32, 0.06, puddle), uNight);
        diffuseColor.rgb *= mix(1.0, 0.55, puddle * uNight);`);
  });
  m.customProgramCacheKey = () => 'wet-ground';
  ground = m;
  return m;
}
