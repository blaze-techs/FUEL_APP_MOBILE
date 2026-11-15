// Polyfills must be first - enables older browser compatibility
import "@/polyfills";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { TRPCProvider } from "@/providers/trpc";
import { FuelProProvider } from "@/react-app/components/FuelProProvider";
import { runAllStorageMigrations } from "@/react-app/lib/geo-utils";
import App from "./App.tsx";
import "@/react-app/styles/ux-principles.css";

// Run storage migrations at app startup before any component reads localStorage
runAllStorageMigrations();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <TRPCProvider>
      <FuelProProvider>
        <App />
      </FuelProProvider>
    </TRPCProvider>
  </StrictMode>,
);
