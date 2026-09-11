/// <reference types="vite/client" />

// Global reload guard injected by index.html — all reload paths go through
// this to prevent infinite refresh loops. Declared here (inside the
// tsconfig.app.json `include` scope) so `tsc -b` typechecks window usages.
interface Window {
  __fuelproSafeReload?: (reason: string) => boolean;
  __BUILD_VERSION__?: string;
}
