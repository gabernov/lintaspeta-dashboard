import { useState, useEffect } from "react";
import type { DatasetMeta } from "../../lib/types";
import type { Feature } from "geojson";

type GeoProps = Record<string, unknown>;

interface Props {
  meta: DatasetMeta;
  feature: Feature | null;
  mode: "create" | "update";
  canEdit: boolean;
  canDelete: boolean;
  onSave: (values: GeoProps) => void;
  onDelete: () => void;
  onClose: () => void;
  saving: boolean;
  prefill?: GeoProps | null;
  hint?: string | null;
}

export default function AttributeForm({
  meta,
  feature,
  mode,
  canEdit,
  canDelete,
  onSave,
  onDelete,
  onClose,
  saving,
  prefill,
  hint,
}: Props) {
  const [values, setValues] = useState<Record<string, string | number>>({});

  useEffect(() => {
    const init: Record<string, string | number> = {};
    const src =
      mode === "update" && feature?.properties ? feature.properties : {};
    for (const f of meta.formFields) {
      const v = src[f.key];
      init[f.key] = v != null ? (typeof v === "number" ? v : String(v)) : "";
    }
    // Create-mode autofill (e.g. nearest-ruas lookup) only fills empty
    // fields — never overwrites something the user already typed.
    if (mode === "create" && prefill) {
      for (const f of meta.formFields) {
        if (init[f.key] !== "") continue;
        const v = prefill[f.key];
        if (v != null && v !== "") init[f.key] = String(v);
      }
    }
    setValues(init);
  }, [feature, mode, meta.formFields, prefill]);

  const handleChange = (key: string, val: string | number) => {
    setValues((prev) => ({ ...prev, [key]: val }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(values);
  };

  return (
    <div className="ed-panel">
      <div className="ed-panel-header">
        <h3>{mode === "create" ? "Tambah Fitur Baru" : "Edit Fitur"}</h3>
        <button className="ed-btn-icon" onClick={onClose} title="Tutup panel">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {mode === "update" && feature?.properties && (
        <div className="ed-panel-meta">
          <span className="ed-badge ed-badge-status">
            {String(feature.properties._status ?? "draft")}
          </span>
          <span className="ed-badge ed-badge-source">
            {String(feature.properties._source_type ?? "master")}
          </span>
          {feature.properties._region && (
            <span className="ed-badge ed-badge-region">
              {String(feature.properties._region)}
            </span>
          )}
        </div>
      )}

      <form className="ed-form" onSubmit={handleSubmit}>
        {hint && mode === "create" && (
          <div className="ed-autofill-hint">{hint}</div>
        )}
        {meta.formFields.map((field) => (
          <label key={field.key} className="ed-form-field">
            <span className="ed-form-label">{field.label}</span>
            {field.type === "select" && field.options ? (
              <select
                className="ed-form-input"
                value={String(values[field.key] ?? "")}
                onChange={(e) => handleChange(field.key, e.target.value)}
                disabled={!canEdit}
              >
                <option value="">— Pilih —</option>
                {field.options.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            ) : field.type === "number" ? (
              <input
                type="number"
                step="any"
                className="ed-form-input"
                value={values[field.key] != null ? String(values[field.key]) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  handleChange(field.key, v === "" ? "" : Number(v));
                }}
                disabled={!canEdit}
              />
            ) : (
              <input
                type="text"
                className="ed-form-input"
                value={String(values[field.key] ?? "")}
                onChange={(e) => handleChange(field.key, e.target.value)}
                disabled={!canEdit}
              />
            )}
          </label>
        ))}

        <div className="ed-form-actions">
          {canEdit && (
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? "Menyimpan…" : "Simpan"}
            </button>
          )}
          {canDelete && mode === "update" && (
            <button
              type="button"
              className="ed-btn-danger"
              onClick={onDelete}
              disabled={saving}
            >
              Hapus
            </button>
          )}
        </div>

        {!canEdit && (
          <p className="ed-form-locked">
            Jendela edit tertutup — hubungi super admin.
          </p>
        )}
      </form>
    </div>
  );
}
