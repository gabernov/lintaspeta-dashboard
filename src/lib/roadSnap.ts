import type { FeatureCollection, Position } from "geojson";
import type { SnappableContext, TerraDrawMouseEvent } from "terra-draw";

/*
 * "Magnet" snapping for the line draw tool.
 *
 * TerraDraw's built-in snapping only sees its own internal store, so snapping
 * onto the reference road network (a plain MapLibre source, `roads-bg`) has to
 * go through the mode's `toCustom` hook. That hook runs on every mouse move to
 * draw the guidance point, so lookups go through a grid index instead of
 * scanning the ~280k road coordinates.
 */

const CELL_DEG = 0.01;
const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG = 111320;

type Segment = readonly [number, number, number, number];

export interface RoadSnapIndex {
  cells: Map<string, Segment[]>;
}

const cellKey = (x: number, y: number) => `${x},${y}`;

/** Bucket every road segment into the grid cells its bounding box touches. */
export function buildRoadSnapIndex(
  fc: FeatureCollection | null | undefined
): RoadSnapIndex {
  const cells = new Map<string, Segment[]>();
  if (!fc) return { cells };

  for (const feature of fc.features) {
    const g = feature.geometry;
    const parts =
      g.type === "MultiLineString"
        ? g.coordinates
        : g.type === "LineString"
          ? [g.coordinates]
          : [];
    for (const line of parts) {
      for (let i = 0; i < line.length - 1; i++) {
        const a = line[i];
        const b = line[i + 1];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        const seg: Segment = [a[0], a[1], b[0], b[1]];
        const x0 = Math.floor(Math.min(a[0], b[0]) / CELL_DEG);
        const x1 = Math.floor(Math.max(a[0], b[0]) / CELL_DEG);
        const y0 = Math.floor(Math.min(a[1], b[1]) / CELL_DEG);
        const y1 = Math.floor(Math.max(a[1], b[1]) / CELL_DEG);
        for (let x = x0; x <= x1; x++) {
          for (let y = y0; y <= y1; y++) {
            const key = cellKey(x, y);
            const bucket = cells.get(key);
            if (bucket) bucket.push(seg);
            else cells.set(key, [seg]);
          }
        }
      }
    }
  }
  return { cells };
}

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LNG * Math.cos((lat * Math.PI) / 180);
}

function closestPointOnSegment(
  lng: number,
  lat: number,
  seg: Segment,
  mLng: number
): Position {
  const [ax, ay, bx, by] = seg;
  const vx = (bx - ax) * mLng;
  const vy = (by - ay) * METERS_PER_DEG_LAT;
  const wx = (lng - ax) * mLng;
  const wy = (lat - ay) * METERS_PER_DEG_LAT;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return [ax + (bx - ax) * t, ay + (by - ay) * t];
}

/** Nearest point on any indexed road segment within `maxMeters`, else null. */
export function nearestRoadPoint(
  index: RoadSnapIndex,
  lng: number,
  lat: number,
  maxMeters: number
): Position | null {
  const mLng = metersPerDegLng(lat);
  const cellX = CELL_DEG * mLng;
  const cellY = CELL_DEG * METERS_PER_DEG_LAT;
  const ring = Math.ceil(maxMeters / Math.min(cellX, cellY)) + 1;
  const cx = Math.floor(lng / CELL_DEG);
  const cy = Math.floor(lat / CELL_DEG);

  let best: Position | null = null;
  let bestMeters = maxMeters;

  for (let x = cx - ring; x <= cx + ring; x++) {
    for (let y = cy - ring; y <= cy + ring; y++) {
      const bucket = index.cells.get(cellKey(x, y));
      if (!bucket) continue;
      for (const seg of bucket) {
        const p = closestPointOnSegment(lng, lat, seg, mLng);
        const dx = (p[0] - lng) * mLng;
        const dy = (p[1] - lat) * METERS_PER_DEG_LAT;
        const d = Math.hypot(dx, dy);
        if (d < bestMeters) {
          bestMeters = d;
          best = p;
        }
      }
    }
  }
  return best;
}

/**
 * Builds the `toCustom` callback for TerraDrawLineStringMode. The pixel
 * threshold has to be applied here: TerraDraw uses a toCustom result verbatim,
 * so returning a far-away point would snap the vertex across the map.
 */
export function makeRoadSnap(
  indexRef: { current: RoadSnapIndex | null },
  snapPx = 32
) {
  return function snapToRoads(
    event: TerraDrawMouseEvent,
    ctx: SnappableContext
  ): Position | undefined {
    const index = indexRef.current;
    if (!index || index.cells.size === 0) return undefined;

    const p0 = ctx.project(event.lng, event.lat);
    const p1 = ctx.unproject(p0.x + snapPx, p0.y);
    const maxMeters = Math.hypot(
      (p1.lng - event.lng) * metersPerDegLng(event.lat),
      (p1.lat - event.lat) * METERS_PER_DEG_LAT
    );

    const hit = nearestRoadPoint(index, event.lng, event.lat, maxMeters);
    return hit ? [hit[0], hit[1]] : undefined;
  };
}
