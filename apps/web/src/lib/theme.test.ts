import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  nextTheme,
  readStoredTheme,
  resolveDark,
  storeTheme,
  THEME_KEY,
} from './theme';

describe('theme', () => {
  it('cycles system → light → dark → system', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('resolves dark from preference and system setting', () => {
    expect(resolveDark('dark', false)).toBe(true);
    expect(resolveDark('light', true)).toBe(false);
    expect(resolveDark('system', true)).toBe(true);
    expect(resolveDark('system', false)).toBe(false);
  });

  it('persists, and ignores invalid or unavailable storage', () => {
    storeTheme('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    expect(readStoredTheme()).toBe('dark');
    localStorage.setItem(THEME_KEY, 'purple');
    expect(readStoredTheme()).toBe('system');
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readStoredTheme(throwing)).toBe('system');
    expect(() => {
      storeTheme('dark', throwing);
    }).not.toThrow();
  });

  it('applies the dark class to the root element', () => {
    applyTheme('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    applyTheme('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
