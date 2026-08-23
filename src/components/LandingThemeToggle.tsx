import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  applyThemePreference,
  getThemePreference,
  type ThemePreference,
} from "../lib/theme";

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M8 21h8M12 17v4" />
    </svg>
  );
}

const PREF_ICONS: Record<ThemePreference, ReactNode> = {
  light: <SunIcon />,
  dark: <MoonIcon />,
  system: <MonitorIcon />,
};

const PREF_LABELS: Record<ThemePreference, string> = {
  light: "Terang",
  dark: "Gelap",
  system: "Sistem",
};

const PREF_ORDER: ThemePreference[] = ["light", "dark", "system"];

export default function LandingThemeToggle() {
  const [pref, setPref] = useState<ThemePreference>(getThemePreference);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Follow the OS preference while in "system" mode.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = (e: MediaQueryListEvent) => {
      document.documentElement.dataset.theme = e.matches ? "light" : "dark";
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const apply = (p: ThemePreference) => {
    applyThemePreference(p);
    setPref(p);
    setOpen(false);
  };

  return (
    <div className="landing-theme" ref={rootRef}>
      <button
        type="button"
        className="landing-theme-btn"
        onClick={() => setOpen((v) => !v)}
        aria-label="Ganti tema"
        aria-expanded={open}
        title="Ganti tema (terang / gelap / sistem)"
      >
        {PREF_ICONS[pref]}
      </button>

      {open && (
        <div className="landing-theme-menu" role="menu">
          {PREF_ORDER.map((p) => (
            <button
              key={p}
              type="button"
              role="menuitemradio"
              aria-checked={p === pref}
              className={`landing-theme-option${p === pref ? " landing-theme-option-active" : ""}`}
              onClick={() => apply(p)}
            >
              {PREF_ICONS[p]}
              <span>{PREF_LABELS[p]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
