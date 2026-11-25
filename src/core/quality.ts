export type QualityName = 'performance' | 'balanced' | 'high' | 'ultra';

export interface QualitySettings {
  name: QualityName;
  /** Max device pixel ratio the adaptive resolution may use */
  maxPixelRatio: number;
  minPixelRatio: number;
  /** Radius (m) in which city chunks are streamed */
  viewRadius: number;
  /** Distances (m) at which chunks switch to LOD1 / LOD2 */
  lod1: number;
  lod2: number;
  shadows: boolean;
  shadowMapSize: number;
  antialias: boolean;
  vehicles: number;
  /** Chunks generated per frame budget */
  genBudget: number;
}

export const QUALITY: Record<QualityName, QualitySettings> = {
  performance: { name: 'performance', maxPixelRatio: 1.25, minPixelRatio: 0.7, viewRadius: 2600, lod1: 450, lod2: 1100, shadows: false, shadowMapSize: 1024, antialias: false, vehicles: 120, genBudget: 3 },
  balanced:    { name: 'balanced',    maxPixelRatio: 2.0,  minPixelRatio: 0.9, viewRadius: 3600, lod1: 650, lod2: 1600, shadows: false, shadowMapSize: 1024, antialias: false, vehicles: 220, genBudget: 4 },
  high:        { name: 'high',        maxPixelRatio: 2.5,  minPixelRatio: 1.0, viewRadius: 4800, lod1: 900, lod2: 2200, shadows: true,  shadowMapSize: 2048, antialias: true,  vehicles: 320, genBudget: 6 },
  ultra:       { name: 'ultra',       maxPixelRatio: 3.0,  minPixelRatio: 1.25, viewRadius: 6500, lod1: 1300, lod2: 3000, shadows: true,  shadowMapSize: 4096, antialias: true,  vehicles: 450, genBudget: 8 },
};

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

export function isTouchDevice(): boolean {
  return navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}

/** Initial pick. iPhone 16 Pro (A18 Pro) handles "balanced" comfortably; adaptive
 *  resolution then trades pixels for frame time before geometry is sacrificed. */
export function autoQuality(): QualityName {
  const q = new URLSearchParams(location.search).get('quality') as QualityName | null;
  if (q && q in QUALITY) return q;
  if (isIOS() || isTouchDevice()) return 'balanced';
  return 'high';
}
