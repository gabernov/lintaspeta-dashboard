import { useParams } from "react-router-dom";
import { Fragment, useEffect, useRef, useState, useCallback, type ReactNode } from "react";
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
  MultiLineString,
} from "geojson";

/* Raster basemap catalog — "bright" (CartoDB Voyager) is the default
   across every dataset editor, per product request. */
const BASEMAPS = [
  {
    id: "bright",
    label: "Bright",
    url: "https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
    attribution: "© OpenStreetMap contributors © CARTO",
  },
  {
    id: "positron",
    label: "Putih",
    url: "https://basemaps.cartocdn.com/light_all/{z}/{x}/{y}@2x.png",
    attribution: "© OpenStreetMap contributors © CARTO",
  },
  {
    id: "dark",
    label: "Gelap",
    url: "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
    attribution: "© OpenStreetMap contributors © CARTO",
  },
] as const;

type BasemapId = (typeof BASEMAPS)[number]["id"];

function getBasemap(id: string | null | undefined) {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

/* Deterministic per-ruas color: golden-angle hue walk keeps adjacent
   ruas visually distinct even with many features on screen. */
function ruasColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 72% 46%)`;
}

/* Squared distance from point to a lng/lat vertex array — good enough
   for nearest-ruas ranking at province scale. */
function distSqToCoords(
  p: [number, number],
  coords: [number, number][]
): number {
  let best = Infinity;
  for (let i = 0; i + 1 < coords.length; i++) {
    const [ax, ay] = coords[i];
    const [bx, by] = coords[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((p[0] - ax) * dx + (p[1] - ay) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    const ddx = p[0] - cx;
    const ddy = p[1] - cy;
    // Scale lng by cos(lat) so horizontal distances compare fairly.
    const mx = ddx * Math.cos((p[1] * Math.PI) / 180);
    const d2 = mx * mx + ddy * ddy;
    if (d2 < best) best = d2;
  }
  return best;
}

function nearestRuas(
  point: Point,
  fc: FeatureCollection
): { kode: string; nama: string; meters: number } | null {
  let best: { d2: number; kode: string; nama: string } | null = null;
  for (const f of fc.features) {
    if (!f.geometry || f.geometry.type !== "LineString") continue;
    const coords = f.geometry.coordinates as [number, number][];
    if (!coords.length) continue;
    const d2 = distSqToCoords(
      [point.coordinates[0], point.coordinates[1]],
      coords
    );
    if (!best || d2 < best.d2) {
      const p = (f.properties ?? {}) as Record<string, unknown>;
      best = {
        d2,
        kode: String(p.kode_number ?? ""),
        nama: String(p.nama ?? ""),
      };
    }
  }
  if (!best) return null;
  // d2 mixes cos-scaled lng² and raw lat² (degrees); the averaged
  // degree→meter factor lands within ~1% across Jabar's latitudes.
  const latRad = (point.coordinates[1] * Math.PI) / 180;
  const degToM = (111320 * Math.cos(latRad) + 111320) / 2;
  return { kode: best.kode, nama: best.nama, meters: Math.sqrt(best.d2) * degToM };
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

type LineGeom = LineString | MultiLineString;

function isLineGeom(g: Geometry | null | undefined): g is LineGeom {
  return !!g && (g.type === "LineString" || g.type === "MultiLineString");
}

function lineCoords(g: LineGeom): [number, number][] {
  const raw = g.type === "LineString" ? g.coordinates : g.coordinates[0];
  return (raw as [number, number][]).map((c) => [c[0], c[1]] as [number, number]);
}

function rebuildLineGeom(g: LineGeom, coords: [number, number][]): LineGeom {
  if (g.type === "LineString") {
    return { type: "LineString", coordinates: coords };
  }
  return { type: "MultiLineString", coordinates: [coords] };
}

// Dense lines (ruas_jalan has 900+ vertices) would render every handle as a
// solid white band on top of the line — a phantom "second line". Sample evenly
// past a cap while keeping the real vertex index so dragging still targets the
// correct vertex.
const MAX_VERTEX_HANDLES = 80;

function sampleVertices(
  coords: [number, number][]
): { c: [number, number]; i: number }[] {
  if (coords.length <= MAX_VERTEX_HANDLES) {
    return coords.map((c, i) => ({ c, i }));
  }
  const step = (coords.length - 1) / (MAX_VERTEX_HANDLES - 1);
  return Array.from({ length: MAX_VERTEX_HANDLES }, (_, k) => {
    const i = Math.round(k * step);
    return { c: coords[i], i };
  });
}

/* ------------------------------------------------------------------ */
/*  Point layer stack (clusters + labels + points) shared by onLoad    */
/*  and the cluster toggle so the source can be re-created cleanly.    */
/* ------------------------------------------------------------------ */
function addPointDraftLayers(map: maplibregl.Map, color: string) {
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
      "circle-color": color,
      "circle-opacity": 0.85,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: "draft-cluster-labels",
    type: "symbol",
    source: "draft",
    filter: ["has", "point_count"],
    layout: {
      "text-field": ["get", "point_count"],
      "text-font": ["Open Sans Semibold"],
      "text-size": 12,
    },
    paint: {
      "text-color": "#ffffff",
      "text-halo-color": "#0f172a",
      "text-halo-width": 1.5,
    },
  });
  map.addLayer({
    id: "draft-points",
    type: "circle",
    source: "draft",
    filter: ["!", ["has", "point_count"]],
    paint: {
      // Zoom curve: peak at mid zoom where points are placed, small at
      // both far zoom (dense) and street level (keeps points unobtrusive).
      "circle-radius": [
        "interpolate",
        ["linear"],
        ["zoom"],
        6, 4,
        10, 5.5,
        13, 6.5,
        16, 5,
        19, 3.5,
        22, 3,
      ],
      "circle-color": color,
      "circle-stroke-width": 2,
      "circle-stroke-color": "#0f172a",
      "circle-blur": 0.15,
    },
  });
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
  const applyRuasColorsRef = useRef<() => void>(() => {});
  const activeToolRef = useRef<"select" | "pan" | "draw">("select");
  const dragRef = useRef<{
    featureId: string;
    startLngLat: { lng: number; lat: number };
    origGeom: Geometry;
  } | null>(null);
  const drawTargetRef = useRef<"point" | "line">(
    meta?.geometryType === "Point" ? "point" : "line"
  );
  const vertexDragRef = useRef<{
    featureId: string;
    origGeom: LineGeom;
    coords: [number, number][];
    index: number;
    startLngLat: { lng: number; lat: number };
  } | null>(null);
  const marqueeStartRef = useRef<{ x: number; y: number } | null>(null);
  const selectedFeatureRef = useRef<Feature | null>(null);

  /* ---- state ---- */
  const [features, setFeatures] = useState<FeatureCollection>({
    type: "FeatureCollection",
    features: [],
  });
  const [editWindow, setEditWindow] = useState<EditWindow | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "pan" | "draw">(
    "select"
  );
  const [drawTarget, setDrawTarget] = useState<"point" | "line">(
    meta?.geometryType === "Point" ? "point" : "line"
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [marquee, setMarquee] = useState<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  } | null>(null);
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
  // Cluster mode OFF by default — users prefer seeing every point; the
  // toolbox button lets super_admin/editor turn native clustering on.
  const [clusterMode, setClusterMode] = useState(false);
  const clusterModeRef = useRef(false);

  /* ---- per-ruas reference coloring + nearest-ruas autofill ---- */
  const roadsBgRef = useRef<FeatureCollection | null>(null);
  const [distinctRuas, setDistinctRuas] = useState(
    () => localStorage.getItem(`ruas_colors_${datasetId}`) === "true"
  );
  const distinctRuasRef = useRef(distinctRuas);
  const [nearestPrefill, setNearestPrefill] = useState<GeoProps | null>(null);
  const [nearestHint, setNearestHint] = useState<string | null>(null);

  /* ---- basemap switcher (default bright for every dataset) ---- */
  const [basemapId, setBasemapId] = useState<BasemapId>(() => {
    return getBasemap(localStorage.getItem("ed_basemap")).id;
  });
  const basemapIdRef = useRef(basemapId);

  /* ---- undo / redo ---- */
  type UndoOp =
    | { type: "create"; geometry: Geometry; properties: Record<string, unknown>; region: string; sourceId: string }
    | { type: "update"; id: string; oldGeometry: Geometry; oldProperties: Record<string, unknown>; newGeometry: Geometry; newProperties: Record<string, unknown>; region: string }
    | { type: "delete"; feature: Feature }
    | { type: "bulk-delete"; features: Feature[] }
    | { type: "move"; id: string; oldGeometry: Geometry; newGeometry: Geometry; properties: Record<string, unknown>; region: string; sourceId: string; sourceType: string };
  const undoStackRef = useRef<UndoOp[]>([]);
  const redoStackRef = useRef<UndoOp[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /* ---- derived ---- */
  const isPoint = meta?.geometryType === "Point";
  const isSuperAdmin = role === "super_admin";
  const isEditor = role === "editor";
  const canDraw =
    meta != null && (isSuperAdmin || (isEditor && editWindow?.open));

  /* ---- callbacks ---- */
  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const pushUndo = useCallback((op: UndoOp) => {
    undoStackRef.current = [...undoStackRef.current.slice(-49), op];
    redoStackRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }, []);

  /** Shared draw-start handler used by both toolbar and floating toolbox. */
  const handleStartDraw = useCallback((target: "point" | "line") => {
    drawTargetRef.current = target;
    setDrawTarget(target);
    // Exit any active edit session (form + vertex handles) so drawing starts
    // clean. Otherwise the stale edit form / dense vertex handles stay on top
    // of the map and block drawing the new feature.
    setFormOpen(false);
    setSelectedFeature(null);
    setPendingGeometry(null);
    setFormMode("create");
    setNearestPrefill(null);
    setNearestHint(null);
    setSelectedIds([]);
    if (tdRef.current) {
      tdRef.current.clear();
      tdRef.current.setMode(target === "point" ? "point" : "linestring");
    }
    setActiveTool("draw");
  }, []);

  const applyDragPan = useCallback((tool: "select" | "pan" | "draw") => {
    const map = mapRef.current;
    if (!map) return;
    if (tool === "pan") map.dragPan.enable();
    else map.dragPan.disable();
  }, []);

  const applyFeaturesToSource = useCallback(
    (fc: FeatureCollection) => {
      const map = mapRef.current;
      if (!map) return;
      const src = map.getSource("draft");
      if (src && "setData" in src) {
        (src as maplibregl.GeoJSONSource).setData(fc);
      }
      if (!hasFittedRef.current) {
        const saved = datasetId
          ? sessionStorage.getItem(`ed_viewport_${datasetId}`)
          : null;
        if (saved) {
          try {
            const { lng, lat, zoom } = JSON.parse(saved) as {
              lng: number;
              lat: number;
              zoom: number;
            };
            map.jumpTo({ center: [lng, lat], zoom });
          } catch {
            /* fall through to fitBounds */
          }
        } else {
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
        }
        hasFittedRef.current = true;
      }
    },
    [datasetId]
  );

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
    if (!datasetId) return;
    const next = !editWindow?.open;
    const now = new Date().toISOString();
    // Upsert on the dataset PK so the first "Buka" inserts the row and
    // subsequent toggles update it — no duplicate-key error.
    const { error } = await supabase
      .from("edit_windows")
      .upsert(
        {
          dataset: datasetId,
          open: next,
          opened_by: profile?.id,
          opened_at: now,
        },
        { onConflict: "dataset" }
      );
    if (error) {
      showToast("Gagal mengubah jendela edit: " + error.message, false);
      return;
    }
    setEditWindow((prev) =>
      prev
        ? { ...prev, open: next }
        : {
            dataset: datasetId as EditWindow["dataset"],
            open: next,
            opened_by: profile?.id ?? null,
            opened_at: now,
            note: null,
          }
    );
    showToast(next ? "Jendela edit dibuka" : "Jendela edit ditutup", true);
  }, [editWindow, datasetId, profile?.id, showToast]);

  /* Recolor the ruas reference layer: distinct per-ruas colors when the
     legend toggle is on, neutral grey otherwise. */
  const applyRuasColors = useCallback(() => {
    const map = mapRef.current;
    const fc = roadsBgRef.current;
    if (!map || !map.getLayer("roads-bg-line")) return;
    if (distinctRuasRef.current && fc) {
      for (const f of fc.features) {
        const p = (f.properties ?? {}) as Record<string, unknown>;
        f.properties = {
          ...p,
          _ruas_color: ruasColor(String(p.kode_number ?? p.nama ?? f.id ?? "")),
        };
      }
      const src = map.getSource("roads-bg");
      if (src && "setData" in src) {
        (src as maplibregl.GeoJSONSource).setData(fc);
      }
      map.setPaintProperty("roads-bg-line", "line-color", [
        "get",
        "_ruas_color",
      ]);
    } else {
      map.setPaintProperty("roads-bg-line", "line-color", "#94a3b8");
    }
  }, []);

  useEffect(() => {
    applyRuasColorsRef.current = applyRuasColors;
  }, [applyRuasColors]);

  const handleToggleRuasColors = useCallback(() => {
    setDistinctRuas((prev) => {
      const next = !prev;
      localStorage.setItem(`ruas_colors_${datasetId}`, String(next));
      return next;
    });
  }, [datasetId]);

  useEffect(() => {
    distinctRuasRef.current = distinctRuas;
    applyRuasColors();
  }, [distinctRuas, applyRuasColors]);

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

      if (formMode === "create") {
        pushUndo({ type: "create", geometry, properties: values, region: String(regionVal), sourceId });
      } else if (formMode === "update" && selectedFeature) {
        pushUndo({
          type: "update", id: String(selectedFeature.id),
          oldGeometry: selectedFeature.geometry, oldProperties: (selectedFeature.properties ?? {}) as Record<string, unknown>,
          newGeometry: geometry, newProperties: values, region: String(regionVal),
        });
      }

      const { error } = await supabase.rpc("save_draft_feature", {
        p_dataset: datasetId,
        p_id: pId,
        p_source_id: sourceId,
        p_geometry: geometry,
        p_properties: values,
        p_region: String(regionVal),
        p_source_type: "master",
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
      showToast,
      refreshFeatures,
    ]
  );

  const handleDelete = useCallback(async () => {
    if (!datasetId || !selectedFeature?.id) return;
    pushUndo({ type: "delete", feature: selectedFeature });
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

  const handleBulkDelete = useCallback(async () => {
    if (!datasetId || selectedIds.length === 0) return;
    const featsToDelete = selectedIds
      .map((id) => featuresRef.current?.features.find((f) => String(f.id) === id))
      .filter(Boolean) as Feature[];
    pushUndo({ type: "bulk-delete", features: featsToDelete });
    setSaving(true);
    const results = await Promise.all(
      selectedIds.map((id) =>
        supabase.rpc("delete_draft_feature", {
          p_dataset: datasetId,
          p_id: id,
        })
      )
    );
    setSaving(false);
    const failed = results.find((r) => r.error);
    if (failed) {
      showToast("Gagal menghapus: " + failed.error?.message, false);
      return;
    }
    showToast(`${selectedIds.length} fitur dihapus`, true);
    setSelectedIds([]);
    void refreshFeatures();
  }, [datasetId, selectedIds, showToast, refreshFeatures]);

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
      pushUndo({
        type: "move", id: draftId, oldGeometry: full.geometry, newGeometry: geometry,
        properties: fullProps, region: regionVal, sourceId, sourceType,
      });
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
      // User feedback (poin 4): open the data panel after a geometry edit.
      const updated = { ...full, geometry } as Feature;
      setSelectedFeature(updated);
      selectedFeatureRef.current = updated;
      setFormMode("update");
      setFormOpen(true);
    },
    [meta, datasetId, fetchFeatureDetail, region, showToast, refreshFeatures]
  );

  const handleUndo = useCallback(async () => {
    if (undoStackRef.current.length === 0 || !datasetId) return;
    const op = undoStackRef.current.pop()!;
    redoStackRef.current = [...redoStackRef.current, op];
    setCanRedo(true);
    setCanUndo(undoStackRef.current.length > 0);

    switch (op.type) {
      case "create": {
        const fc = featuresRef.current;
        const feat = fc?.features.find((f) => f.properties?._source_id === op.sourceId);
        if (feat) {
          await supabase.rpc("delete_draft_feature", { p_dataset: datasetId, p_id: String(feat.id) });
        }
        break;
      }
      case "update": {
        const oldProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.oldProperties)) {
          if (!k.startsWith("_")) oldProps[k] = v;
        }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: op.id,
          p_source_id: op.oldProperties._source_id as string ?? op.id,
          p_geometry: op.oldGeometry, p_properties: oldProps,
          p_region: op.oldProperties._region as string ?? "", p_source_type: op.oldProperties._source_type as string ?? "master",
        });
        break;
      }
      case "delete": {
        const f = op.feature;
        const fp = (f.properties ?? {}) as Record<string, unknown>;
        const cleanProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fp)) { if (!k.startsWith("_")) cleanProps[k] = v; }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: null,
          p_source_id: (fp._source_id as string) ?? `undo-${Date.now()}`,
          p_geometry: f.geometry, p_properties: cleanProps,
          p_region: (fp._region as string) ?? "", p_source_type: (fp._source_type as string) ?? "master",
        });
        break;
      }
      case "bulk-delete": {
        for (const f of op.features) {
          const fp = (f.properties ?? {}) as Record<string, unknown>;
          const cleanProps: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(fp)) { if (!k.startsWith("_")) cleanProps[k] = v; }
          await supabase.rpc("save_draft_feature", {
            p_dataset: datasetId, p_id: null,
            p_source_id: (fp._source_id as string) ?? `undo-${Date.now()}`,
            p_geometry: f.geometry, p_properties: cleanProps,
            p_region: (fp._region as string) ?? "", p_source_type: (fp._source_type as string) ?? "master",
          });
        }
        break;
      }
      case "move": {
        const moveProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.properties)) { if (!k.startsWith("_")) moveProps[k] = v; }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: op.id, p_source_id: op.sourceId,
          p_geometry: op.oldGeometry, p_properties: moveProps,
          p_region: op.region, p_source_type: op.sourceType,
        });
        break;
      }
    }
    setFormOpen(false);
    setSelectedFeature(null);
    tdRef.current?.clear();
    await refreshFeatures();
  }, [datasetId, refreshFeatures]);

  const handleRedo = useCallback(async () => {
    if (redoStackRef.current.length === 0 || !datasetId) return;
    const op = redoStackRef.current.pop()!;
    undoStackRef.current = [...undoStackRef.current, op];
    setCanUndo(true);
    setCanRedo(redoStackRef.current.length > 0);

    switch (op.type) {
      case "create": {
        const fp = op.properties as Record<string, unknown>;
        const cleanProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fp)) { if (!k.startsWith("_")) cleanProps[k] = v; }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: null, p_source_id: op.sourceId,
          p_geometry: op.geometry, p_properties: cleanProps,
          p_region: op.region, p_source_type: "master",
        });
        break;
      }
      case "update": {
        const newProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.newProperties)) { if (!k.startsWith("_")) newProps[k] = v; }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: op.id,
          p_source_id: op.oldProperties._source_id as string ?? op.id,
          p_geometry: op.newGeometry, p_properties: newProps,
          p_region: op.region, p_source_type: op.oldProperties._source_type as string ?? "master",
        });
        break;
      }
      case "delete": {
        const f = op.feature;
        await supabase.rpc("delete_draft_feature", { p_dataset: datasetId, p_id: String(f.id) });
        break;
      }
      case "bulk-delete": {
        for (const f of op.features) {
          await supabase.rpc("delete_draft_feature", { p_dataset: datasetId, p_id: String(f.id) });
        }
        break;
      }
      case "move": {
        const moveProps: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(op.properties)) { if (!k.startsWith("_")) moveProps[k] = v; }
        await supabase.rpc("save_draft_feature", {
          p_dataset: datasetId, p_id: op.id, p_source_id: op.sourceId,
          p_geometry: op.newGeometry, p_properties: moveProps,
          p_region: op.region, p_source_type: op.sourceType,
        });
        break;
      }
    }
    setFormOpen(false);
    setSelectedFeature(null);
    tdRef.current?.clear();
    await refreshFeatures();
  }, [datasetId, refreshFeatures]);

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

  /** Re-create the "draft" source+layers with cluster on/off; ids stay the same so handlers keep working. */
  const applyClusterMode = useCallback(
    (next: boolean) => {
      clusterModeRef.current = next;
      setClusterMode(next);
      const map = mapRef.current;
      if (!map || !isPoint) return;
      if (!map.getSource("draft")) return;
      for (const lid of ["draft-clusters", "draft-cluster-labels", "draft-points"]) {
        if (map.getLayer(lid)) map.removeLayer(lid);
      }
      map.removeSource("draft");
      map.addSource("draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: next,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });
      addPointDraftLayers(map, meta?.defaultColor ?? "#2563eb");
      const fc = featuresRef.current;
      if (fc) {
        const src = map.getSource("draft");
        if (src && "setData" in src) {
          (src as maplibregl.GeoJSONSource).setData(fc);
        }
      }
    },
    [isPoint, meta]
  );

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
        glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
        sources: {
          basemap: {
            type: "raster",
            tiles: [getBasemap(basemapIdRef.current).url],
            tileSize: 256,
            attribution: getBasemap(basemapIdRef.current).attribution,
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

      // Reference layer: published ruas_jalan network shown under the draft
      // data on the other datasets (sekolah/rambu/apj) to guide penitikan.
      // Skipped on ruas_jalan itself — that editor intentionally shows
      // drafts only, so grey published lines never get mixed into edits.
      if (datasetId !== "ruas_jalan" && !map.getSource("roads-bg")) {
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
            if (!data) return;
            roadsBgRef.current = data as FeatureCollection;
            const src = map.getSource("roads-bg");
            if (src && "setData" in src) {
              (src as maplibregl.GeoJSONSource).setData(
                data as FeatureCollection
              );
            }
            applyRuasColorsRef.current();
          });
      }

      map.addSource("draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: isPoint && clusterModeRef.current,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      if (isPoint) {
        addPointDraftLayers(map, meta.defaultColor);
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
            "line-color": meta.defaultColor,
            "line-width": 3,
          },
        });
      }

      map.addSource("draft-selected", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      if (isPoint) {
        map.addLayer({
          id: "draft-selected-points",
          type: "circle",
          source: "draft-selected",
          paint: {
            "circle-radius": 14,
            "circle-color": "rgba(245, 158, 11, 0.35)",
            "circle-stroke-color": "#f59e0b",
            "circle-stroke-width": 3,
          },
        });
      } else {
        map.addLayer({
          id: "draft-selected-lines",
          type: "line",
          source: "draft-selected",
          paint: {
            "line-color": "#f59e0b",
            "line-width": 8,
            "line-opacity": 0.85,
          },
        });
      }

      map.addSource("line-edit-vertices", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: "line-edit-vertices",
        type: "circle",
        source: "line-edit-vertices",
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-color": "#f59e0b",
          "circle-stroke-width": 3,
        },
      });

      const layerIds = isPoint ? ["draft-points"] : ["draft-lines"];

      if (isPoint) {
        for (const lid of ["draft-clusters", "draft-cluster-labels"]) {
          map.on("click", lid, (e: maplibregl.MapLayerMouseEvent) => {
            if (activeToolRef.current !== "select") return;
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
          map.on("mouseenter", lid, () => {
            if (activeToolRef.current !== "select") return;
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", lid, () => {
            if (activeToolRef.current === "pan") map.getCanvas().style.cursor = "grab";
            else if (activeToolRef.current === "draw") map.getCanvas().style.cursor = "crosshair";
            else map.getCanvas().style.cursor = "";
          });
        }
      }

      for (const lid of layerIds) {
        map.on("mouseenter", lid, () => {
          if (activeToolRef.current !== "select") return;
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", lid, () => {
          if (activeToolRef.current === "pan") map.getCanvas().style.cursor = "grab";
          else if (activeToolRef.current === "draw") map.getCanvas().style.cursor = "crosshair";
          else map.getCanvas().style.cursor = "";
        });
      }

      map.on("dblclick", (e: maplibregl.MapMouseEvent) => {
        if (activeToolRef.current === "draw") e.preventDefault();
      });

      map.on("click", (e: maplibregl.MapMouseEvent) => {
        if (activeToolRef.current !== "select") return;
        const clickedOnFeature = map.queryRenderedFeatures(e.point, {
          layers: layerIds,
        });
        if (clickedOnFeature.length > 0) return;

        setSelectedIds([]);
        closePopup();

        // Empty-map click always ends the edit session; this handler is
        // registered once at mount so it reads the live selection via ref.
        if (selectedFeatureRef.current) {
          setFormOpen(false);
          setSelectedFeature(null);
          setFormMode("create");
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

    map.on("moveend", () => {
      if (!datasetId) return;
      const c = map.getCenter();
      sessionStorage.setItem(
        `ed_viewport_${datasetId}`,
        JSON.stringify({ lng: c.lng, lat: c.lat, zoom: map.getZoom() })
      );
    });

    function initTerraDraw() {
      if (tdRef.current) {
        tdRef.current.stop();
        tdRef.current = null;
      }
      const adapter = new TerraDrawMapLibreGLAdapter({ map });

      const modes = [new TerraDrawPointMode(), new TerraDrawLineStringMode()];

      const td = new TerraDraw({ adapter, modes });
      td.start();
      tdRef.current = td;
      td.setMode(
        canDraw && activeToolRef.current === "draw"
          ? drawTargetRef.current === "point"
            ? "point"
            : "linestring"
          : "static"
      );

      td.on("finish", (_id, context) => {
        if (context.action === "draw") {
          const snap = td.getSnapshot();
          const drawn = snap.find(
            (f) =>
              f.properties?.mode ===
                (drawTargetRef.current === "point" ? "point" : "linestring") &&
              !f.properties?.currentlyDrawing
          );
          if (drawn) {
            const geom = drawn.geometry as Point | LineString;

            // Rambu workflow: prefill kode/nama from the nearest ruas so
            // penitikan di lapangan tidak mengetik manual.
            if (
              datasetId === "rambu" &&
              geom.type === "Point" &&
              roadsBgRef.current?.features.length
            ) {
              const nr = nearestRuas(geom as Point, roadsBgRef.current);
              if (nr) {
                setNearestPrefill({
                  kode_ruas: nr.kode,
                  nama_ruas: nr.nama,
                });
                setNearestHint(
                  `Terisi otomatis dari ruas terdekat: ${nr.kode} — ${nr.nama} (${Math.round(nr.meters)} m)`
                );
              } else {
                setNearestPrefill(null);
                setNearestHint(null);
              }
            } else {
              setNearestPrefill(null);
              setNearestHint(null);
            }

            setPendingGeometry(geom);
            setFormMode("create");
            setSelectedFeature(null);
            setFormOpen(true);
            // Keep the just-drawn feature rendered while the create form is
            // open — clear() here makes it vanish the instant the user
            // double-clicks, which reads as "line hilang, tidak teregister".
            td.setMode("static");
            return;
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

  /* ---- swap basemap tiles when the user picks another one ---- */
  useEffect(() => {
    basemapIdRef.current = basemapId;
    localStorage.setItem("ed_basemap", basemapId);
    const src = mapRef.current?.getSource("basemap");
    if (src && "setTiles" in src) {
      (src as maplibregl.RasterTileSource).setTiles([
        getBasemap(basemapId).url,
      ]);
    }
  }, [basemapId]);

  /* ---- keep activeTool ref in sync for event handlers ---- */
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  /* ---- keep clusterMode ref in sync for map handlers ---- */
  useEffect(() => {
    clusterModeRef.current = clusterMode;
  }, [clusterMode]);

  /* ---- keep selectedFeature ref in sync for mount-time handlers ---- */
  useEffect(() => {
    selectedFeatureRef.current = selectedFeature;
  }, [selectedFeature]);

  /* ---- keep drawTarget ref in sync ---- */
  useEffect(() => {
    drawTargetRef.current = drawTarget;
  }, [drawTarget]);

  const handleUndoRef = useRef(handleUndo);
  const handleRedoRef = useRef(handleRedo);
  useEffect(() => { handleUndoRef.current = handleUndo; }, [handleUndo]);
  useEffect(() => { handleRedoRef.current = handleRedo; }, [handleRedo]);

  /* ---- disable map drag-pan unless pan tool is active ---- */
  useEffect(() => {
    applyDragPan(activeTool);
  }, [activeTool, applyDragPan]);

  /* ---- system cursor per tool (Excalidraw-style) ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const canvas = map.getCanvas();
    const applyCursor = () => {
      if (activeTool === "pan") canvas.style.cursor = "grab";
      else if (activeTool === "draw") canvas.style.cursor = "crosshair";
      else canvas.style.cursor = "";
    };
    applyCursor();
    if (activeTool !== "pan") return;
    const onDown = () => {
      canvas.style.cursor = "grabbing";
    };
    const onUp = () => {
      canvas.style.cursor = "grab";
    };
    map.on("mousedown", onDown);
    map.on("mouseup", onUp);
    map.on("mouseout", onUp);
    return () => {
      map.off("mousedown", onDown);
      map.off("mouseup", onUp);
      map.off("mouseout", onUp);
    };
  }, [activeTool]);

  /* ---- sync terra-draw mode with activeTool ---- */
  useEffect(() => {
    if (tdRef.current && meta) {
      if (activeTool === "draw" && canDraw) {
        tdRef.current.setMode(
          drawTarget === "point" ? "point" : "linestring"
        );
      } else {
        tdRef.current.setMode("static");
      }
    }
  }, [activeTool, canDraw, meta, drawTarget]);

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
      setSelectedIds([]);
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
    if (!map || !meta || activeTool !== "select") return;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const vertexLayerId = "line-edit-vertices";
    const previewPointLayer = "drag-preview-point";
    const previewLineLayer = "drag-preview-line";

    const setDraftData = (fc: FeatureCollection) => {
      const src = map.getSource("draft") as maplibregl.GeoJSONSource;
      if (src) src.setData(fc);
    };

    const setVertices = (coords: [number, number][]) => {
      const vsrc = map.getSource("line-edit-vertices") as maplibregl.GeoJSONSource;
      if (vsrc) {
        const visible = sampleVertices(coords);
        vsrc.setData({
          type: "FeatureCollection",
          features: visible.map(({ c, i }) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: c },
            properties: { vi: i },
          })),
        });
      }
    };

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
      if (activeToolRef.current !== "select") return;

      const isLineEdit =
        formMode === "update" && isLineGeom(selectedFeature?.geometry);

      if (isLineEdit) {
        const vhits = map.queryRenderedFeatures(e.point, {
          layers: [vertexLayerId],
        });
        if (vhits.length) {
          const vi = Number(vhits[0].properties?.vi ?? 0);
          const origGeom = selectedFeature!.geometry as LineGeom;
          vertexDragRef.current = {
            featureId: resolveDraftId(selectedFeature!),
            origGeom,
            coords: lineCoords(origGeom),
            index: vi,
            startLngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
          };
          map.getCanvas().style.cursor = "grabbing";
          return;
        }
      }

      const feats = map.queryRenderedFeatures(e.point, { layers: [layerId] });
      if (feats.length) {
        const feat = feats[0] as unknown as Feature;
        const g = feat.geometry;
        if (!g || !g.type || !("coordinates" in g)) return;
        const featureId = resolveDraftId(feat);
        dragRef.current = {
          featureId,
          startLngLat: { lng: e.lngLat.lng, lat: e.lngLat.lat },
          origGeom: g as Geometry,
        };
        const fc = featuresRef.current;
        if (fc) {
          setDraftData({
            ...fc,
            features: fc.features.filter((f) => String(f.id) !== featureId),
          });
        }
        ensurePreviewLayer();
        setPreview(g as Geometry);
        map.getCanvas().style.cursor = "grabbing";
        return;
      }

      marqueeStartRef.current = { x: e.point.x, y: e.point.y };
      setMarquee({ x1: e.point.x, y1: e.point.y, x2: e.point.x, y2: e.point.y });
      map.getCanvas().style.cursor = "crosshair";
    };

    const onMouseMove = (e: maplibregl.MapMouseEvent) => {
      const v = vertexDragRef.current;
      if (v) {
        const dLng = e.lngLat.lng - v.startLngLat.lng;
        const dLat = e.lngLat.lat - v.startLngLat.lat;
        const newCoords = v.coords.map((c, i) =>
          i === v.index
            ? ([c[0] + dLng, c[1] + dLat] as [number, number])
            : c
        );
        const fc = featuresRef.current;
        if (fc) {
          setDraftData({
            ...fc,
            features: fc.features.map((f) =>
              String(f.id) === v.featureId
                ? {
                    ...f,
                    geometry: rebuildLineGeom(v.origGeom, newCoords),
                  }
                : f
            ),
          });
        }
        setVertices(newCoords);
        return;
      }

      const d = dragRef.current;
      if (d) {
        const dLng = e.lngLat.lng - d.startLngLat.lng;
        const dLat = e.lngLat.lat - d.startLngLat.lat;
        setPreview(translateGeometry(d.origGeom, dLng, dLat));
        return;
      }

      const ms = marqueeStartRef.current;
      if (ms) {
        setMarquee({
          x1: Math.min(ms.x, e.point.x),
          y1: Math.min(ms.y, e.point.y),
          x2: Math.max(ms.x, e.point.x),
          y2: Math.max(ms.y, e.point.y),
        });
      }
    };

    const onMouseUp = (e: maplibregl.MapMouseEvent) => {
      const v = vertexDragRef.current;
      if (v) {
        vertexDragRef.current = null;
        const dLng = e.lngLat.lng - v.startLngLat.lng;
        const dLat = e.lngLat.lat - v.startLngLat.lat;
        applyDragPan(activeToolRef.current);
        map.getCanvas().style.cursor = "";
        if (dLng === 0 && dLat === 0) return;
        const newGeom = rebuildLineGeom(
          v.origGeom,
          v.coords.map((c, i) =>
            i === v.index
              ? ([c[0] + dLng, c[1] + dLat] as [number, number])
              : c
          )
        );
        const fc = featuresRef.current;
        if (fc) {
          const updated = {
            ...fc,
            features: fc.features.map((f) =>
              String(f.id) === v.featureId
                ? { ...f, geometry: newGeom }
                : f
            ),
          };
          setDraftData(updated);
          featuresRef.current = updated;
        }
        setSelectedFeature((prev) =>
          prev && String(prev.id) === v.featureId
            ? { ...prev, geometry: newGeom }
            : prev
        );
        void persistMovedFeature(v.featureId, newGeom);
        return;
      }

      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        const dLng = e.lngLat.lng - d.startLngLat.lng;
        const dLat = e.lngLat.lat - d.startLngLat.lat;
        removePreviewLayer();
        applyDragPan(activeToolRef.current);
        map.getCanvas().style.cursor = "";
        if (dLng === 0 && dLat === 0) {
          const fc = featuresRef.current;
          if (fc) setDraftData(fc);
          return;
        }
        const newGeom = translateGeometry(d.origGeom, dLng, dLat);
        const fc = featuresRef.current;
        if (fc) {
          const updated = {
            ...fc,
            features: fc.features.map((f) =>
              String(f.id) === d.featureId
                ? { ...f, geometry: newGeom }
                : f
            ),
          };
          setDraftData(updated);
          featuresRef.current = updated;
        }
        setSelectedFeature((prev) =>
          prev && String(prev.id) === d.featureId
            ? { ...prev, geometry: newGeom }
            : prev
        );
        void persistMovedFeature(d.featureId, newGeom);
        return;
      }

      const ms = marqueeStartRef.current;
      if (ms) {
        marqueeStartRef.current = null;
        const x1 = Math.min(ms.x, e.point.x);
        const y1 = Math.min(ms.y, e.point.y);
        const x2 = Math.max(ms.x, e.point.x);
        const y2 = Math.max(ms.y, e.point.y);
        setMarquee(null);
        applyDragPan(activeToolRef.current);
        map.getCanvas().style.cursor = "";
        if (x2 - x1 < 5 && y2 - y1 < 5) return;
        const hits = map.queryRenderedFeatures(
          [
            [x1, y1],
            [x2, y2],
          ] as [[number, number], [number, number]],
          { layers: [layerId] }
        );
        const ids = Array.from(
          new Set(hits.map((f) => resolveDraftId(f as unknown as Feature)))
        );
        setSelectedIds(ids);
      }
    };

    map.on("mousedown", onMouseDown);
    map.on("mousemove", onMouseMove);
    map.on("mouseup", onMouseUp);
    return () => {
      map.off("mousedown", onMouseDown);
      map.off("mousemove", onMouseMove);
      map.off("mouseup", onMouseUp);
      dragRef.current = null;
      vertexDragRef.current = null;
      marqueeStartRef.current = null;
      removePreviewLayer();
      setMarquee(null);
      const fc = featuresRef.current;
      if (fc) setDraftData(fc);
      applyDragPan(activeToolRef.current);
      map.getCanvas().style.cursor = "";
    };
  }, [
    meta,
    isPoint,
    activeTool,
    formMode,
    selectedFeature,
    persistMovedFeature,
    resolveDraftId,
    applyDragPan,
  ]);

  useEffect(() => {
    if (!mapRef.current || !meta) return;
    const map = mapRef.current;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      if (activeToolRef.current !== "select") return;
      handleFeatureClick(e.features[0] as unknown as Feature);
    };

    map.on("click", layerId, handler);
    return () => {
      map.off("click", layerId, handler);
    };
  }, [meta, isPoint, handleFeatureClick]);

  /* ---- populate vertex handles for the line being edited ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("line-edit-vertices") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    const isLineEdit =
      formMode === "update" && isLineGeom(selectedFeature?.geometry);
    if (!isLineEdit) {
      src.setData({ type: "FeatureCollection", features: [] });
      return;
    }
    const coords = lineCoords(selectedFeature!.geometry as LineGeom);
    const visible = sampleVertices(coords);
    src.setData({
      type: "FeatureCollection",
      features: visible.map(({ c, i }) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: c },
        properties: { vi: i },
      })),
    });
  }, [selectedFeature, formMode]);

  /* ---- render marquee-selected features highlight ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("draft-selected") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (!src) return;
    const ids = new Set(selectedIds);
    const feats = features.features.filter((f) => ids.has(String(f.id)));
    src.setData({ type: "FeatureCollection", features: feats });
  }, [selectedIds, features]);

  /* ---- clear selection when leaving the select tool ---- */
  useEffect(() => {
    if (activeTool !== "select") setSelectedIds([]);
  }, [activeTool]);

  /* ================================================================ */
  /*  TOOLBOX — Excalidraw-style: grouped tools with keyboard 1-9     */
  /* ================================================================ */
  type ToolboxBtn = {
    key: string;
    group: "action" | "mode" | "zoom";
    show: boolean | undefined;
    title: string;
    active: boolean;
    disabled?: boolean;
    className?: string;
    icon: ReactNode;
    onClick: () => void;
  };

  const toolboxBtns: ToolboxBtn[] = [
    {
      key: "select",
      group: "action",
      show: true,
      active: activeTool === "select",
      title: "Pilih (cursor) — klik fitur untuk edit/hapus, seret untuk pindah",
      icon: (
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
          <path d="M4 4l7.07 17 2.51-7.39L21 11.07z" />
          <path d="M11.07 11.07l4.24 4.24" />
        </svg>
      ),
      onClick: () => setActiveTool("select"),
    },
    {
      key: "pan",
      group: "action",
      show: true,
      active: activeTool === "pan",
      title: "Geser peta (tangan) — seret untuk memindahkan peta",
      icon: (
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
          <path d="M18 11V6a2 2 0 0 0-4 0v5" />
          <path d="M14 10V4a2 2 0 0 0-4 0v6" />
          <path d="M10 10.5V6a2 2 0 0 0-4 0v8" />
          <path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />
        </svg>
      ),
      onClick: () => setActiveTool("pan"),
    },
    {
      key: "draw",
      group: "action",
      show: canDraw,
      active: activeTool === "draw",
      title: isPoint ? "Tambah titik" : "Tambah garis",
      icon: isPoint ? (
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
      ) : (
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
          <path d="M4 17l6-8 4 4 6-7" />
        </svg>
      ),
      onClick: () => handleStartDraw(isPoint ? "point" : "line"),
    },
    {
      key: "undo",
      group: "action",
      show: true,
      active: false,
      disabled: !canUndo,
      title: "Urungkan (Ctrl+Z)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7v6h6" /><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
        </svg>
      ),
      onClick: handleUndo,
    },
    {
      key: "redo",
      group: "action",
      show: true,
      active: false,
      disabled: !canRedo,
      title: "Ulangi (Ctrl+Y)",
      icon: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 7v6h-6" /><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
        </svg>
      ),
      onClick: handleRedo,
    },
    {
      key: "cluster",
      group: "mode",
      show: isPoint,
      active: clusterMode,
      title: `Mode cluster: ${clusterMode ? "ON" : "OFF"} — ${clusterMode ? "titik digabung saat zoom out" : "semua titik tampil"}`,
      icon: (
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
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="17" cy="7" r="2.5" />
          <circle cx="12" cy="15" r="2.5" />
          <circle cx="5" cy="18" r="2.5" />
          <path d="M8.4 7.6l6 6.2M14.8 9.1l-1.4 4M7.2 16.4l3.4-.9" />
        </svg>
      ),
      onClick: () => applyClusterMode(!clusterMode),
    },
    {
      key: "autopublish",
      group: "mode",
      show: isSuperAdmin,
      active: autoSchedule,
      title: `Auto publish 2 hari: ${autoSchedule ? "ON" : "OFF"}`,
      icon: (
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
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      ),
      onClick: toggleAutoSchedule,
    },
    {
      key: "publish",
      group: "mode",
      show: isSuperAdmin,
      active: false,
      disabled: publishBusy,
      className: "ed-toolbox-btn-publish",
      title: "Publish ke Peta Publik",
      icon: (
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
      ),
      onClick: handlePublish,
    },
    {
      key: "zoomin",
      group: "zoom",
      show: true,
      active: false,
      title: "Perbesar",
      icon: (
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
      ),
      onClick: () => {
        const m = mapRef.current;
        if (m) m.easeTo({ zoom: m.getZoom() + 1, duration: 200 });
      },
    },
    {
      key: "zoomout",
      group: "zoom",
      show: true,
      active: false,
      title: "Perkecil",
      icon: (
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
      ),
      onClick: () => {
        const m = mapRef.current;
        if (m) m.easeTo({ zoom: m.getZoom() - 1, duration: 200 });
      },
    },
    {
      key: "reset",
      group: "zoom",
      show: true,
      active: false,
      title: "Reset ke Jawa Barat",
      icon: (
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
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
        </svg>
      ),
      onClick: () => {
        const m = mapRef.current;
        if (m) m.easeTo({ center: [107.6, -6.9], zoom: 9, duration: 400 });
      },
    },
  ];

  const visibleToolboxBtns = toolboxBtns.filter((b) => b.show);
  const visibleToolboxBtnsRef = useRef(visibleToolboxBtns);
  useEffect(() => {
    visibleToolboxBtnsRef.current = visibleToolboxBtns;
  });

  /** Keyboard 1-9 activates the Nth visible toolbox tool (Excalidraw-style). */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if ((e.ctrlKey || e.metaKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndoRef.current();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === "y" || (e.key === "z" && e.shiftKey))) {
        e.preventDefault();
        handleRedoRef.current();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!/^[1-9]$/.test(e.key)) return;
      const btn = visibleToolboxBtnsRef.current[Number(e.key) - 1];
      if (btn && !btn.disabled) btn.onClick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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

          {/* ---- Floating Toolbox (Excalidraw-style) ---- */}
          {(isSuperAdmin || isEditor) && (
            <div className="ed-toolbox">
              {visibleToolboxBtns.map((btn, i) => (
                <Fragment key={btn.key}>
                  {i > 0 && visibleToolboxBtns[i - 1].group !== btn.group && (
                    <div className="ed-toolbox-divider" />
                  )}
                  <button
                    className={`ed-toolbox-btn${btn.active ? " ed-toolbox-btn-active" : ""}${btn.className ? ` ${btn.className}` : ""}`}
                    onClick={btn.onClick}
                    disabled={btn.disabled}
                    title={`${i + 1}. ${btn.title}`}
                  >
                    <span className="ed-toolbox-key">{i + 1}</span>
                    {btn.icon}
                  </button>
                </Fragment>
              ))}
            </div>
          )}

          {/* ---- Marquee overlay (select tool) ---- */}
          {activeTool === "select" && marquee && (
            <div
              className="ed-marquee"
              style={{
                left: Math.min(marquee.x1, marquee.x2),
                top: Math.min(marquee.y1, marquee.y2),
                width: Math.abs(marquee.x2 - marquee.x1),
                height: Math.abs(marquee.y2 - marquee.y1),
              }}
            />
          )}

          {/* ---- Selection bar (bulk actions) ---- */}
          {selectedIds.length > 0 && (
            <div className="ed-selection-bar">
              <span className="ed-selection-count">
                {selectedIds.length} fitur terpilih
              </span>
              <button
                className="ed-selection-btn ed-selection-btn-del"
                onClick={handleBulkDelete}
                disabled={saving}
              >
                Hapus
              </button>
              <button
                className="ed-selection-btn"
                onClick={() => setSelectedIds([])}
              >
                Batal
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
            {datasetId !== "ruas_jalan" && (
              <div className="ed-legend-item">
                <span
                  className="ed-legend-swatch-line"
                  style={{
                    background: distinctRuas
                      ? "linear-gradient(90deg,#ef4444,#eab308,#22c55e,#3b82f6)"
                      : "#94a3b8",
                  }}
                />
                <span className="ed-legend-label">Ruas jalan (referensi)</span>
                <button
                  type="button"
                  className={`ed-legend-toggle${distinctRuas ? " on" : ""}`}
                  onClick={handleToggleRuasColors}
                  title="Warna berbeda untuk tiap ruas — memudahkan melihat batas antar ruas"
                >
                  {distinctRuas ? "Warna unik" : "Seragam"}
                </button>
              </div>
            )}
          </div>

          {/* ---- Basemap picker ---- */}
          <div className="ed-basemap" role="group" aria-label="Pilih basemap">
            {BASEMAPS.map((b) => (
              <button
                key={b.id}
                type="button"
                className={`ed-basemap-opt${basemapId === b.id ? " on" : ""}`}
                onClick={() => setBasemapId(b.id)}
                title={`Basemap ${b.label}`}
              >
                {b.label}
              </button>
            ))}
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
                  {isPoint ? "Tambah titik" : "Tambah garis"}
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

          {/* ---- Floating form panel (right of toolbox) ---- */}
          {formOpen && (
            <AttributeForm
              meta={meta}
              feature={formMode === "update" ? selectedFeature : null}
              mode={formMode}
              canEdit={isSuperAdmin || (isEditor && (editWindow?.open ?? false))}
              canDelete={isSuperAdmin || isEditor}
              onSave={handleSave}
              onDelete={handleDelete}
              prefill={nearestPrefill}
              hint={nearestHint}
              onClose={() => {
                setFormOpen(false);
                setSelectedFeature(null);
                setPendingGeometry(null);
                setFormMode("create");
                setNearestPrefill(null);
                setNearestHint(null);
                tdRef.current?.clear();
                closePopup();
              }}
              saving={saving}
            />
          )}
        </div>
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
