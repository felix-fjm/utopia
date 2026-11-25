import * as THREE from 'three';

/** Uniforms shared by every patched material (fog scattering, night factor). */
export const sharedUniforms = {
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunFogColor: { value: new THREE.Color(1, 0.8, 0.6) },
  uFogHeightFalloff: { value: 0.0018 },
  uTime: { value: 0 },
  uNight: { value: 0 },
};

let chunksPatched = false;

/** Replace three's fog with directional, height-attenuated atmospheric perspective:
 *  haze brightens toward the sun and thins out when looking up at tower tops. */
export function patchFogChunks(): void {
  if (chunksPatched) return;
  chunksPatched = true;
  const C = THREE.ShaderChunk as unknown as Record<string, string>;
  C.fog_pars_vertex = `#ifdef USE_FOG\n varying float vFogDepth;\n varying vec3 vFogDir;\n varying float vFogY;\n#endif`;
  C.fog_vertex = `#ifdef USE_FOG\n vFogDepth = - mvPosition.z;\n vFogDir = (vec4(mvPosition.xyz, 0.0) * viewMatrix).xyz;\n vFogY = vFogDir.y + cameraPosition.y;\n#endif`;
  C.fog_pars_fragment = `#ifdef USE_FOG
  uniform vec3 fogColor;
  uniform vec3 uSunDir;
  uniform vec3 uSunFogColor;
  uniform float uFogHeightFalloff;
  varying float vFogDepth;
  varying vec3 vFogDir;
  varying float vFogY;
  #ifdef FOG_EXP2
    uniform float fogDensity;
  #else
    uniform float fogNear;
    uniform float fogFar;
  #endif
#endif`;
  C.fog_fragment = `#ifdef USE_FOG
  vec3 fdir = normalize(vFogDir);
  float sunAmt = pow(max(dot(fdir, uSunDir), 0.0), 5.0);
  vec3 fcol = mix(fogColor, uSunFogColor, sunAmt);
  #ifdef FOG_EXP2
    // height attenuation: integrate exponential density along the ray (approx.)
    float hy = max(vFogY, 0.0);
    float hAtt = exp(-hy * uFogHeightFalloff);
    float dens = fogDensity * mix(0.55, 1.0, hAtt);
    float fogFactor = 1.0 - exp(- dens * dens * vFogDepth * vFogDepth);
  #else
    float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
  #endif
  gl_FragColor.rgb = mix(gl_FragColor.rgb, fcol, fogFactor);
#endif`;
}

/** Attach shared uniforms to a material (needed because the patched fog chunk declares them). */
export function patchMaterial<T extends THREE.Material>(mat: T, extra?: (shader: THREE.WebGLProgramParametersWithUniforms) => void): T {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    shader.uniforms.uSunDir = sharedUniforms.uSunDir;
    shader.uniforms.uSunFogColor = sharedUniforms.uSunFogColor;
    shader.uniforms.uFogHeightFalloff = sharedUniforms.uFogHeightFalloff;
    if (extra) extra(shader);
    prev.call(mat, shader, renderer);
  };
  return mat;
}
