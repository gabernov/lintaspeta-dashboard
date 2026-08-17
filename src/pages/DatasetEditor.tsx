import { useParams } from "react-router-dom";
import { getDataset } from "../lib/datasets";

export default function DatasetEditor() {
  const { datasetId } = useParams<{ datasetId: string }>();
  const meta = getDataset(datasetId ?? "");

  if (!meta) return <div className="page-loading">Dataset tidak dikenal</div>;

  return (
    <div className="page">
      <header className="page-header">
        <h1>{meta.label}</h1>
        <p className="muted">Editor peta (dibangun pada langkah berikutnya)</p>
      </header>
    </div>
  );
}
