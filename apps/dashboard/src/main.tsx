import React from "react";
import { createRoot } from "react-dom/client";
import { Catalog } from "./catalog/Catalog.js";
import { CanvasApp } from "./canvas/CanvasApp.js";
import { Timeline } from "./activity/Timeline.js";
import { SessionGate } from "./auth/SessionGate.js";

const view = new URLSearchParams(window.location.search).get("view");
createRoot(document.getElementById("root")!).render(<React.StrictMode><SessionGate>{view === "canvas" ? <CanvasApp /> : view === "timeline" ? <Timeline /> : <Catalog />}</SessionGate></React.StrictMode>);
