export const ROAD_UPTD = ["UPTD-I", "UPTD-II", "UPTD-III", "UPTD-IV"];

export const UPTD_COLORS: Record<string, string> = {
  "UPTD-I": "#E11D48",
  "UPTD-II": "#2563EB",
  "UPTD-III": "#059669",
  "UPTD-IV": "#7C3AED",
};

export const ROAD_UPTD_FALLBACK = "#94A3B8";

export type RoadItem = { id: string; nama: string; kode: string; uptd: string; kab?: string };
