import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  GEO_ATTRIBUTION,
  type PlaceHit,
  type RoadHit,
  type SearchHit,
  emitSearchSelection,
  geocodePlaces,
  getSharedRoads,
  parseCoordInput,
  searchRoads,
} from "../../lib/editorSearch";

type Results = {
  coord: Extract<SearchHit, { kind: "coord" }> | null;
  places: PlaceHit[];
  roads: RoadHit[];
  roadTotal: number;
  loading: boolean;
};

const EMPTY: Results = { coord: null, places: [], roads: [], roadTotal: 0, loading: false };

type Props = {
  leading?: ReactNode;
  trailing?: ReactNode;
};

export default function EditorSearch({ leading, trailing }: Props) {
  const location = useLocation();
  const isMapRoute = location.pathname.includes("/dataset/");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<Results>(EMPTY);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);

  const items = useMemo<SearchHit[]>(() => {
    const list: SearchHit[] = [];
    if (results.coord) list.push(results.coord);
    list.push(...results.roads, ...results.places);
    return list;
  }, [results]);

  const coordOffset = results.coord ? 1 : 0;
  const placeOffset = coordOffset + results.roads.length;

  useEffect(() => {
    if (!isMapRoute) {
      setQuery("");
      setOpen(false);
      setResults(EMPTY);
    }
  }, [isMapRoute]);

  useEffect(() => {
    const text = query.trim();
    if (timerRef.current) window.clearTimeout(timerRef.current);
    abortRef.current?.abort();

    if (text.length < 2) {
      setResults(EMPTY);
      setOpen(false);
      return;
    }

    const parsed = parseCoordInput(text);
    const coord: Results["coord"] = parsed ? { kind: "coord", lat: parsed.lat, lng: parsed.lng } : null;
    const { hits: roads, total } = searchRoads(text, getSharedRoads());
    setResults({ coord, places: [], roads, roadTotal: total, loading: true });
    setOpen(true);
    setActive(0);

    timerRef.current = window.setTimeout(() => {
      const controller = new AbortController();
      abortRef.current = controller;
      geocodePlaces(text, { signal: controller.signal })
        .then((places) => {
          if (controller.signal.aborted) return;
          setResults((prev) => ({ ...prev, places, loading: false }));
        })
        .catch((err: unknown) => {
          if ((err as Error)?.name === "AbortError") return;
          setResults((prev) => ({ ...prev, loading: false }));
        });
    }, 450);

    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  useEffect(
    () => () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      abortRef.current?.abort();
    },
    []
  );

  if (!isMapRoute) return null;

  const pick = (hit: SearchHit) => {
    emitSearchSelection(hit);
    setQuery("");
    setResults(EMPTY);
    setOpen(false);
    inputRef.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
      return;
    }
    if (!open || !items.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(items[Math.min(active, items.length - 1)]);
    }
  };

  const hasAny = items.length > 0;
  const rowClass = (i: number) => `ed-search-item${i === active ? " active" : ""}`;

  return (
    <div className={`ed-search${leading ? " has-lead" : ""}${trailing ? " has-trail" : ""}`} ref={wrapRef}>
      {leading ?? (
        <span className="ed-search-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
        </span>
      )}
      <input
        ref={inputRef}
        type="text"
        className="ed-search-input"
        placeholder="Cari koordinat, tempat, atau ruas jalan..."
        aria-label="Cari koordinat, tempat, atau ruas jalan"
        autoComplete="off"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => {
          if (items.length) setOpen(true);
        }}
        onKeyDown={onKeyDown}
      />
      {query && (
        <button
          type="button"
          className={`ed-search-clear${trailing ? " inline" : ""}`}
          aria-label="Bersihkan pencarian"
          onClick={() => {
            setQuery("");
            setResults(EMPTY);
            setOpen(false);
            inputRef.current?.focus();
          }}
        >
          ×
        </button>
      )}
      {trailing}

      {open && (
        <div className="ed-search-menu" role="listbox">
          {!hasAny && (
            <div className="ed-search-note">
              {results.loading ? "Mencari..." : "Tidak ditemukan"}
            </div>
          )}

          {results.coord && (
            <>
              <div className="ed-search-head">Koordinat</div>
              <button
                type="button"
                role="option"
                aria-selected={active === 0}
                className={rowClass(0)}
                onClick={() => pick(results.coord as SearchHit)}
              >
                <span className="ed-search-name">📍 {results.coord.lat}, {results.coord.lng}</span>
                <span className="ed-search-meta">Tandai titik di peta</span>
              </button>
            </>
          )}

          {results.roads.length > 0 && (
            <>
              <div className="ed-search-head">
                Jalan
                {results.roadTotal > results.roads.length && (
                  <span className="ed-search-count">
                    {results.roads.length} dari {results.roadTotal}
                  </span>
                )}
              </div>
              {results.roads.map((hit, offset) => {
                const i = coordOffset + offset;
                return (
                  <button
                    key={`${hit.ruasId}-${hit.kode}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={rowClass(i)}
                    onClick={() => pick(hit)}
                  >
                    <span className="ed-search-name">
                      {hit.label}
                      {hit.uptd && <span className="ed-search-chip">{hit.uptd.replace("UPTD-", "UPTD ")}</span>}
                    </span>
                    {hit.sub && <span className="ed-search-meta">{hit.sub}</span>}
                  </button>
                );
              })}
            </>
          )}

          {results.places.length > 0 && (
            <>
              <div className="ed-search-head">Tempat</div>
              {results.places.map((hit, offset) => {
                const i = placeOffset + offset;
                return (
                  <button
                    key={`${hit.osmType}-${hit.osmId}-${hit.lat}`}
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    className={rowClass(i)}
                    onClick={() => pick(hit)}
                  >
                    <span className="ed-search-name">{hit.label}</span>
                    {hit.sub && <span className="ed-search-meta">{hit.sub}</span>}
                  </button>
                );
              })}
            </>
          )}

          {hasAny && <div className="ed-search-note ed-search-attr">{GEO_ATTRIBUTION}</div>}
        </div>
      )}
    </div>
  );
}
