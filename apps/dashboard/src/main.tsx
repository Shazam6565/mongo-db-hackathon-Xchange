import React from "react";
import { createRoot } from "react-dom/client";
import { Catalog } from "./catalog/Catalog.js";

import { CanvasApp } from "./canvas/CanvasApp.js";

import { Timeline } from "./activity/Timeline.js";

createRoot(document.getElementById("root")!).render(<React.StrictMode>{new URLSearchParams(window.location.search).get("view") === "canvas" ? <CanvasApp /> : new URLSearchParams(window.location.search).get("view") === "timeline" ? <Timeline /> : <Catalog />}</React.StrictMode>);
