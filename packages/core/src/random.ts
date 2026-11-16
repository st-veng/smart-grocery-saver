/** Deterministic, stateless hashing PRNG helpers (for mock data). */

/** 32-bit FNV-1a followed by a murmur3-style avalanche — stable across platforms. */
export function hash32(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Uniform [0, 1) derived from the key parts. Same parts → same number, always. */
export function rand01(...parts: readonly (string | number)[]): number {
  return hash32(parts.join('|')) / 4_294_967_296;
}

export function randRange(
  min: number,
  max: number,
  ...parts: readonly (string | number)[]
): number {
  return min + (max - min) * rand01(...parts);
}

export function randInt(
  min: number,
  maxInclusive: number,
  ...parts: readonly (string | number)[]
): number {
  return min + Math.floor(rand01(...parts) * (maxInclusive - min + 1));
}

export function pick<T>(items: readonly T[], ...parts: readonly (string | number)[]): T {
  const item = items[Math.floor(rand01(...parts) * items.length)];
  if (item === undefined) throw new RangeError('pick from empty array');
  return item;
}
