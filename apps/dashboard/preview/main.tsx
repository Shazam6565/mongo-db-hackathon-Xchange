import { canvasId } from "./api.js";
import React from "react";
import { createRoot } from "react-dom/client";
import { Catalog } from "../src/catalog/Catalog.js";
import { CanvasApp } from "../src/canvas/CanvasApp.js";
import { Timeline } from "../src/activity/Timeline.js";
import "./preview.css";

const url = new URL(window.location.href);
const isCanvas = url.searchParams.get("view") === "canvas";
if (isCanvas && !url.searchParams.has("canvas")) {
  url.searchParams.set("canvas", canvasId);
  window.history.replaceState(null, "", url);
}
const view = url.searchParams.get("view");
createRoot(document.getElementById("root")!).render(<React.StrictMode>{view === "canvas" ? <CanvasApp /> : view === "timeline" ? <Timeline /> : <Catalog />}</React.StrictMode>);
