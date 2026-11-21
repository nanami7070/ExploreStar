/**
 * The deterministic material catalog behind the `density-compare` model.
 *
 * This is the ONLY set of objects the system can simulate. AI-generated tasks
 * may reference these ids when (and only when) the question is about floating
 * and sinking in water — everything else is a real-observation task and must
 * not pretend to have a simulation. Densities are nominal values for dry,
 * solid, fixed-shape objects.
 */
import type { TaskLiquid, TaskMaterial } from '@/lib/inquiry/domain/types';

export const MATERIAL_CATALOG: readonly TaskMaterial[] = [
  { id: 'wood-block', name: '木块', density: 0.5, kind: 'solid' },
  { id: 'plastic-block', name: '塑料块', density: 0.9, kind: 'solid' },
  { id: 'wax-block', name: '蜡块', density: 0.92, kind: 'solid' },
  { id: 'stone-block', name: '石块', density: 2.6, kind: 'solid' },
  {
    id: 'iron-nail',
    name: '铁钉',
    density: 7.8,
    kind: 'solid',
    hazard: '铁钉尖锐，请小心取放，不要对着眼睛',
  },
  { id: 'clay-ball', name: '实心橡皮泥团', density: 1.3, kind: 'solid' },
] as const;

export const LIQUID_CATALOG: readonly TaskLiquid[] = [
  { id: 'water', name: '清水', density: 1.0 },
  { id: 'salt-water', name: '盐水', density: 1.1 },
] as const;

export const MATERIAL_CATALOG_IDS: readonly string[] = MATERIAL_CATALOG.map((m) => m.id);
export const LIQUID_CATALOG_IDS: readonly string[] = LIQUID_CATALOG.map((l) => l.id);

export function catalogMaterial(id: string): TaskMaterial | undefined {
  return MATERIAL_CATALOG.find((material) => material.id === id);
}

export function catalogLiquid(id: string): TaskLiquid | undefined {
  return LIQUID_CATALOG.find((liquid) => liquid.id === id);
}
