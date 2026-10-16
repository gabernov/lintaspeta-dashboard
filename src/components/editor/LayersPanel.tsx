import { useEffect, useState } from "react";
import { ROAD_UPTD, UPTD_COLORS, type RoadItem } from "../../lib/roadUptd";
import { BASEMAPS, ED_BASEMAP_EVENT, getBasemap } from "../../lib/basemaps";

type Props = {
  label: string;
  isPoint: boolean;
  defaultColor: string;
  showRoads: boolean;
  open: boolean;
  onToggleOpen: () => void;
  featuresVisible: boolean;
  onToggleFeatures: () => void;
  roadsVisible: boolean;
  onToggleRoads: () => void;
  roadUPTD: string[];
  onToggleUPTD: (code: string) => void;
  roadList: RoadItem[];
  hiddenRoads: string[];
  onToggleRoad: (id: string) => void;
  onSetManyRoads: (ids: string[], visible: boolean) => void;
  onShowAllRoads: () => void;
};

export default function LayersPanel({
  label,
  isPoint,
  defaultColor,
  showRoads,
  open,
  onToggleOpen,
  featuresVisible,
  onToggleFeatures,
  roadsVisible,
  onToggleRoads,
  roadUPTD,
  onToggleUPTD,
  roadList,
  hiddenRoads,
  onToggleRoad,
  onSetManyRoads,
  onShowAllRoads,
}: Props) {
  const [expandedUPTD, setExpandedUPTD] = useState<string | null>(null);
  const [roadQuery, setRoadQuery] = useState("");
  const [basemap, setBasemap] = useState(() => getBasemap(localStorage.getItem("ed_basemap")));

  useEffect(() => {
    const onExternal = (e: Event) => {
      setBasemap(getBasemap((e as CustomEvent<string>).detail));
    };
    window.addEventListener(ED_BASEMAP_EVENT, onExternal);
    return () => window.removeEventListener(ED_BASEMAP_EVENT, onExternal);
  }, []);

  const pickBasemap = (id: string) => {
    const bm = getBasemap(id);
    localStorage.setItem("ed_basemap", bm.id);
    setBasemap(bm);
    window.dispatchEvent(new CustomEvent(ED_BASEMAP_EVENT, { detail: bm.id }));
  };

  return (
    <div className="ed-layers">
      {open && (
        <div className="ed-layers-card" role="dialog" aria-label="Tampilkan lapisan">
          <div className="ed-layers-head">
            <div className="ed-layers-title">Tampilkan Lapisan</div>
            <button
              type="button"
              className="ed-layers-close"
              onClick={onToggleOpen}
              aria-label="Tutup panel lapisan"
              title="Tutup"
            >
              ✕
            </button>
          </div>
          <div className="ed-layers-name">{label}</div>
          <button
            type="button"
            className={`ed-layer-row${featuresVisible ? " on" : ""}`}
            onClick={onToggleFeatures}
            aria-pressed={featuresVisible}
          >
            <span
              className={`ed-layer-swatch${isPoint ? " is-dot" : " is-line"}`}
              style={{ background: defaultColor }}
            />
            <span className="ed-layer-label">Fitur</span>
            <span className="ed-layer-state">{featuresVisible ? "On" : "Off"}</span>
          </button>

          {showRoads && (
            <>
              <button
                type="button"
                className={`ed-layer-row${roadsVisible ? " on" : ""}`}
                onClick={onToggleRoads}
                aria-pressed={roadsVisible}
              >
                <span className="ed-layer-swatch is-line" style={{ background: "#cbd5e1" }} />
                <span className="ed-layer-label">Ruas jalan (referensi)</span>
                <span className="ed-layer-state">{roadsVisible ? "On" : "Off"}</span>
              </button>

              <div className="ed-layer-sub">
                {ROAD_UPTD.map((code) => {
                  const on = roadUPTD.includes(code);
                  const roads = roadList.filter((r) => r.uptd === code);
                  const hiddenHere = roads.filter((r) => hiddenRoads.includes(r.id)).length;
                  const expanded = expandedUPTD === code;
                  const needle = roadQuery.trim().toLowerCase();
                  const shown = needle
                    ? roads.filter((r) => `${r.nama} ${r.kode}`.toLowerCase().includes(needle))
                    : roads;
                  return (
                    <div key={code} className="ed-layer-group">
                      <div className="ed-layer-group-head">
                        <button
                          type="button"
                          className={`ed-layer-row ed-layer-row-sub${on ? " on" : ""}`}
                          onClick={() => onToggleUPTD(code)}
                          aria-pressed={on}
                        >
                          <span
                            className="ed-layer-swatch is-line"
                            style={{ background: UPTD_COLORS[code] }}
                          />
                          <span className="ed-layer-label">{code.replace("UPTD-", "UPTD ")}</span>
                          <span className="ed-layer-state">
                            {hiddenHere ? `${roads.length - hiddenHere}/${roads.length}` : on ? "On" : "Off"}
                          </span>
                        </button>
                        <button
                          type="button"
                          className={`ed-layer-expand${expanded ? " on" : ""}`}
                          onClick={() => {
                            setExpandedUPTD(expanded ? null : code);
                            setRoadQuery("");
                          }}
                          aria-expanded={expanded}
                          aria-label={`Daftar ruas ${code.replace("UPTD-", "UPTD ")}`}
                          title="Pilih per ruas"
                        >
                          ▾
                        </button>
                      </div>
                      {expanded && (
                        <div className="ed-road-list">
                          <input
                            type="text"
                            className="ed-road-search"
                            placeholder="Cari ruas..."
                            value={roadQuery}
                            onChange={(e) => setRoadQuery(e.target.value)}
                          />
                          <div className="ed-road-actions">
                            <button type="button" onClick={() => onSetManyRoads(shown.map((r) => r.id), true)}>
                              Tampilkan
                            </button>
                            <button type="button" onClick={() => onSetManyRoads(shown.map((r) => r.id), false)}>
                              Sembunyikan
                            </button>
                          </div>
                          {shown.length === 0 && <div className="ed-road-empty">Tidak ada ruas</div>}
                          {shown.map((road) => {
                            const visible = !hiddenRoads.includes(road.id);
                            return (
                              <button
                                key={road.id}
                                type="button"
                                className={`ed-road-row${visible ? " on" : ""}`}
                                onClick={() => onToggleRoad(road.id)}
                                aria-pressed={visible}
                                title={`${road.nama}${road.kode ? ` — ${road.kode}` : ""}`}
                              >
                                <span className="ed-road-check">{visible ? "✓" : ""}</span>
                                <span className="ed-road-name">{road.nama}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
                {hiddenRoads.length > 0 && (
                  <button type="button" className="ed-road-reset" onClick={onShowAllRoads}>
                    Tampilkan semua ruas ({hiddenRoads.length} disembunyikan)
                  </button>
                )}
              </div>
            </>
          )}

          <div className="ed-layers-title ed-layers-title-gap">Peta dasar</div>
          {BASEMAPS.map((b) => {
            const on = b.id === basemap.id;
            return (
              <button
                key={b.id}
                type="button"
                className={`ed-layer-row${on ? " on" : ""}`}
                onClick={() => pickBasemap(b.id)}
                aria-pressed={on}
              >
                <span className="ed-layer-swatch" style={{ background: b.swatch }} />
                <span className="ed-layer-label">{b.label}</span>
                <span className="ed-layer-state">{on ? "✓" : ""}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        type="button"
        className={`ed-layers-btn${open ? " on" : ""}`}
        onClick={onToggleOpen}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
        <span>Lapisan</span>
      </button>
    </div>
  );
}
