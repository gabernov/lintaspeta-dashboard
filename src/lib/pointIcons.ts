import type { Map as MapLibreMap, StyleImageSource } from "maplibre-gl";

/*
 * Canvas-drawn point icons for the pengawasan_angkutan_barang dataset.
 * Mirrors maps/pengawasan-angkutanbarang/{config,module}.js in lintaspeta-web
 * so a point looks identical in the editor and on the public map. MapLibre v5
 * addImage() accepts raw RGBA pixels, so no external assets are needed.
 */

type PointShape = "circle" | "square" | "triangle" | "diamond";
type PointGlyph = "truck" | "prohibit" | "ore" | "post";

interface PointIconStyle {
  color: string;
  shape: PointShape;
  glyph: PointGlyph;
  scale: number;
  dy: number;
}

const ICON_SIZE = 40;
const FALLBACK_JENIS = "rambu_kelas_jalan";

const STYLES: Record<string, PointIconStyle> = {
  rambu_kelas_jalan: { color: "#EF4444", shape: "circle", glyph: "truck", scale: 0.92, dy: 0 },
  rambu_mst: { color: "#2563EB", shape: "triangle", glyph: "truck", scale: 0.55, dy: 4 },
  rambu_pembatasan: { color: "#F59E0B", shape: "square", glyph: "prohibit", scale: 0.95, dy: 0 },
  tambang: { color: "#7C3AED", shape: "diamond", glyph: "ore", scale: 0.95, dy: 0 },
  posko: { color: "#0D9488", shape: "square", glyph: "post", scale: 0.95, dy: 0 },
};

export const KELAS_ORDER = ["I", "II", "III"];

export const JENIS_ICON_IDS: Record<string, string> = {
  rambu_kelas_jalan: "ed-jenis-rambu_kelas_jalan",
  rambu_mst: "ed-jenis-rambu_mst",
  rambu_pembatasan: "ed-jenis-rambu_pembatasan",
  tambang: "ed-jenis-tambang",
  posko: "ed-jenis-posko",
};

export const KELAS_ICON_IDS: Record<string, string> = {
  I: "ed-kelas-I",
  II: "ed-kelas-II",
  III: "ed-kelas-III",
};

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function shapePath(ctx: CanvasRenderingContext2D, shape: PointShape, S: number) {
  const m = 4;
  const c = S / 2;
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(c, c, S / 2 - m, 0, Math.PI * 2);
  } else if (shape === "square") {
    roundRectPath(ctx, m, m, S - 2 * m, S - 2 * m, 7);
  } else if (shape === "triangle") {
    ctx.moveTo(c, m + 1);
    ctx.lineTo(S - m - 1, S - m - 1);
    ctx.lineTo(m + 1, S - m - 1);
    ctx.closePath();
  } else {
    ctx.moveTo(c, m);
    ctx.lineTo(S - m, c);
    ctx.lineTo(c, S - m);
    ctx.lineTo(m, c);
    ctx.closePath();
  }
}

function drawTruckGlyph(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#FFFFFF";
  roundRectPath(ctx, -14, -8, 18, 12, 2);
  ctx.fill();
  roundRectPath(ctx, 4, -3, 9, 7, 1.6);
  ctx.fill();
  ctx.fillStyle = "#0F172A";
  ctx.beginPath();
  ctx.arc(-8, 5.5, 2.8, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(7, 5.5, 2.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawProhibitGlyph(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "#FFFFFF";
  ctx.lineWidth = 4.5;
  ctx.beginPath();
  ctx.arc(0, 0, 10, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-7, 7);
  ctx.lineTo(7, -7);
  ctx.stroke();
}

function drawOreGlyph(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0F172A";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
}

function drawPostGlyph(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.lineTo(12, -1);
  ctx.lineTo(-12, -1);
  ctx.closePath();
  ctx.fill();
  roundRectPath(ctx, -9, -1, 18, 12, 1.5);
  ctx.fill();
  ctx.fillStyle = "#0F172A";
  roundRectPath(ctx, -3, 3, 6, 8, 1);
  ctx.fill();
}

function drawRomanGlyph(ctx: CanvasRenderingContext2D, kelas: string) {
  const bars = kelas === "I" ? 1 : kelas === "II" ? 2 : 3;
  const w = 3.4;
  const gap = 5.2;
  const total = bars * w + (bars - 1) * gap;
  let x = -total / 2;
  ctx.fillStyle = "#111827";
  for (let i = 0; i < bars; i++) {
    ctx.fillRect(x, -11, w, 22);
    x += w + gap;
  }
}

function newContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  return canvas.getContext("2d");
}

function toImage(ctx: CanvasRenderingContext2D): StyleImageSource {
  const data = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
  return { width: ICON_SIZE, height: ICON_SIZE, data: new Uint8Array(data.data) };
}

function buildJenisIcon(jenis: string): StyleImageSource | null {
  const style = STYLES[jenis] ?? STYLES[FALLBACK_JENIS];
  const ctx = newContext();
  if (!ctx) return null;
  const S = ICON_SIZE;
  ctx.lineJoin = "round";

  shapePath(ctx, style.shape, S);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 5;
  ctx.stroke();

  shapePath(ctx, style.shape, S);
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.strokeStyle = "#0F172A";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.save();
  ctx.translate(S / 2, S / 2 + style.dy);
  ctx.scale(style.scale, style.scale);
  if (style.glyph === "prohibit") drawProhibitGlyph(ctx);
  else if (style.glyph === "ore") drawOreGlyph(ctx);
  else if (style.glyph === "post") drawPostGlyph(ctx);
  else drawTruckGlyph(ctx);
  ctx.restore();

  return toImage(ctx);
}

function buildKelasIcon(kelas: string): StyleImageSource | null {
  const ctx = newContext();
  if (!ctx) return null;
  const S = ICON_SIZE;
  const c = S / 2;

  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();

  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 5, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = "#EF4444";
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.stroke();

  ctx.save();
  ctx.translate(c, c);
  drawRomanGlyph(ctx, kelas);
  ctx.restore();

  return toImage(ctx);
}

export function ensurePointIcons(map: MapLibreMap) {
  for (const jenis of Object.keys(STYLES)) {
    const id = JENIS_ICON_IDS[jenis];
    if (!id || map.hasImage(id)) continue;
    const image = buildJenisIcon(jenis);
    if (image) map.addImage(id, image);
  }
  for (const kelas of KELAS_ORDER) {
    const id = KELAS_ICON_IDS[kelas];
    if (!id || map.hasImage(id)) continue;
    const image = buildKelasIcon(kelas);
    if (image) map.addImage(id, image);
  }
}

export function pointIconForId(id: string): StyleImageSource | null {
  const jenis = Object.keys(JENIS_ICON_IDS).find((k) => JENIS_ICON_IDS[k] === id);
  if (jenis) return buildJenisIcon(jenis);
  const kelas = KELAS_ORDER.find((k) => KELAS_ICON_IDS[k] === id);
  if (kelas) return buildKelasIcon(kelas);
  return null;
}
