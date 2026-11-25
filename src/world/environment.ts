import * as THREE from 'three';
import { sharedUniforms, patchMaterial } from './shared';
import { windowMaterials, stripMaterials } from './materials';

export type PresetName = 'golden' | 'day' | 'blue' | 'night';

interface Preset {
  label: string;
  sunElev: number; sunAz: number;
  lightElevMin: number;
  sunColor: string; sunIntensity: number;
  hemiSky: string; hemiGround: string; hemiIntensity: number;
  zenith: string; horizon: string; ground: string;
  fog: string; sunFog: string; haze: number;
  exposure: number; env: number;
  windows: number; strips: number;
  clouds: number; cloudLit: string; cloudShade: string;
  stars: number; sunDisc: number;
  night: number;
}

export const PRESETS: Record<PresetName, Preset> = {
  golden: { label: 'Golden Hour', sunElev: 7, sunAz: 228, lightElevMin: 7, sunColor: '#ffb06a', sunIntensity: 3.4, hemiSky: '#a9b9d6', hemiGround: '#5b4535', hemiIntensity: 0.75,
    zenith: '#3b5f93', horizon: '#f2b07a', ground: '#4a3a30', fog: '#d3a88f', sunFog: '#e9b493', haze: 1.1, exposure: 0.95, env: 1.0,
    windows: 0.12, strips: 0.9, clouds: 0.5, cloudLit: '#ffcf9c', cloudShade: '#8a7c8e', stars: 0, sunDisc: 1, night: 0.15 },
  day: { label: 'Tageslicht', sunElev: 52, sunAz: 200, lightElevMin: 0, sunColor: '#fff5e8', sunIntensity: 3.6, hemiSky: '#c4d8f2', hemiGround: '#6f675d', hemiIntensity: 1.0,
    zenith: '#2a68bd', horizon: '#cfe0f0', ground: '#6b665f', fog: '#c3d5e7', sunFog: '#eef1f2', haze: 0.85, exposure: 0.85, env: 1.0,
    windows: 0.0, strips: 0.25, clouds: 0.38, cloudLit: '#ffffff', cloudShade: '#a8b6c8', stars: 0, sunDisc: 1, night: 0 },
  blue: { label: 'Blaue Stunde', sunElev: -4, sunAz: 250, lightElevMin: 14, sunColor: '#7f90d4', sunIntensity: 0.55, hemiSky: '#6077b0', hemiGround: '#2b2b3b', hemiIntensity: 0.95,
    zenith: '#0d1b46', horizon: '#d78b75', ground: '#24222e', fog: '#4f5d8c', sunFog: '#c98673', haze: 1.0, exposure: 1.15, env: 0.9,
    windows: 0.7, strips: 1.1, clouds: 0.32, cloudLit: '#d796a0', cloudShade: '#3d4366', stars: 0.25, sunDisc: 0, night: 0.75 },
  night: { label: 'Nacht', sunElev: 38, sunAz: 140, lightElevMin: 0, sunColor: '#9db1ff', sunIntensity: 0.32, hemiSky: '#1c2548', hemiGround: '#0b0b12', hemiIntensity: 0.55,
    zenith: '#02040d', horizon: '#18203d', ground: '#08080c', fog: '#1d2238', sunFog: '#2c3560', haze: 1.0, exposure: 1.3, env: 0.6,
    windows: 1.05, strips: 1.6, clouds: 0.25, cloudLit: '#39415e', cloudShade: '#141826', stars: 1, sunDisc: 0, night: 1 },
};

const skyVert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = vec4(p.xy, p.w * 0.99999, p.w);
}`;

const noiseGLSL = /* glsl */ `
float hh(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y); }
float fbm3(vec2 p) { return 0.5 * vn(p) + 0.25 * vn(p * 2.03 + 7.1) + 0.125 * vn(p * 4.11 + 3.7) + 0.0625 * vn(p * 8.3 + 1.3); }
`;

const skyFrag = /* glsl */ `
uniform vec3 uZenith, uHorizon, uGround, uSunDir, uSunColor, uFog, uSunFog;
uniform float uSunDisc, uStars;
varying vec3 vDir;
${noiseGLSL}
void main() {
  vec3 d = normalize(vDir);
  float y = d.y;
  float mu = max(dot(d, uSunDir), 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(clamp(y, 0.0, 1.0), 0.45));
  // warm forward scattering band near the horizon around the sun
  col += uSunColor * (0.25 * pow(mu, 6.0) + 0.5 * pow(mu, 48.0)) * (1.0 - 0.6 * clamp(y * 2.0, 0.0, 1.0));
  // below/at the horizon the sky must equal the fogged ground colour so the world edge is invisible
  vec3 haze = mix(uFog, uSunFog, pow(mu, 5.0));
  col = mix(col, haze, 1.0 - smoothstep(-0.005, 0.16, y));
  col += uSunColor * uSunDisc * smoothstep(0.9993, 0.9997, mu) * 18.0;
  gl_FragColor = vec4(col, 1.0);
}`;

const cloudFrag = /* glsl */ `
uniform vec3 uSunDir, uLit, uShade;
uniform float uCover, uTime, uStars;
varying vec3 vDir;
${noiseGLSL}
void main() {
  vec3 d = normalize(vDir);
  if (d.y < 0.01) discard;
  vec2 uv = d.xz / (d.y + 0.12) * 1.6 + vec2(uTime * 0.0035, uTime * 0.0012);
  float n = fbm3(uv);
  float c = smoothstep(1.0 - uCover, 1.0 - uCover + 0.32, n);
  float mu = max(dot(d, uSunDir), 0.0);
  float thick = smoothstep(0.4, 0.95, n);
  vec3 col = mix(uLit, uShade, thick * 0.75) + uLit * pow(mu, 8.0) * 0.6;
  float a = c * smoothstep(0.01, 0.18, d.y) * 0.9;
  if (uStars > 0.0) {
    vec2 sp = vec2(atan(d.z, d.x) * 520.0, asin(d.y) * 520.0);
    vec2 cell = floor(sp);
    float s = hh(cell);
    vec2 f = fract(sp) - 0.5;
    float star = step(0.9965, s) * smoothstep(0.5, 0.1, length(f)) * (0.35 + 0.65 * hh(cell + 3.0));
    star *= uStars * smoothstep(0.05, 0.3, d.y) * (1.0 - c);
    col = mix(col, vec3(0.85, 0.9, 1.0) * 1.6, star / max(a + star, 1e-3));
    a = max(a, star);
  }
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** Sky, clouds, lights, fog and image-based lighting with four time-of-day presets. */
export class Environment {
  readonly sun = new THREE.DirectionalLight('#ffffff', 3);
  readonly hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  readonly fog = new THREE.FogExp2('#cccccc', 0.0004);
  private skyScene = new THREE.Scene();
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  readonly cloudDome: THREE.Mesh;
  private cubeRT: THREE.WebGLCubeRenderTarget;
  private cubeCam: THREE.CubeCamera;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  current: PresetName = 'golden';
  sunDir = new THREE.Vector3();
  private shadowExtent = 420;

  constructor(private renderer: THREE.WebGLRenderer, private scene: THREE.Scene) {
    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false,
      uniforms: { uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uGround: { value: new THREE.Color() },
        uSunDir: { value: new THREE.Vector3() }, uSunColor: { value: new THREE.Color() }, uSunDisc: { value: 1 }, uStars: { value: 0 }, uFog: { value: new THREE.Color() }, uSunFog: { value: new THREE.Color() } },
    });
    this.skyScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), this.skyMat));
    this.cubeRT = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter });
    this.cubeCam = new THREE.CubeCamera(0.1, 100, this.cubeRT);
    this.pmrem = new THREE.PMREMGenerator(renderer);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: skyVert, fragmentShader: cloudFrag, side: THREE.BackSide, transparent: true, depthWrite: false, fog: false,
      uniforms: { uSunDir: sharedUniforms.uSunDir, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uCover: { value: 0.4 }, uTime: sharedUniforms.uTime, uStars: { value: 0 } },
    });
    this.cloudDome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.cloudMat);
    this.cloudDome.frustumCulled = false;
    this.cloudDome.renderOrder = -1;
    this.cloudDome.matrixAutoUpdate = true;
    scene.add(this.cloudDome);

    this.sun.castShadow = false;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 1.2;
    const sc = this.sun.shadow.camera;
    sc.left = -this.shadowExtent; sc.right = this.shadowExtent; sc.top = this.shadowExtent; sc.bottom = -this.shadowExtent;
    sc.near = 10; sc.far = 4000;
    scene.add(this.sun, this.sun.target, this.hemi);
    scene.fog = this.fog;
  }

  setShadows(on: boolean, size: number) {
    this.sun.castShadow = on;
    if (on && this.sun.shadow.mapSize.x !== size) {
      this.sun.shadow.mapSize.set(size, size);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null as unknown as THREE.WebGLRenderTarget;
    }
  }

  apply(name: PresetName, viewRadius: number) {
    const p = PRESETS[name];
    this.current = name;
    const el = THREE.MathUtils.degToRad(p.sunElev), az = THREE.MathUtils.degToRad(p.sunAz);
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    sharedUniforms.uSunDir.value.copy(this.sunDir);
    sharedUniforms.uSunFogColor.value.set(p.sunFog);
    sharedUniforms.uNight.value = p.night;
    const u = this.skyMat.uniforms;
    u.uZenith.value.set(p.zenith); u.uHorizon.value.set(p.horizon); u.uGround.value.set(p.ground);
    u.uSunDir.value.copy(this.sunDir); u.uSunColor.value.set(p.sunColor);
    u.uSunDisc.value = p.sunDisc; u.uStars.value = p.stars;
    u.uFog.value.set(p.fog); u.uSunFog.value.set(p.sunFog);
    this.cloudMat.uniforms.uLit.value.set(p.cloudLit);
    this.cloudMat.uniforms.uShade.value.set(p.cloudShade);
    this.cloudMat.uniforms.uCover.value = p.clouds;
    this.cloudMat.uniforms.uStars.value = p.stars;

    this.sun.color.set(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemiIntensity;
    this.fog.color.set(p.fog);
    this.setViewRadius(viewRadius);
    this.renderer.toneMappingExposure = p.exposure;
    for (const m of windowMaterials) m.emissiveIntensity = p.windows;
    for (const m of stripMaterials) m.emissiveIntensity = p.strips;

    // render the sky into a cube map -> background + PMREM image based lighting
    this.cubeCam.update(this.renderer, this.skyScene);
    this.scene.background = this.cubeRT.texture;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromCubemap(this.cubeRT.texture);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = p.env;
  }

  setViewRadius(r: number) {
    const p = PRESETS[this.current];
    this.fog.density = (1.55 / r) * p.haze;
    this.cloudDome.scale.setScalar(r * 2.2);
  }

  /** Keep shadow frustum and sky dome around the camera. */
  update(cam: THREE.Camera) {
    this.cloudDome.position.copy(cam.position);
    const lightDir = this.sunDir.clone();
    const p = PRESETS[this.current];
    const minEl = THREE.MathUtils.degToRad(Math.max(p.lightElevMin, 4));
    if (lightDir.y < Math.sin(minEl)) { lightDir.y = Math.sin(minEl); lightDir.normalize(); }
    // snap the focus to shadow texels to avoid shimmering
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    const fx = Math.round(cam.position.x / texel) * texel, fz = Math.round(cam.position.z / texel) * texel;
    const fy = Math.max(0, Math.min(cam.position.y - 60, 200));
    this.sun.target.position.set(fx, fy, fz);
    this.sun.position.set(fx + lightDir.x * 2000, fy + lightDir.y * 2000, fz + lightDir.z * 2000);
    this.sun.target.updateMatrixWorld();
  }
}

export { patchMaterial };
