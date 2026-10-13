/* Basemap catalog shared by the topbar picker and the editor.
   Primary entries are OpenFreeMap vector styles (same set as the public
   map): they look consistent with peta.dishubjabar.com and support light/dark
   pairing so the theme toggle can drive the map. A few keyless raster layers
   (satellite, OSM, topo) are kept as extras. */
import type { StyleSpecification } from "maplibre-gl";

export type BasemapKind = "vector" | "raster";
export type BasemapTheme = "light" | "dark";

export interface BasemapOption {
  id: string;
  label: string;
  url: string;
  attribution: string;
  kind: BasemapKind;
  theme?: BasemapTheme;
  swatch: string;
}

const OFM_ATTRIB = "© OpenFreeMap © OpenMapTiles © OpenStreetMap contributors";

export const BASEMAPS: BasemapOption[] = [
  {
    id: "bright",
    label: "Bright",
    url: "https://tiles.openfreemap.org/styles/bright",
    attribution: OFM_ATTRIB,
    kind: "vector",
    theme: "light",
    swatch: "#FDE68A",
  },
  {
    id: "liberty",
    label: "Liberty",
    url: "https://tiles.openfreemap.org/styles/liberty",
    attribution: OFM_ATTRIB,
    kind: "vector",
    theme: "light",
    swatch: "#A0C4FF",
  },
  {
    id: "positron",
    label: "Positron",
    url: "https://tiles.openfreemap.org/styles/positron",
    attribution: OFM_ATTRIB,
    kind: "vector",
    theme: "light",
    swatch: "#E2E8F0",
  },
  {
    id: "dark",
    label: "Dark",
    url: "https://tiles.openfreemap.org/styles/dark",
    attribution: OFM_ATTRIB,
    kind: "vector",
    theme: "dark",
    swatch: "#1E293B",
  },
  {
    id: "fiord",
    label: "Fiord",
    url: "https://tiles.openfreemap.org/styles/fiord",
    attribution: OFM_ATTRIB,
    kind: "vector",
    theme: "dark",
    swatch: "#64748B",
  },
  {
    id: "satellite",
    label: "Satelit",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    kind: "raster",
    swatch: "#4B5563",
  },
  {
    id: "osm",
    label: "OSM",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    kind: "raster",
    swatch: "#D6E4C8",
  },
  {
    id: "topo",
    label: "Topografi",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
    kind: "raster",
    swatch: "#C9B99A",
  },
];

export const DEFAULT_BASEMAP_ID = "bright";

export function getBasemap(id: string | null | undefined): BasemapOption {
  return BASEMAPS.find((b) => b.id === id) ?? getBasemapById(DEFAULT_BASEMAP_ID);
}

function getBasemapById(id: string): BasemapOption {
  return BASEMAPS.find((b) => b.id === id) as BasemapOption;
}

export function basemapForTheme(theme: BasemapTheme): BasemapOption {
  return getBasemap(theme === "dark" ? "dark" : DEFAULT_BASEMAP_ID);
}

export const ED_BASEMAP_EVENT = "ed-basemap";

export const EDITOR_GLYPHS = "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf";

export function basemapStyleSpec(bm: BasemapOption): string | StyleSpecification {
  if (bm.kind === "vector") return bm.url;
  return {
    version: 8,
    glyphs: EDITOR_GLYPHS,
    sources: {
      basemap: {
        type: "raster",
        tiles: [bm.url],
        tileSize: 256,
        attribution: bm.attribution,
      },
    },
    layers: [{ id: "basemap", type: "raster", source: "basemap", minzoom: 0, maxzoom: 20 }],
  };
}
