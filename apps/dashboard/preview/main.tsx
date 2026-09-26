import { canvasId } from "./api.js";
import "./preview.css";

const url = new URL(window.location.href);
const isCanvas = url.searchParams.get("view") === "canvas";
if (isCanvas && !url.searchParams.has("canvas")) {
  url.searchParams.set("canvas", canvasId);
  window.history.replaceState(null, "", url);
}
// Load the shared entry after setting the initial sample canvas deep link.
void import("../src/main.js");
