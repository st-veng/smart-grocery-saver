import { UNITS, type UnitCode } from '../units/table.js';

/**
 * Unit price in cents per one `displayUnit`. Unrounded: round only for display.
 * `baseQuantity` is the package size in base units (g / ml / ea); for per-weight items it is the
 * base quantity of one pricing unit (e.g. 453.59237 for per-lb).
 */
export function unitPriceCents(
  priceCents: number,
  baseQuantity: number,
  displayUnit: UnitCode,
): number {
  if (!(baseQuantity > 0)) throw new RangeError('baseQuantity must be > 0');
  return (priceCents / baseQuantity) * UNITS[displayUnit].factor;
}
