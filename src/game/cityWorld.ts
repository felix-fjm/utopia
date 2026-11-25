import * as THREE from 'three';
import { CityRenderer } from '../world/cityRenderer';
import { CHUNK } from '../world/cityGen';
import { cellContent } from './creatures';
import { MorphWorld } from './morph';

/** MorphWorld backed by the procedural city (flat ground at y = 0, cylinder colliders). */
export function proceduralWorld(city: CityRenderer, seed: () => number, origin: { x: number; z: number }): MorphWorld {
  const tmp = new THREE.Vector3();
  return {
    collide(wx, y, wz, margin) {
      tmp.set(wx - origin.x, y, wz - origin.z);
      const hit = city.collide(tmp, origin.x, origin.z, margin);
      return [tmp.x + origin.x, tmp.y, tmp.z + origin.z, hit];
    },
    surfaceAt(wx, wz, maxY) {
      const cx = Math.floor(wx / CHUNK), cz = Math.floor(wz / CHUNK);
      let s = 0;
      for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
        const c = city.chunks.get(cx + i + ',' + (cz + j));
        if (!c) continue;
        const col = c.colliders;
        for (let k = 0; k < col.length; k += 4) {
          const h = col[k + 3];
          if (h > maxY + 0.6 || h <= s) continue;
          const dx = wx - col[k], dz = wz - col[k + 1], r = col[k + 2] * 0.95;
          if (dx * dx + dz * dz < r * r) s = h;
        }
      }
      return s;
    },
    cell: (cx, cz) => cellContent(seed(), cx, cz),
    groundY: () => 0,
  };
}
