export type CityId = 'frankfurt' | 'sydney' | 'hongkong';

export interface CityDef {
  id: CityId;
  name: string;
  /** origin of the local frame (degrees) */
  lat: number; lon: number;
  /** start position and the landmark to look at (degrees) */
  start: [number, number]; look: [number, number];
  startAlt: number; // metres above ground
  leftHandTraffic: boolean;
}

export const CITIES: Record<CityId, CityDef> = {
  frankfurt: { id: 'frankfurt', name: 'Frankfurt am Main', lat: 50.1109, lon: 8.6721, start: [50.1028, 8.6745], look: [50.1125, 8.6722], startAlt: 220, leftHandTraffic: false },
  sydney: { id: 'sydney', name: 'Sydney', lat: -33.8610, lon: 151.2108, start: [-33.8520, 151.2235], look: [-33.8568, 151.2153], startAlt: 180, leftHandTraffic: true },
  hongkong: { id: 'hongkong', name: 'Hongkong', lat: 22.2830, lon: 114.1590, start: [22.2938, 114.1712], look: [22.2853, 114.1589], startAlt: 260, leftHandTraffic: true },
};

export function cityFromEnv(param: string | null): CityDef | null {
  const id = (param || (import.meta.env.VITE_CITY as string | undefined) || '').toLowerCase().replace(/[^a-z]/g, '');
  const alias: Record<string, CityId> = { frankfurt: 'frankfurt', ffm: 'frankfurt', sydney: 'sydney', hongkong: 'hongkong', hk: 'hongkong' };
  return alias[id] ? CITIES[alias[id]] : null;
}
