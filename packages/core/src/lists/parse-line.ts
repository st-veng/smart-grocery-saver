/**
 * Parse one free-text grocery-list line ("2 lb ground beef", "milk x2", "1/2 gal oj", "dozen eggs")
 * into quantity, unit and the item name used for product matching (SPEC Phase 3).
 */
import type { UnitCode } from '../units/table.js';

export interface ParsedLine {
  readonly raw: string;
  readonly name: string;
  readonly quantity: number;
  /** A measure (lb, gal, oz…) or null, meaning "packages" (cans, bags, plain counts). */
  readonly unit: UnitCode | null;
  readonly notes: string | null;
}

/** Measures that become list-item units. Bare "oz" is mass; product matching may turn it into fl_oz. */
const MEASURES: readonly (readonly [RegExp, UnitCode])[] = [
  [/^(?:fl\.?\s*oz\.?|floz|fluid\s+ounces?)$/, 'fl_oz'],
  [/^(?:oz\.?|ounces?)$/, 'oz'],
  [/^(?:lbs?\.?|pounds?|#)$/, 'lb'],
  [/^(?:kg|kgs|kilos?|kilograms?)$/, 'kg'],
  [/^(?:g|grams?)$/, 'g'],
  [/^(?:ml|milliliters?|millilitres?)$/, 'ml'],
  [/^(?:l|liters?|litres?)$/, 'l'],
  [/^(?:gal\.?|gallons?)$/, 'gal'],
  [/^(?:qt\.?|quarts?)$/, 'qt'],
  [/^(?:pt\.?|pints?)$/, 'pt'],
  [/^(?:dozen|doz\.?|dz)$/, 'dozen'],
  [/^(?:ct\.?|count|ea\.?|each)$/, 'ea'],
];

/** Container words: the quantity counts packages, so the unit stays null. */
const CONTAINERS =
  /^(?:cans?|bags?|box(?:es)?|jars?|bottles?|packs?|pks?|pkgs?|packages?|bunch(?:es)?|heads?|loaf|loaves|cartons?|containers?|tubs?|rolls?|bars?|sticks?|pouches|pouch|cases?|tins?|blocks?)$/;

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  couple: 2,
  half: 0.5,
};

const UNICODE_FRACTIONS: Readonly<Record<string, string>> = {
  '½': ' 1/2',
  '¼': ' 1/4',
  '¾': ' 3/4',
  '⅓': ' 1/3',
  '⅔': ' 2/3',
};

const NUMBER = String.raw`\d+\s+\d+/\d+|\d+/\d+|\d*\.\d+|\d+`;

function toNumber(t: string): number {
  const s = t.trim();
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = /^(\d+)\/(\d+)$/.exec(s);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s);
}

export function measureUnit(token: string): UnitCode | null {
  const t = token.trim().toLowerCase();
  for (const [re, code] of MEASURES) if (re.test(t)) return code;
  return null;
}

export function isContainerWord(token: string): boolean {
  return CONTAINERS.test(token.trim().toLowerCase());
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function parseListLine(input: string): ParsedLine | null {
  const raw = input.trim();
  if (raw === '' || raw.startsWith('#') || raw.startsWith('//')) return null;

  let s = raw
    .replace(/[½¼¾⅓⅔]/g, (c) => UNICODE_FRACTIONS[c] ?? c)
    .replace(/\s+/g, ' ')
    .trim();
  // Bullets, checkboxes and list numbering: "- milk", "* milk", "[ ] milk", "1. milk", "2) milk".
  s = s.replace(/^(?:[-*•·–]\s*|\[[ xX✓]?\]\s*|\d+[.)]\s+)+/, '');

  let notes: string | null = null;
  const paren = /\s*\(([^)]*[A-Za-z][^)]*)\)\s*$/.exec(s);
  if (paren?.[1]) {
    notes = paren[1].trim();
    s = s.slice(0, paren.index);
  }

  // Trailing multiplier: "milk x2", "milk × 2", "eggs (2)", "bread - 2", "bread *2".
  let mult = 1;
  const tail = /\s*(?:[x×*]\s*(\d+)|\((\d+)\)|-\s*(\d+))\s*$/i.exec(s);
  if (tail && tail.index > 0) {
    mult = Number(tail[1] ?? tail[2] ?? tail[3]);
    s = s.slice(0, tail.index);
  }

  // Glued numbers and units: "16oz cheddar" → "16 oz cheddar".
  s = s.replace(/^(\d+(?:\.\d+)?)([a-zA-Z#])/, '$1 $2').trim();

  let quantity = 1;
  let unit: UnitCode | null = null;
  const lower = s.toLowerCase();
  // A number glued to % ("2% milk") is part of the name, not a quantity.
  const num = new RegExp(`^(${NUMBER})(?![\\d.%/])\\s*`).exec(lower);
  let rest = s;
  if (num?.[1]) {
    quantity = toNumber(num[1]);
    rest = s.slice(num[0].length);
  } else {
    const word =
      /^(a couple of|a couple|couple of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half(?:\s+a)?)\s+/i.exec(
        s,
      );
    if (word?.[1]) {
      const key = word[1].toLowerCase().replace(/^a /, '').replace(/ of$/, '').replace(/ a$/, '');
      quantity = WORD_NUMBERS[key] ?? 1;
      rest = s.slice(word[0].length);
    }
  }

  // Optional unit token after the number (or a bare leading "dozen eggs" / "gallon of milk").
  const unitTok = /^([a-zA-Z#][a-zA-Z.#]*(?:\s+oz\.?)?)\s*(?:of\s+)?/.exec(rest);
  if (unitTok?.[1]) {
    const candidate = unitTok[1];
    const m = measureUnit(candidate);
    const tokenEnd = unitTok[0].length;
    const nameAfter = rest.slice(tokenEnd).trim();
    if (m && nameAfter.length === 0 && num) return null; // "2 lb" — a measure with no item
    if (m && nameAfter.length > 0) {
      unit = m;
      rest = nameAfter;
    } else if (
      isContainerWord(candidate) &&
      nameAfter.length > 0 &&
      (num || quantity !== 1 || /^(a|an)\b/i.test(s))
    ) {
      rest = nameAfter;
    }
  }

  const name = rest
    .replace(/^of\s+/i, '')
    .replace(/[,;:\s]+$/, '')
    .trim();
  if (name === '' || !/[a-z]/i.test(name)) return null;
  quantity = round(quantity * mult);
  if (!(quantity > 0) || quantity > 9999) return null;
  return { raw, name, quantity, unit, notes };
}
