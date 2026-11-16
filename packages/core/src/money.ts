declare const centsBrand: unique symbol;
/** Integer US cents. Never use floats for currency totals. */
export type Cents = number & { readonly [centsBrand]: true };

export function cents(value: number): Cents {
  if (!Number.isInteger(value)) throw new RangeError(`cents must be an integer, got ${value}`);
  return value as Cents;
}

/** Banker's rounding (round half to even) to an integer. Tolerates float noise near .5. */
export function roundHalfEven(value: number): number {
  if (!Number.isFinite(value)) throw new RangeError('roundHalfEven: non-finite value');
  const floor = Math.floor(value);
  const diff = value - floor;
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1;
  return Math.round(value);
}

export function toCents(value: number): Cents {
  return cents(roundHalfEven(value));
}

export function formatCents(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  return `${sign}$${Math.floor(abs / 100).toLocaleString('en-US')}.${String(abs % 100).padStart(2, '0')}`;
}
