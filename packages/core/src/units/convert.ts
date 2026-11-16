import { UNITS, type Dimension, type UnitCode } from './table.js';

export function dimensionOf(unit: UnitCode): Dimension {
  return UNITS[unit].dimension;
}

/** Quantity in `unit` → base units (g / ml / ea). */
export function toBase(quantity: number, unit: UnitCode): number {
  return quantity * UNITS[unit].factor;
}

/** Base units → quantity in `unit`. */
export function fromBase(baseQuantity: number, unit: UnitCode): number {
  return baseQuantity / UNITS[unit].factor;
}

export function convert(quantity: number, from: UnitCode, to: UnitCode): number {
  if (dimensionOf(from) !== dimensionOf(to)) {
    throw new RangeError(
      `Cannot convert ${from} (${dimensionOf(from)}) to ${to} (${dimensionOf(to)})`,
    );
  }
  return fromBase(toBase(quantity, from), to);
}

/** Base quantity of a package: pack_count × unit_quantity × factor (mirrors the generated DB column). */
export function packageBaseQuantity(
  packCount: number,
  unitQuantity: number,
  unit: UnitCode,
): number {
  if (!Number.isInteger(packCount) || packCount < 1)
    throw new RangeError('packCount must be a positive integer');
  if (!(unitQuantity > 0)) throw new RangeError('unitQuantity must be > 0');
  return packCount * toBase(unitQuantity, unit);
}

export interface BridgeResult {
  readonly baseQuantity: number;
  readonly approximate: boolean;
}

/**
 * Express a base quantity of one dimension in another. Only count↔mass is bridgeable,
 * and only with an average weight per each; such results are flagged approximate.
 */
export function bridgeBase(
  baseQuantity: number,
  from: Dimension,
  to: Dimension,
  avgEachGrams: number | null,
): BridgeResult | null {
  if (from === to) return { baseQuantity, approximate: false };
  if (avgEachGrams === null || !(avgEachGrams > 0)) return null;
  if (from === 'count' && to === 'mass')
    return { baseQuantity: baseQuantity * avgEachGrams, approximate: true };
  if (from === 'mass' && to === 'count')
    return { baseQuantity: baseQuantity / avgEachGrams, approximate: true };
  return null;
}
