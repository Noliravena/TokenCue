import React from "react";
import ReactDOM from "react-dom/client";
import "./assets/fonts/fonts.css";
import "./generated/designTokens.css";
import "./styles.css";
import "./tokencue.css";

async function bootstrap() {
  // Vite's browser-only preview is used for design review and never ships a
  // second application implementation. It installs the same typed IPC
  // boundary that the native shell exposes, then renders the real React tree.
  if (!("__TAURI_INTERNALS__" in window)) {
    const { installPreviewBackend } = await import("./previewBackend");
    installPreviewBackend();
  }

  const { default: App } = await import("./App");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
