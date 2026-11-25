export type CityId = 'frankfurt' | 'sydney' | 'hongkong' | 'tokyo';

export interface CityDef {
  id: CityId;
  name: string;
  /** origin of the local frame (degrees) */
  lat: number; lon: number;
  /** start position and the landmark to look at (degrees) */
  start: [number, number]; look: [number, number];
  startAlt: number; // metres above ground
  leftHandTraffic: boolean;
  /** google = Photorealistic 3D Tiles; plateau = PLATEAU buildings (Japan MLIT) + terrain, neon style */
  kind: 'google' | 'plateau';
  /** PLATEAU ward codes to stream */
  wards?: string[];
  preset?: 'golden' | 'day' | 'blue' | 'night';
}

export const CITIES: Record<CityId, CityDef> = {
  frankfurt: { id: 'frankfurt', name: 'Frankfurt am Main', lat: 50.1109, lon: 8.6721, start: [50.1028, 8.6745], look: [50.1125, 8.6722], startAlt: 220, leftHandTraffic: false, kind: 'google' },
  sydney: { id: 'sydney', name: 'Sydney', lat: -33.8610, lon: 151.2108, start: [-33.8520, 151.2235], look: [-33.8568, 151.2153], startAlt: 180, leftHandTraffic: true, kind: 'google' },
  hongkong: { id: 'hongkong', name: 'Hongkong', lat: 22.2830, lon: 114.1590, start: [22.2938, 114.1712], look: [22.2853, 114.1589], startAlt: 260, leftHandTraffic: true, kind: 'google' },
  // Shinjuku: west skyscraper district seen from above Kabukichō / Shinjuku station
  tokyo: { id: 'tokyo', name: 'Neo Tokio', lat: 35.6905, lon: 139.7000, start: [35.6935, 139.7080], look: [35.6895, 139.6925], startAlt: 140, leftHandTraffic: true, kind: 'plateau',
    wards: ['13104', '13113', '13103', '13101', '13102'], preset: 'night' },
};

export function cityFromEnv(param: string | null): CityDef | null {
  const id = (param || (import.meta.env.VITE_CITY as string | undefined) || '').toLowerCase().replace(/[^a-z]/g, '');
  const alias: Record<string, CityId> = { frankfurt: 'frankfurt', ffm: 'frankfurt', sydney: 'sydney', hongkong: 'hongkong', hk: 'hongkong', tokyo: 'tokyo', tokio: 'tokyo', neotokyo: 'tokyo', neotokio: 'tokyo', plateau: 'tokyo' };
  return alias[id] ? CITIES[alias[id]] : null;
}
