import React from "react";
import { createRoot } from "react-dom/client";
import { Catalog } from "./catalog/Catalog.js";
import { CanvasApp } from "./canvas/CanvasApp.js";
import { Timeline } from "./activity/Timeline.js";
import { Harness } from "./harness/Harness.js";
import { Landing } from "./landing/Landing.js";
import { SessionGate } from "./auth/SessionGate.js";

const view = new URLSearchParams(window.location.search).get("view");
// /about is a static overview page: it needs no session or API, so it renders outside the gate.
const app = window.location.pathname === "/about" ? <Landing /> : <SessionGate>{view === "canvas" ? <CanvasApp /> : view === "timeline" ? <Timeline /> : view === "harness" ? <Harness /> : <Catalog />}</SessionGate>;
createRoot(document.getElementById("root")!).render(<React.StrictMode>{app}</React.StrictMode>);
