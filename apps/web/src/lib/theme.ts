export type ThemePref = 'system' | 'light' | 'dark';
export const THEME_KEY = 'sgs-theme';
export const THEME_ORDER: readonly ThemePref[] = ['system', 'light', 'dark'];

export function isThemePref(v: unknown): v is ThemePref {
  return v === 'system' || v === 'light' || v === 'dark';
}

export function readStoredTheme(
  storage: Pick<Storage, 'getItem'> | undefined = safeStorage(),
): ThemePref {
  try {
    const v = storage?.getItem(THEME_KEY);
    return isThemePref(v) ? v : 'system';
  } catch {
    return 'system';
  }
}

export function storeTheme(
  pref: ThemePref,
  storage: Pick<Storage, 'setItem'> | undefined = safeStorage(),
): void {
  try {
    storage?.setItem(THEME_KEY, pref);
  } catch {
    // Private mode / blocked storage: the theme still applies for this page view.
  }
}

export function resolveDark(pref: ThemePref, systemPrefersDark: boolean): boolean {
  return pref === 'dark' || (pref === 'system' && systemPrefersDark);
}

export function nextTheme(pref: ThemePref): ThemePref {
  const i = THEME_ORDER.indexOf(pref);
  return THEME_ORDER[(i + 1) % THEME_ORDER.length] ?? 'system';
}

export function applyTheme(pref: ThemePref, root: HTMLElement = document.documentElement): void {
  const systemDark =
    typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;
  root.classList.toggle('dark', resolveDark(pref, systemDark));
  root.dataset.theme = pref;
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}
