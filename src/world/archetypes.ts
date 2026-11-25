import * as THREE from 'three';

export type Category = 'supertower' | 'tower' | 'mid' | 'low' | 'landmark';
/** Infrastructure archetypes are placed with non-uniform matrices (roads, bridges, trees…). */
export type InfraKind = 'deck' | 'pillar' | 'bridge' | 'tree' | 'rail';

export interface ArchetypePart {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  castShadow?: boolean;
}

export interface Archetype {
  index: number;
  id: string;
  category: Category | 'infra';
  infra?: InfraKind;
  /** native height (m) at scale 1 */
  height: number;
  /** footprint bounding radius (m) at scale 1 */
  radius: number;
  /** allowed uniform scale range; tight for real assets to preserve proportions */
  minScale: number;
  maxScale: number;
  /** LOD levels, index 0 = most detailed. Entries may be null until streamed in. */
  lods: (ArchetypePart[] | null)[];
  temporary: boolean;
  /** collision cylinder radius = radius * colliderFactor (0 disables) */
  colliderFactor?: number;
}

export class ArchetypeRegistry {
  readonly list: Archetype[] = [];
  readonly byCategory = new Map<string, Archetype[]>();
  readonly infra = new Map<InfraKind, Archetype>();
  /** true when buildings come from placeholder geometry instead of the Utopia kit */
  temporary = true;
  kitLabel = '';
  version = 0;
  /** bumped when the building set changes (chunks must be regenerated) */
  layoutVersion = 0;

  add(a: Omit<Archetype, 'index'>): Archetype {
    const arch = { ...a, index: this.list.length } as Archetype;
    this.list.push(arch);
    const key = arch.infra ? 'infra:' + arch.infra : arch.category;
    if (!this.byCategory.has(key)) this.byCategory.set(key, []);
    this.byCategory.get(key)!.push(arch);
    if (arch.infra) this.infra.set(arch.infra, arch);
    this.version++;
    return arch;
  }

  /** Remove all building archetypes (keep infra) – used when real assets replace placeholders. */
  clearBuildings(): void {
    const keep = this.list.filter((a) => a.category === 'infra');
    this.list.length = 0;
    this.byCategory.clear();
    this.infra.clear();
    for (const a of keep) this.add(a);
    this.layoutVersion++;
  }

  buildings(cat: Category): Archetype[] {
    return this.byCategory.get(cat) ?? [];
  }

  /** Best available LOD at or coarser/finer than requested. */
  resolveLod(a: Archetype, lod: number): number {
    if (a.lods[lod]) return lod;
    for (let l = lod + 1; l < a.lods.length; l++) if (a.lods[l]) return l;
    for (let l = lod - 1; l >= 0; l--) if (a.lods[l]) return l;
    return -1;
  }
}
