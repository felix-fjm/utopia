/**
 * Real streets and parks from OpenStreetMap (Overpass API), converted into the local frame,
 * so parked cars stand on real lanes (correct side of the road per country) and frogs sit in
 * real parks. Data © OpenStreetMap contributors (ODbL).
 */
import { Rng, hash2 } from '../core/rng';
import { CELL, CellContent, CarSpot, FrogSpot, OrbSpot, CAR_COLORS } from '../game/creatures';

export interface LatLon { lat: number; lon: number; }
interface OverpassWay { type: string; id: number; tags?: Record<string, string>; geometry?: LatLon[]; }

interface Seg { ax: number; az: number; bx: number; bz: number; len: number; half: number; lanes: number; oneway: boolean; kind: string; }
interface Poly { pts: [number, number][]; minx: number; minz: number; maxx: number; maxz: number; }

const ROAD_TYPES = 'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';
const ROAD_HALF: Record<string, number> = { motorway: 7, trunk: 6.5, primary: 6, secondary: 5, tertiary: 4.5, unclassified: 3.5, residential: 3.5, living_street: 3, service: 2.5 };

export const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

export async function fetchOsm(lat: number, lon: number, radius: number, override?: string): Promise<OverpassWay[]> {
  if (override) { const r = await fetch(override); return ((await r.json()) as { elements: OverpassWay[] }).elements; }
  const q = `[out:json][timeout:40];(way["highway"~"^(${ROAD_TYPES})$"](around:${radius},${lat},${lon});way["leisure"~"^(park|garden|playground)$"](around:${radius},${lat},${lon});way["landuse"~"^(grass|recreation_ground|village_green)$"](around:${radius},${lat},${lon}););out geom;`;
  let lastErr: unknown;
  for (const url of OVERPASS) {
    try {
      const r = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return ((await r.json()) as { elements: OverpassWay[] }).elements;
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

function inPoly(x: number, z: number, p: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, zi] = p[i], [xj, zj] = p[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

export class OsmIndex {
  private segCells = new Map<string, Seg[]>();
  private polys: Poly[] = [];
  private polyCells = new Map<string, Poly[]>();
  roadsKm = 0;
  parks = 0;

  constructor(ways: OverpassWay[], toLocal: (lat: number, lon: number) => [number, number], private seed: number, private leftHand: boolean) {
    for (const w of ways) {
      const t = w.tags ?? {};
      const g = w.geometry;
      if (!g || g.length < 2) continue;
      if (t.highway) {
        if (t.tunnel === 'yes' || t.tunnel === 'building_passage' || (t.layer && parseInt(t.layer) < 0)) continue;
        if (t.service === 'parking_aisle' || t.access === 'private') continue;
        const kind = t.highway.replace('_link', '');
        let half = ROAD_HALF[kind] ?? 3.5;
        const lanes = parseInt(t.lanes ?? '') || (half >= 5 ? 4 : 2);
        if (t.width && parseFloat(t.width) > 3) half = parseFloat(t.width) / 2;
        const oneway = t.oneway === 'yes' || kind === 'motorway';
        let prev = toLocal(g[0].lat, g[0].lon);
        for (let i = 1; i < g.length; i++) {
          const cur = toLocal(g[i].lat, g[i].lon);
          const len = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
          if (len > 2) {
            const seg: Seg = { ax: prev[0], az: prev[1], bx: cur[0], bz: cur[1], len, half, lanes, oneway, kind };
            this.roadsKm += len / 1000;
            // index into every cell the segment touches (sampled)
            const n = Math.ceil(len / (CELL / 2));
            const keys = new Set<string>();
            for (let k = 0; k <= n; k++) { const tt = k / n; keys.add(Math.floor((seg.ax + (seg.bx - seg.ax) * tt) / CELL) + ',' + Math.floor((seg.az + (seg.bz - seg.az) * tt) / CELL)); }
            for (const key of keys) { if (!this.segCells.has(key)) this.segCells.set(key, []); this.segCells.get(key)!.push(seg); }
          }
          prev = cur;
        }
      } else {
        const pts = g.map((p) => toLocal(p.lat, p.lon));
        let minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
        for (const [x, z] of pts) { minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z); }
        if ((maxx - minx) * (maxz - minz) < 300) continue;
        const poly: Poly = { pts, minx, minz, maxx, maxz };
        this.polys.push(poly);
        this.parks++;
        for (let cx = Math.floor(minx / CELL); cx <= Math.floor(maxx / CELL); cx++) for (let cz = Math.floor(minz / CELL); cz <= Math.floor(maxz / CELL); cz++) {
          const key = cx + ',' + cz;
          if (!this.polyCells.has(key)) this.polyCells.set(key, []);
          this.polyCells.get(key)!.push(poly);
        }
      }
    }
  }

  private inPark(x: number, z: number): boolean {
    const list = this.polyCells.get(Math.floor(x / CELL) + ',' + Math.floor(z / CELL));
    if (!list) return false;
    for (const p of list) if (x >= p.minx && x <= p.maxx && z >= p.minz && z <= p.maxz && inPoly(x, z, p.pts)) return true;
    return false;
  }

  /** sample points on the streets of a cell (for neon signs): position, direction, half width */
  roadSamples(cx: number, cz: number, n: number): { x: number; z: number; dx: number; dz: number; half: number }[] {
    const segs = (this.segCells.get(cx + ',' + cz) ?? []).filter((s) => s.kind !== 'motorway' && s.kind !== 'service');
    if (!segs.length) return [];
    const rng = new Rng(Math.floor(hash2(cx, cz, this.seed + 515) * 4294967296));
    const total = segs.reduce((a, s) => a + s.len, 0);
    const out: { x: number; z: number; dx: number; dz: number; half: number }[] = [];
    const x0 = cx * CELL, z0 = cz * CELL;
    for (let i = 0; i < n * 3 && out.length < n; i++) {
      let r = rng.next() * total, seg = segs[0];
      for (const s of segs) { if ((r -= s.len) <= 0) { seg = s; break; } }
      const t = rng.next();
      const x = seg.ax + (seg.bx - seg.ax) * t, z = seg.az + (seg.bz - seg.az) * t;
      if (x < x0 || x >= x0 + CELL || z < z0 || z >= z0 + CELL) continue;
      out.push({ x, z, dx: (seg.bx - seg.ax) / seg.len, dz: (seg.bz - seg.az) / seg.len, half: seg.half });
    }
    return out;
  }

  /** deterministic content of one streaming cell */
  cell(cx: number, cz: number): CellContent {
    const rng = new Rng(Math.floor(hash2(cx, cz, this.seed + 4242) * 4294967296));
    const base = ((cx * 92821 + cz * 68917) & 0xffffff) * 64;
    const segs = this.segCells.get(cx + ',' + cz) ?? [];
    const x0 = cx * CELL, z0 = cz * CELL;
    const inCell = (x: number, z: number) => x >= x0 && x < x0 + CELL && z >= z0 && z < z0 + CELL;
    const cars: CarSpot[] = [], frogs: FrogSpot[] = [], orbs: OrbSpot[] = [];
    const total = segs.reduce((a, s) => a + s.len, 0);
    const pickSeg = () => { let r = rng.next() * total; for (const s of segs) { if ((r -= s.len) <= 0) return s; } return segs[segs.length - 1]; };
    const lanePoint = (s: Seg, t: number, lateral: number) => {
      const dx = (s.bx - s.ax) / s.len, dz = (s.bz - s.az) / s.len;
      // right normal of the segment direction in a y-up frame
      const rx = -dz, rz = dx;
      return { x: s.ax + (s.bx - s.ax) * t + rx * lateral, z: s.az + (s.bz - s.az) * t + rz * lateral, dx, dz };
    };
    if (segs.length) {
      const want = Math.min(6, Math.round(total / 60));
      for (let i = 0; i < want * 3 && cars.length < want; i++) {
        const s = pickSeg();
        if (s.kind === 'motorway' && rng.next() < 0.5) continue;
        const t = 0.1 + rng.next() * 0.8;
        // driving side: right-hand traffic -> lane on the right of the travel direction
        let dirSign = rng.next() < 0.5 ? 1 : -1;
        if (s.oneway) dirSign = 1;
        const sideOfTravel = this.leftHand ? -1 : 1;
        const laneOff = s.oneway ? (rng.next() - 0.5) * s.half : sideOfTravel * dirSign * s.half * 0.5;
        const p = lanePoint(s, t, laneOff);
        if (!inCell(p.x, p.z)) continue;
        if (cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 9)) continue;
        const hx = p.dx * dirSign, hz = p.dz * dirSign;
        cars.push({ id: base + cars.length, x: p.x, z: p.z, h: Math.atan2(-hx, -hz), color: Math.floor(rng.next() * CAR_COLORS.length) });
      }
      // orb in the middle of a calm street
      for (let i = 0; i < 6; i++) {
        const s = pickSeg();
        const p = lanePoint(s, 0.3 + rng.next() * 0.4, 0);
        if (!inCell(p.x, p.z) || cars.some((c) => Math.hypot(c.x - p.x, c.z - p.z) < 12)) continue;
        if (rng.next() < 0.8) orbs.push({ id: base + 40, x: p.x, z: p.z, hue: rng.next() });
        break;
      }
      // a few frogs on the pavement next to small streets
      for (let i = 0; i < 4 && frogs.length < 1; i++) {
        const s = pickSeg();
        if (s.half > 4 || rng.next() < 0.5) continue;
        const p = lanePoint(s, rng.next(), (rng.next() < 0.5 ? -1 : 1) * (s.half + 1.6));
        if (inCell(p.x, p.z)) frogs.push({ id: base + 20 + frogs.length, x: p.x, z: p.z, period: 2 + rng.next() * 3, phase: rng.next() * 10, range: 3, scale: 2.2 });
      }
    }
    // frogs and an orb in parks
    let parkOrb = false;
    for (let i = 0; i < 24 && frogs.length < 4; i++) {
      const x = x0 + rng.next() * CELL, z = z0 + rng.next() * CELL;
      if (!this.inPark(x, z)) continue;
      if (!parkOrb && rng.next() < 0.5) { orbs.push({ id: base + 41, x, z, hue: rng.next() }); parkOrb = true; continue; }
      frogs.push({ id: base + 20 + frogs.length, x, z, period: 2 + rng.next() * 3, phase: rng.next() * 10, range: 8, scale: 2.2 });
    }
    return { cars, frogs, orbs };
  }
}
