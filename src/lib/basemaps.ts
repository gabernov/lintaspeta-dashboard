/* Raster basemap catalog shared by the topbar picker and the editor.
   "bright" (CartoDB Voyager) is the default look per product request. */
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
