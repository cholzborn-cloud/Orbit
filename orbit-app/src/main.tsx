import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { designAnwenden } from "./features/einstellungen";
import { getSettings } from "./lib/api";
import { useOrbit } from "./lib/store";

// Standard: Hell/Dunkel folgt dem System (CSS prefers-color-scheme). Sobald der Dienst bereit ist, gilt die gespeicherte Wahl.
designAnwenden("system");
const stop = useOrbit.subscribe((s) => {
  if (!s.bereit) return;
  stop();
  getSettings().then((r) => designAnwenden(r.settings.theme)).catch(() => {});
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
