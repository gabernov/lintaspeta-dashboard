import { useParams } from "react-router-dom";
import { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
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
  Geometry,
  Point,
  LineString,
} from "geojson";

const FIELD_COLOR = "#f59e0b";

function basemapUrl(): string {
  const theme = document.documentElement.dataset.theme;
  const base = theme === "light" ? "light_all" : "dark_all";
  return `https://basemaps.cartocdn.com/${base}/{z}/{x}/{y}@2x.png`;
}

type GeoProps = Record<string, unknown>;

/* ------------------------------------------------------------------ */
/*  Geometry helpers – compute a bounding box for a FeatureCollection  */
/* ------------------------------------------------------------------ */
function computeBBox(
  fc: FeatureCollection
): [number, number, number, number] | null {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;

  const proc = (lng: number, lat: number) => {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  };

  for (const feat of fc.features) {
    const g = feat.geometry;
    switch (g.type) {
      case "Point":
        proc(g.coordinates[0], g.coordinates[1]);
        break;
      case "LineString":
        for (const c of g.coordinates) proc(c[0], c[1]);
        break;
      case "Polygon":
        for (const ring of g.coordinates)
          for (const c of ring) proc(c[0], c[1]);
        break;
      case "MultiPoint":
        for (const c of g.coordinates) proc(c[0], c[1]);
        break;
      case "MultiLineString":
        for (const part of g.coordinates)
          for (const c of part) proc(c[0], c[1]);
        break;
      case "MultiPolygon":
        for (const poly of g.coordinates)
          for (const ring of poly)
            for (const c of ring) proc(c[0], c[1]);
        break;
      case "GeometryCollection":
        for (const sub of g.geometries) {
          const mini: FeatureCollection = {
            type: "FeatureCollection",
            features: [{ type: "Feature", geometry: sub, properties: {} }],
          };
          const subB = computeBBox(mini);
          if (subB) {
            proc(subB[0], subB[1]);
            proc(subB[2], subB[3]);
          }
        }
        break;
    }
  }

  if (minLng === Infinity) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function translateGeometry(geom: Geometry, dLng: number, dLat: number): Geometry {
  const shift = (c: number[]): number[] => [c[0] + dLng, c[1] + dLat];
  switch (geom.type) {
    case "Point":
      return { type: "Point", coordinates: shift(geom.coordinates) };
    case "LineString":
      return { type: "LineString", coordinates: geom.coordinates.map(shift) };
    case "MultiPoint":
      return { type: "MultiPoint", coordinates: geom.coordinates.map(shift) };
    case "MultiLineString":
      return { type: "MultiLineString", coordinates: geom.coordinates.map((l) => l.map(shift)) };
    case "Polygon":
      return { type: "Polygon", coordinates: geom.coordinates.map((r) => r.map(shift)) };
    case "MultiPolygon":
      return {
        type: "MultiPolygon",
        coordinates: geom.coordinates.map((p) => p.map((r) => r.map(shift))),
      };
    default:
      return geom;
  }
}

/* ================================================================== */
export default function DatasetEditor() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const meta = getDataset(datasetId ?? "");
  const { profile, role, region } = useAuth();

  /* ---- refs ---- */
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const tdRef = useRef<TerraDraw | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const hasFittedRef = useRef(false);
  const featuresRef = useRef<FeatureCollection | null>(null);
  const moveModeRef = useRef(false);
  const dragRef = useRef<{
    featureId: string;
    startLngLat: { lng: number; lat: number };
    origGeom: Geometry;
  } | null>(null);

  /* ---- state ---- */
  const [features, setFeatures] = useState<FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [editWindow, setEditWindow] = useState<EditWindow | null>(null);
  const [fieldMode, setFieldMode] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
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
  const [initialLoading, setInitialLoading] = useState(true);

  /* ---- derived ---- */
  const isPoint = meta?.geometryType === "Point";
  const isSuperAdmin = role === "super_admin";
  const isEditor = role === "editor";
  const canDraw =
    meta != null &&
    (isSuperAdmin || (isEditor && (editWindow?.open || fieldMode)));

  /* ---- callbacks ---- */
  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  /** Shared draw-start handler used by both toolbar and floating toolbox. */
  const handleStartDraw = useCallback(() => {
    if (tdRef.current) {
      tdRef.current.clear();
      tdRef.current.setMode(isPoint ? "point" : "linestring");
    }
  }, [isPoint]);

  const applyFeaturesToSource = useCallback((fc: FeatureCollection) => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("draft");
    if (src && "setData" in src) {
      (src as maplibregl.GeoJSONSource).setData(fc);
    }
    if (!hasFittedRef.current) {
      const bbox = computeBBox(fc);
      if (bbox) {
        map.fitBounds(bbox, { padding: 60, maxZoom: 14 });
      } else {
        map.fitBounds(
          [
            [105.5, -8],
            [109.5, -5.5],
          ],
          { padding: 60 }
        );
      }
      hasFittedRef.current = true;
    }
  }, []);

  const refreshFeatures = useCallback(async () => {
    if (!datasetId) return;
    const { data, error } = await supabase.rpc("draft_features_geojson", {
      p_dataset: datasetId,
      p_light: true,
    });
    if (error) {
      console.error("fetch features:", error.message);
      setInitialLoading(false);
      return;
    }
    const fc = data as FeatureCollection;
    setFeatures(fc);
    featuresRef.current = fc;
    setInitialLoading(false);

    if (mapRef.current?.getSource("draft")) {
      applyFeaturesToSource(fc);
    }
  }, [datasetId, applyFeaturesToSource]);

  const refreshEditWindow = useCallback(async () => {
    if (!datasetId) return;
    const { data } = await supabase
      .from("edit_windows")
      .select("*")
      .eq("dataset", datasetId)
      .maybeSingle();
    if (data) setEditWindow(data as EditWindow);
  }, [datasetId]);

  const fetchFeatureDetail = useCallback(
    async (id: string): Promise<Feature | null> => {
      if (!datasetId) return null;
      const { data, error } = await supabase.rpc("draft_feature_detail", {
        p_dataset: datasetId,
        p_id: id,
      });
      if (error || !data) {
        console.error("fetch feature detail:", error?.message ?? "no data");
        return null;
      }
      return data as Feature;
    },
    [datasetId]
  );

  const toggleWindow = useCallback(async () => {
    if (!editWindow || !datasetId) return;
    const next = !editWindow.open;
    const { error } = await supabase
      .from("edit_windows")
      .update({
        open: next,
        opened_by: profile?.id,
        opened_at: new Date().toISOString(),
      })
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
    async (values: GeoProps) => {
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
        values[meta.regionPropertyKey ?? ""] ?? region ?? "";

      const sourceId =
        formMode === "create"
          ? `new-${Date.now()}`
          : String(
              selectedFeature?.properties?._source_id ?? `new-${Date.now()}`
            );

      const pId =
        formMode === "update" && selectedFeature?.id
          ? String(selectedFeature.id)
          : null;

      const { error } = await supabase.rpc("save_draft_feature", {
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
      showToast(
        formMode === "create" ? "Fitur ditambahkan" : "Fitur diperbarui",
        true
      );
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

  const persistMovedFeature = useCallback(
    async (draftId: string, geometry: Geometry) => {
      if (!meta || !datasetId) return;
      const full = await fetchFeatureDetail(draftId);
      if (!full) return;
      const fullProps = (full.properties ?? {}) as Record<string, unknown>;
      const regionVal = String(fullProps._region ?? region ?? "");
      const sourceId = String(fullProps._source_id ?? full.id ?? `move-${Date.now()}`);
      const sourceType = String(fullProps._source_type ?? "master");
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fullProps)) {
        if (!k.startsWith("_")) props[k] = v;
      }
      const { error } = await supabase.rpc("save_draft_feature", {
        p_dataset: datasetId,
        p_id: draftId,
        p_source_id: sourceId,
        p_geometry: geometry,
        p_properties: props,
        p_region: regionVal,
        p_source_type: sourceType,
      });
      if (error) {
        showToast("Gagal menyimpan perpindahan: " + error.message, false);
        return;
      }
      showToast("Posisi diperbarui", true);
      void refreshFeatures();
    },
    [meta, datasetId, fetchFeatureDetail, region, showToast, refreshFeatures]
  );

  const handlePublish = useCallback(async () => {
    if (!datasetId || !isSuperAdmin) return;
    if (!window.confirm(`Publish dataset ${meta?.label} ke peta publik?`))
      return;
    setPublishBusy(true);
    const { data: _result, error } = await supabase.rpc(
      "publish_dataset_safe",
      { p_dataset: datasetId }
    );
    setPublishBusy(false);
    if (error) {
      showToast("Gagal publish: " + error.message, false);
      return;
    }
    const res = _result as { published: number; dataset: string; at: string };
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

  /* ---- map init ---- */
  useEffect(() => {
    if (!mapContainerRef.current || !meta) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: {
        version: 8,
        sources: {
          basemap: {
            type: "raster",
            tiles: [basemapUrl()],
            tileSize: 256,
            attribution: "© OpenStreetMap contributors © CARTO",
          },
        },
        layers: [
          {
            id: "basemap",
            type: "raster",
            source: "basemap",
            minzoom: 0,
            maxzoom: 20,
          },
        ],
      },
      center: [107.6, -6.9],
      zoom: 9,
    });

    mapRef.current = map;

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: "320px",
    });

    const onLoad = () => {
      if (map.getSource("draft")) return;

      if (!map.getSource("roads-bg")) {
        map.addSource("roads-bg", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "roads-bg-casing",
          type: "line",
          source: "roads-bg",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#0b1220",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 2,
              10, 3,
              14, 4.5,
              18, 6,
            ],
            "line-opacity": 0.85,
          },
        });
        map.addLayer({
          id: "roads-bg-line",
          type: "line",
          source: "roads-bg",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#94a3b8",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 0.9,
              10, 1.4,
              14, 2.2,
              18, 3.2,
            ],
            "line-opacity": 0.7,
          },
        });
        void supabase
          .rpc("published_features_geojson", { p_dataset: "ruas_jalan" })
          .then(({ data }) => {
            const src = map.getSource("roads-bg");
            if (src && "setData" in src && data) {
              (src as maplibregl.GeoJSONSource).setData(
                data as FeatureCollection
              );
            }
          });
      }

      map.addSource("draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      if (isPoint) {
        map.addLayer({
          id: "draft-clusters",
          type: "circle",
          source: "draft",
          filter: ["has", "point_count"],
          paint: {
            "circle-radius": [
              "step",
              ["get", "point_count"],
              14,
              10, 20,
              100, 30,
              1000, 42,
            ],
            "circle-color": meta.defaultColor,
            "circle-opacity": 0.85,
            "circle-stroke-color": "#0f172a",
            "circle-stroke-width": 2,
          },
        });
        map.addLayer({
          id: "draft-points",
          type: "circle",
          source: "draft",
          filter: ["!", ["has", "point_count"]],
          paint: {
            "circle-radius": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              10,
              7,
            ],
            "circle-color": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              FIELD_COLOR,
              meta.defaultColor,
            ],
            "circle-stroke-width": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              3,
              2,
            ],
            "circle-stroke-color": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              "#92400e",
              "#0f172a",
            ],
            "circle-blur": 0.15,
          },
        });
      } else {
        map.addLayer({
          id: "draft-lines",
          type: "line",
          source: "draft",
          layout: {
            "line-cap": "round",
            "line-join": "round",
          },
          paint: {
            "line-color": [
              "case",
              ["==", ["get", "_source_type"], "field"],
              FIELD_COLOR,
              meta.defaultColor,
            ],
            "line-width": 3,
          },
        });
      }

      const layerIds = isPoint ? ["draft-points"] : ["draft-lines"];
      const buildPopupHtml = (props: GeoProps | null): string => {
        if (!props) return "";
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
        map.on("click", lid, (e: maplibregl.MapLayerMouseEvent) => {
          if (!e.features?.length) return;
          if (tdRef.current?.enabled) return;

          const feat = e.features[0] as unknown as Feature;
          const coords =
            feat.geometry.type === "Point"
              ? (feat.geometry as Point).coordinates
              : feat.geometry.type === "LineString"
                ? (feat.geometry as LineString).coordinates[0]
                : [e.lngLat.lng, e.lngLat.lat];

          closePopup();
          void fetchFeatureDetail(resolveDraftId(feat)).then((full) => {
            const props = (full?.properties ?? feat.properties) as GeoProps | null;
            popupRef.current
              ?.setLngLat(coords as [number, number])
              .setHTML(buildPopupHtml(props))
              .addTo(map);
          });

          popupRef.current?.on("close", () => {
            if (formMode === "update" && selectedFeature?.id === feat.id) {
              setFormOpen(false);
              setSelectedFeature(null);
              setFormMode("create");
            }
          });
        });
      }

      if (isPoint) {
        map.on("click", "draft-clusters", (e: maplibregl.MapLayerMouseEvent) => {
          if (tdRef.current?.enabled) return;
          const cluster = e.features?.[0];
          if (!cluster) return;
          const src = map.getSource("draft") as maplibregl.GeoJSONSource;
          const clusterId = cluster.properties?.["cluster_id"] as number;
          void src
            .getClusterExpansionZoom(clusterId)
            .then((zoom) => {
              map.easeTo({
                center: (cluster.geometry as Point).coordinates as [number, number],
                zoom,
              });
            })
            .catch(() => {});
        });
        map.on("mouseenter", "draft-clusters", () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "draft-clusters", () => {
          map.getCanvas().style.cursor = "";
        });
      }

      for (const lid of layerIds) {
        map.on("mouseenter", lid, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", lid, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      map.on("dblclick", (e: maplibregl.MapMouseEvent) => {
        if (tdRef.current?.enabled) return;
        e.preventDefault();
      });

      map.on("click", (e: maplibregl.MapMouseEvent) => {
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

      initTerraDraw();

      if (featuresRef.current) {
        applyFeaturesToSource(featuresRef.current);
      }
    };

    if (map.isStyleLoaded()) {
      onLoad();
    } else {
      map.once("load", onLoad);
      map.once("styledata", onLoad);
      // Fallback: if the style never fully "loads" (e.g. slow glyph/tile server),
      // still init once the base style is present.
      const t = setTimeout(onLoad, 8000);
      map.once("remove", () => clearTimeout(t));
    }

    function initTerraDraw() {
      if (tdRef.current) {
        tdRef.current.stop();
        tdRef.current = null;
      }
      const adapter = new TerraDrawMapLibreGLAdapter({ map });

      const modes = isPoint
        ? [new TerraDrawPointMode()]
        : [new TerraDrawLineStringMode()];

      const td = new TerraDraw({ adapter, modes });
      td.start();
      tdRef.current = td;
      td.setMode(canDraw ? (isPoint ? "point" : "linestring") : "static");

      td.on("finish", (_id, context) => {
        if (context.action === "draw") {
          const snap = td.getSnapshot();
          const drawn = snap.find(
            (f) =>
              f.properties?.mode === (isPoint ? "point" : "linestring") &&
              !f.properties?.currentlyDrawing
          );
          if (drawn) {
            const geom = drawn.geometry as Point | LineString;
            setPendingGeometry(geom);
            setFormMode("create");
            setSelectedFeature(null);
            setFormOpen(true);
          }
          td.clear();
        }
      });
    }

    return () => {
      closePopup();
      tdRef.current?.stop();
      tdRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- switch basemap tiles when theme changes ---- */
  useEffect(() => {
    const apply = () => {
      const src = mapRef.current?.getSource("basemap");
      if (src && "setTiles" in src) {
        (src as maplibregl.RasterTileSource).setTiles([basemapUrl()]);
      }
    };
    const mo = new MutationObserver(apply);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => mo.disconnect();
  }, []);

  /* ---- keep moveMode ref in sync for event handlers ---- */
  useEffect(() => {
    moveModeRef.current = moveMode;
  }, [moveMode]);

  /* ---- sync terra-draw mode with canDraw ---- */
  useEffect(() => {
    if (tdRef.current && meta) {
      if (moveMode) {
        tdRef.current.setMode("static");
      } else if (canDraw) {
        tdRef.current.setMode(isPoint ? "point" : "linestring");
      } else {
        tdRef.current.setMode("static");
      }
    }
  }, [canDraw, meta, isPoint, moveMode]);

  /* ---- initial data fetch ---- */
  useEffect(() => {
    void refreshFeatures();
    void refreshEditWindow();
  }, [refreshFeatures, refreshEditWindow]);

  /* ---- realtime channel ---- */
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
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const users = Object.keys(state);
        setOnlineCount(users.length);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setOnlineCount(1);
        }
      });

    void channel.track({ user: profile?.id ?? "anon" });

    return () => {
      void channel.untrack();
      void supabase.removeChannel(channel);
    };
  }, [datasetId, meta, profile?.id, refreshFeatures]);

  /* ---- keep selected feature in sync with live data ---- */
  useEffect(() => {
    if (formMode === "update" && selectedFeature) {
      const id = String(selectedFeature.id);
      const live = features.features.find((f) => String(f.id) === id);
      if (live) {
        const liveProps = (live.properties ?? {}) as Record<string, unknown>;
        const hasFullProps = Object.keys(liveProps).some((k) => !k.startsWith("_"));
        if (hasFullProps) {
          setSelectedFeature(live as Feature);
        }
      } else {
        setFormOpen(false);
        setSelectedFeature(null);
        setFormMode("create");
      }
    }
  }, [features, formMode, selectedFeature]);

  const resolveDraftId = useCallback((feat: Feature): string => {
    const sourceId = (feat.properties as GeoProps | null)?._source_id;
    if (sourceId != null) {
      const real = featuresRef.current?.features.find(
        (f) => (f.properties as GeoProps | null)?._source_id === sourceId
      );
      if (real) return String(real.id);
    }
    return String(feat.id);
  }, []);

  const handleFeatureClick = useCallback(
    (feat: Feature) => {
      closePopup();
      void fetchFeatureDetail(resolveDraftId(feat)).then((full) => {
        setSelectedFeature(full ?? feat);
        setFormMode("update");
        setPendingGeometry(null);
        setFormOpen(true);
      });
    },
    [closePopup, fetchFeatureDetail, resolveDraftId]
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !meta || !moveMode) return;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const previewPointLayer = "drag-preview-point";
    const previewLineLayer = "drag-preview-line";

    const ensurePreviewLayer = () => {
      if (!map.getSource("drag-preview")) {
        map.addSource("drag-preview", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
      }
      if (isPoint && !map.getLayer(previewPointLayer)) {
        map.addLayer({
          id: previewPointLayer,
          type: "circle",
          source: "drag-preview",
          paint: {
            "circle-radius": 10,
            "circle-color": "#f59e0b",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }
      if (!isPoint && !map.getLayer(previewLineLayer)) {
        map.addLayer({
          id: previewLineLayer,
          type: "line",
          source: "drag-preview",
          paint: { "line-color": "#f59e0b", "line-width": 4 },
        });
      }
    };

    const removePreviewLayer = () => {
      if (map.getLayer(previewPointLayer)) map.removeLayer(previewPointLayer);
      if (map.getLayer(previewLineLayer)) map.removeLayer(previewLineLayer);
      if (map.getSource("drag-preview")) map.removeSource("drag-preview");
    };

    const setPreview = (geom: Geometry) => {
      const src = map.getSource("drag-preview");
      if (src && "setData" in src) {
        (src as maplibregl.GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [{ type: "Feature", geometry: geom, properties: {} }],
        });
      }
    };

    const onMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (!moveModeRef.current) return;
      const feats = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (!feats.length) return;
      const feat = feats[0] as unknown as Feature;
      const g = feat.geometry;
      if (!g || !g.type || !("coordinates" in g)) return;
      dragRef.current = {
        featureId: resolveDraftId(feat),
        startLngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
        origGeom: g as Geometry,
      };
      ensurePreviewLayer();
      setPreview(g as Geometry);
      map.dragPan.disable();
      map.getCanvas().style.cursor = "grabbing";
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dLng = e.lngLat.lng - d.startLngLat.lng;
      const dLat = e.lngLat.lat - d.startLngLat.lat;
      setPreview(translateGeometry(d.origGeom, dLng, dLat));
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      const dLng = e.lngLat.lng - d.startLngLat.lng;
      const dLat = e.lngLat.lat - d.startLngLat.lat;
      removePreviewLayer();
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
      if (dLng === 0 && dLat === 0) return;
      const newGeom = translateGeometry(d.origGeom, dLng, dLat);
      void persistMovedFeature(d.featureId, newGeom);
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      dragRef.current = null;
      removePreviewLayer();
      map.dragPan.enable();
      map.getCanvas().style.cursor = "";
    };
  }, [meta, isPoint, moveMode, persistMovedFeature, resolveDraftId]);

  useEffect(() => {
    if (!mapRef.current || !meta) return;
    const map = mapRef.current;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      if (tdRef.current?.enabled) return;
      if (moveModeRef.current) return;
      handleFeatureClick(e.features[0] as unknown as Feature);
    };

    if (map.getLayer(layerId)) {
      map.on("click", layerId, handler);
    }
    return () => {
      map.off("click", layerId, handler);
    };
  }, [meta, isPoint, handleFeatureClick]);

  /* ================================================================ */
  /*  RENDER                                                          */
  /* ================================================================ */
  if (!meta) {
    return <div className="page-loading">Dataset tidak dikenal</div>;
  }

  return (
    <div className="ed-root">
      

      {/* -------- map + overlays -------- */}
      <div className="ed-body">
        <div className="ed-map-wrap" ref={mapContainerRef}>
        {/* ---- Top-left floating panel: title, online, edit window ---- */}
        <div className="ed-panel-tl">
          <div className="ed-panel-tl-title">{meta.label}</div>
          <div className="ed-panel-tl-sub">
            <span className="ed-live-dot" />
            <span>{onlineCount} online</span>
            <div className={`ed-window-pill ${editWindow?.open ? "ed-window-pill-open" : "ed-window-pill-closed"}`}>
              {editWindow?.open ? "Edit terbuka" : "Edit tertutup"}
            </div>
            {isSuperAdmin && (
              <button
                className={`ed-window-btn ${editWindow?.open ? "ed-window-btn-close" : "ed-window-btn-open"}`}
                onClick={toggleWindow}
              >
                {editWindow?.open ? "Tutup" : "Buka"}
              </button>
            )}
          </div>
        </div>

          {/* ---- Floating Toolbox ---- */}
          {(isSuperAdmin || isEditor) && (
            <div className="ed-toolbox">
              {canDraw && (
                <button
                  className="ed-toolbox-btn"
                  onClick={handleStartDraw}
                  title={isPoint ? "+ Titik" : "+ Garis"}
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                </button>
              )}

              <button
                className={`ed-toolbox-btn${fieldMode ? " ed-toolbox-btn-active" : ""}`}
                onClick={() => setFieldMode((p) => !p)}
                title="Mode Penandaan"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
                  <circle cx="12" cy="9" r="2.5" />
                </svg>
              </button>

              {canDraw && (
                <button
                  className={`ed-toolbox-btn${moveMode ? " ed-toolbox-btn-active" : ""}`}
                  onClick={() => setMoveMode((p) => !p)}
                  title="Mode Geser/Ubah — klik fitur lalu seret untuk memindahkan (titik/garis)"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="5 9 2 12 5 15" />
                    <polyline points="9 5 12 2 15 5" />
                    <polyline points="15 19 12 22 9 19" />
                    <polyline points="19 9 22 12 19 15" />
                    <line x1="2" y1="12" x2="22" y2="12" />
                    <line x1="12" y1="2" x2="12" y2="22" />
                  </svg>
                </button>
              )}

              {isSuperAdmin && (
                <>
                <button
                  className="ed-toolbox-btn"
                  onClick={toggleAutoSchedule}
                  title={`Auto publish 2 hari: ${autoSchedule ? "ON" : "OFF"}`}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                </button>
                <button
                  className="ed-toolbox-btn ed-toolbox-btn-publish"
                  onClick={handlePublish}
                  disabled={publishBusy}
                  title="Publish ke Peta Publik"
                >
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                    <polyline points="16 6 12 2 8 6" />
                    <line x1="12" y1="2" x2="12" y2="15" />
                  </svg>
                </button>
                </>
              )}

              <div className="ed-toolbox-divider" />

              <button
                className="ed-toolbox-btn"
                onClick={() => {
                  const m = mapRef.current;
                  if (m) m.easeTo({ zoom: m.getZoom() + 1, duration: 200 });
                }}
                title="Perbesar"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>

              <button
                className="ed-toolbox-btn"
                onClick={() => {
                  const m = mapRef.current;
                  if (m) m.easeTo({ zoom: m.getZoom() - 1, duration: 200 });
                }}
                title="Perkecil"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                >
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <button
                className="ed-toolbox-btn"
                onClick={() => {
                  const m = mapRef.current;
                  if (m) m.easeTo({ center: [107.6, -6.9], zoom: 9, duration: 400 });
                }}
                title="Reset ke Jawa Barat"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
                </svg>
              </button>
            </div>
          )}

          {/* ---- Legend ---- */}
          <div className="ed-legend">
            <div className="ed-legend-item">
              {isPoint ? (
                <span
                  className="ed-legend-swatch"
                  style={{ backgroundColor: meta.defaultColor }}
                />
              ) : (
                <span
                  className="ed-legend-swatch-line"
                  style={{ backgroundColor: meta.defaultColor }}
                />
              )}
              <span className="ed-legend-label">Fitur (master)</span>
            </div>
            <div className="ed-legend-item">
              {isPoint ? (
                <span
                  className="ed-legend-swatch ed-legend-swatch-field"
                  style={{ backgroundColor: FIELD_COLOR }}
                />
              ) : (
                <span
                  className="ed-legend-swatch-line"
                  style={{ backgroundColor: FIELD_COLOR }}
                />
              )}
              <span className="ed-legend-label">Penandaan lapangan</span>
            </div>
          </div>

          {/* ---- Empty state ---- */}
          {features.features.length === 0 && !initialLoading && (
            <div className="ed-empty-state">
              <div className="ed-empty-state-card">
                <div className="ed-empty-state-icon">
                  <svg
                    width="40"
                    height="40"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                </div>
                <h3 className="ed-empty-state-title">Belum ada data</h3>
                <p className="ed-empty-state-text">
                  Klik &ldquo;
                  {isPoint ? "+ Titik" : "+ Garis"}
                  &rdquo; untuk menambah fitur pertama.
                </p>
              </div>
            </div>
          )}

          {/* ---- Loading chip ---- */}
          {initialLoading && (
            <div className="ed-loading-chip">
              <div className="ed-loading-spinner" />
              Memuat data&hellip;
            </div>
          )}
        </div>

        {formOpen && (
          <AttributeForm
            meta={meta}
            feature={formMode === "update" ? selectedFeature : null}
            mode={formMode}
            canEdit={
              isSuperAdmin || (isEditor && (editWindow?.open || fieldMode))
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

      {/* -------- toast -------- */}
      {toast && (
        <div
          className={`ed-toast ${toast.ok ? "ed-toast-ok" : "ed-toast-err"}`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
