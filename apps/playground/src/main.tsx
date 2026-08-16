import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "@valuz-genui/a2ui/styles.css";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
