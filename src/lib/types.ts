// Shared types - mirror of the deployed schema (supabase/migrations/20260817100000_schema.sql)

export type Role = "super_admin" | "editor" | "viewer";

export interface Profile {
  id: string;
  role: Role;
  region: string | null;
  full_name: string | null;
  created_at: string;
  updated_at: string;
}

export type DatasetId = "ruas_jalan" | "sekolah" | "rambu" | "apj";

export type GeometryType = "Point" | "LineString" | "Polygon";

export interface DatasetMeta {
  id: DatasetId;
  label: string;
  draftTable: string; // e.g. ruas_jalan_draft
  publishedTable: string; // e.g. ruas_jalan_published
  geometryType: GeometryType;
  regionField: string; // top-level column holding region for RLS
  regionLabel: string;
  sourceIdLabel: string; // human label of the original PK
  /** JSONB keys of original parquet properties that the dashboard form should show */
  formFields: { key: string; label: string; type: "text" | "number" | "select"; options?: string[] }[];
  /** Which properties column carries the region value (may differ from regionField for display) */
  regionPropertyKey: string | null;
  defaultColor: string;
}

export interface DraftRow {
  id: string;
  source_id: string;
  geometry: unknown; // PostGIS geometry - client converts via ST_AsGeoJSON
  properties: Record<string, unknown>;
  region: string;
  status: "draft" | "pending" | "approved" | "rejected";
  source_type: "master" | "field";
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EditWindow {
  dataset: DatasetId;
  open: boolean;
  opened_by: string | null;
  opened_at: string | null;
  note: string | null;
}

export interface AuditEntry {
  id: string;
  table_name: string;
  record_id: string;
  action: "INSERT" | "UPDATE" | "DELETE";
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  user_id: string | null;
  created_at: string;
}
