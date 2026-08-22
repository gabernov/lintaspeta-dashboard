import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { BASEMAPS, ED_BASEMAP_EVENT, getBasemap } from "../lib/basemaps";

/* Topbar dropdown: pick a raster basemap; the choice persists in
   localStorage and editors react via the ed-basemap window event.
   Only rendered on map routes (pathname starts with /dataset/). */
export default function BasemapPicker() {
  const location = useLocation();
  const isMapRoute = location.pathname.startsWith("/dataset/");
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

  if (!isMapRoute) return null;

  return (
    <div className="bm-wrap" ref={wrapRef}>
      <button
        type="button"
        className="topbar-btn bm-btn"
        onClick={() => setOpen((v) => !v)}
        title={`Ganti peta dasar — ${current.label}`}
        aria-label={`Peta dasar: ${current.label}`}
        aria-haspopup="true"
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
          <path d="M9 4v14" />
          <path d="M15 6v14" />
        </svg>
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
