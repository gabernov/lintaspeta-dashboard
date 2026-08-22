import { useEffect, useRef, useState } from "react";
import { BASEMAPS, ED_BASEMAP_EVENT, getBasemap } from "../lib/basemaps";

/* Topbar dropdown: pick a raster basemap; the choice persists in
   localStorage and editors react via the ed-basemap window event. */
export default function BasemapPicker() {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(() => getBasemap(localStorage.getItem("ed_basemap")));
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (id: string) => {
    const bm = getBasemap(id);
    localStorage.setItem("ed_basemap", bm.id);
    setCurrent(bm);
    setOpen(false);
    window.dispatchEvent(new CustomEvent(ED_BASEMAP_EVENT, { detail: bm.id }));
  };

  return (
    <div className="bm-wrap" ref={wrapRef}>
      <button
        type="button"
        className="topbar-btn bm-btn"
        onClick={() => setOpen((v) => !v)}
        title={`Basemap: ${current.label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="9" />
          <path d="M3.6 9h16.8M3.6 15h16.8M12 3a15.3 15.3 0 0 1 0 18M12 3a15.3 15.3 0 0 0 0 18" />
        </svg>
        <span className="bm-current">{current.label}</span>
      </button>
      {open && (
        <div className="bm-menu" role="menu">
          {BASEMAPS.map((b) => (
            <button
              key={b.id}
              type="button"
              role="menuitem"
              className={`bm-item${b.id === current.id ? " on" : ""}`}
              onClick={() => pick(b.id)}
            >
              <span className="bm-check">{b.id === current.id ? "✓" : ""}</span>
              <span>{b.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
