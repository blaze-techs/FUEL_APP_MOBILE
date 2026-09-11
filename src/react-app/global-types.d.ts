// Global ambient types for the React app. This file lives under src/react-app
// so it is picked up by `tsc -b` (tsconfig.app.json includes src/react-app),
// whereas src/vite-env.d.ts is only consumed by Vite at build time.

interface Window {
  __fuelproSafeReload?: (reason: string) => boolean;
  __BUILD_VERSION__?: string;
}
