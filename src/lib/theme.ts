export type ThemeMode = "light" | "dark";

const KEY = "lintaspeta_theme";

export function getSystemTheme(): ThemeMode {
  return window.matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

export function isSystemMode(): boolean {
  const stored = localStorage.getItem(KEY);
  return stored !== "light" && stored !== "dark";
}

export function getInitialTheme(): ThemeMode {
  const stored = localStorage.getItem(KEY);
  if (stored === "light" || stored === "dark") return stored;
  return getSystemTheme();
}

export function applyTheme(t: ThemeMode) {
  document.documentElement.dataset.theme = t;
  localStorage.setItem(KEY, t);
}