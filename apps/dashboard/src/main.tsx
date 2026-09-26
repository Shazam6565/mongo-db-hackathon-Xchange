import React from "react";
import { createRoot } from "react-dom/client";
import { Catalog } from "./catalog/Catalog.js";

createRoot(document.getElementById("root")!).render(<React.StrictMode><Catalog /></React.StrictMode>);
