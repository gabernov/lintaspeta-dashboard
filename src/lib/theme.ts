export type ThemeMode = "light" | "dark";

const KEY = "lintaspeta_theme";

export const ED_THEME_EVENT = "ed-theme";

export function getSystemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function isSystemMode(): boolean {
  const stored = localStorage.getItem(KEY);
  return stored !== "light" && stored !== "dark";
}

export function getCurrentTheme(): ThemeMode {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return getInitialTheme();
}

export function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return getSystemTheme();
}

function emitTheme(t: ThemeMode) {
  window.dispatchEvent(new CustomEvent(ED_THEME_EVENT, { detail: t }));
}

export function applyTheme(t: ThemeMode) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(KEY, t);
  emitTheme(t);
}

export function applySystemTheme(t: ThemeMode) {
  document.documentElement.dataset.theme = t;
  emitTheme(t);
}

export type ThemePreference = ThemeMode | "system";

export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return "system";
}

export function applyThemePreference(p: ThemePreference) {
  if (p === "system") {
    localStorage.removeItem(KEY);
    const t = getSystemTheme();
    document.documentElement.dataset.theme = t;
    emitTheme(t);
  } else {
    applyTheme(p);
  }
}
