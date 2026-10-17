/*
 * XLSX export for the editor's layers dock, mirroring the public map's
 * "Unduh XLSX" action. SheetJS is loaded on demand from the same CDN the portal
 * uses, so the dashboard keeps no spreadsheet dependency in its bundle.
 */

type SheetJsUtils = {
  json_to_sheet: (rows: Record<string, unknown>[]) => unknown;
  book_new: () => unknown;
  book_append_sheet: (book: unknown, sheet: unknown, name: string) => void;
};
type SheetJs = {
  utils: SheetJsUtils;
  writeFile: (book: unknown, filename: string) => void;
};

const CDN = "https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js";

let loading: Promise<boolean> | null = null;

function lib(): SheetJs | null {
  const w = window as unknown as { XLSX?: SheetJs };
  return w.XLSX ?? null;
}

export function ensureXLSX(): Promise<boolean> {
  if (lib()) return Promise.resolve(true);
  if (loading) return loading;
  loading = new Promise<boolean>((resolve) => {
    const script = document.createElement("script");
    script.src = CDN;
    script.onload = () => resolve(true);
    script.onerror = () => {
      loading = null;
      resolve(false);
    };
    document.head.appendChild(script);
  });
  return loading;
}

const SKIP_KEYS = new Set(["geometry", "geometry_bbox", "wkb_geometry", "geom"]);

export function exportRowsToXLSX(
  rows: Record<string, unknown>[],
  filename: string,
  sheetName = "Data"
): number {
  const XLSX = lib();
  if (!XLSX || rows.length === 0) return 0;
  const clean = rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (SKIP_KEYS.has(k) || k.startsWith("_")) continue;
      out[k] = v === null || v === undefined ? "" : v;
    }
    return out;
  });
  const sheet = XLSX.utils.json_to_sheet(clean);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, sheetName);
  XLSX.writeFile(book, filename);
  return clean.length;
}
