import { useParams } from "react-router-dom";
import { Fragment, useEffect, useMemo, useRef, useState, useCallback, type ReactNode } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { TerraDraw, TerraDrawPointMode, TerraDrawLineStringMode } from "terra-draw";
import { TerraDrawMapLibreGLAdapter } from "terra-draw-maplibre-gl-adapter";
import { supabase } from "../lib/supabase";
import { getDataset } from "../lib/datasets";
import { ED_BASEMAP_EVENT, basemapForTheme, basemapStyleSpec, getBasemap } from "../lib/basemaps";
import { resetEditorChrome, setEditorChrome } from "../lib/editorChrome";
import { fetchOsmGeometry, onSearchSelection, setSharedRoads } from "../lib/editorSearch";
import {
  buildRoadSnapIndex,
  makeRoadSnap,
  type RoadSnapIndex,
} from "../lib/roadSnap";
import { ROAD_UPTD, ROAD_UPTD_FALLBACK, UPTD_COLORS, type RoadItem } from "../lib/roadUptd";
import LayersPanel from "../components/editor/LayersPanel";
import {
  JENIS_ICON_IDS,
  KELAS_ICON_IDS,
  MST_ICON_IDS,
  ensurePointIcons,
  jenisLabel,
} from "../lib/pointIcons";
import { ED_THEME_EVENT, getCurrentTheme, type ThemeMode } from "../lib/theme";
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

/* Basemap catalog lives in lib/basemaps.ts — picked from the topbar
   dropdown and applied here via the ed-basemap window event. */

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
): { props: Record<string, unknown>; meters: number } | null {
  let best: { d2: number; props: Record<string, unknown> } | null = null;
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type !== "LineString" && g.type !== "MultiLineString") continue;
    const parts =
      g.type === "LineString" ? [g.coordinates] : g.coordinates;
    for (const raw of parts) {
      const coords = raw as [number, number][];
      if (!coords.length) continue;
      const d2 = distSqToCoords(
        [point.coordinates[0], point.coordinates[1]],
        coords
      );
      if (!best || d2 < best.d2) {
        best = { d2, props: (f.properties ?? {}) as Record<string, unknown> };
      }
    }
  }
  if (!best) return null;
  // d2 mixes cos-scaled lng² and raw lat² (degrees); the averaged
  // degree→meter factor lands within ~1% across Jabar's latitudes.
  const latRad = (point.coordinates[1] * Math.PI) / 180;
  const degToM = (111320 * Math.cos(latRad) + 111320) / 2;
  return { props: best.props, meters: Math.sqrt(best.d2) * degToM };
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
/* ------------------------------------------------------------------ */function addPointDraftLayers(
  map: maplibregl.Map,
  color: string,
  withJenisIcons: boolean
) {
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
  if (withJenisIcons) {
    ensurePointIcons(map);
    // The circle becomes an invisible hit target (keeps the click/hover
    // handlers and the generous tap area) while the icon layer carries the
    // visual, so the dataset's jenis is readable at a glance.
    map.addLayer({
      id: "draft-points",
      type: "circle",
      source: "draft",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": [
          "interpolate",
          ["linear"],
          ["zoom"],
          6, 6,
          10, 8,
          13, 10,
          16, 9,
          19, 7,
          22, 6,
        ],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-width": 0,
      },
    });
    map.addLayer({
      id: "draft-point-icons",
      type: "symbol",
      source: "draft",
      filter: ["!", ["has", "point_count"]],
      layout: {
        // Kelas-jalan signs follow kelas_jalan (white disc, red ring, Roman
        // numeral); every other jenis uses its own shape.
        "icon-image": [
          "case",
          ["==", ["get", "jenis"], "rambu_kelas_jalan"],
          [
            "match", ["get", "kelas_jalan"],
            "I", KELAS_ICON_IDS["I"],
            "II", KELAS_ICON_IDS["II"],
            "III", KELAS_ICON_IDS["III"],
            KELAS_ICON_IDS["I"],
          ],
          [
            "case",
            ["==", ["get", "jenis"], "rambu_mst"],
            [
              "match", ["get", "kelas_jalan"],
              "I", MST_ICON_IDS["10"],
              MST_ICON_IDS["8"],
            ],
            [
              "match", ["get", "jenis"],
              "rambu_pembatasan", JENIS_ICON_IDS["rambu_pembatasan"],
              "tambang", JENIS_ICON_IDS["tambang"],
              "posko", JENIS_ICON_IDS["posko"],
              JENIS_ICON_IDS["rambu_kelas_jalan"],
            ],
          ],
        ],
        "icon-size": [
          "interpolate", ["linear"], ["zoom"],
          7, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.3, ["==", ["get", "jenis"], "tambang"], 0.44, 0.34],
          10, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.33, ["==", ["get", "jenis"], "tambang"], 0.66, 0.5],
          13, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.345, ["==", ["get", "jenis"], "tambang"], 0.82, 0.62],
          16, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.38, ["==", ["get", "jenis"], "tambang"], 0.96, 0.72],
        ],
        "icon-allow-overlap": true,
        "icon-ignore-placement": true,
        "icon-anchor": "center",
      },
    });
    return;
  }
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

/** Roads hidden by the user persist across reloads; the reference network is
 *  shared by every dataset, so a single key covers all of them. */
const HIDDEN_ROADS_KEY = "ed_hidden_roads";

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
  // Jenis chosen from the "Tambah titik" menu for the point being drawn; the
  // draw-finish handler reads it to keep the create form and the on-map preview
  // in sync with the picked jenis.
  const drawJenisRef = useRef<string | null>(null);
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
  /** What the select tool acts on. "feature" = the dataset's own rows,
   *  "road" = the published ruas_jalan reference network. */
  const [selectMode, setSelectMode] = useState<"feature" | "road">("feature");
  /** Road selection, keyed on id_ruas_jalan so it lines up with the
   *  hiddenRoads list and the layer panel's road rows. */
  const [selectedRoadIds, setSelectedRoadIds] = useState<string[]>([]);
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
  /** Set when the feature fetch fails. Without it a failed load looks exactly
   *  like an empty dataset ("Belum ada data"), which hides the real problem. */
  const [loadError, setLoadError] = useState<string | null>(null);
  // Cluster mode OFF by default — users prefer seeing every point; the
  // toolbox button lets super_admin/editor turn native clustering on.
  const [clusterMode, setClusterMode] = useState(false);
  const clusterModeRef = useRef(false);

  /* ---- per-ruas reference coloring + nearest-ruas autofill ---- */
  const roadsBgRef = useRef<FeatureCollection | null>(null);
  /** Grid index over roadsBgRef for magnet snapping while drawing lines. */
  const roadSnapRef = useRef<RoadSnapIndex | null>(null);
  const rambuLookupRef = useRef<Map<string, { kelas_jalan: string; fungsi: string }>>(
    new Map()
  );
  const [roadInfo, setRoadInfo] = useState<Feature | null>(null);
  const [activeRoadUPTD, setActiveRoadUPTD] = useState<string[]>(() => [...ROAD_UPTD]);
  const roadUPTDRef = useRef<string[]>([...ROAD_UPTD]);
  const [hiddenRoads, setHiddenRoads] = useState<string[]>(() => {
    try {
      const parsed: unknown = JSON.parse(
        localStorage.getItem(HIDDEN_ROADS_KEY) ?? "[]"
      );
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  });
  const hiddenRoadsRef = useRef<string[]>([]);
  const selectedRoadIdsRef = useRef<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);
  const selectModeRef = useRef<"feature" | "road">("feature");
  const [roadList, setRoadList] = useState<RoadItem[]>([]);
  const searchMarkerRef = useRef<maplibregl.Marker | null>(null);
  const searchGeomAbortRef = useRef<AbortController | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [featuresVisible, setFeaturesVisible] = useState(true);
  const [roadsVisible, setRoadsVisible] = useState(true);
  const featuresVisibleRef = useRef(true);
  const roadsVisibleRef = useRef(true);
  /** Magnet snapping of drawn lines onto the reference road network. */
  const [snapToRoads, setSnapToRoads] = useState(
    () => localStorage.getItem("ed_snap_roads") !== "false"
  );
  const [nearestPrefill, setNearestPrefill] = useState<GeoProps | null>(null);
  const [nearestHint, setNearestHint] = useState<string | null>(null);

  const DRAFT_LAYERS = [
    "draft-points",
    "draft-point-icons",
    "draft-pending-icons",
    "draft-lines",
    "draft-clusters",
    "draft-cluster-labels",
    "draft-selected-points",
    "draft-selected-lines",
  ];
  const ROAD_LAYERS = ["roads-bg-casing", "roads-bg-line", "roads-bg-hit"];

  const applyLayers = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    const vis = (id: string, on: boolean) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", on ? "visible" : "none");
    };
    DRAFT_LAYERS.forEach((id) => vis(id, featuresVisibleRef.current));
    ROAD_LAYERS.forEach((id) => vis(id, roadsVisibleRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roadSnapToCustom = useMemo(() => makeRoadSnap(roadSnapRef), []);
  /** Snapping handed to TerraDraw; an empty object turns every magnet off. */
  const lineSnapping = useMemo(
    () =>
      snapToRoads
        ? { toLine: true, toCoordinate: true, toCustom: roadSnapToCustom }
        : {},
    [snapToRoads, roadSnapToCustom]
  );

  useEffect(() => {
    featuresVisibleRef.current = featuresVisible;
    roadsVisibleRef.current = roadsVisible;
    applyLayers();
  }, [featuresVisible, roadsVisible, applyLayers]);

  useEffect(() => {
    if (!statusOpen) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!t.closest(".ed-topright") && !t.closest(".ed-addmenu")) {
        setStatusOpen(false);
        setAddMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setLayersOpen(false);
        setStatusOpen(false);
      }
    };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [statusOpen]);

  /* ---- basemap: stored pick, else the theme's default ---- */
  const basemapIdRef = useRef(
    getBasemap(localStorage.getItem("ed_basemap") ?? basemapForTheme(getCurrentTheme()).id).id
  );

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
  const handleStartDraw = useCallback(
    (target: "point" | "line", prefill: GeoProps | null = null, hint: string | null = null) => {
    drawTargetRef.current = target;
    setDrawTarget(target);
    // Exit any active edit session (form + vertex handles) so drawing starts
    // clean. Otherwise the stale edit form / dense vertex handles stay on top
    // of the map and block drawing the new feature.
    setFormOpen(false);
    setSelectedFeature(null);
    setPendingGeometry(null);
    setFormMode("create");
    setNearestPrefill(prefill);
    setNearestHint(hint);
    setSelectedIds([]);
    if (tdRef.current) {
      tdRef.current.clear();
      tdRef.current.setMode(target === "point" ? "point" : "linestring");
    }
    setActiveTool("draw");
    },
    []
  );

  const startJenisDraw = useCallback(
    (jenis: string) => {
      setAddMenuOpen(false);
      drawJenisRef.current = jenis;
      handleStartDraw("point", { jenis }, `Jenis titik: ${jenisLabel(jenis)}`);
    },
    [handleStartDraw]
  );

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
    setLoadError(null);
    const { data, error } = await supabase.rpc("draft_features_geojson", {
      p_dataset: datasetId,
      p_light: true,
    });
    if (error) {
      console.error("fetch features:", error.message);
      setLoadError(error.message);
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

  /* Road reference layer: fixed UPTD palette (same as the public map) plus a
   per-UPTD filter so each unit can be toggled on/off. */
  const applyRoadStyle = useCallback(() => {
    const map = mapRef.current;
    if (!map || !map.getLayer("roads-bg-line")) return;
    map.setPaintProperty("roads-bg-line", "line-color", [
      "match",
      ["get", "unit_kerja_kode"],
      "UPTD-I", UPTD_COLORS["UPTD-I"],
      "UPTD-II", UPTD_COLORS["UPTD-II"],
      "UPTD-III", UPTD_COLORS["UPTD-III"],
      "UPTD-IV", UPTD_COLORS["UPTD-IV"],
      ROAD_UPTD_FALLBACK,
    ]);
    const sel = roadUPTDRef.current;
    const clauses: maplibregl.FilterSpecification[] = [];
    if (sel.length < ROAD_UPTD.length) {
      clauses.push(["in", ["get", "unit_kerja_kode"], ["literal", sel]] as maplibregl.FilterSpecification);
    }
    const hidden = hiddenRoadsRef.current;
    if (hidden.length) {
      clauses.push(["!", ["in", ["get", "id_ruas_jalan"], ["literal", hidden]]] as maplibregl.FilterSpecification);
    }
    const filter: maplibregl.FilterSpecification | null =
      clauses.length === 0 ? null : clauses.length === 1 ? clauses[0] : (["all", ...clauses] as maplibregl.FilterSpecification);
    ROAD_LAYERS.forEach((id) => {
      if (map.getLayer(id)) map.setFilter(id, filter);
    });
  }, []);

  useEffect(() => {
    applyRuasColorsRef.current = applyRoadStyle;
  }, [applyRoadStyle]);

  const toggleRoadUPTD = useCallback(
    (code: string) => {
      setActiveRoadUPTD((prev) => {
        const next = prev.includes(code)
          ? prev.filter((c) => c !== code)
          : [...prev, code];
        roadUPTDRef.current = next;
        return next;
      });
    },
    []
  );

  useEffect(() => {
    roadUPTDRef.current = activeRoadUPTD;
    applyRoadStyle();
    applyLayers();
  }, [activeRoadUPTD, applyRoadStyle, applyLayers]);

  const toggleRoadVisibility = useCallback((ruasId: string) => {
    setHiddenRoads((prev) =>
      prev.includes(ruasId) ? prev.filter((id) => id !== ruasId) : [...prev, ruasId]
    );
  }, []);

  const setManyRoadsVisible = useCallback((ids: string[], visible: boolean) => {
    setHiddenRoads((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (visible) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  }, []);

  const showAllRoads = useCallback(() => setHiddenRoads([]), []);

  useEffect(() => {
    hiddenRoadsRef.current = hiddenRoads;
    applyRoadStyle();
    try {
      localStorage.setItem(HIDDEN_ROADS_KEY, JSON.stringify(hiddenRoads));
    } catch {
      // Storage blocked or full: the in-memory list still applies this session.
    }
  }, [hiddenRoads, applyRoadStyle]);

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
    if (!window.confirm(`Publish dataset ${meta?.label} ke peta publik?`)) return;
    setPublishBusy(true);
    try {
      // Publishing must go through the export-parquet function: it runs the
      // publish RPC AND dispatches the GitHub workflow that rebuilds the portal
      // parquet + redeploys the public map. Calling the RPC alone left the
      // public map stale.
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sesi tidak ditemukan, silakan login ulang.");

      const { data, error } = await supabase.functions.invoke("export-parquet", {
        body: { datasets: [datasetId] },
        headers: { Authorization: `Bearer ${token}` },
      });
      if (error) throw error;

      const res = (data ?? {}) as {
        published?: Record<string, { published?: number } | { error?: string } | null>;
        dispatchError?: string;
      };
      if (res.dispatchError) {
        throw new Error("Data ter-publish, tapi pipeline gagal dipicu: " + res.dispatchError);
      }
      const entry = res.published?.[datasetId] as { published?: number } | undefined;
      const count = entry?.published;
      showToast(
        count != null
          ? `Publish selesai (${count} fitur). Peta publik diperbarui otomatis.`
          : "Publish selesai. Peta publik diperbarui otomatis.",
        true
      );
    } catch (err) {
      showToast(
        "Gagal publish: " + (err instanceof Error ? err.message : String(err)),
        false
      );
    } finally {
      setPublishBusy(false);
    }
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
      for (const lid of ["draft-clusters", "draft-cluster-labels", "draft-points", "draft-point-icons"]) {
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
      addPointDraftLayers(
        map,
        meta?.defaultColor ?? "#2563eb",
        !!meta?.formFields.some((f) => f.key === "jenis")
      );
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

  /** Road identity shared by the selection, the layer panel and hiddenRoads. */
  const roadIdOf = useCallback((feat: Feature) => {
    const p = (feat.properties ?? {}) as Record<string, unknown>;
    return String(p.id_ruas_jalan ?? p._source_id ?? "");
  }, []);

  /** Paint the yellow highlight from the selected road ids. The info card state
   *  and the roads-selected source must always move together, or the highlight
   *  outlives the card. */
  const applyRoadSelection = useCallback(
    (ids: string[]) => {
      selectedRoadIdsRef.current = ids;
      setSelectedRoadIds(ids);
      const src = mapRef.current?.getSource("roads-selected") as
        | maplibregl.GeoJSONSource
        | undefined;
      const set = new Set(ids);
      src?.setData({
        type: "FeatureCollection",
        features: (roadsBgRef.current?.features ?? []).filter((f) =>
          set.has(roadIdOf(f))
        ),
      });
    },
    [roadIdOf]
  );

  const clearRoadSelection = useCallback(() => {
    setRoadInfo(null);
    applyRoadSelection([]);
  }, [applyRoadSelection]);

  /* ---- map init ---- */
  useEffect(() => {
    if (!mapContainerRef.current || !meta) return;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: basemapStyleSpec(getBasemap(basemapIdRef.current)),
      center: [107.6, -6.9],
      zoom: 9,
    });

    mapRef.current = map;
    const iconPoints = meta.formFields.some((f) => f.key === "jenis");

    popupRef.current = new maplibregl.Popup({
      closeButton: true,
      closeOnClick: false,
      maxWidth: "320px",
    });

    map.addControl(
      new maplibregl.ScaleControl({ maxWidth: 130, unit: "metric" }),
      "bottom-left"
    );

    // The sidebar collapses with a width transition; MapLibre only tracks
    // window resize, so observe the container. Debounce so the canvas resizes
    // once the transition settles instead of every frame (which flickers).
    let resizeTimer = 0;
    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => map.resize(), 150);
    });
    resizeObserver.observe(mapContainerRef.current);

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
              6, 3,
              10, 4.2,
              14, 6,
              18, 8,
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
            "line-color": ROAD_UPTD_FALLBACK,
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 1.6,
              10, 2.4,
              14, 3.6,
              18, 5.2,
            ],
            "line-opacity": 0.9,
          },
        });
        // Invisible wide hit layer: makes thin reference roads easy to click.
        map.addLayer({
          id: "roads-bg-hit",
          type: "line",
          source: "roads-bg",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "rgba(0,0,0,0)",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 8,
              10, 10,
              14, 12,
              18, 14,
            ],
          },
        });
        map.addSource("roads-selected", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "roads-selected-casing",
          type: "line",
          source: "roads-selected",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#ffffff",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 5,
              10, 6.5,
              14, 8,
              18, 10,
            ],
            "line-opacity": 0.9,
          },
        });
        map.addLayer({
          id: "roads-selected-line",
          type: "line",
          source: "roads-selected",
          layout: { "line-join": "round", "line-cap": "round" },
          paint: {
            "line-color": "#facc15",
            "line-width": [
              "interpolate",
              ["linear"],
              ["zoom"],
              6, 3.5,
              10, 4.5,
              14, 6,
              18, 8,
            ],
            "line-opacity": 1,
          },
        });
        const cachedRoads = roadsBgRef.current;
        if (cachedRoads) {
          // A style switch (basemap or theme) wipes this source. Re-apply the
          // network we already hold instead of re-fetching it: that request is
          // ~9 MB / ~2 s, so the map would sit road-less meanwhile and stay
          // that way if the request failed.
          const src = map.getSource("roads-bg");
          if (src && "setData" in src) {
            (src as maplibregl.GeoJSONSource).setData(cachedRoads);
          }
          if (!roadSnapRef.current) {
            roadSnapRef.current = buildRoadSnapIndex(cachedRoads);
          }
          applyRuasColorsRef.current();
        } else {
          void supabase
            .rpc("published_features_geojson", { p_dataset: "ruas_jalan" })
            .then(({ data }) => {
              if (!data) return;
              roadsBgRef.current = data as FeatureCollection;
              roadSnapRef.current = buildRoadSnapIndex(data as FeatureCollection);
              setSharedRoads(data as FeatureCollection);
              const fc = data as FeatureCollection;
              setRoadList(
                fc.features
                  .map((f) => {
                    const p = (f.properties ?? {}) as Record<string, unknown>;
                    return {
                      id: String(p.id_ruas_jalan ?? p._source_id ?? ""),
                      nama: String(p.nama ?? "") || String(p.kode_number ?? ""),
                      kode: String(p.kode_number ?? ""),
                      uptd: String(p.unit_kerja_kode ?? ""),
                    };
                  })
                  .filter((r) => r.id)
                  .sort((a, b) => a.nama.localeCompare(b.nama, "id"))
              );
              const src = map.getSource("roads-bg");
              if (src && "setData" in src) {
                (src as maplibregl.GeoJSONSource).setData(
                  data as FeatureCollection
                );
              }
              applyRuasColorsRef.current();
            });
        }
        if (datasetId === "rambu") {
          supabase
            .from("rambu_draft")
            .select("properties")
            .then(({ data: rows }) => {
              const lookup = new Map<string, { kelas_jalan: string; fungsi: string }>();
              for (const row of rows ?? []) {
                const p = (row as { properties?: Record<string, unknown> }).properties ?? {};
                const kode = String(p.kode_ruas ?? "");
                if (!kode || lookup.has(kode)) continue;
                lookup.set(kode, {
                  kelas_jalan: String(p.kelas_jalan ?? ""),
                  fungsi: String(p.fungsi ?? ""),
                });
              }
              rambuLookupRef.current = lookup;
            });
        }
      }

      map.addSource("draft", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: isPoint && clusterModeRef.current,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      if (isPoint) {
        addPointDraftLayers(
          map,
          meta.defaultColor,
          meta.formFields.some((f) => f.key === "jenis")
        );
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
            "circle-radius": iconPoints ? 16 : 14,
            "circle-color": iconPoints ? "rgba(0,0,0,0)" : "rgba(245, 158, 11, 0.35)",
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

      if (isPoint && iconPoints) {
        map.addSource("draft-pending", {
          type: "geojson",
          data: { type: "FeatureCollection", features: [] },
        });
        map.addLayer({
          id: "draft-pending-icons",
          type: "symbol",
          source: "draft-pending",
          layout: {
            "icon-image": [
              "case",
              ["==", ["get", "jenis"], "rambu_kelas_jalan"],
              [
                "match", ["get", "kelas_jalan"],
                "I", KELAS_ICON_IDS["I"],
                "II", KELAS_ICON_IDS["II"],
                "III", KELAS_ICON_IDS["III"],
                KELAS_ICON_IDS["I"],
              ],
              [
                "case",
                ["==", ["get", "jenis"], "rambu_mst"],
                [
                  "match", ["get", "kelas_jalan"],
                  "I", MST_ICON_IDS["10"],
                  MST_ICON_IDS["8"],
                ],
                [
                  "match", ["get", "jenis"],
                  "rambu_pembatasan", JENIS_ICON_IDS["rambu_pembatasan"],
                  "tambang", JENIS_ICON_IDS["tambang"],
                  "posko", JENIS_ICON_IDS["posko"],
                  JENIS_ICON_IDS["rambu_kelas_jalan"],
                ],
              ],
            ],
            "icon-size": [
              "interpolate", ["linear"], ["zoom"],
              7, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.3, ["==", ["get", "jenis"], "tambang"], 0.44, 0.34],
              10, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.33, ["==", ["get", "jenis"], "tambang"], 0.66, 0.5],
              13, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.345, ["==", ["get", "jenis"], "tambang"], 0.82, 0.62],
              16, ["case", ["==", ["get", "jenis"], "rambu_kelas_jalan"], 0.38, ["==", ["get", "jenis"], "tambang"], 0.96, 0.72],
            ],
            "icon-allow-overlap": true,
            "icon-ignore-placement": true,
            "icon-anchor": "center",
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
            if (selectModeRef.current !== "feature") return;
            map.getCanvas().style.cursor = "pointer";
          });
          map.on("mouseleave", lid, () => {
            if (activeToolRef.current === "pan") map.getCanvas().style.cursor = "grab";
            else if (activeToolRef.current === "draw") map.getCanvas().style.cursor = "crosshair";
            else map.getCanvas().style.cursor = "default";
          });
        }
      }

      for (const lid of layerIds) {
        map.on("mouseenter", lid, () => {
          if (activeToolRef.current !== "select") return;
          if (selectModeRef.current !== "feature") return;
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", lid, () => {
          if (activeToolRef.current === "pan") map.getCanvas().style.cursor = "grab";
          else if (activeToolRef.current === "draw") map.getCanvas().style.cursor = "crosshair";
          else map.getCanvas().style.cursor = "default";
        });
      }

      map.on("dblclick", (e: maplibregl.MapMouseEvent) => {
        if (activeToolRef.current === "draw") e.preventDefault();
      });

      map.on("click", (e: maplibregl.MapMouseEvent) => {
        if (activeToolRef.current !== "select") return;
        const additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;

        if (selectModeRef.current === "road") {
          // Road mode: only the reference network responds to clicks.
          if (datasetId !== "ruas_jalan") {
            const roadFeats = map.queryRenderedFeatures(e.point, {
              layers: ["roads-bg-line", "roads-bg-hit"],
            });
            if (roadFeats.length) {
              const roadFeat = roadFeats[0] as unknown as Feature;
              // Use the pristine feature from the original RPC data rather
              // than the click-event object: queryRenderedFeatures features
              // carry MapLibre internals that GeoJSONSource.setData silently
              // rejects (source serializes with data but renders nothing).
              const srcId = (roadFeat.properties as GeoProps | null)?._source_id;
              const clean =
                roadsBgRef.current?.features.find(
                  (f) =>
                    (f.properties as GeoProps | null)?._source_id === srcId
                ) ??
                roadsBgRef.current?.features.find(
                  (f) =>
                    (f.properties as GeoProps | null)?.kode_number ===
                    (roadFeat.properties as GeoProps | null)?.kode_number
                );
              const cleanFeature =
                clean ?? (JSON.parse(JSON.stringify(roadFeat)) as Feature);
              const id = roadIdOf(cleanFeature);
              if (additive) {
                // Ctrl/Cmd+click adds to (or removes from) the road selection;
                // the single-road card gives way to the bulk bar.
                const prev = selectedRoadIdsRef.current;
                setRoadInfo(null);
                applyRoadSelection(
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                );
              } else {
                setRoadInfo(cleanFeature);
                applyRoadSelection([id]);
              }
              closePopup();
              return;
            }
          }
          clearRoadSelection();
          closePopup();
          return;
        }

        // Feature mode: the dataset's own rows own the clicks.
        const clickedOnFeature = map.queryRenderedFeatures(e.point, {
          layers: layerIds,
        });
        if (clickedOnFeature.length > 0) return;

        setSelectedIds([]);
        clearRoadSelection();
        closePopup();

        // Empty-map click always ends the edit session; this handler is
        // registered once at mount so it reads the live selection via ref.
        if (selectedFeatureRef.current) {
          setFormOpen(false);
          setSelectedFeature(null);
          setFormMode("create");
        }
      });

      if (datasetId !== "ruas_jalan") {
        map.on("mouseenter", "roads-bg-hit", () => {
          if (activeToolRef.current !== "select") return;
          if (selectModeRef.current !== "road") return;
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", "roads-bg-hit", () => {
          if (activeToolRef.current === "pan") map.getCanvas().style.cursor = "grab";
          else if (activeToolRef.current === "draw") map.getCanvas().style.cursor = "crosshair";
          else map.getCanvas().style.cursor = "default";
        });
      }

      initTerraDraw();

      if (featuresRef.current) {
        applyFeaturesToSource(featuresRef.current);
      }

      applyLayers();
    };

    if (map.isStyleLoaded()) onLoad();
    // Persistent: setStyle (basemap switch) wipes sources/layers, so overlays
    // and terra-draw must be rebuilt every time a style finishes loading.
    map.on("style.load", onLoad);
    // Fallback: if the style never fully "loads" (e.g. slow glyph/tile server),
    // still init once the base style is present.
    const t = setTimeout(onLoad, 8000);
    map.once("remove", () => clearTimeout(t));

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

      const modes = [
        // Icon datasets render the drawn point through draft-pending-icons, so
        // TerraDraw's own dot is switched off to avoid a plain dot sitting on
        // top of the icon while the create form is open.
        new TerraDrawPointMode(
          iconPoints
            ? {
                styles: {
                  pointColor: "#000000",
                  pointWidth: 0,
                  pointOutlineColor: "#000000",
                  pointOutlineWidth: 0,
                },
              }
            : {}
        ),
        new TerraDrawLineStringMode({
          snapping: lineSnapping,
          styles: { snappingPointColor: "#f59e0b", snappingPointWidth: 9 },
        }),
      ];

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
          const drawn =
            snap.find((f) => f.id === _id) ??
            snap.find(
              (f) =>
                f.properties?.mode ===
                  (drawTargetRef.current === "point" ? "point" : "linestring") &&
                !f.properties?.currentlyDrawing
            );
          if (drawn) {
            const geom = drawn.geometry as Point | LineString;

            // Rambu: copy road metadata (kode_number, nama, status, panjang_km)
            // plus the road's kelas_jalan/fungsi (from the rambu lookup built
            // from existing rambu rows, which carry them per kode_ruas).
            if (
              datasetId === "rambu" &&
              geom.type === "Point" &&
              roadsBgRef.current?.features.length
            ) {
              const nr = nearestRuas(geom as Point, roadsBgRef.current);
              if (nr) {
                const rp = nr.props;
                const kode = String(rp.kode_number ?? "");
                const nama = String(rp.nama ?? "");
                const cls = rambuLookupRef.current.get(kode);
                setNearestPrefill({
                  kode_ruas: kode,
                  nama_ruas: nama,
                  status: String(rp.status ?? ""),
                  panjang_km: rp.panjang_km != null ? Number(rp.panjang_km) : "",
                  kelas_jalan: cls?.kelas_jalan ?? "",
                  fungsi: cls?.fungsi ?? "",
                });
                const parts = [`${kode} — ${nama} (${Math.round(nr.meters)} m)`];
                if (kode || nama) {
                  setNearestHint(
                    `Terisi otomatis dari ruas terdekat: ${parts.join(", ")}`
                  );
                } else {
                  setNearestHint(null);
                }
              } else {
                setNearestPrefill(null);
                setNearestHint(null);
              }
            } else if (drawJenisRef.current) {
              setNearestPrefill({ jenis: drawJenisRef.current });
              setNearestHint(`Jenis titik: ${jenisLabel(drawJenisRef.current)}`);
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
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ---- Preview the point being added with its jenis icon (TerraDraw's own
     dot is hidden for icon datasets) until the create form is saved. ---- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const src = map.getSource("draft-pending");
    if (!src || !("setData" in src)) return;
    const jenis = drawJenisRef.current;
    const features =
      pendingGeometry && pendingGeometry.type === "Point" && jenis
        ? [
            {
              type: "Feature" as const,
              properties: { jenis, kelas_jalan: "" },
              geometry: pendingGeometry,
            },
          ]
        : [];
    (src as maplibregl.GeoJSONSource).setData({
      type: "FeatureCollection",
      features,
    });
  }, [pendingGeometry]);

  /* ---- basemap + theme: switch the map style (overlays rebuild on style.load) ---- */
  useEffect(() => {
    const applyBasemap = (bm: ReturnType<typeof getBasemap>) => {
      const map = mapRef.current;
      if (!map) return;
      basemapIdRef.current = bm.id;
      localStorage.setItem("ed_basemap", bm.id);
      map.setStyle(basemapStyleSpec(bm));
    };
    const onPick = (e: Event) => {
      applyBasemap(getBasemap((e as CustomEvent<string>).detail));
    };
    const onTheme = (e: Event) => {
      const theme = (e as CustomEvent<ThemeMode>).detail;
      const current = getBasemap(basemapIdRef.current);
      // Leave manual satellite/OSM/topo picks alone; only theme-paired styles follow.
      if (!current.theme) return;
      const next = basemapForTheme(theme);
      if (next.id === current.id) return;
      window.dispatchEvent(new CustomEvent(ED_BASEMAP_EVENT, { detail: next.id }));
    };
    window.addEventListener(ED_BASEMAP_EVENT, onPick);
    window.addEventListener(ED_THEME_EVENT, onTheme);
    return () => {
      window.removeEventListener(ED_BASEMAP_EVENT, onPick);
      window.removeEventListener(ED_THEME_EVENT, onTheme);
    };
  }, []);

  useEffect(() => {
    const clearSearchMarker = () => {
      searchMarkerRef.current?.remove();
      searchMarkerRef.current = null;
    };

    const clearSearchGeometry = () => {
      const map = mapRef.current;
      if (!map) return;
      for (const id of ["search-hl-fill", "search-hl-line", "search-hl-glow"]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      if (map.getSource("search-hl")) map.removeSource("search-hl");
    };

    const off = onSearchSelection((sel) => {
      const map = mapRef.current;
      if (!map) return;
      clearSearchMarker();
      clearSearchGeometry();
      searchGeomAbortRef.current?.abort();

      if (sel.kind === "coord") {
        const el = document.createElement("div");
        el.className = "ed-search-marker";
        searchMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([sel.lng, sel.lat])
          .addTo(map);
        map.flyTo({ center: [sel.lng, sel.lat], zoom: Math.max(map.getZoom(), 15), duration: 700, essential: true });
        return;
      }

      if (sel.kind === "road") {
        const fc = roadsBgRef.current;
        const feature = fc?.features.find((f) => {
          const p = (f.properties ?? {}) as Record<string, unknown>;
          return (
            (sel.ruasId && String(p.id_ruas_jalan ?? "") === sel.ruasId) ||
            (sel.kode && String(p.kode_number ?? "") === sel.kode)
          );
        });
        if (!feature) return;
        const src = map.getSource("roads-selected") as maplibregl.GeoJSONSource | undefined;
        src?.setData({ type: "FeatureCollection", features: [feature] });
        // Keep the card in step with the highlight, so a search pick behaves
        // exactly like clicking the road on the map.
        setRoadInfo(feature);
        const bounds = computeBBox({ type: "FeatureCollection", features: [feature] });
        if (bounds) {
          map.fitBounds(
            [[bounds[0], bounds[1]], [bounds[2], bounds[3]]],
            { padding: 80, maxZoom: 15, duration: 800 }
          );
        }
        return;
      }

      const controller = new AbortController();
      searchGeomAbortRef.current = controller;
      if (sel.bbox) {
        map.fitBounds(
          [[sel.bbox[0], sel.bbox[1]], [sel.bbox[2], sel.bbox[3]]],
          { padding: 60, maxZoom: 15, duration: 800 }
        );
      } else {
        map.flyTo({ center: [sel.lng, sel.lat], zoom: 14, duration: 800, essential: true });
      }
      const el = document.createElement("div");
      el.className = "ed-search-marker is-place";
      searchMarkerRef.current = new maplibregl.Marker({ element: el })
        .setLngLat([sel.lng, sel.lat])
        .addTo(map);

      if (sel.osmType && sel.osmId != null) {
        void fetchOsmGeometry(sel.osmType, sel.osmId, controller.signal)
          .then((geometry) => {
            if (controller.signal.aborted || !geometry) return;
            const current = mapRef.current;
            if (!current) return;
            current.addSource("search-hl", { type: "geojson", data: geometry });
            const type = (geometry.features[0]?.geometry as { type?: string } | undefined)?.type ?? "";
            if (type === "Polygon" || type === "MultiPolygon") {
              current.addLayer({
                id: "search-hl-fill", type: "fill", source: "search-hl",
                paint: { "fill-color": "#2563EB", "fill-opacity": 0.12, "fill-outline-color": "#2563EB" },
              });
              current.addLayer({
                id: "search-hl-line", type: "line", source: "search-hl",
                paint: { "line-color": "#2563EB", "line-width": 2, "line-opacity": 0.9 },
              });
            } else {
              current.addLayer({
                id: "search-hl-glow", type: "line", source: "search-hl",
                paint: { "line-color": "#2563EB", "line-width": 8, "line-opacity": 0.25 },
              });
              current.addLayer({
                id: "search-hl-line", type: "line", source: "search-hl",
                paint: { "line-color": "#2563EB", "line-width": 3, "line-opacity": 0.9 },
              });
            }
          })
          .catch(() => undefined);
      }
    });

    return () => {
      off();
      searchGeomAbortRef.current?.abort();
      clearSearchMarker();
      clearSearchGeometry();
    };
  }, []);

  /* ---- keep activeTool ref in sync for event handlers ---- */
  useEffect(() => {
    activeToolRef.current = activeTool;
  }, [activeTool]);

  /* ---- keep selectMode ref in sync for the mount-time map handlers ---- */
  useEffect(() => {
    selectModeRef.current = selectMode;
  }, [selectMode]);

  /* ---- keep the feature selection ref in sync for the mouse handlers ---- */
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

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
      else canvas.style.cursor = "default";
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
      // Re-arm drawing whenever the create form is closed; while it is open the
      // mode stays static so a stray map click can't overwrite pendingGeometry.
      if (activeTool === "draw" && canDraw && !formOpen) {
        tdRef.current.setMode(
          drawTarget === "point" ? "point" : "linestring"
        );
      } else {
        tdRef.current.setMode("static");
      }
    }
  }, [activeTool, canDraw, meta, drawTarget, formOpen]);

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

  const toggleFeatureSelection = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }, []);

  const handleFeatureClick = useCallback(
    (feat: Feature, additive = false) => {
      closePopup();
      clearRoadSelection();
      if (additive) {
        // Ctrl/Cmd+click extends the selection; the edit form is reserved for
        // a plain click so additive picking never interrupts the flow.
        toggleFeatureSelection(resolveDraftId(feat));
        return;
      }
      setSelectedIds([]);
      void fetchFeatureDetail(resolveDraftId(feat)).then((full) => {
        setSelectedFeature(full ?? feat);
        setFormMode("update");
        setPendingGeometry(null);
        setFormOpen(true);
      });
    },
    [
      clearRoadSelection,
      closePopup,
      fetchFeatureDetail,
      resolveDraftId,
      toggleFeatureSelection,
    ]
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
        map.getCanvas().style.cursor = "default";
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
        map.getCanvas().style.cursor = "default";
        if (dLng === 0 && dLat === 0) {
          const fc = featuresRef.current;
          if (fc) setDraftData(fc);
          const feat = fc?.features.find((f) => String(f.id) === d.featureId);
          // Pure click (no drag): the feature was removed from the source on
          // mousedown and restored here, so MapLibre's layer click event won't
          // reliably fire — open the edit panel directly.
          if (feat) {
            handleFeatureClick(
              feat as Feature,
              e.originalEvent.ctrlKey || e.originalEvent.metaKey
            );
          }
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
        map.getCanvas().style.cursor = "default";
        if (x2 - x1 < 5 && y2 - y1 < 5) return;
        const box = [
          [x1, y1],
          [x2, y2],
        ] as [[number, number], [number, number]];
        const additive = e.originalEvent.ctrlKey || e.originalEvent.metaKey;

        if (selectModeRef.current === "road") {
          // Same layers the road clicks use, so marquee and Ctrl+click pick
          // from one pool.
          const hits = map.queryRenderedFeatures(box, {
            layers: ["roads-bg-line", "roads-bg-hit"],
          });
          const ids = Array.from(
            new Set(hits.map((f) => roadIdOf(f as unknown as Feature)))
          ).filter(Boolean);
          setRoadInfo(null);
          applyRoadSelection(
            additive
              ? Array.from(new Set([...selectedRoadIdsRef.current, ...ids]))
              : ids
          );
          return;
        }

        const hits = map.queryRenderedFeatures(box, { layers: [layerId] });
        const ids = Array.from(
          new Set(hits.map((f) => resolveDraftId(f as unknown as Feature)))
        );
        setSelectedIds(
          additive ? Array.from(new Set([...selectedIdsRef.current, ...ids])) : ids
        );
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
      map.getCanvas().style.cursor = "default";
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
    handleFeatureClick,
  ]);

  useEffect(() => {
    if (!mapRef.current || !meta) return;
    const map = mapRef.current;

    const layerId = isPoint ? "draft-points" : "draft-lines";
    const handler = (e: maplibregl.MapLayerMouseEvent) => {
      if (!e.features?.length) return;
      if (activeToolRef.current !== "select") return;
      if (selectModeRef.current !== "feature") return;
      handleFeatureClick(
        e.features[0] as unknown as Feature,
        e.originalEvent.ctrlKey || e.originalEvent.metaKey
      );
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
    if (activeTool !== "select") {
      setSelectedIds([]);
      clearRoadSelection();
    }
  }, [activeTool, clearRoadSelection]);

  /* ---- magnet toggle: re-configure the line mode in place ---- */
  useEffect(() => {
    localStorage.setItem("ed_snap_roads", String(snapToRoads));
    tdRef.current?.updateModeOptions<typeof TerraDrawLineStringMode>("linestring", {
      snapping: lineSnapping,
    });
  }, [snapToRoads, lineSnapping]);

  /* ---- switching select mode drops the other mode's selection ---- */
  useEffect(() => {
    if (selectMode === "road") setSelectedIds([]);
    else clearRoadSelection();
  }, [selectMode, clearRoadSelection]);

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
      key: "select-feature",
      group: "action",
      show: true,
      active: activeTool === "select" && selectMode === "feature",
      title:
        "Pilih titik/koordinat — klik untuk edit, Ctrl+klik untuk menambah, seret untuk memilih banyak",
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
      onClick: () => {
        setSelectMode("feature");
        setActiveTool("select");
      },
    },
    {
      key: "select-road",
      group: "action",
      show: datasetId !== "ruas_jalan",
      active: activeTool === "select" && selectMode === "road",
      title:
        "Pilih jalan (referensi) — klik untuk metadata, Ctrl+klik untuk menambah, seret untuk memilih banyak",
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
          <path d="M6 3l-2 18" />
          <path d="M18 3l2 18" />
          <path d="M12 4v3M12 11v3M12 18v2" />
        </svg>
      ),
      onClick: () => {
        setSelectMode("road");
        setActiveTool("select");
      },
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
      onClick: () =>
        jenisOptions.length > 0
          ? setAddMenuOpen((v) => !v)
          : handleStartDraw(isPoint ? "point" : "line"),
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
      key: "snap",
      group: "mode",
      show: !isPoint,
      active: snapToRoads,
      title: `Magnet ke jalan: ${snapToRoads ? "ON" : "OFF"} — titik garis menempel ke jaringan ruas di belakangnya`,
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
          <path d="M5 3v8a7 7 0 0 0 14 0V3" />
          <path d="M5 3h4v5H5z" />
          <path d="M15 3h4v5h-4z" />
        </svg>
      ),
      onClick: () => setSnapToRoads((v) => !v),
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

  const ACTION_LABELS: Record<string, string> = {
    autopublish: "Auto-publish 2 hari",
    publish: "Publish",
  };
  const isActionBtn = (key: string) => key === "autopublish" || key === "publish";
  const actionBtns = toolboxBtns.filter((b) => b.show && isActionBtn(b.key));
  const publishBtn = actionBtns.find((b) => b.key === "publish");
  const autoBtn = actionBtns.find((b) => b.key === "autopublish");
  const jenisField = meta?.formFields.find((f) => f.key === "jenis");
  const jenisOptions = jenisField?.options ?? [];
  const visibleToolboxBtns = toolboxBtns.filter((b) => b.show && !isActionBtn(b.key));
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

  /* ---- expose the editor's status + Publish to the shell chrome ----
     On phones the status summary renders in the sidebar drawer and Publish in
     the search pill, both outside this component's subtree. Handlers are read
     through a ref so this snapshot only changes when a displayed value does. */
  const chromeActionsRef = useRef({
    toggleWindow: () => {},
    toggleAutoPublish: () => {},
    publish: () => {},
  });
  chromeActionsRef.current = {
    toggleWindow,
    toggleAutoPublish: autoBtn?.onClick ?? (() => {}),
    publish: publishBtn?.onClick ?? (() => {}),
  };

  const chromeActions = useMemo(
    () => ({
      toggleWindow: () => chromeActionsRef.current.toggleWindow(),
      toggleAutoPublish: () => chromeActionsRef.current.toggleAutoPublish(),
      publish: () => chromeActionsRef.current.publish(),
    }),
    []
  );

  const chromeEditOpen = !!editWindow?.open;
  const chromeAutoLabel = autoBtn ? ACTION_LABELS[autoBtn.key] ?? autoBtn.title : null;
  const chromeAutoActive = !!autoBtn?.active;
  const chromePublishDisabled = !!publishBtn?.disabled;
  const chromePublishTitle = publishBtn?.title ?? "";

  useEffect(() => {
    setEditorChrome({
      mounted: true,
      onlineCount,
      editOpen: chromeEditOpen,
      canToggleWindow: isSuperAdmin,
      autoPublishLabel: chromeAutoLabel,
      autoPublishActive: chromeAutoActive,
      publishAvailable: !!publishBtn,
      publishDisabled: chromePublishDisabled,
      publishTitle: chromePublishTitle,
      publishBusy,
      actions: chromeActions,
    });
  }, [
    onlineCount,
    chromeEditOpen,
    isSuperAdmin,
    chromeAutoLabel,
    chromeAutoActive,
    publishBtn,
    chromePublishDisabled,
    chromePublishTitle,
    publishBusy,
    chromeActions,
  ]);

  useEffect(() => () => resetEditorChrome(), []);

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
          {/* ---- Tools (top-center) ---- */}
          {(isSuperAdmin || isEditor) && (
            <div className="ed-toolbar" role="toolbar" aria-label="Alat editor">
              {visibleToolboxBtns.map((btn, i) => (
                <Fragment key={btn.key}>
                  {i > 0 && visibleToolboxBtns[i - 1].group !== btn.group && (
                    <div className="ed-toolbar-divider" />
                  )}
                  <button
                    type="button"
                    className={`ed-tool${btn.active ? " on" : ""}`}
                    onClick={btn.onClick}
                    disabled={btn.disabled}
                    title={`${i + 1}. ${btn.title}`}
                  >
                    {btn.icon}
                    <span className="ed-tool-key">{i + 1}</span>
                  </button>
                </Fragment>
              ))}
            </div>
          )}

          {addMenuOpen && jenisOptions.length > 0 && (
            <div className="ed-addmenu">
              <div className="ed-popover-title">Tambah titik</div>
              {jenisOptions.map((jenis) => (
                <button
                  key={jenis}
                  type="button"
                  className="ed-addmenu-item"
                  onClick={() => startJenisDraw(jenis)}
                >
                  {jenisLabel(jenis)}
                </button>
              ))}
            </div>
          )}

          {/* ---- Status chip + Publish (top-right) ---- */}
          <div className="ed-topright">
            <button
              type="button"
              className={`ed-chip${statusOpen ? " on" : ""}`}
              onClick={() => setStatusOpen((v) => !v)}
              aria-expanded={statusOpen}
              title="Status editor"
            >
              <span className="ed-live-dot" />
              <span>{onlineCount} online</span>
              <span className="ed-chip-dot">·</span>
              <span className={editWindow?.open ? "ed-chip-open" : "ed-chip-closed"}>
                {editWindow?.open ? "Edit terbuka" : "Edit tertutup"}
              </span>
            </button>

            {publishBtn && (
              <button
                type="button"
                className="ed-publish"
                onClick={publishBtn.onClick}
                disabled={publishBtn.disabled}
                title={publishBtn.title}
              >
                {publishBtn.icon}
                <span>Publish</span>
              </button>
            )}

            {statusOpen && (
              <div className="ed-popover ed-popover-right">
                <div className="ed-popover-title">Status editor</div>
                <div className="ed-popover-row">
                  <span className={`ed-window-pill ${editWindow?.open ? "ed-window-pill-open" : "ed-window-pill-closed"}`}>
                    {editWindow?.open ? "Edit terbuka" : "Edit tertutup"}
                  </span>
                  {isSuperAdmin && (
                    <button
                      className={`ed-window-btn ${editWindow?.open ? "ed-window-btn-close" : "ed-window-btn-open"}`}
                      onClick={toggleWindow}
                    >
                      {editWindow?.open ? "Tutup" : "Buka"}
                    </button>
                  )}
                </div>
                {autoBtn && (
                  <button
                    type="button"
                    className={`ed-popover-toggle${autoBtn.active ? " on" : ""}`}
                    onClick={autoBtn.onClick}
                    title={autoBtn.title}
                  >
                    <span className="ed-action-label">{ACTION_LABELS[autoBtn.key] ?? autoBtn.title}</span>
                    <span className={`ed-action-state${autoBtn.active ? " on" : ""}`}>
                      {autoBtn.active ? "ON" : "OFF"}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/**/}
          <LayersPanel
            label={meta.label}
            isPoint={isPoint}
            defaultColor={meta.defaultColor}
            showRoads={datasetId !== "ruas_jalan"}
            open={layersOpen}
            onToggleOpen={() => setLayersOpen((v) => !v)}
            featuresVisible={featuresVisible}
            onToggleFeatures={() => setFeaturesVisible((v) => !v)}
            roadsVisible={roadsVisible}
            onToggleRoads={() => setRoadsVisible((v) => !v)}
            roadUPTD={activeRoadUPTD}
            onToggleUPTD={toggleRoadUPTD}
            roadList={roadList}
            hiddenRoads={hiddenRoads}
            onToggleRoad={toggleRoadVisibility}
            onSetManyRoads={setManyRoadsVisible}
            onShowAllRoads={showAllRoads}
          />

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

          {/* ---- Selection bar (bulk actions, one variant per select mode) ---- */}
          {selectMode === "feature" && selectedIds.length > 0 && (
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

          {selectMode === "road" && selectedRoadIds.length > 0 && !roadInfo && (
            <div className="ed-selection-bar">
              <span className="ed-selection-count">
                {selectedRoadIds.length} fitur terpilih
              </span>
              <button
                className="ed-selection-btn"
                onClick={() => {
                  setManyRoadsVisible(selectedRoadIds, false);
                  clearRoadSelection();
                }}
              >
                Sembunyikan
              </button>
              <button className="ed-selection-btn" onClick={clearRoadSelection}>
                Batal
              </button>
            </div>
          )}

          {/* ---- Load failure: shown instead of the empty state so a failed
               fetch is never mistaken for a dataset with no rows ---- */}
          {loadError && !initialLoading && (
            <div className="ed-empty-state">
              <div className="ed-empty-state-card">
                <h3 className="ed-empty-state-title">Gagal memuat data</h3>
                <p className="ed-empty-state-text">{loadError}</p>
                <button
                  className="ed-selection-btn"
                  onClick={() => {
                    setInitialLoading(true);
                    void refreshFeatures();
                  }}
                >
                  Coba lagi
                </button>
              </div>
            </div>
          )}

          {/* ---- Empty state ---- */}
          {!loadError && features.features.length === 0 && !initialLoading && (
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

          {/* ---- Read-only road info panel (reference layer click) ---- */}
          {roadInfo && !formOpen && (
            <div className="ed-panel ed-panel-roadinfo">
              <div className="ed-panel-header">
                <h3>Meta Data Ruas Jalan</h3>
                <button
                  className="ed-btn-icon"
                  onClick={clearRoadSelection}
                  title="Tutup panel"
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              </div>
              <div className="ed-roadinfo-list">
                {(
                  [
                    ["Kode Ruas", "kode_number"],
                    ["Nama Ruas", "nama"],
                    ["Status", "status"],
                    ["Kabupaten", "KABUPATEN"],
                    ["Panjang (km)", "panjang_km"],
                    ["Unit Kerja", "unit_kerja_kode"],
                    ["Lokasi Kode", "lokasi_kode"],
                  ] as const
                ).map(([label, key]) => {
                  const v = (roadInfo.properties as GeoProps | null)?.[key];
                  if (v == null || v === "") return null;
                  return (
                    <div key={key} className="ed-roadinfo-row">
                      <span className="ed-roadinfo-label">{label}</span>
                      <span className="ed-roadinfo-value">{String(v)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="ed-roadinfo-note">
                Referensi ruas jalan (read-only). Gunakan toolbox untuk mengelola
                fitur draft.
              </p>
            </div>
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
