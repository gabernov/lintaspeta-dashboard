import type { FeatureCollection, Position } from "geojson";

/*
 * "Create route" for line datasets: the user clicks a start and an end point and
 * the line follows the reference road network, like onthegomap's routing.
 *
 * Everything runs in the browser: the network is only ~300 features / ~280k
 * coordinates, so a plain CSR graph plus A* answers in milliseconds. The graph
 * is built lazily (the first time the route tool is used) so it costs nothing on
 * a normal editor load.
 */

const METERS_PER_DEG_LAT = 110540;
const METERS_PER_DEG_LNG = 111320;
const KEY_PRECISION = 1e7;

export interface RoadGraph {
  n: number;
  head: Uint32Array;
  targets: Uint32Array;
  weights: Float64Array;
  xs: Float64Array;
  ys: Float64Array;
  keys: Map<string, number>;
}

function metersPerDegLng(lat: number): number {
  return METERS_PER_DEG_LNG * Math.cos((lat * Math.PI) / 180);
}

function segmentMeters(a: Position, b: Position): number {
  const mLng = metersPerDegLng((a[1] + b[1]) / 2);
  return Math.hypot(
    (b[0] - a[0]) * mLng,
    (b[1] - a[1]) * METERS_PER_DEG_LAT
  );
}

/** Every vertex becomes a node; vertices that share a rounded coordinate (road
 *  junctions, and the parts of a MultiLineString) become one shared node. */
export function buildRoadGraph(
  fc: FeatureCollection | null | undefined
): RoadGraph | null {
  if (!fc || fc.features.length === 0) return null;

  const keys = new Map<string, number>();
  const xs: number[] = [];
  const ys: number[] = [];
  const edgeU: number[] = [];
  const edgeV: number[] = [];
  const edgeW: number[] = [];

  const nodeOf = (lng: number, lat: number) => {
    const key = `${Math.round(lng * KEY_PRECISION)},${Math.round(lat * KEY_PRECISION)}`;
    const existing = keys.get(key);
    if (existing !== undefined) return existing;
    const id = xs.length;
    keys.set(key, id);
    xs.push(lng);
    ys.push(lat);
    return id;
  };

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
        const u = nodeOf(a[0], a[1]);
        const v = nodeOf(b[0], b[1]);
        if (u === v) continue;
        const w = segmentMeters(a, b);
        edgeU.push(u);
        edgeV.push(v);
        edgeW.push(w);
        edgeU.push(v);
        edgeV.push(u);
        edgeW.push(w);
      }
    }
  }

  const n = xs.length;
  const head = new Uint32Array(n + 1);
  for (const u of edgeU) head[u + 1]++;
  for (let i = 0; i < n; i++) head[i + 1] += head[i];
  const targets = new Uint32Array(edgeV.length);
  const weights = new Float64Array(edgeW.length);
  const cursor = head.slice(0, n);
  for (let e = 0; e < edgeU.length; e++) {
    const slot = cursor[edgeU[e]]++;
    targets[slot] = edgeV[e];
    weights[slot] = edgeW[e];
  }

  return {
    n,
    head,
    targets,
    weights,
    xs: Float64Array.from(xs),
    ys: Float64Array.from(ys),
    keys,
  };
}

/** Nearest graph node to a coordinate, or null when nothing is within `maxMeters`. */
export function nearestNode(
  graph: RoadGraph,
  lng: number,
  lat: number,
  maxMeters: number
): number | null {
  let best: number | null = null;
  let bestMeters = maxMeters;
  const mLng = metersPerDegLng(lat);
  for (let i = 0; i < graph.n; i++) {
    const d = Math.hypot(
      (graph.xs[i] - lng) * mLng,
      (graph.ys[i] - lat) * METERS_PER_DEG_LAT
    );
    if (d < bestMeters) {
      bestMeters = d;
      best = i;
    }
  }
  return best;
}

/** Binary min-heap over (priority, node) pairs. */
class MinHeap {
  private prio: number[] = [];
  private node: number[] = [];

  get size() {
    return this.node.length;
  }

  push(priority: number, node: number) {
    this.prio.push(priority);
    this.node.push(node);
    let i = this.node.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.prio[parent] <= this.prio[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.node[0];
    const lastPrio = this.prio.pop() as number;
    const lastNode = this.node.pop() as number;
    if (this.node.length > 0) {
      this.prio[0] = lastPrio;
      this.node[0] = lastNode;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.prio.length && this.prio[l] < this.prio[smallest]) smallest = l;
        if (r < this.prio.length && this.prio[r] < this.prio[smallest]) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.prio[a], this.prio[b]] = [this.prio[b], this.prio[a]];
    [this.node[a], this.node[b]] = [this.node[b], this.node[a]];
  }
}

export interface RouteResult {
  coordinates: Position[];
  meters: number;
}

/** A* shortest path along the graph, returned as coordinates + length. */
export function routeBetween(
  graph: RoadGraph,
  startNode: number,
  endNode: number
): RouteResult | null {
  // nearestNode() returns null when a click lands away from every road, so the
  // indices must be validated: an invalid one would otherwise make the path walk
  // below loop forever and hang the editor.
  if (
    !Number.isInteger(startNode) ||
    !Number.isInteger(endNode) ||
    startNode < 0 ||
    startNode >= graph.n ||
    endNode < 0 ||
    endNode >= graph.n
  ) {
    return null;
  }

  if (startNode === endNode) {
    return { coordinates: [[graph.xs[startNode], graph.ys[startNode]]], meters: 0 };
  }

  const tx = graph.xs[endNode];
  const ty = graph.ys[endNode];
  const heuristic = (i: number) => {
    const mLng = metersPerDegLng(graph.ys[i]);
    return Math.hypot(
      (graph.xs[i] - tx) * mLng,
      (graph.ys[i] - ty) * METERS_PER_DEG_LAT
    );
  };

  const gScore = new Float64Array(graph.n).fill(Infinity);
  const cameFrom = new Int32Array(graph.n).fill(-1);
  const closed = new Uint8Array(graph.n);
  const open = new MinHeap();

  gScore[startNode] = 0;
  open.push(heuristic(startNode), startNode);

  while (open.size > 0) {
    const current = open.pop();
    if (current === endNode) break;
    if (closed[current]) continue;
    closed[current] = 1;

    for (let e = graph.head[current]; e < graph.head[current + 1]; e++) {
      const next = graph.targets[e];
      if (closed[next]) continue;
      const tentative = gScore[current] + graph.weights[e];
      if (tentative < gScore[next]) {
        gScore[next] = tentative;
        cameFrom[next] = current;
        open.push(tentative + heuristic(next), next);
      }
    }
  }

  if (cameFrom[endNode] === -1) return null;

  const path: number[] = [];
  let node = endNode;
  for (let guard = 0; guard <= graph.n && node !== -1; guard++) {
    path.push(node);
    node = cameFrom[node];
  }
  path.reverse();

  return {
    coordinates: path.map((i) => [graph.xs[i], graph.ys[i]] as Position),
    meters: gScore[endNode],
  };
}
