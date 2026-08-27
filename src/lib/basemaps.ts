/* Raster basemap catalog shared by the topbar picker and the editor.
   "bright" (Esri World Street Map) is the default look per product request.
   NOTE: previously used CARTO CDN (basemaps.cartocdn.com) but CARTO now
   requires an API key and serves watermarked tiles; Esri ArcGIS raster
   tiles are keyless and free for public use. */
export interface BasemapOption {
  id: string;
  label: string;
  url: string;
  attribution: string;
}

export const BASEMAPS: BasemapOption[] = [
  {
    id: "bright",
    label: "Bright",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  {
    id: "positron",
    label: "Putih",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  {
    id: "dark",
    label: "Gelap",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
  },
  {
    id: "osm",
    label: "OSM",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
  },
  {
    id: "topo",
    label: "Topografi",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
  },
  {
    id: "satellite",
    label: "Satelit",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
  },
];

export function getBasemap(id: string | null | undefined): BasemapOption {
  return BASEMAPS.find((b) => b.id === id) ?? BASEMAPS[0];
}

export const ED_BASEMAP_EVENT = "ed-basemap";
