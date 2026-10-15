import type { FeatureCollection } from "geojson";

export const GEO_ATTRIBUTION = "© OpenStreetMap contributors";

const NOMINATIM = "https://nominatim.openstreetmap.org";
const PHOTON = "https://photon.komoot.io/api/";
const BIAS = { lat: -6.9, lon: 107.6 };

export type CoordHit = { kind: "coord"; lat: number; lng: number };
export type PlaceHit = {
  kind: "place";
  label: string;
  sub: string;
  lat: number;
  lng: number;
  bbox?: [number, number, number, number];
  osmType?: string;
  osmId?: number;
};
export type RoadHit = {
  kind: "road";
  label: string;
  sub: string;
  kode: string;
  ruasId: string;
  uptd: string;
};
export type SearchHit = CoordHit | PlaceHit | RoadHit;

export type SearchSelection = SearchHit;

const ED_SEARCH_SELECT = "ed-search-select";

export function emitSearchSelection(sel: SearchSelection) {
  window.dispatchEvent(new CustomEvent<SearchSelection>(ED_SEARCH_SELECT, { detail: sel }));
}

export function onSearchSelection(handler: (sel: SearchSelection) => void) {
  const listener = (e: Event) => handler((e as CustomEvent<SearchSelection>).detail);
  window.addEventListener(ED_SEARCH_SELECT, listener);
  return () => window.removeEventListener(ED_SEARCH_SELECT, listener);
}

let sharedRoads: FeatureCollection | null = null;

export function setSharedRoads(fc: FeatureCollection | null) {
  sharedRoads = fc;
}

export function getSharedRoads() {
  return sharedRoads;
}

function dmsToDecimal(deg: string, min: string, sec: string, hemi: string | undefined) {
  let value = Number(deg) + Number(min || 0) / 60 + Number(sec || 0) / 3600;
  if (hemi && /[SW]/i.test(hemi)) value = -value;
  return value;
}

const DMS_PART = String.raw`(\d+)\s*[°d]\s*(\d+)?\s*['′m]?\s*([\d.]+)?\s*["″s]?\s*([NSEW])?`;

export function parseCoordInput(raw: string): { lat: number; lng: number } | null {
  const text = raw.trim();
  if (!text) return null;

  const decimal = text.match(/^(-?\d+(?:[.,]\d+)?)\s*[,\s]\s*(-?\d+(?:[.,]\d+)?)$/);
  if (decimal) {
    const a = Number(decimal[1].replace(",", "."));
    const b = Number(decimal[2].replace(",", "."));
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) return { lat: a, lng: b };
    if (Math.abs(a) <= 180 && Math.abs(b) <= 90) return { lat: b, lng: a };
    return null;
  }

  if (!/[°d]['′m]/.test(text)) return null;
  const parts = text.match(new RegExp(DMS_PART, "gi"));
  if (!parts || parts.length < 2) return null;
  const parsed = parts.slice(0, 2).map((part) => {
    const m = new RegExp(`^${DMS_PART}$`, "i").exec(part.trim());
    if (!m) return null;
    const hemi = (m[4] || "").toUpperCase();
    return { value: dmsToDecimal(m[1], m[2], m[3], hemi), hemi };
  });
  if (parsed.some((p) => p === null)) return null;
  const [first, second] = parsed as { value: number; hemi: string }[];
  const latPart = [first, second].find((p) => p.hemi === "N" || p.hemi === "S");
  const lngPart = [first, second].find((p) => p.hemi === "E" || p.hemi === "W");
  if (latPart && lngPart) return { lat: latPart.value, lng: lngPart.value };
  if (Math.abs(first.value) <= 90) return { lat: first.value, lng: second.value };
  return { lat: second.value, lng: first.value };
}

export async function geocodePlaces(
  query: string,
  opts: { signal?: AbortSignal; limit?: number } = {}
): Promise<PlaceHit[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(opts.limit ?? 6),
    lang: "id",
    lat: String(BIAS.lat),
    lon: String(BIAS.lon),
  });
  const res = await fetch(`${PHOTON}?${params.toString()}`, {
    signal: opts.signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    features?: {
      geometry?: { coordinates?: number[] };
      properties?: Record<string, unknown>;
    }[];
  };
  const features = data.features ?? [];
  return features.flatMap((feature) => {
    const coords = feature.geometry?.coordinates;
    const props = feature.properties ?? {};
    if (!coords || coords.length < 2) return [];
    const parts = [props.street, props.district, props.city, props.county, props.state, props.country]
      .map((v) => (v == null ? "" : String(v)))
      .filter(Boolean);
    const unique = parts.filter((v, i) => parts.indexOf(v) === i);
    const extent = props.extent as number[] | undefined;
    return [{
      kind: "place" as const,
      label: String(props.name ?? unique[0] ?? query),
      sub: unique.join(", "),
      lat: coords[1],
      lng: coords[0],
      bbox: extent && extent.length === 4
        ? [extent[0], extent[3], extent[2], extent[1]] as [number, number, number, number]
        : undefined,
      osmType: props.osm_type ? String(props.osm_type) : undefined,
      osmId: props.osm_id != null ? Number(props.osm_id) : undefined,
    }];
  });
}

export async function fetchOsmGeometry(
  osmType: string,
  osmId: number,
  signal?: AbortSignal
): Promise<FeatureCollection | null> {
  const typeChar = osmType.charAt(0).toUpperCase();
  const params = new URLSearchParams({
    osmtype: typeChar,
    osmid: String(osmId),
    format: "json",
    polygon_geojson: "1",
  });
  const res = await fetch(`${NOMINATIM}/details?${params.toString()}`, {
    signal,
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { geometry?: { type: string; coordinates: unknown } };
  if (!data.geometry) return null;
  return {
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: data.geometry }],
  } as FeatureCollection;
}

export function searchRoads(
  query: string,
  roads: FeatureCollection | null,
  limit = 12
): { hits: RoadHit[]; total: number } {
  if (!roads || !query.trim()) return { hits: [], total: 0 };
  const needle = query.trim().toLowerCase();
  const hits: RoadHit[] = [];
  let total = 0;
  for (const feature of roads.features) {
    const props = (feature.properties ?? {}) as Record<string, unknown>;
    const nama = String(props.nama ?? "");
    const kode = String(props.kode_number ?? "");
    const resmi = String(props.id_ruas_jalan ?? "");
    const lama = String(props.nama_lama ?? "");
    const haystack = `${nama} ${kode} ${resmi} ${lama}`.toLowerCase();
    if (!haystack.includes(needle)) continue;
    total += 1;
    if (hits.length >= limit) continue;
    const parts = [kode || resmi];
    if (props.panjang_km != null) parts.push(`${props.panjang_km} km`);
    hits.push({
      kind: "road",
      label: nama || kode || resmi,
      sub: parts.filter(Boolean).join(" · "),
      kode,
      ruasId: resmi,
      uptd: String(props.unit_kerja_kode ?? ""),
    });
  }
  return { hits, total };
}
