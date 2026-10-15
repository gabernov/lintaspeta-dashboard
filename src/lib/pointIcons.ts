import type { Map as MapLibreMap, StyleImageSource } from "maplibre-gl";

/*
 * Canvas-drawn point icons for the pengawasan_angkutan_barang dataset.
 * Mirrors maps/pengawasan-angkutanbarang/{config,module}.js in lintaspeta-web
 * so a point looks identical in the editor and on the public map. The three
 * rambu jenis are drawn as the actual Indonesian signs (white disc, red ring,
 * the sign's own pictogram); tambang/posko are not traffic signs and use a
 * white badge carrying their illustration.
 */

const ICON_UNITS = 40;
const ICON_SIZE = 64;
const SIGN_RED = "#EF4444";
const INK = "#111827";
const OUTLINE = "#0F172A";

// MST tonnage follows the road class: kelas I carries 10 T, kelas II/III 8 T.
const MST_TON_BY_KELAS: Record<string, number> = { I: 10, II: 8, III: 8 };

interface IconSpec {
  id: string;
  jenis: string;
  kelas: string;
}

const ICON_SPECS: IconSpec[] = [
  { id: "ed-kelas-I", jenis: "rambu_kelas_jalan", kelas: "I" },
  { id: "ed-kelas-II", jenis: "rambu_kelas_jalan", kelas: "II" },
  { id: "ed-kelas-III", jenis: "rambu_kelas_jalan", kelas: "III" },
  { id: "ed-mst-10", jenis: "rambu_mst", kelas: "I" },
  { id: "ed-mst-8", jenis: "rambu_mst", kelas: "II" },
  { id: "ed-jenis-rambu_kelas_jalan", jenis: "rambu_kelas_jalan", kelas: "I" },
  { id: "ed-jenis-rambu_mst", jenis: "rambu_mst", kelas: "II" },
  { id: "ed-jenis-rambu_pembatasan", jenis: "rambu_pembatasan", kelas: "" },
  { id: "ed-jenis-tambang", jenis: "tambang", kelas: "" },
  { id: "ed-jenis-posko", jenis: "posko", kelas: "" },
];

export const KELAS_ORDER = ["I", "II", "III"];

export const KELAS_ICON_IDS: Record<string, string> = {
  I: "ed-kelas-I",
  II: "ed-kelas-II",
  III: "ed-kelas-III",
};

// MST signs show the permitted axle load, which follows the road class.
export const MST_ICON_IDS: Record<string, string> = {
  "10": "ed-mst-10",
  "8": "ed-mst-8",
};

export const JENIS_ICON_IDS: Record<string, string> = {
  rambu_kelas_jalan: "ed-jenis-rambu_kelas_jalan",
  rambu_mst: "ed-jenis-rambu_mst",
  rambu_pembatasan: "ed-jenis-rambu_pembatasan",
  tambang: "ed-jenis-tambang",
  posko: "ed-jenis-posko",
};

export const JENIS_LABELS: Record<string, string> = {
  rambu_kelas_jalan: "Rambu Kelas Jalan",
  rambu_mst: "Rambu MST",
  rambu_pembatasan: "Rambu Pembatasan Angkutan",
  tambang: "Lokasi Tambang",
  posko: "Titik Posko Pengawasan",
};

export function jenisLabel(jenis: string): string {
  return JENIS_LABELS[jenis] ?? jenis.replace(/_/g, " ");
}

const SIGN_JENIS = new Set(["rambu_kelas_jalan", "rambu_mst", "rambu_pembatasan"]);

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

function signBase(ctx: CanvasRenderingContext2D, S: number) {
  const c = S / 2;
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 3, 0, Math.PI * 2);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 5, 0, Math.PI * 2);
  ctx.lineWidth = 5;
  ctx.strokeStyle = SIGN_RED;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(c, c, S / 2 - 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(15,23,42,0.55)";
  ctx.stroke();
}

function badgeBase(ctx: CanvasRenderingContext2D, S: number) {
  const m = 3;
  roundRectPath(ctx, m, m, S - 2 * m, S - 2 * m, 9);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 5;
  ctx.stroke();
  roundRectPath(ctx, m, m, S - 2 * m, S - 2 * m, 9);
  ctx.fillStyle = "#FFFFFF";
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawRomanGlyph(ctx: CanvasRenderingContext2D, kelas: string) {
  const bars = kelas === "I" ? 1 : kelas === "II" ? 2 : 3;
  const w = 3.4;
  const gap = 5.2;
  const total = bars * w + (bars - 1) * gap;
  let x = -total / 2;
  ctx.fillStyle = INK;
  for (let i = 0; i < bars; i++) {
    ctx.fillRect(x, -11, w, 22);
    x += w + gap;
  }
}

function drawMstGlyph(ctx: CanvasRenderingContext2D, ton: number) {
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = "bold 13px 'Fira Sans', system-ui, sans-serif";
  ctx.fillText(String(ton), -2, -1.5);
  ctx.font = "bold 6.5px 'Fira Sans', system-ui, sans-serif";
  ctx.fillText("T", 8.5, -6.5);

  ctx.fillRect(-1.1, 0.8, 2.2, 3.2);
  ctx.beginPath();
  ctx.moveTo(-3.3, 3.8);
  ctx.lineTo(3.3, 3.8);
  ctx.lineTo(0, 6.8);
  ctx.closePath();
  ctx.fill();

  for (const x of [-11, -8.4, 8.4, 11]) {
    roundRectPath(ctx, x - 1.2, 6.4, 2.4, 6.6, 1.1);
    ctx.fill();
  }
  roundRectPath(ctx, -11, 8.5, 22, 2.4, 1.2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, 9.7, 3.9, 2.7, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawTruckSilhouette(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = INK;
  roundRectPath(ctx, -3, -8, 16, 10.5, 0.8);
  ctx.fill();
  roundRectPath(ctx, -6.5, 1.8, 22.5, 2.2, 0.6);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-13.5, 4);
  ctx.lineTo(-13.5, -0.5);
  ctx.quadraticCurveTo(-13.5, -3.6, -10.5, -3.6);
  ctx.lineTo(-3, -3.6);
  ctx.lineTo(-3, 4);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(-11.6, -2.2);
  ctx.lineTo(-4.4, -2.2);
  ctx.lineTo(-4.4, 1);
  ctx.lineTo(-11.6, 1);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK;
  for (const x of [-9, 8.5]) {
    ctx.beginPath();
    ctx.arc(x, 4.6, 2.8, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#FFFFFF";
  for (const x of [-9, 8.5]) {
    ctx.beginPath();
    ctx.arc(x, 4.6, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawProhibitSlash(ctx: CanvasRenderingContext2D, S: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S / 2 - 6.2, 0, Math.PI * 2);
  ctx.clip();
  ctx.translate(S / 2, S / 2);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(-S, -3.5, S * 2, 7);
  ctx.fillStyle = SIGN_RED;
  ctx.fillRect(-S, -2.2, S * 2, 4.4);
  ctx.restore();
}

function drawMineGlyph(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const topY = -4;
  const baseY = 14;
  const topL = -3;
  const topR = 0;
  const baseL = -8;
  const baseR = 5;
  const xAt = (t: number, l: number, r: number) => l + (r - l) * t;

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(topL, topY);
  ctx.lineTo(topR, topY);
  ctx.lineTo(baseR, baseY);
  ctx.lineTo(baseL, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  const rails = [topY, 2.5, 9, baseY];
  for (let i = 1; i < rails.length - 1; i++) {
    const t = (rails[i] - topY) / (baseY - topY);
    ctx.beginPath();
    ctx.moveTo(xAt(t, topL, baseL), rails[i]);
    ctx.lineTo(xAt(t, topR, baseR), rails[i]);
    ctx.stroke();
  }
  for (let i = 0; i < rails.length - 1; i++) {
    const t1 = (rails[i] - topY) / (baseY - topY);
    const t2 = (rails[i + 1] - topY) / (baseY - topY);
    ctx.beginPath();
    ctx.moveTo(xAt(t1, topL, baseL), rails[i]);
    ctx.lineTo(xAt(t2, topR, baseR), rails[i + 1]);
    ctx.moveTo(xAt(t1, topR, baseR), rails[i]);
    ctx.lineTo(xAt(t2, topL, baseL), rails[i + 1]);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(baseL - 2.5, baseY);
  ctx.lineTo(baseR + 2.5, baseY);
  ctx.stroke();

  ctx.save();
  ctx.translate(-4.2, -1.2);
  ctx.rotate(-0.43);
  ctx.fillStyle = "#B6BEC9";
  roundRectPath(ctx, -10.2, -1.9, 20.4, 3.8, 1.9);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(-13.2, 2.9, 1.7, 0, Math.PI * 2);
  ctx.fillStyle = "#B6BEC9";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 6;
    const px = 9 + Math.cos(a) * 5.2;
    const py = -7.5 + Math.sin(a) * 5.2;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#29B6F6";
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(9, -7.5, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(9, -7.5, 1.1, 0, Math.PI * 2);
  ctx.fillStyle = "#94A3B8";
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(9, -2.3);
  ctx.lineTo(9, 1.4);
  ctx.stroke();

  ctx.fillStyle = "#64748B";
  roundRectPath(ctx, 6.9, 1.4, 4.2, 5.6, 1);
  ctx.fill();
  ctx.stroke();
}

function drawTentGlyph(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = INK;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1.2;
  ctx.lineJoin = "round";

  const apexY = -11.5;
  const eaveY = 2.5;
  const bodyTopY = 4.1;
  const bodyBotY = 14.5;
  const bodyTopHalf = 11.5;
  const bodyBotHalf = 13.5;

  ctx.beginPath();
  ctx.moveTo(-bodyTopHalf, bodyTopY);
  ctx.lineTo(bodyTopHalf, bodyTopY);
  ctx.lineTo(bodyBotHalf, bodyBotY);
  ctx.lineTo(-bodyBotHalf, bodyBotY);
  ctx.closePath();
  ctx.fill();

  const wedges = [
    [-12.5, -8],
    [-6.5, -2],
    [2, 6.5],
    [8.5, 12.5],
  ];
  for (const [a, b] of wedges) {
    ctx.beginPath();
    ctx.moveTo(0, apexY);
    ctx.lineTo(a, eaveY);
    ctx.lineTo(b, eaveY);
    ctx.closePath();
    ctx.fill();
  }
  for (const [a, b] of wedges) {
    const r = Math.min(2.1, (b - a) / 2);
    ctx.beginPath();
    ctx.arc((a + b) / 2, eaveY + 1.1, r, 0, Math.PI);
    ctx.fill();
  }

  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.moveTo(-3.2, bodyTopY + 2.6);
  ctx.lineTo(3.2, bodyTopY + 2.6);
  ctx.lineTo(4.8, bodyBotY);
  ctx.lineTo(-4.8, bodyBotY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(0.6, -15);
  ctx.lineTo(0.6, -11.4);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0.9, -15);
  ctx.lineTo(5.4, -13.6);
  ctx.lineTo(0.9, -12.2);
  ctx.closePath();
  ctx.fill();
}

function drawGlyph(ctx: CanvasRenderingContext2D, jenis: string, kelas: string) {
  if (jenis === "rambu_kelas_jalan") drawRomanGlyph(ctx, kelas);
  else if (jenis === "rambu_mst") drawMstGlyph(ctx, MST_TON_BY_KELAS[kelas] ?? 8);
  else if (jenis === "rambu_pembatasan") drawTruckSilhouette(ctx);
  else if (jenis === "tambang") drawMineGlyph(ctx);
  else drawTentGlyph(ctx);
}

function newContext(): CanvasRenderingContext2D | null {
  const canvas = document.createElement("canvas");
  canvas.width = ICON_SIZE;
  canvas.height = ICON_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.lineJoin = "round";
  return ctx;
}

function toImage(ctx: CanvasRenderingContext2D): StyleImageSource {
  const data = ctx.getImageData(0, 0, ICON_SIZE, ICON_SIZE);
  return { width: ICON_SIZE, height: ICON_SIZE, data: new Uint8Array(data.data) };
}

function buildJenisIcon(jenis: string, kelas: string): StyleImageSource | null {
  const ctx = newContext();
  if (!ctx) return null;
  const S = ICON_UNITS;
  const k = ICON_SIZE / ICON_UNITS;
  ctx.scale(k, k);
  if (SIGN_JENIS.has(jenis)) signBase(ctx, S);
  else badgeBase(ctx, S);
  ctx.save();
  ctx.translate(S / 2, S / 2);
  drawGlyph(ctx, jenis, kelas);
  ctx.restore();
  if (jenis === "rambu_pembatasan") drawProhibitSlash(ctx, S);
  return toImage(ctx);
}

export function ensurePointIcons(map: MapLibreMap) {
  for (const spec of ICON_SPECS) {
    if (map.hasImage(spec.id)) continue;
    const image = buildJenisIcon(spec.jenis, spec.kelas);
    if (image) map.addImage(spec.id, image);
  }
}

export function pointIconForId(id: string): StyleImageSource | null {
  const spec = ICON_SPECS.find((s) => s.id === id);
  return spec ? buildJenisIcon(spec.jenis, spec.kelas) : null;
}
