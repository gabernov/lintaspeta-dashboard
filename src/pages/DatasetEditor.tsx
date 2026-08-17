import { useParams } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { supabase } from "../lib/supabase";
import { getDataset } from "../lib/datasets";
import { useAuth } from "../auth/AuthContext";
import AttributeForm from "../components/editor/AttributeForm";
import type { EditWindow } from "../lib/types";
import type {
  Feature,
  FeatureCollection,
  GeoJsonProperties,
  Geometry,
  Point,
  LineString,
} from "geojson";

const FIELD_COLOR = "#f59e0b";

export default function DatasetEditor() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const meta = getDataset(datasetId ?? "");
  const { profile, role, region, hasRole } = useAuth();

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tdRef = useRef<TerraDraw | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);

  const [features, setFeatures] = useState<FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [editWindow, setEditWindow] = useState<EditWindow | null>(null);
  const [fieldMode, setFieldMode] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [formMode, setFormMode] = useState<"create" | "update">("create");
  const [selectedFeature, setSelectedFeature] = useState<Feature | null>(null);
  const [pendingGeometry, setPendingGeometry] = useState<Geometry | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [onlineCount, setOnlineCount] = useState(0);
  const [publishBusy, setPublishBusy] = useState(false);
  const [autoSchedule, setAutoSchedule] = useState(() => {
    return localStorage.getItem(`autoflag_${datasetId}`) === "true";
  });

  const isPoint = meta?.geometryType === "Point";
  const isSuperAdmin = role === "super_admin";
  const isEditor = role === "editor";
  const canDraw =
    meta &&
    (isSuperAdmin || (isEditor && (editWindow?.open || fieldMode)));

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const refreshFeatures = useCallback(async () => {
    if (!datasetId) return;
    const { data, error } = await supabase.rpc("draft_features_geojson", {
      p_dataset: datasetId,
    });
    if (error) {
      console.error("fetch features:", error.message);
      return;
    }
    const fc = data as FeatureCollection;
    setFeatures(fc);
    if (mapRef.current?.isStyleLoaded()) {
      const src = mapRef.current.getSource("draft");
      if (src && "setData" in src) {
        (src as maplibregl.GeoJSONSource).setData(fc);
      }
    }
  }, [datasetId]);

  const refreshEditWindow = useCallback(async () => {
    if (!datasetId) return;
    const { data } = await supabase
      .from("edit_windows")
      .select("*")
      .eq("dataset", datasetId)
      .maybeSingle();
    if (data) setEditWindow(data as EditWindow);
  }, [datasetId]);

  const toggleWindow = useCallback(async () => {
    if (!editWindow || !datasetId) return;
    const next = !editWindow.open;
    const { error } = await supabase
      .from("edit_windows")
      .update({ open: next, opened_by: profile?.id, opened_at: new Date().toISOString() })
      .eq("dataset", datasetId);
    if (error) {
      showToast("Gagal mengubah jendela edit: " + error.message, false);
      return;
    }
    setEditWindow((prev) => (prev ? { ...prev, open: next } : prev));
    showToast(
      next ? "Jendela edit dibuka" : "Jendela edit ditutup",
      true
    );
  }, [editWindow, datasetId, profile?.id, showToast]);

  const handleSave = useCallback(
    async (values: GeoJsonProperties) => {
      if (!meta || !datasetId) return;
      setSaving(true);

      let geometry: Geometry | null = pendingGeometry;
      if (formMode === "update" && selectedFeature) {
        geometry = selectedFeature.geometry;
      }
      if (!geometry) {
        setSaving(false);
        showToast("Tidak ada geometri", false);
        return;
      }

      const regionVal =
        values[meta.regionPropertyKey ?? ""] ??
        region ??
        "";

      const sourceId =
        formMode === "create"
          ? `new-${Date.now()}`
          : String(selectedFeature?.properties?._source_id ?? `new-${Date.now()}`);

      const pId = formMode === "update" && selectedFeature?.id
        ? String(selectedFeature.id)
        : null;

      const { data, error } = await supabase.rpc("save_draft_feature", {
        p_dataset: datasetId,
        p_id: pId,
        p_source_id: sourceId,
        p_geometry: geometry,
        p_properties: values,
        p_region: String(regionVal),
        p_source_type: fieldMode ? "field" : "master",
      });

      setSaving(false);
      if (error) {
        showToast("Gagal menyimpan: " + error.message, false);
        return;
      }
      showToast(formMode === "create" ? "Fitur ditambahkan" : "Fitur diperbarui", true);
      setFormOpen(false);
      setSelectedFeature(null);
      setPendingGeometry(null);
      setFormMode("create");
      tdRef.current?.clear();
      void refreshFeatures();
    },
    [
      meta,
      datasetId,
      pendingGeometry,
      formMode,
      selectedFeature,
      region,
      fieldMode,
      showToast,
      refreshFeatures,
    ]
  );

  const handleDelete = useCallback(async () => {
    if (!datasetId || !selectedFeature?.id) return;
    setSaving(true);
    const { error } = await supabase.rpc("delete_draft_feature", {
      p_dataset: datasetId,
      p_id: String(selectedFeature.id),
    });
    setSaving(false);
    if (error) {
      showToast("Gagal menghapus: " + error.message, false);
      return;
    }
    showToast("Fitur dihapus", true);
    setFormOpen(false);
    setSelectedFeature(null);
    setFormMode("create");
    void refreshFeatures();
  }, [datasetId, selectedFeature, showToast, refreshFeatures]);

  const handlePublish = useCallback(async () => {
    if (!datasetId || !isSuperAdmin) return;
    if (!window.confirm(`Publish dataset ${meta?.label} ke peta publik?`)) return;
    setPublishBusy(true);
    const { data, error } = await supabase.rpc("publish_dataset_safe", {
      p_dataset: datasetId,
    });
    setPublishBusy(false);
    if (error) {
      showToast("Gagal publish: " + error.message, false);
      return;
    }
    const res = data as { published: number; dataset: string; at: string };
    showToast(`Berhasil publish ${res.published} fitur`, true);
  }, [datasetId, isSuperAdmin, meta?.label, showToast]);

  const toggleAutoSchedule = useCallback(() => {
    setAutoSchedule((prev) => {
      const next = !prev;
      localStorage.setItem(`autoflag_${datasetId}`, String(next));
      return next;
    });
  }, [datasetId]);

  const closePopup = useCallback(() => {
    popupRef.current?.remove();
    popupRef.current = null;
  }, []);

  useEffect(() => {
    if (!mapContainerRef.current || !meta) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/liberty",
      center: [119.8, -2.5],
      zoom: 10,
    });

    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl(), "top-left");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: "320px",
    });

    map.on("load", () => {
      map.addSource("draft", {
        type: "geojson",
        data: features,
      });

      if (isPoint) {
        map.addLayer({
          id: "draft-points",
          type: "circle",
          source: "draft",
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              8,
              6,
            ],
            "circle-color": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              FIELD_COLOR,
              meta.defaultColor,
            ],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "#1e293b",
          },
        });
      } else {
        map.addLayer({
          id: "draft-lines",
          type: "line",
          source: "draft",
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              FIELD_COLOR,
              meta.defaultColor,
            ],
            "line-width": 2.5,
          },
        });
      }

      const layerIds = isPoint ? ["draft-points"] : ["draft-lines"];
      const buildPopupHtml = (props: GeoJsonProperties): string => {
        const rows: string[] = [];
        const fields = meta.formFields.slice(0, 5);
        for (const f of fields) {
          const v = props[f.key];
          if (v != null && v !== "") {
            rows.push(
              `<div class="ed-popup-row"><span class="ed-popup-key">${f.label}</span><span class="ed-popup-val">${String(v)}</span></div>`
            );
          }
        }
        if (props._status) {
          rows.push(
            `<div class="ed-popup-row"><span class="ed-popup-key">Status</span><span class="ed-popup-val ed-badge ed-badge-status">${String(props._status)}</span></div>`
          );
        }
        if (props._region) {
          rows.push(
            `<div class="ed-popup-row"><span class="ed-popup-key">${meta.regionLabel}</span><span class="ed-popup-val">${String(props._region)}</span></div>`
          );
        }
        return `<div class="ed-popup">${rows.join("")}</div>`;
      };

      for (const lid of layerIds) {
        map.on("click", lid, (e) => {
          if (!e.features?.length) return;
          if (tdRef.current?.enabled) return;

          const feat = e.features[0] as Feature;
          const props = feat.properties as GeoJsonProperties;
          const coords =
            feat.geometry.type === "Point"
              ? (feat.geometry as Point).coordinates
              : feat.geometry.type === "LineString"
                ? (feat.geometry as LineString).coordinates[0]
                : [e.lngLat.lng, e.lngLat.lat];

          closePopup();
          popupRef.current
            ?.setLngLat(coords as [number, number])
            .setHTML(buildPopupHtml(props))
            .addTo(map);

          popupRef.current?.on("close", () => {
            if (formMode === "update" && selectedFeature?.id === feat.id) {
              setFormOpen(false);
              setSelectedFeature(null);
              setFormMode("create");
            }
          });
        });

        map.on("mouseenter", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", lid, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      map.on("dblclick", (e) => {
        if (tdRef.current?.enabled) return;
        e.preventDefault();
      });

      map.on("click", (e) => {
        if (tdRef.current?.enabled) return;
        const clickedOnFeature = map.queryRenderedFeatures(e.point, {
          layers: layerIds,
        });
        if (clickedOnFeature.length > 0) return;

        closePopup();

        if (formMode === "update" && selectedFeature) {
          const featId = String(selectedFeature.id);
          const stillVisible = features.features.some(
            (f) => String(f.id) === featId
          );
          if (!stillVisible) {
            setFormOpen(false);
            setSelectedFeature(null);
            setFormMode("create");
          }
        }
      });
    });

    return () => {
      closePopup();
      tdRef.current?.stop();
      tdRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!meta || !mapRef.current) return;
    const map = mapRef.current;

    if (!map.isStyleLoaded()) {
      map.once("load", () => initTerraDraw());
      return;
    }
    initTerraDraw();

    function initTerraDraw() {
      if (tdRef.current) {
        tdRef.current.stop();
        tdRef.current = null;
      }

      const adapter = new TerraDrawMapLibreGLAdapter({ map });

      const modes = isPoint
        ? [
            new TerraDrawPointMode(),
          ]
        : [
            new TerraDrawLineStringMode(),
          ];

      const td = new TerraDraw({ adapter, modes });
      td.start();
      tdRef.current = td;

      td.on("finish", (_id, context) => {
        if (context.action === "draw") {
          const snap = td.getSnapshot();
          const drawn = snap.find(
            (f) =>
              f.properties?.mode === (isPoint ? "point" : "linestring") &&
              !f.properties?.currentlyDrawing
          );
          if (drawn) {
            const geom: Geometry = {
              type: drawn.geometry.type as "Point" | "LineString",
              coordinates: drawn.geometry.coordinates,
            };
            setPendingGeometry(geom);
            setFormMode("create");
            setSelectedFeature(null);
            setFormOpen(true);
          }
          td.clear();
        }
      });
    }
  }, [meta, isPoint]);

  useEffect(() => {
    if (tdRef.current && meta) {
      if (canDraw) {
        tdRef.current.setMode(
          isPoint ? "point" : "linestring"
        );
      } else {
        tdRef.current.setMode("static");
      }
    }
  }, [canDraw, meta, isPoint]);

  useEffect(() => {
    void refreshFeatures();
    void refreshEditWindow();
  }, [refreshFeatures, refreshEditWindow]);

  useEffect(() => {
    if (!datasetId || !meta) return;
    const channel = supabase
      .channel(`editor-${datasetId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: meta.draftTable },
        () => {
          void refreshFeatures();
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setOnlineCount(1);
        }
      });

    void channel.track({ user: profile?.id ?? "anon" });

    const presenceHandler = channel.on(
      "presence",
      { event: "sync" },
      () => {
        const state = channel.presenceState();
        const users = Object.keys(state);
        setOnlineCount(users.length);
      }
    );

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [datasetId, meta, profile?.id, refreshFeatures]);

  useEffect(() => {
    if (formMode === "update" && selectedFeature) {
      const id = String(selectedFeature.id);
      const live = features.features.find((f) => String(f.id) === id);
      if (live) {
        setSelectedFeature(live as Feature);
      } else {
        setFormOpen(false);
        setSelectedFeature(null);
        setFormMode("create");
      }
    }
  }, [features, formMode, selectedFeature]);

  const handleFeatureClick = useCallback(
    (feat: Feature) => {
      closePopup();
      setSelectedFeature(feat);
      setFormMode("update");
      setPendingGeometry(null);
      setFormOpen(true);
    },
    [closePopup]
  );

  useEffect(() => {
    if (!mapRef.current || !meta) return;
    const map = mapRef.current;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const handler = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapboxGeoJSONFeature[] }) => {
      if (!e.features?.length) return;
      if (tdRef.current?.enabled) return;
      handleFeatureClick(e.features[0] as unknown as Feature);
    };

    if (map.getLayer(layerId)) {
      map.on("click", layerId, handler);
    }
    return () => {
      map.off("click", layerId, handler as (e: maplibregl.MapMouseEvent) => void);
    };
  }, [meta, isPoint, handleFeatureClick]);

  if (!meta) {
    return <div className="page-loading">Dataset tidak dikenal</div>;
  }

  return (
    <div className="ed-root">
      <div className="ed-toolbar">
        <div className="ed-toolbar-left">
          <h2 className="ed-title">{meta.label}</h2>
          <span className="ed-online">
            <span className="ed-live-dot" />
            {onlineCount} online
          </span>
        </div>

        <div className="ed-toolbar-center">
          <div
            className={`ed-window-banner ${editWindow?.open ? "ed-window-open" : "ed-window-closed"}`}
          >
            {editWindow?.open
              ? "Jendela edit TERBUKA"
              : "Jendela edit TERTUTUP"}
          </div>
          {isSuperAdmin && (
            <button
              className={`btn-primary ed-btn-sm ${editWindow?.open ? "ed-btn-close" : "ed-btn-open"}`}
              onClick={toggleWindow}
            >
              {editWindow?.open ? "Tutup Jendela" : "Buka Jendela"}
            </button>
          )}
        </div>

        <div className="ed-toolbar-right">
          {(isSuperAdmin || isEditor) && (
            <button
              className={`ed-btn-field ${fieldMode ? "ed-btn-field-active" : ""}`}
              onClick={() => setFieldMode((p) => !p)}
              title="Mode Penandaan Lapangan"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
                <circle cx="12" cy="9" r="2.5" />
              </svg>
              {fieldMode ? "Mode Lapangan ON" : "Mode Penandaan"}
            </button>
          )}

          {isSuperAdmin && (
            <>
              <label className="ed-auto-toggle">
                <input
                  type="checkbox"
                  checked={autoSchedule}
                  onChange={toggleAutoSchedule}
                />
                Auto 2 hari
              </label>
              <button
                className="btn-primary ed-btn-sm ed-btn-publish"
                onClick={handlePublish}
                disabled={publishBusy}
              >
                {publishBusy ? "Publishing…" : "Publish ke Peta Publik"}
              </button>
            </>
          )}

          {canDraw && (
            <button
              className="btn-primary ed-btn-sm"
              onClick={() => {
                if (tdRef.current) {
                  tdRef.current.clear();
                  tdRef.current.setMode(isPoint ? "point" : "linestring");
                }
              }}
            >
              {isPoint ? "+ Titik" : "+ Garis"}
            </button>
          )}
        </div>
      </div>

      {fieldMode && (
        <div className="ed-field-banner">
          Mode Penandaan Lapangan aktif — fitur baru langsung tampil untuk
          editor, masuk daftar publish berikutnya.
        </div>
      )}

      <div className="ed-body">
        <div className="ed-map-wrap" ref={mapContainerRef} />

        {formOpen && (
          <AttributeForm
            meta={meta}
            feature={formMode === "update" ? selectedFeature : null}
            mode={formMode}
            canEdit={
              isSuperAdmin ||
              (isEditor && (editWindow?.open || fieldMode))
            }
            canDelete={isSuperAdmin || isEditor}
            onSave={handleSave}
            onDelete={handleDelete}
            onClose={() => {
              setFormOpen(false);
              setSelectedFeature(null);
              setPendingGeometry(null);
              setFormMode("create");
              tdRef.current?.clear();
              closePopup();
            }}
            saving={saving}
          />
        )}
      </div>

      {toast && (
        <div className={`ed-toast ${toast.ok ? "ed-toast-ok" : "ed-toast-err"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
