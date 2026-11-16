import { describe, expect, it } from 'vitest';
import { loadConfig } from './config.js';

describe('loadConfig', () => {
  it('applies defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({ PORT: 4000, PRICE_PROVIDER: 'mock', METRO: 'DFW' });
    expect(c.SEED_ANCHOR_DATE).toBeUndefined();
  });

  it('treats an empty SEED_ANCHOR_DATE as unset and validates a given one', () => {
    expect(loadConfig({ SEED_ANCHOR_DATE: '' }).SEED_ANCHOR_DATE).toBeUndefined();
    expect(loadConfig({ SEED_ANCHOR_DATE: '2026-11-01' }).SEED_ANCHOR_DATE).toBe('2026-11-01');
    expect(() => loadConfig({ SEED_ANCHOR_DATE: '2026-13-01' })).toThrow(/SEED_ANCHOR_DATE/);
  });

  it('fails fast listing every invalid variable', () => {
    expect(() => loadConfig({ PORT: 'abc', PRICE_PROVIDER: 'real' })).toThrow(
      /PORT[\s\S]*PRICE_PROVIDER/,
    );
  });
});
