import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createQueryClient } from "./shared/api/queryClient";
import "./index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Elemento #root ausente em index.html");

createRoot(root).render(
  <StrictMode>
    <App queryClient={createQueryClient()} />
  </StrictMode>
);
