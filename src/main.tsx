import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { setWorkerUrl } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import "./style.css";
import App from "./App";
import { AuthProvider } from "./auth/AuthContext";

// MapLibre GL v6 requires an explicit worker URL under bundlers (Vite).
// Without it, the map mounts but never requests/decodes vector tiles.
setWorkerUrl(maplibreWorkerUrl);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
